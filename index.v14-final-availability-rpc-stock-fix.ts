import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";


import {
  ECOMMERCE_GENERIC_TYPE_WORDS,
  ECOMMERCE_PRODUCT_BRAND_WORDS,
  ECOMMERCE_PRODUCT_BRAND_GROUPS,
  ECOMMERCE_PRODUCT_FAMILIES,
  ECOMMERCE_PRODUCT_SYNONYMS,
  ECOMMERCE_PRODUCT_TYPE_WORDS,
} from "./data/ecommerceProductLexicon.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ChatMessage = {
  role: "user" | "assistant" | "model";
  content: string;
};

type RequestBody = {
  messages: ChatMessage[];
  language?: "ar" | "en";
  mode?: "chat" | "analyze";
  /** Optional pre-analysis sent by the UI to avoid analyzing the same user text twice. */
  analysis?: AiIntentAnalysis;
  /**
   * مهم:
   * piRate هنا يأتي من الواجهة من:
   * calculatePrice(1, 'free').priceInPi
   *
   * يعني: كم Pi يقابل 1 EGP.
   * لذلك حساب سعر المنتج يكون:
   * local_price_egp * piRate
   */
  piRate?: number;
  userName?: string;
  userId?: string;
};

type ProductMatch = {
  id: string;
  name?: string | null;
  name_ar?: string | null;
  description?: string | null;
  description_ar?: string | null;
  image?: string | null;
  category?: string | null;
  category_ar?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  category_name_ar?: string | null;
  price?: number | string | null;
  local_price_egp?: number | string | null;
  min_amount_egp?: number | string | null;
  max_amount_egp?: number | string | null;
  original_price?: number | string | null;
  source?: "merchant" | "admin" | "service" | string | null;
  merchant_id?: string | null;
  merchant_name?: string | null;
  in_stock?: boolean | null;
  stock_quantity?: number | string | null;
  shipping_type?: string | null;
  tags?: string[] | string | null;
};

type KnowledgeMatch = {
  id?: string | null;
  section?: string | null;
  source_table?: string | null;
  source_id?: string | null;
  source_key?: string | null;
  title?: string | null;
  title_ar?: string | null;
  content?: string | null;
  content_ar?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  similarity?: number | null;
};

type CategoryRow = {
  id?: string | null;
  name?: string | null;
  name_ar?: string | null;
  slug?: string | null;
};

type MerchantRow = {
  id: string;
  name?: string | null;
  specialty?: string | null;
  country?: string | null;
  slug?: string | null;
  bio?: string | null;
};

type StoreSettingsRow = {
  store_name?: string | null;
  store_description?: string | null;
  store_description_ar?: string | null;
  support_email?: string | null;
  admin_whatsapp?: string | null;
};

const GROQ_MODEL = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openrouter/free";
const CEREBRAS_MODEL = Deno.env.get("CEREBRAS_MODEL") || "gpt-oss-120b";
const GEMINI_GENERATE_MODEL = Deno.env.get("GEMINI_GENERATE_MODEL") || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-2.0-flash";
const GEMINI_EMBEDDING_MODEL = Deno.env.get("GEMINI_EMBEDDING_MODEL") || "gemini-embedding-001";
const AI_PROVIDER_ORDER = Deno.env.get("AI_PROVIDER_ORDER") || "groq,openrouter,gemini,cerebras";
const SITE_URL = Deno.env.get("SITE_URL") || "https://salla-shop.com";
const APP_NAME = Deno.env.get("APP_NAME") || "Salla Shop Mall";

const CATEGORY_CACHE_DURATION = 60 * 60 * 1000;
const STATIC_CONTEXT_CACHE_DURATION = 15 * 60 * 1000;

const MAX_MESSAGE_HISTORY = 10;
const MAX_PRODUCT_MATCHES = 12;
const MAX_TEXT_PRODUCT_MATCHES = 80;
const MAX_KNOWLEDGE_MATCHES = 10;
const MAX_TEXT_KNOWLEDGE_MATCHES = 6;
const MAX_MERCHANT_MATCHES = 6;
const MAX_CONTEXT_CHARS = 14000;
const MAX_COUPON_CONTEXT_ROWS = 8;
const MAX_ORDER_CONTEXT_ROWS = 6;
const PRODUCT_VECTOR_MATCH_THRESHOLD = 0.26;
const KNOWLEDGE_VECTOR_MATCH_THRESHOLD = 0.30;
const MIN_PRODUCT_CONTEXT_SCORE = 65;
const AI_TEMPERATURE = 0.15;
const AI_TOP_P = 0.75;
const AI_MAX_TOKENS = 700;

let cachedCategoriesContext = "";
let cachedCategoriesLang = "";
let lastCategoryCacheTime = 0;

let cachedStaticMallContext = "";
let cachedStaticMallLang = "";
let lastStaticCacheTime = 0;

const jsonResponse = (data: unknown, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
};

const cleanText = (value: unknown, fallback = "") => {
  return String(value ?? fallback)
    .replace(/\s+/g, " ")
    .trim();
};

const cleanMultiline = (value: unknown, fallback = "") => {
  return String(value ?? fallback)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const truncateText = (value: string, maxChars: number) => {
  if (!value || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trim()}...`;
};

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const isProductAvailableForChat = (product: ProductMatch) => {
  if (product.source === "service") return true;
  if (product.in_stock === false) return false;

  /*
   * بعض منتجات المدير/التجار تكون متاحة في الواجهة لأن in_stock=true
   * لكن stock_quantity يكون null أو غير مستخدم.
   * لا نحذفها من الشات في هذه الحالة؛ نحذف فقط الكمية الصفرية الصريحة.
   */
  if (product.stock_quantity === null || product.stock_quantity === undefined || cleanText(product.stock_quantity) === "") {
    return product.in_stock === true;
  }

  return toNumber(product.stock_quantity) > 0;
};

const isArabicLanguage = (language?: string) => language === "ar";

const getLastUserQuery = (messages: ChatMessage[]) => {
  const userMessages = (messages || []).filter((message) => message.role === "user");
  return cleanText(userMessages[userMessages.length - 1]?.content);
};

const getConversationSearchText = (messages: ChatMessage[]) => {
  return (messages || [])
    .slice(-4)
    .filter((message) => message.role === "user")
    .map((message) => cleanText(message.content))
    .filter(Boolean)
    .join("\n");
};

const limitMessages = (messages: ChatMessage[], maxMessages = MAX_MESSAGE_HISTORY) => {
  return (messages || []).slice(-maxMessages).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: cleanText(message.content) }],
  }));
};

const escapeIlikeTerm = (value: string) => {
  return cleanText(value)
    .replace(/[%_\\]/g, " ")
    .replace(/[(){}[\]|&!:;'",.?؟،؛]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const uniqueBy = <T>(items: T[], getKey: (item: T) => string) => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
};

const getFallbackMessage = (isArabic: boolean, userName?: string) => {
  const name = cleanText(userName, isArabic ? "عزيزي" : "friend");

  return isArabic
    ? `عذرا يا ${name}، هناك ضغط كبير على المساعد الذكي حاليا ⏳. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.`
    : `Sorry ${name}, our AI assistant is experiencing high traffic right now ⏳. Please wait a minute and try again.`;
};

const openAiStyleSseFallback = (message: string) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: message } }],
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};


const THINK_OPEN_TAGS = ["<think>", "<thinking>"];
const THINK_CLOSE_TAGS = ["</think>", "</thinking>"];

const findFirstTagIndex = (value: string, tags: string[]) => {
  const lowerValue = value.toLowerCase();
  let bestIndex = -1;
  let bestTag = "";

  for (const tag of tags) {
    const index = lowerValue.indexOf(tag);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestTag = tag;
    }
  }

  return { index: bestIndex, tag: bestTag };
};

const getPartialThinkTagSuffix = (value: string) => {
  const lowerValue = value.toLowerCase();
  const allTags = [...THINK_OPEN_TAGS, ...THINK_CLOSE_TAGS];
  let best = "";

  for (const tag of allTags) {
    const maxLength = Math.min(tag.length - 1, lowerValue.length);
    for (let length = 1; length <= maxLength; length += 1) {
      const suffix = lowerValue.slice(-length);
      if (tag.startsWith(suffix) && length > best.length) {
        best = value.slice(-length);
      }
    }
  }

  return best;
};

type ThinkSanitizerState = {
  buffer: string;
  insideThinkBlock: boolean;
};

const sanitizeThinkContentChunk = (chunk: string, state: ThinkSanitizerState) => {
  let value = `${state.buffer}${chunk}`;
  state.buffer = "";
  let output = "";

  while (value) {
    if (state.insideThinkBlock) {
      const closeTag = findFirstTagIndex(value, THINK_CLOSE_TAGS);

      if (closeTag.index === -1) {
        state.buffer = value.slice(-24);
        return output;
      }

      value = value.slice(closeTag.index + closeTag.tag.length);
      state.insideThinkBlock = false;
      continue;
    }

    const openTag = findFirstTagIndex(value, THINK_OPEN_TAGS);

    if (openTag.index === -1) {
      const partial = getPartialThinkTagSuffix(value);

      if (partial) {
        output += value.slice(0, -partial.length);
        state.buffer = partial;
      } else {
        output += value;
      }

      return output;
    }

    output += value.slice(0, openTag.index);
    value = value.slice(openTag.index + openTag.tag.length);
    state.insideThinkBlock = true;
  }

  return output;
};

const extractSseContent = (parsed: any) => {
  const content =
    parsed?.choices?.[0]?.delta?.content ||
    parsed?.choices?.[0]?.message?.content ||
    parsed?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";

  return typeof content === "string" ? content : "";
};

const createOpenAiStyleSseLine = (content: string) => {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
};

const sanitizeAiSseStream = (body: ReadableStream<Uint8Array> | null) => {
  if (!body) return null;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const sanitizerState: ThinkSanitizerState = {
    buffer: "",
    insideThinkBlock: false,
  };

  let sseBuffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          let newlineIndex: number;

          while ((newlineIndex = sseBuffer.indexOf("\n")) !== -1) {
            let line = sseBuffer.slice(0, newlineIndex);
            sseBuffer = sseBuffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":")) continue;
            if (line.trim() === "") continue;
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();

            if (data === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const rawContent = extractSseContent(parsed);

              if (!rawContent) continue;

              const safeContent = sanitizeThinkContentChunk(rawContent, sanitizerState);

              if (safeContent.trim()) {
                controller.enqueue(encoder.encode(createOpenAiStyleSseLine(safeContent)));
              }
            } catch {
              continue;
            }
          }
        }

        const tail = decoder.decode();
        if (tail) sseBuffer += tail;

        if (sseBuffer.trim().startsWith("data:")) {
          const data = sseBuffer.trim().slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data);
              const rawContent = extractSseContent(parsed);
              const safeContent = sanitizeThinkContentChunk(rawContent, sanitizerState);
              if (safeContent.trim()) {
                controller.enqueue(encoder.encode(createOpenAiStyleSseLine(safeContent)));
              }
            } catch {
              // Ignore malformed trailing SSE data.
            }
          }
        }

        const flushed = sanitizeThinkContentChunk("", sanitizerState);
        if (flushed.trim()) {
          controller.enqueue(encoder.encode(createOpenAiStyleSseLine(flushed)));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        console.warn("AI SSE sanitize stream failed:", error instanceof Error ? error.message : String(error));
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
};

const retryableAiStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

type AiProviderName = "groq" | "openrouter" | "gemini" | "cerebras";

type AiProvider = {
  name: AiProviderName;
  model: string;
  apiKey: string;
  endpoint?: string;
  type: "openai-compatible" | "gemini";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableAiStatus = (status: number) => retryableAiStatuses.has(status);

const toOpenAiMessages = (systemPrompt: string, messages: ChatMessage[]) => {
  const safeMessages = (messages || []).slice(-MAX_MESSAGE_HISTORY).map((message) => ({
    role: message.role === "assistant" || message.role === "model" ? "assistant" : "user",
    content: cleanText(message.content),
  })).filter((message) => message.content);

  return [
    { role: "system", content: systemPrompt },
    ...safeMessages,
  ];
};

const buildGeminiGenerateUrl = (apiKey: string, model: string) => {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
};

const getConfiguredAiProviders = () => {
  const providerMap: Record<AiProviderName, AiProvider | null> = {
    groq: Deno.env.get("GROQ_API_KEY")
      ? {
          name: "groq",
          type: "openai-compatible",
          endpoint: "https://api.groq.com/openai/v1/chat/completions",
          apiKey: Deno.env.get("GROQ_API_KEY") || "",
          model: GROQ_MODEL,
        }
      : null,
    openrouter: Deno.env.get("OPENROUTER_API_KEY")
      ? {
          name: "openrouter",
          type: "openai-compatible",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          apiKey: Deno.env.get("OPENROUTER_API_KEY") || "",
          model: OPENROUTER_MODEL,
        }
      : null,
    cerebras: Deno.env.get("CEREBRAS_API_KEY")
      ? {
          name: "cerebras",
          type: "openai-compatible",
          endpoint: "https://api.cerebras.ai/v1/chat/completions",
          apiKey: Deno.env.get("CEREBRAS_API_KEY") || "",
          model: CEREBRAS_MODEL,
        }
      : null,
    gemini: Deno.env.get("GEMINI_API_KEY")
      ? {
          name: "gemini",
          type: "gemini",
          apiKey: Deno.env.get("GEMINI_API_KEY") || "",
          model: GEMINI_GENERATE_MODEL,
        }
      : null,
  };

  const requestedOrder = AI_PROVIDER_ORDER
    .split(",")
    .map((provider) => cleanText(provider).toLowerCase())
    .filter(Boolean) as AiProviderName[];

  const ordered = requestedOrder
    .map((providerName) => providerMap[providerName])
    .filter(Boolean) as AiProvider[];

  return ordered.length
    ? ordered
    : (Object.values(providerMap).filter(Boolean) as AiProvider[]);
};

const isGroqReasoningModel = (model: string) => {
  const normalizedModel = cleanText(model).toLowerCase();

  return (
    normalizedModel.includes("qwen") ||
    normalizedModel.includes("qwq") ||
    normalizedModel.includes("deepseek") ||
    normalizedModel.includes("reasoning")
  );
};

const fetchOpenAiCompatibleStream = async ({
  provider,
  systemPrompt,
  messages,
}: {
  provider: AiProvider;
  systemPrompt: string;
  messages: ChatMessage[];
}) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };

  if (provider.name === "openrouter") {
    headers["HTTP-Referer"] = SITE_URL;
    headers["X-Title"] = APP_NAME;
  }

  return fetch(provider.endpoint || "", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: toOpenAiMessages(systemPrompt, messages),
      stream: true,
      temperature: AI_TEMPERATURE,
      top_p: AI_TOP_P,
      max_tokens: AI_MAX_TOKENS,
      ...(provider.name === "groq" && isGroqReasoningModel(provider.model)
        ? { reasoning_format: "hidden" }
        : {}),
    }),
  });
};

const fetchGeminiStream = async ({
  provider,
  systemPrompt,
  geminiMessages,
}: {
  provider: AiProvider;
  systemPrompt: string;
  geminiMessages: ReturnType<typeof limitMessages>;
}) => {
  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: geminiMessages,
    generationConfig: {
      temperature: AI_TEMPERATURE,
      topP: AI_TOP_P,
      maxOutputTokens: AI_MAX_TOKENS,
    },
  };

  return fetch(buildGeminiGenerateUrl(provider.apiKey, provider.model), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
};

const fetchAiStreamWithProviderFallback = async ({
  systemPrompt,
  messages,
}: {
  systemPrompt: string;
  messages: ChatMessage[];
}) => {
  const providers = getConfiguredAiProviders();

  if (!providers.length) {
    throw new Error("No AI provider key is configured. Add GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, or CEREBRAS_API_KEY.");
  }

  const geminiMessages = limitMessages(messages);
  let lastResponse: Response | null = null;
  let lastProviderName = "unknown";
  let lastErrorBody = "";

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = provider.type === "gemini"
          ? await fetchGeminiStream({ provider, systemPrompt, geminiMessages })
          : await fetchOpenAiCompatibleStream({ provider, systemPrompt, messages });

        if (response.ok) {
          console.info("AI provider selected:", {
            provider: provider.name,
            model: provider.model,
            attempt,
          });
          return response;
        }

        const errorBody = await response.text();
        lastResponse = response;
        lastProviderName = provider.name;
        lastErrorBody = errorBody;

        console.warn("AI provider attempt failed:", {
          provider: provider.name,
          model: provider.model,
          attempt,
          status: response.status,
          retryable: isRetryableAiStatus(response.status),
          body: truncateText(errorBody, 800),
        });

        if (!isRetryableAiStatus(response.status)) break;
        await sleep(attempt * 350);
      } catch (error) {
        console.warn("AI provider network/error failed:", {
          provider: provider.name,
          model: provider.model,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(attempt * 350);
      }
    }
  }

  if (lastResponse) {
    console.error("All AI providers failed:", {
      lastProviderName,
      status: lastResponse.status,
      body: truncateText(lastErrorBody, 1200),
    });
    return lastResponse;
  }

  throw new Error("All AI provider requests failed before receiving a response");
};


type AiIntentAnalysis = {
  intent:
    | "product_search" | "add_to_cart" | "show_cart" | "coupons" | "orders" | "compare_products"
    | "support" | "payment" | "st_info" | "pi_info" | "pi_st_compare"
    | "general_mall_question" | "general_external_question" | "clarification" | "unknown";
  action?: "search" | "add_to_cart" | "open_cart" | "show_coupons" | "track_orders" | "compare" | "answer" | "clarify";
  product_query?: string;
  category_hint?: string;
  target_index?: number | null;
  quantity?: number;
  availability_required?: boolean;
  needs_mall_data?: boolean;
  allow_external_knowledge?: boolean;
  is_financial_topic?: boolean;
  topic?: string;
  confidence?: number;
  language?: "ar" | "en";
  reason?: string;
};

const defaultAiIntentAnalysis = (isArabic: boolean): AiIntentAnalysis => ({
  intent: "unknown",
  action: "answer",
  confidence: 0.2,
  language: isArabic ? "ar" : "en",
  needs_mall_data: false,
  allow_external_knowledge: true,
});


const PRODUCT_SEARCH_INTENTS = new Set(["product_search", "add_to_cart"]);

const mergeSearchQueries = (...queries: Array<string | undefined | null>) => {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const query of queries) {
    const cleaned = cleanText(query);
    if (!cleaned) continue;
    const normalized = normalizeIntentText(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parts.push(cleaned);
  }

  return parts.join("\n");
};

const shouldForceProductIntentFromText = (query: string) => {
  const decision = getProductSearchDecision(query);
  return decision.shouldSearch;
};

const strengthenProductAnalysisWithRawText = (analysis: AiIntentAnalysis, lastUserQuery: string): AiIntentAnalysis => {
  const rawSaysProduct = shouldForceProductIntentFromText(lastUserQuery);
  if (!rawSaysProduct) return analysis;

  if (PRODUCT_SEARCH_INTENTS.has(analysis.intent)) return analysis;

  return {
    ...analysis,
    intent: "product_search",
    action: "search",
    product_query: cleanText(analysis.product_query) || lastUserQuery,
    needs_mall_data: true,
    allow_external_knowledge: false,
    confidence: Math.max(clampConfidence(analysis.confidence, 0.5), 0.75),
  };
};

const clampConfidence = (value: unknown, fallback = 0.5) => {
  const numberValue = Number(value ?? fallback);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(1, numberValue));
};

const safeParseAnalyzerJson = (value: string, isArabic: boolean): AiIntentAnalysis => {
  const text = cleanText(value);
  if (!text) return defaultAiIntentAnalysis(isArabic);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return defaultAiIntentAnalysis(isArabic);

  try {
    const parsed = JSON.parse(jsonMatch[0]) as AiIntentAnalysis;
    const allowedIntents = new Set([
      "product_search", "add_to_cart", "show_cart", "coupons", "orders", "compare_products",
      "support", "payment", "st_info", "pi_info", "pi_st_compare", "general_mall_question",
      "general_external_question", "clarification", "unknown",
    ]);
    const intent = allowedIntents.has(parsed.intent) ? parsed.intent : "unknown";
    return {
      ...defaultAiIntentAnalysis(isArabic),
      ...parsed,
      intent,
      product_query: truncateText(cleanText(parsed.product_query), 120),
      category_hint: truncateText(cleanText(parsed.category_hint), 80),
      topic: truncateText(cleanText(parsed.topic), 160),
      target_index: typeof parsed.target_index === "number" && parsed.target_index >= 0 ? Math.floor(parsed.target_index) : null,
      quantity: Math.max(1, Math.min(99, Math.floor(toNumber(parsed.quantity, 1)))) || 1,
      confidence: clampConfidence(parsed.confidence, 0.5),
      language: isArabic ? "ar" : "en",
    };
  } catch {
    return defaultAiIntentAnalysis(isArabic);
  }
};

const buildIntentAnalyzerPrompt = (isArabic: boolean) => {
  const languageRule = isArabic ? "Arabic" : "English";
  return `You are the intent analyzer for Salla Shop Mall, a Web3 marketplace. Return ONLY valid compact JSON. No markdown, no explanation.

You do NOT answer the customer and you do NOT choose real products. You only understand the full customer text and extract an actionable intent for mall data resolvers.

Allowed intents:
- product_search: user wants to find/browse/check available products, even natural language like "ايه الشاي المتوفر" or "هل فيه غلايات".
- add_to_cart: user asks to add something to cart, including named products like "ضيف الغلاية للسلة" or ordinal references like "ضيف الأول".
- show_cart, coupons, orders, compare_products, support, payment, st_info, pi_info, pi_st_compare, general_mall_question, general_external_question, clarification, unknown.

Rules:
1. Analyze the CURRENT USER TEXT semantically. Previous conversation is context only and must not override the current user text. Do not rely on fixed keywords. Handle Arabic typos, colloquial spelling, missing letters, and keyboard mistakes.
2. If the user asks about a product category/type/name, set product_search and put the clean searchable product phrase ONLY in product_query. Remove verbs and filler words. Examples: "يسأل عن شاي العروسه" => product_query="شاي العروسه"; "هل فيه منتجات مكتبه" => product_query="منتجات مكتبه"; "ايه الشاي المتوفر" => product_query="شاي"; "ارخص موابيل ايه" => product_query="موبايل"; "ارخص موبايبل ايه" => product_query="موبايل"; "موبايلات سامسون" => product_query="موبايل سامسونج"; "فيه تليفونات؟" => product_query="تليفون".
3. If the user asks what is available, set availability_required=true.
4. If user asks to add to cart, set add_to_cart. If a product name is mentioned, put the exact clean product phrase in product_query, not an ordinal. If only ordinal is mentioned, set target_index zero-based: first=0, second=1, third=2.
5. Do not confuse Pi with ST. Pi-only question => pi_info or general_external_question if it asks investment/opinion. ST-only question => st_info. Comparison only if both are explicitly mentioned.
6. Product prices, stock, coupons, orders, and policies must be resolved by mall data later; do not invent them.
7. For finance/crypto opinions, set is_financial_topic=true and allow_external_knowledge=true.
8. Use customer language: ${languageRule}.

JSON schema:
{"intent":"product_search|add_to_cart|show_cart|coupons|orders|compare_products|support|payment|st_info|pi_info|pi_st_compare|general_mall_question|general_external_question|clarification|unknown","action":"search|add_to_cart|open_cart|show_coupons|track_orders|compare|answer|clarify","product_query":"","category_hint":"","target_index":null,"quantity":1,"availability_required":true,"needs_mall_data":true,"allow_external_knowledge":false,"is_financial_topic":false,"topic":"","confidence":0.0}`;
};

const fetchAiTextWithProviderFallback = async ({
  systemPrompt,
  userPrompt,
  maxTokens = 320,
  temperature = 0.05,
}: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}) => {
  const providers = getConfiguredAiProviders();
  if (!providers.length) throw new Error("No AI provider key is configured. Add GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, or CEREBRAS_API_KEY.");
  let lastError = "";

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        if (provider.type === "gemini") {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature, topP: 0.7, maxOutputTokens: maxTokens },
            }),
          });
          if (response.ok) {
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("") || "";
            if (cleanText(text)) return text;
          } else lastError = await response.text();
        } else {
          const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` };
          if (provider.name === "openrouter") {
            headers["HTTP-Referer"] = SITE_URL;
            headers["X-Title"] = APP_NAME;
          }
          const response = await fetch(provider.endpoint || "", {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: provider.model,
              messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
              stream: false,
              temperature,
              top_p: 0.7,
              max_tokens: maxTokens,
              ...(provider.name === "groq" && isGroqReasoningModel(provider.model) ? { reasoning_format: "hidden" } : {}),
            }),
          });
          if (response.ok) {
            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content || "";
            if (cleanText(text)) return text;
          } else lastError = await response.text();
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleep(attempt * 150);
    }
  }
  throw new Error(`AI text fallback failed: ${truncateText(lastError, 500)}`);
};

const analyzeUserIntentWithAI = async ({ messages, lastUserQuery, isArabic }: { messages: ChatMessage[]; lastUserQuery: string; isArabic: boolean; }) => {
  try {
    const recentContext = (messages || []).slice(-4).map((message) => `${message.role}: ${cleanText(message.content)}`).join("\n");
    const raw = await fetchAiTextWithProviderFallback({
      systemPrompt: buildIntentAnalyzerPrompt(isArabic),
      userPrompt: `Recent conversation:\n${recentContext}\n\nCurrent user text:\n${lastUserQuery}`,
      maxTokens: 320,
      temperature: 0.02,
    });
    const parsed = safeParseAnalyzerJson(raw, isArabic);
    console.info("AI intent analyzer:", { intent: parsed.intent, action: parsed.action, product_query: parsed.product_query, target_index: parsed.target_index, confidence: parsed.confidence });
    return parsed;
  } catch (error) {
    console.warn("AI intent analyzer failed; using conservative fallback:", error instanceof Error ? error.message : String(error));
    return defaultAiIntentAnalysis(isArabic);
  }
};

const normalizeIntentText = (value: string) => {
  return cleanText(value)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // مهم للبحث العربي: العروسة/العروسه، مكتبة/مكتبه، غلاية/غلايه
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const stripArabicDefiniteArticle = (value: string) => {
  const normalized = normalizeIntentText(value);
  return normalized
    .split(" ")
    .map((word) => word.startsWith("ال") && word.length > 4 ? word.slice(2) : word)
    .join(" ")
    .trim();
};

const getNormalizedTextVariants = (value: string) => {
  const normalized = normalizeIntentText(value);
  const noArticle = stripArabicDefiniteArticle(value);
  const variants = new Set<string>();

  [normalized, noArticle].forEach((item) => {
    if (item) variants.add(item);
  });

  // Arabic Ta marbuta / Ha variants and common definite-article form.
  Array.from(variants).forEach((item) => {
    variants.add(item.replace(/ه/g, "ة"));
    variants.add(item.replace(/ة/g, "ه"));
    if (item && !item.startsWith("ال") && /[؀-ۿ]/.test(item)) {
      variants.add(`ال${item}`);
    }
  });

  return Array.from(variants).map(cleanText).filter(Boolean);
};

const getArabicOrthographicVariants = (value: string) => {
  const raw = cleanText(value);
  const normalized = normalizeIntentText(value);
  const variants = new Set<string>();

  [raw, normalized, stripArabicDefiniteArticle(value)].forEach((item) => {
    const cleaned = cleanText(item);
    if (cleaned) variants.add(cleaned);
  });

  Array.from(variants).forEach((item) => {
    if (!item) return;
    variants.add(item.replace(/ه/g, "ة"));
    variants.add(item.replace(/ة/g, "ه"));
    variants.add(item.replace(/ا/g, "أ"));
    variants.add(item.replace(/ا/g, "إ"));
  });

  return Array.from(variants)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 2);
};


type AssistantIntent =
  | "greeting"
  | "coupon"
  | "support"
  | "product"
  | "merchant"
  | "st"
  | "pi"
  | "pi_general"
  | "compare_pi_st"
  | "payment"
  | "order"
  | "returns"
  | "category"
  | "general";

const hasAnyIntentWord = (normalized: string, words: string[]) => {
  return words.some((word) => normalized.includes(normalizeIntentText(word)));
};

const COUPON_QUERY_WORDS = [
  "كوبون",
  "كوبونات",
  "كود خصم",
  "اكواد خصم",
  "أكواد خصم",
  "قسيمة",
  "قسائم",
  "برومو كود",
  "coupon",
  "coupons",
  "promo code",
  "discount code",
  "voucher",
  "vouchers",
];

const PRODUCT_QUERY_WORDS = [
  "منتج",
  "منتجات",
  "اشتري",
  "شراء",
  "عايز",
  "عاوز",
  "ابحث",
  "هات",
  "اعرض",
  "سعر",
  "ارخص",
  "الأرخص",
  "افضل",
  "أفضل",
  "موبايل",
  "موبايلات",
  "الموبايلات",
  "هاتف",
  "هواتف",
  "الهاتف",
  "الهواتف",
  "جوال",
  "جوالات",
  "سامسونج",
  "samsung",
  "iphone",
  "ايفون",
  "شاومي",
  "xiaomi",
  "oppo",
  "اوبو",
  "شاحن",
  "product",
  "products",
  "buy",
  "search",
  "find",
  "show",
  "price",
  "cheapest",
  "best",
  "phone",
  "charger",
];


const hasPiTopic = (normalized: string) => {
  return (
    normalized === "pi" ||
    normalized.includes("عملة pi") ||
    normalized.includes("عملة باي") ||
    normalized.includes("باي نتورك") ||
    normalized.includes("pi network") ||
    normalized.includes("pi currency") ||
    normalized.includes("what is pi") ||
    normalized.includes("explain pi")
  );
};

const hasStTopic = (normalized: string) => {
  return (
    normalized === "st" ||
    normalized.includes("عملة st") ||
    normalized.includes("توكن st") ||
    normalized.includes("salla token") ||
    normalized.includes("st token")
  );
};

const isGeneralPiQuestion = (normalized: string) => {
  if (!hasPiTopic(normalized)) return false;

  return hasAnyIntentWord(normalized, [
    "كويسة",
    "كويسه",
    "جيدة",
    "جيده",
    "حلوة",
    "حلوه",
    "مضمونة",
    "مضمونه",
    "آمنة",
    "امنة",
    "استثمار",
    "استثمر",
    "اشتري",
    "بيع",
    "مستقبل",
    "ناجحة",
    "ناجحه",
    "مشروع ناجح",
    "رأي",
    "رايك",
    "توقع",
    "سعرها",
    "قيمتها",
    "good",
    "worth",
    "safe",
    "investment",
    "invest",
    "future",
    "price",
    "prediction",
    "should i buy",
    "should i invest",
  ]);
};

const getKnowledgeModeForQuery = (query: string) => {
  const normalized = normalizeIntentText(query);
  const hasPi = hasPiTopic(normalized);
  const hasSt = hasStTopic(normalized);

  if (hasPi && hasSt) return "compare_pi_st" as const;
  if (hasSt) return "st" as const;
  if (hasPi) return "pi" as const;
  return "mall" as const;
};

const PRODUCT_TYPE_INTENT_WORDS = ECOMMERCE_PRODUCT_TYPE_WORDS;

const PRODUCT_BRAND_INTENT_WORDS = ECOMMERCE_PRODUCT_BRAND_WORDS;

const PRODUCT_COMMERCIAL_INTENT_WORDS = [
  "عايز", "عاوز", "عايزة", "اريد", "أريد", "ابحث", "بحث", "هات", "اعرض", "وريني",
  "اشتري", "شراء", "سعر", "ارخص", "الأرخص", "افضل", "أفضل", "رشح", "اقترح",
  "want", "need", "buy", "find", "search", "show", "price", "cheapest", "best", "recommend",
];

const PRODUCT_AVAILABILITY_INTENT_WORDS = [
  "فيه", "يوجد", "موجود", "موجودة", "متاح", "متاحة", "متوفر", "متوفرة", "عندكم", "عندك", "لديكم",
  "available", "in stock", "do you have", "have",
];

const PRODUCT_SEARCH_NEGATION_INTENT_WORDS = [
  "لا تبحث عن منتج",
  "لا ابحث عن منتج",
  "لا أبحث عن منتج",
  "لا اريد منتج",
  "لا أريد منتج",
  "مش منتج",
  "ليس منتج",
  "بدون منتجات",
  "لا منتجات",
  "no product",
  "not product",
  "do not search products",
  "don't search products",
];

const HARD_NON_PRODUCT_INTENT_WORDS = [
  "web3", "ويب3", "ويب 3", "المول web3", "مول web3",
  "كوبون", "كوبونات", "كود خصم", "قسيمة", "قسائم", "voucher", "coupon",
  "دعم", "الدعم", "مشكلة", "شكوى", "بلاغ", "support", "help",
  "طلباتي", "تتبع", "اوردر", "order", "orders", "tracking",
  "استرجاع", "استبدال", "مرتجع", "refund", "return", "exchange",
  "محفظة", "رصيد", "تحويل", "wallet", "balance", "transfer",
  "انضم كتاجر", "تاجر", "بائع", "merchant", "seller", "vendor",
];

const SOFT_NON_PRODUCT_INTENT_WORDS = [
  "عملة", "توكن", "استثمار", "مستقبل", "توقع", "كويسة", "كويسه", "جيدة", "جيده", "مشروع",
  "currency", "token", "investment", "invest", "future", "prediction", "worth", "safe",
];

type ProductSearchDecision = {
  shouldSearch: boolean;
  confidence: number;
  reason: string;
};

const hasAnyNormalizedWord = (normalized: string, words: string[]) => {
  return words.some((word) => {
    const normalizedWord = normalizeIntentText(word);
    if (!normalizedWord) return false;
    return normalized === normalizedWord || normalized.includes(normalizedWord);
  });
};

const getProductSearchDecision = (query: string): ProductSearchDecision => {
  const normalized = normalizeIntentText(query);
  if (!normalized) return { shouldSearch: false, confidence: 0, reason: "empty" };

  if (hasAnyNormalizedWord(normalized, PRODUCT_SEARCH_NEGATION_INTENT_WORDS)) {
    return { shouldSearch: false, confidence: 0, reason: "explicit_product_search_negation" };
  }

  const hasType = hasAnyNormalizedWord(normalized, PRODUCT_TYPE_INTENT_WORDS);
  const hasBrand = hasAnyNormalizedWord(normalized, PRODUCT_BRAND_INTENT_WORDS);
  const hasCommercial = hasAnyNormalizedWord(normalized, PRODUCT_COMMERCIAL_INTENT_WORDS);
  const hasAvailability = hasAnyNormalizedWord(normalized, PRODUCT_AVAILABILITY_INTENT_WORDS);
  const hasExplicitProductWord = hasAnyNormalizedWord(normalized, ["منتج", "منتجات", "product", "products"]);
  const hasHardNonProduct = hasAnyNormalizedWord(normalized, HARD_NON_PRODUCT_INTENT_WORDS);
  const hasSoftNonProduct = hasAnyNormalizedWord(normalized, SOFT_NON_PRODUCT_INTENT_WORDS);

  // لا تسمح لأسئلة Pi/ST/الدعم/الطلبات/الكوبونات أن تتحول إلى بحث منتجات
  // إلا إذا ذكر العميل منتجا أو ماركة بشكل واضح جدا.
  if ((hasHardNonProduct || hasSoftNonProduct) && !hasType && !hasBrand && !hasExplicitProductWord) {
    return { shouldSearch: false, confidence: 0.1, reason: "non_product_topic" };
  }

  let confidence = 0;
  if (hasType) confidence += 0.45;
  if (hasBrand) confidence += 0.35;
  if (hasCommercial) confidence += 0.2;
  if (hasAvailability) confidence += 0.2;
  if (hasExplicitProductWord) confidence += 0.25;

  // أمثلة يجب أن تمر: "فيه موبايلات؟"، "عاوز موبايل سامسونج"، "عندكم سامسونج؟"
  if (hasType && (hasAvailability || hasCommercial || hasExplicitProductWord || normalized.split(" ").length <= 3)) {
    confidence = Math.max(confidence, 0.82);
  }

  if (hasBrand && (hasAvailability || hasCommercial || hasExplicitProductWord || hasType || normalized.split(" ").length <= 3)) {
    confidence = Math.max(confidence, 0.8);
  }

  if (hasCommercial && !hasType && !hasBrand && !hasExplicitProductWord) {
    // "عاوز حاجة رخيصة" غامضة ولا يجب أن تبحث في كل المنتجات عشوائيا.
    confidence = Math.min(confidence, 0.45);
  }

  if (normalized.split(" ").length === 1 && !hasType && !hasBrand && !hasExplicitProductWord) {
    confidence = Math.min(confidence, 0.3);
  }

  return {
    shouldSearch: confidence >= 0.7,
    confidence,
    reason: confidence >= 0.7 ? "clear_product_search" : "unclear_product_search",
  };
};

const shouldAllowExternalAiKnowledge = (query: string) => {
  const intent = getAssistantIntent(query);
  return intent === "general" || intent === "pi_general";
};

const getAssistantIntent = (query: string): AssistantIntent => {
  const normalized = normalizeIntentText(query);

  if (!normalized) return "general";

  const greetingWords = ["مرحبا", "مرحبه", "اهلا", "اهلين", "السلام عليكم", "سلام", "هاي", "هلا", "hello", "hi", "hey"];
  const words = normalized.split(" ").filter(Boolean);
  if (greetingWords.includes(normalized) || (words.length <= 3 && words.some((word) => greetingWords.includes(word)))) {
    return "greeting";
  }

  const couponLike =
    hasAnyIntentWord(normalized, COUPON_QUERY_WORDS) ||
    ((normalized.includes("خصم") || normalized.includes("discount")) &&
      hasAnyIntentWord(normalized, ["كود", "اكواد", "أكواد", "قسيمة", "قسائم", "فعالة", "صالحة", "متاحة", "available", "valid", "active", "code"]));

  if (couponLike) return "coupon";
  if (hasAnyIntentWord(normalized, ["الدعم", "مشكلة", "مشكله", "تواصل", "شكوى", "بلاغ", "support", "contact", "help"])) return "support";
  if (hasAnyIntentWord(normalized, ["انضم كتاجر", "تاجر", "بائع", "merchant", "seller", "vendor"])) return "merchant";

  const piTopic = hasPiTopic(normalized);
  const stTopic = hasStTopic(normalized);

  if (piTopic && stTopic) return "compare_pi_st";
  if (stTopic) return "st";
  if (piTopic && isGeneralPiQuestion(normalized)) return "pi_general";
  if (piTopic) return "pi";

  if (hasAnyIntentWord(normalized, ["الدفع", "ادفع", "محفظة", "wallet", "payment", "checkout", "pay"])) return "payment";
  if (hasAnyIntentWord(normalized, ["طلب", "طلباتي", "اوردر", "الشحن", "تتبع", "order", "orders", "shipping", "tracking"])) return "order";
  if (hasAnyIntentWord(normalized, ["استرجاع", "استبدال", "مرتجع", "refund", "return", "returns", "exchange"])) return "returns";
  if (getProductSearchDecision(query).shouldSearch) return "product";
  if (hasAnyIntentWord(normalized, ["قسم", "اقسام", "أقسام", "تصنيف", "category", "categories"])) return "category";

  return "general";
};

const shouldFetchProductsForQuery = (query: string) => {
  return getProductSearchDecision(query).shouldSearch;
};

const getIntentKnowledgeTerms = (query: string, isArabic: boolean) => {
  const intent = getAssistantIntent(query);

  const termsByIntent: Record<AssistantIntent, string[]> = {
    greeting: [],
    coupon: isArabic ? ["كوبونات", "كود خصم", "قسائم", "خصومات"] : ["coupons", "coupon codes", "discount codes", "vouchers"],
    support: isArabic ? ["الدعم", "التواصل", "مشكلة حساب"] : ["support", "contact", "account issue"],
    product: [],
    merchant: isArabic ? ["انضم كتاجر", "تاجر", "بائع"] : ["become merchant", "merchant", "seller"],
    st: ["ST", "Salla Token", "توكن ST"],
    pi: ["Pi", "عملة Pi", "Pi currency"],
    pi_general: ["Pi", "Pi Network", "عملة Pi", "عملة باي"],
    compare_pi_st: ["Pi", "عملة Pi", "ST", "Salla Token", "توكن ST"],
    payment: isArabic ? ["الدفع", "الدفع بعملة Pi", "محفظة Pi"] : ["payment", "Pi payment", "Pi wallet"],
    order: isArabic ? ["الطلبات", "الشحن", "تتبع الطلب"] : ["orders", "shipping", "tracking"],
    returns: isArabic ? ["الاسترجاع", "الاستبدال", "المرتجعات"] : ["returns", "refund", "exchange"],
    category: isArabic ? ["الأقسام", "التصنيفات"] : ["categories", "sections"],
    general: [],
  };

  return termsByIntent[intent] || [];
};

const getQuickReply = (lastUserQuery: string, isArabic: boolean, userName?: string) => {
  const normalized = normalizeIntentText(lastUserQuery);
  const name = cleanText(userName, isArabic ? "صديقي" : "there");

  if (!normalized) return "";

  const greetingWords = new Set([
    "مرحبا",
    "مرحبه",
    "اهلا",
    "اهلين",
    "السلام عليكم",
    "سلام",
    "هاي",
    "هلا",
    "hello",
    "hi",
    "hey",
  ]);

  const words = normalized.split(" ");

  if (greetingWords.has(normalized) || (words.length <= 3 && words.some((word) => greetingWords.has(word)))) {
    return isArabic
      ? `مرحبا بك يا ${name} 👋\nأنا مساعد Salla Shop الذكي. أقدر أساعدك في البحث عن المنتجات، الأقسام، الدفع بعملة Pi، معلومات ST، الكوبونات، أو الانضمام كتاجر.`
      : `Hello ${name} 👋\nI'm the Salla Shop AI assistant. I can help you find products, categories, Pi payments, ST, coupons, or becoming a merchant.`;
  }

  if (["الدعم", "دعم", "support", "help"].includes(normalized)) {
    return isArabic
      ? "يمكنك التواصل مع الدعم من خلال صفحة حسابي أو إرسال مشكلتك هنا وسأحاول توجيهك للرابط المناسب داخل المول."
      : "You can contact support from My Account, or send your issue here and I will guide you to the right mall link.";
  }

  const intent = getAssistantIntent(lastUserQuery);

  if (intent === "coupon" && words.length <= 4) {
    return isArabic
      ? "اكتب سؤالك عن الكوبونات أو كود الخصم المحدد، وسأعتمد على معلومات المول المتاحة فقط بدون ترشيح منتجات غير مرتبطة."
      : "Ask about available coupons or a specific coupon code, and I will use only the available mall information without recommending unrelated products.";
  }

  if (["المنتجات", "products", "product"].includes(normalized)) {
    return isArabic
      ? "تقدر تتصفح المنتجات من هنا: [المنتجات](/products) أو منتجات التجار من هنا: [منتجات التجار](/merchant-products)."
      : "You can browse products here: [Products](/products), or merchant products here: [Merchant Products](/merchant-products).";
  }

  if (["st", "عملة st", "توكن st", "st token"].includes(normalized)) {
    return isArabic
      ? "ST عملة منفعة ومكافآت داخل Salla Shop. يمكنك قراءة التفاصيل من هنا: [نظام عملة ST](/st-token-info)."
      : "ST is a utility and rewards token inside Salla Shop. You can read more here: [ST Token System](/st-token-info).";
  }

  return "";
};

const getEmbedding = async (apiKey: string | null, text: string) => {
  const trimmedText = cleanText(text);

  if (!apiKey || !trimmedText) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text: trimmedText }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
      }),
    },
  );

  if (!response.ok) {
    console.warn("Embedding failed:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  return data?.embedding?.values || null;
};

const formatProductPrice = (product: ProductMatch, piRate?: number) => {
  const localPriceEgp = toNumber(product.local_price_egp);
  const piPerEgp = toNumber(piRate);

  // 1. الأولوية الأولى: الحساب الديناميكي الناجح
  if (localPriceEgp > 0 && piPerEgp > 0) {
    return Number((localPriceEgp * piPerEgp).toFixed(5)).toString();
  }

  // 2. إذا كان السعر المحلي موجوداً ولكن الواجهة أرسلت piRate = 0 (بسبب تأخر تحميل سعر الصرف)
  // نمنع العودة للسعر القديم لأنه قد يحتوي على قيمة الجنيه بالخطأ.
  if (localPriceEgp > 0 && piPerEgp === 0) {
    return "يتم الحساب...";
  }

  // 3. السعر المخزن مسبقاً إذا لم يتوفر السعر المحلي
  const storedPiPrice = toNumber(product.price);
  if (storedPiPrice > 0) {
    // حماية أخيرة: لو التاجر أدخل السعر بالجنيه (مثلاً 7500) في حقل عملة Pi بالخطأ قديماً
    // نتجاهل الرقم الضخم حتى لا يخرف المساعد الذكي
    if (storedPiPrice >= 500) {
      return "يحتاج مراجعة تسعير";
    }
    return Number(storedPiPrice.toFixed(5)).toString();
  }

  return "غير محدد";
};

const getProductName = (product: ProductMatch, isArabic: boolean) => {
  return isArabic
    ? cleanText(product.name_ar || product.name, "منتج")
    : cleanText(product.name || product.name_ar, "Product");
};

const getProductDescription = (product: ProductMatch, isArabic: boolean) => {
  return isArabic
    ? cleanText(product.description_ar || product.description)
    : cleanText(product.description || product.description_ar);
};

const getProductCategory = (product: ProductMatch, isArabic: boolean) => {
  return isArabic
    ? cleanText(product.category_name_ar || product.category_ar || product.category_name || product.category, "غير مصنف")
    : cleanText(product.category_name || product.category || product.category_name_ar || product.category_ar, "Uncategorized");
};

const containsArabic = (value: string) => /[\u0600-\u06FF]/.test(value);

const getDisplayProductCategory = (product: ProductMatch, isArabic: boolean) => {
  const category = getProductCategory(product, isArabic);

  if (!category || category === "Uncategorized" || category === "غير مصنف") {
    return category;
  }

  if (!isArabic && containsArabic(category)) {
    const englishCandidate = cleanText(product.category_name || product.category);

    return englishCandidate && !containsArabic(englishCandidate)
      ? englishCandidate
      : "";
  }

  return category;
};

const getProductLink = (product: ProductMatch, name: string) => {
  if (product.source === "service") {
    return `[${name}](/service-product/${product.id})`;
  }

  const source = product.source === "merchant" ? "merchant" : "admin";

  return source === "merchant"
    ? `[${name}](/merchant-product/${product.id})`
    : `[${name}](/product/${product.id})`;
};

const getProductCategoryLink = (product: ProductMatch, isArabic: boolean) => {
  const categoryId = cleanText(product.category_id);
  if (!categoryId) return "";

  const categoryName =
    getDisplayProductCategory(product, isArabic) ||
    (product.source === "service"
      ? (isArabic ? "المنتجات الخدمية" : "Service Products")
      : (isArabic ? "القسم" : "Category"));

  if (product.source === "service") {
    return `[${categoryName}](/products?type=service&category=${categoryId})`;
  }

  if (product.source === "merchant") {
    return `[${categoryName}](/merchant-products?category=${categoryId})`;
  }

  return `[${categoryName}](/products?category=${categoryId})`;
};

const fetchCategoriesContext = async (
  supabase: ReturnType<typeof createClient>,
  isArabic: boolean,
) => {
  const now = Date.now();
  const langKey = isArabic ? "ar" : "en";

  if (
    cachedCategoriesContext &&
    cachedCategoriesLang === langKey &&
    now - lastCategoryCacheTime < CATEGORY_CACHE_DURATION
  ) {
    return cachedCategoriesContext;
  }

  const { data, error } = await supabase
    .from("categories")
    .select("id, name, name_ar, slug")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(120);

  if (error) {
    console.warn("Categories context failed:", error.message);
    return cachedCategoriesContext || "";
  }

  cachedCategoriesContext =
    (data as CategoryRow[] | null)
      ?.map((category) => {
        const name = isArabic
          ? cleanText(category.name_ar || category.name)
          : cleanText(category.name || category.name_ar);

        const id = cleanText(category.id);
        const slug = cleanText(category.slug);
        const link = id ? `/products?category=${id}` : (slug ? `/products?category=${slug}` : "");
        return link ? `${name} => ${link}` : name;
      })
      .filter(Boolean)
      .join(", ") || "";

  cachedCategoriesLang = langKey;
  lastCategoryCacheTime = now;

  return cachedCategoriesContext;
};

const fetchStoreSettings = async (
  supabase: ReturnType<typeof createClient>,
): Promise<StoreSettingsRow> => {
  const { data, error } = await supabase
    .from("store_settings")
    .select("store_name, store_description, store_description_ar, support_email, admin_whatsapp")
    .limit(1)
    .maybeSingle();

  if (!error) {
    return (data || {}) as StoreSettingsRow;
  }

  /**
   * هذا fallback مهم لو PostgREST/Supabase schema cache لم يقرأ الأعمدة الجديدة بعد
   * أو لو الاستعلام شغل قبل ما الأعمدة تتضاف فعليا.
   */
  console.warn("Store settings new columns context failed:", error.message);

  const { data: fallbackData, error: fallbackError } = await supabase
    .from("store_settings")
    .select("admin_whatsapp")
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.warn("Store settings fallback context failed:", fallbackError.message);
    return {};
  }

  return (fallbackData || {}) as StoreSettingsRow;
};

const fetchStaticMallContext = async (
  supabase: ReturnType<typeof createClient>,
  isArabic: boolean,
) => {
  const now = Date.now();
  const langKey = isArabic ? "ar" : "en";

  if (
    cachedStaticMallContext &&
    cachedStaticMallLang === langKey &&
    now - lastStaticCacheTime < STATIC_CONTEXT_CACHE_DURATION
  ) {
    return cachedStaticMallContext;
  }

  const settings = await fetchStoreSettings(supabase);

  const storeName = cleanText(settings.store_name, "Salla Shop Mall");
  const storeDescription = isArabic
    ? cleanText(
        settings.store_description_ar || settings.store_description,
        "أول سوق إلكتروني متكامل متعدد البائعين يدعم مدفوعات Pi Network في مصر والشرق الأوسط وأفريقيا",
      )
    : cleanText(
        settings.store_description || settings.store_description_ar,
        "The first integrated online multi-vendor marketplace supporting Pi Network payments in Egypt, the Middle East, and Africa.",
      );

  const supportEmail = cleanText(settings.support_email);
  const adminWhatsapp = cleanText(settings.admin_whatsapp);

  const mallBaseInfo = isArabic
    ? `
معلومات ثابتة عن المول:
- اسم المول: ${storeName}.
- وصف المول: ${storeDescription}.
- الدفع الأساسي داخل المول يكون بعملة Pi.
- لا تذكر الجنيه المصري أو أي عملة ورقية للعميل.
${supportEmail ? `- بريد الدعم: ${supportEmail}.` : ""}
${adminWhatsapp ? `- واتساب الإدارة: ${adminWhatsapp}.` : ""}
- روابط مهمة:
  - نظام ST: [نظام عملة ST](/st-token-info)
  - الاكتتاب: [سلة توكن ICO](/ico)
  - الانضمام كتاجر: [انضم كتاجر](/become-merchant)
  - المنتجات: [المنتجات](/products)
  - منتجات التجار: [منتجات التجار](/merchant-products)
  - المنتجات الخدمية: [المنتجات الخدمية](/products?type=service)
  - الحساب: [حسابي](/profile)
`
    : `
Static mall information:
- Mall name: ${storeName}.
- Description: ${storeDescription}.
- The main customer-facing payment currency is Pi.
- Do not mention Egyptian pounds or fiat currencies to customers.
${supportEmail ? `- Support email: ${supportEmail}.` : ""}
${adminWhatsapp ? `- Admin WhatsApp: ${adminWhatsapp}.` : ""}
- Important links:
  - ST Token: [ST Token System](/st-token-info)
  - ICO: [Salla Token ICO](/ico)
  - Become Merchant: [Become Merchant](/become-merchant)
  - Products: [Products](/products)
  - Merchant Products: [Merchant Products](/merchant-products)
  - Service Products: [Service Products](/products?type=service)
  - Account: [My Account](/profile)
`;

  cachedStaticMallContext = cleanMultiline(mallBaseInfo);
  cachedStaticMallLang = langKey;
  lastStaticCacheTime = now;

  return cachedStaticMallContext;
};
const PRODUCT_TEXT_STOP_WORDS = new Set([
  "عايز",
  "عاوزه",
  "عاوزة",
  "اريد",
  "أريد",
  "ابحث",
  "بحث",
  "عن",
  "على",
  "منتج",
  "منتجات",
  "اشتري",
  "شراء",
  "هات",
  "فين",
  "ما",
  "ماهي",
  "ماهيه",
  "هي",
  "ايه",
  "إيه",
  "ال",
  "بسعر",
  "سعر",
  "كويس",
  "رخيص",
  "ارخص",
  "الأرخص",
  "متوفر",
  "متاح",
  "المتاح",
  "المتاحه",
  "المتاحة",
  "available",
  "in stock",
  "عندكم",
  "عندك",
  "موجود",
  "المتاحه",
  "المتاحة",
  "المتوفره",
  "المتوفرة",
  "متاحة",
  "متوفرة",
  "لديكم",
  "فيه",
  "يوجد",
  "هل يوجد",
  "هل",
  "اخرى",
  "أخرى",
  "اخري",
  "آخر",
  "اخر",
  "كمان",
  "غير",
  "عندنا",
  "لدينا",
  "في",
  "من",
  "افضل",
  "أفضل",
  "جيد",
  "ممتاز",
  "خصم",
  "عرض",
  "عروض",
  "i",
  "want",
  "need",
  "buy",
  "find",
  "search",
  "for",
  "product",
  "products",
  "cheap",
  "cheapest",
  "good",
  "best",
  "price",
  "available",
  "show",
  "me",
  "discount",
  "sale",
  "hi",
  "hello",
  "hey",
  "a",
  "an",
  "the",
]);

const PRODUCT_TYPE_WORDS = new Set([
  "mobile",
  "mobiles",
  "phone",
  "phones",
  "smartphone",
  "smartphones",
  "موبايل",
  "موبايلات",
  "الموبايل",
  "الموبايلات",
  "موبيل",
  "تليفون",
  "هاتف",
  "هواتف",
  "الهاتف",
  "الهواتف",
  "جوال",
  "جوالات",
  "charger",
  "chargers",
  "شاحن",
  "شواحن",
]);

const getProductQueryIntent = (lastUserQuery: string) => {
  const normalized = normalizeIntentText(lastUserQuery);

  return {
    wantsCheap:
      normalized.includes("رخيص") ||
      normalized.includes("ارخص") ||
      normalized.includes("الأرخص") ||
      normalized.includes("cheap") ||
      normalized.includes("cheapest"),
    wantsBest:
      normalized.includes("افضل") ||
      normalized.includes("أفضل") ||
      normalized.includes("ممتاز") ||
      normalized.includes("best") ||
      normalized.includes("top"),
    wantsSale:
      normalized.includes("خصم") ||
      normalized.includes("عرض") ||
      normalized.includes("عروض") ||
      normalized.includes("discount") ||
      normalized.includes("sale"),
  };
};

const PRODUCT_TEXT_SYNONYMS: Record<string, string[]> = ECOMMERCE_PRODUCT_SYNONYMS;

const expandProductTextCandidate = (candidate: string) => {
  const normalizedCandidate = normalizeIntentText(candidate);
  const expanded = new Set([normalizedCandidate]);

  Object.entries(PRODUCT_TEXT_SYNONYMS).forEach(([key, synonyms]) => {
    const normalizedKey = normalizeIntentText(key);
    if (!normalizedKey || !normalizedCandidate.includes(normalizedKey)) return;

    synonyms.forEach((synonym) => {
      const normalizedSynonym = normalizeIntentText(synonym);
      if (!normalizedSynonym) return;
      expanded.add(normalizedCandidate.replace(normalizedKey, normalizedSynonym));
    });
  });

  return Array.from(expanded).filter(Boolean);
};

const getMatchedProductTypeFamiliesForQuery = (normalized: string) => {
  const families: string[][] = [];
  const productFamilies = ECOMMERCE_PRODUCT_FAMILIES.map((family) => family.terms);

  productFamilies.forEach((family) => {
    if (family.some((word) => normalized.includes(normalizeIntentText(word)))) {
      families.push(family);
    }
  });

  return families;
};

const getMatchedBrandTermsForQuery = (normalized: string) => {
  const matched: string[] = [];
  const normalizedText = normalizeIntentText(normalized);
  const noArticleText = stripArabicDefiniteArticle(normalizedText);

  ECOMMERCE_PRODUCT_BRAND_GROUPS.forEach((group) => {
    const groupMatched = group.some((word) => {
      return getNormalizedTextVariants(word).some((variant) => {
        return normalizedText.includes(variant) || noArticleText.includes(variant);
      });
    });

    if (groupMatched) matched.push(...group);
  });

  return Array.from(new Set(matched.flatMap((term) => getNormalizedTextVariants(term))));
};

const PRODUCT_QUERY_FILLER_WORDS = new Set([
  ...Array.from(PRODUCT_TEXT_STOP_WORDS),
  "يسال", "يسأل", "استفسار", "استفسر", "بخصوص", "حول", "عايزه", "ممكن", "لو", "سمحت",
]);

const tokenizeProductQuery = (query: string) => {
  return normalizeIntentText(query)
    .split(" ")
    .map((word) => cleanText(word))
    .filter((word) => word.length >= 2 && !PRODUCT_QUERY_FILLER_WORDS.has(word));
};

const extractProductSearchTerms = (lastUserQuery: string) => {
  const rawQuery = cleanText(lastUserQuery);
  const normalized = normalizeIntentText(rawQuery);

  if (!normalized) return [] as string[];

  const tokens = tokenizeProductQuery(rawQuery);
  const fullCleanQuery = tokens.join(" ");
  const candidates: string[] = [];

  // اعتمد على product_query القادم من محلل AI كما هو، ولا تحوله لقائمة كلمات ثابتة.
  // نبحث بالعبارة كاملة، ثم بالعبارات بدون "ال"، ثم بالتوكنات المهمة.
  if (fullCleanQuery) candidates.push(fullCleanQuery);
  const noArticleQuery = stripArabicDefiniteArticle(fullCleanQuery || rawQuery);
  if (noArticleQuery) candidates.push(noArticleQuery);

  if (tokens.length > 1) {
    for (let size = Math.min(3, tokens.length); size >= 2; size -= 1) {
      for (let i = 0; i <= tokens.length - size; i += 1) {
        candidates.push(tokens.slice(i, i + size).join(" "));
      }
    }
  }

  candidates.push(...tokens.filter((word) => word.length >= 2));

  const uniqueTerms: string[] = [];
  for (const candidate of candidates) {
    const expandedCandidates = [candidate, ...getArabicOrthographicVariants(candidate), ...expandProductTextCandidate(candidate)];

    for (const expanded of expandedCandidates) {
      const safeCandidate = escapeIlikeTerm(expanded);
      if (!safeCandidate || safeCandidate.length < 2) continue;
      if (uniqueTerms.includes(safeCandidate)) continue;
      uniqueTerms.push(safeCandidate);
    }
  }

  return uniqueTerms.slice(0, 16);
};

const getRequiredProductModifierTerms = (lastUserQuery: string) => {
  const tokens = tokenizeProductQuery(lastUserQuery);

  if (!tokens.length) return [] as string[];

  // لا تجعل نوع المنتج العام مثل "شاي" أو "موبايل" وحده شرطًا يمنع النتائج،
  // لكن أبقِ الكلمات المميزة مثل "العروسه" أو "سامسونج" كشرط مطابقة.
  const genericTypeWords = new Set([
    ...Array.from(PRODUCT_TYPE_WORDS),
    ...ECOMMERCE_GENERIC_TYPE_WORDS,
    "منتج", "منتجات",
  ].map(normalizeIntentText));

  const required = tokens
    .map((word) => stripArabicDefiniteArticle(word))
    .filter((word) => word.length >= 3 && !genericTypeWords.has(normalizeIntentText(word)));

  // لو كل الاستعلام كلمة عامة واحدة، لا تفرض required terms.
  if (tokens.length <= 1) return [];

  return Array.from(new Set(required));
};

const productMatchesRequiredTerms = (product: ProductMatch, requiredTerms: string[]) => {
  if (!requiredTerms.length) return true;

  const searchableText = normalizeIntentText([
    product.name,
    product.name_ar,
    product.description,
    product.description_ar,
    product.category,
    product.category_ar,
    product.category_name,
    product.category_name_ar,
    Array.isArray(product.tags) ? product.tags.join(" ") : product.tags,
  ].filter(Boolean).join(" "));

  const noArticleSearchableText = stripArabicDefiniteArticle(searchableText);

  return requiredTerms.every((term) => {
    return getNormalizedTextVariants(term).some((variant) => {
      return searchableText.includes(variant) || noArticleSearchableText.includes(variant);
    });
  });
};


const getProductSearchableText = (product: ProductMatch) => {
  return normalizeIntentText([
    product.name,
    product.name_ar,
    product.description,
    product.description_ar,
    product.category,
    product.category_ar,
    product.category_name,
    product.category_name_ar,
    Array.isArray(product.tags) ? product.tags.join(" ") : product.tags,
  ].filter(Boolean).join(" "));
};


const getStrongProductSearchableText = (product: ProductMatch) => {
  return normalizeIntentText([
    product.name,
    product.name_ar,
    product.category,
    product.category_ar,
    product.category_name,
    product.category_name_ar,
    Array.isArray(product.tags) ? product.tags.join(" ") : product.tags,
  ].filter(Boolean).join(" "));
};

const hasAnyTermInText = (text: string, terms: string[]) => {
  const normalizedText = normalizeIntentText(text);
  const noArticleText = stripArabicDefiniteArticle(normalizedText);

  return terms.some((term) => {
    return getNormalizedTextVariants(term).some((normalizedTerm) => {
      if (!normalizedTerm) return false;
      return (
        normalizedText === normalizedTerm ||
        normalizedText.includes(normalizedTerm) ||
        noArticleText === normalizedTerm ||
        noArticleText.includes(normalizedTerm)
      );
    });
  });
};

const getRequestedProductFamilies = (originalQuery: string) => {
  const normalizedQuery = normalizeIntentText(originalQuery);
  if (!normalizedQuery) return [] as typeof ECOMMERCE_PRODUCT_FAMILIES;

  return ECOMMERCE_PRODUCT_FAMILIES
    .map((family: any) => {
      const queryTerms = Array.from(new Set([...(family.strictQueryTerms || []), ...(family.terms || [])]));
      const matchedCount = queryTerms.filter((term) => hasAnyTermInText(normalizedQuery, [term])).length;
      return { family, matchedCount };
    })
    .filter((item) => item.matchedCount > 0)
    .sort((a, b) => {
      const priorityDiff = toNumber((b.family as any).priority) - toNumber((a.family as any).priority);
      if (priorityDiff !== 0) return priorityDiff;
      return b.matchedCount - a.matchedCount;
    })
    .map((item) => item.family);
};

const getActiveStrictFamiliesForQuery = (originalQuery: string) => {
  const requestedFamilies = getRequestedProductFamilies(originalQuery) as any[];
  if (!requestedFamilies.length) return [] as any[];

  const suppressedFamilyIds = new Set<string>();
  requestedFamilies.forEach((family) => {
    (family.suppressesFamilies || []).forEach((familyId: string) => suppressedFamilyIds.add(familyId));
  });

  return requestedFamilies.filter((family) => !suppressedFamilyIds.has(family.id));
};

const productMatchesStrictRequestedFamily = (product: ProductMatch, originalQuery: string) => {
  const normalizedQuery = normalizeIntentText(originalQuery);
  if (!normalizedQuery) return true;

  const strongProductText = getStrongProductSearchableText(product);
  const activeFamilies = getActiveStrictFamiliesForQuery(originalQuery);

  for (const family of activeFamilies) {
    const requiredProductTerms = family.requiredProductTerms || family.terms || [];
    const excludeProductTerms = family.excludeProductTerms || [];

    if (requiredProductTerms.length) {
      const productHasFamilySignal = hasAnyTermInText(strongProductText, requiredProductTerms);
      if (!productHasFamilySignal) return false;
    }

    // Apply excludes on strong product fields only: name, category, and tags.
    // Descriptions can mention compatibility words and should not disqualify a real product.
    if (excludeProductTerms.length && hasAnyTermInText(strongProductText, excludeProductTerms)) {
      return false;
    }
  }

  return true;
};

const scoreProductForQuery = (product: ProductMatch, searchTerms: string[], originalQuery: string) => {
  const intent = getProductQueryIntent(originalQuery);
  const requiredTerms = getRequiredProductModifierTerms(originalQuery);

  if (!productMatchesRequiredTerms(product, requiredTerms)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (!productMatchesStrictRequestedFamily(product, originalQuery)) {
    return Number.NEGATIVE_INFINITY;
  }

  const joinedTerms = normalizeIntentText(searchTerms.join(" "));
  const name = normalizeIntentText(`${product.name || ""} ${product.name_ar || ""}`);
  const description = normalizeIntentText(`${product.description || ""} ${product.description_ar || ""}`);
  const category = normalizeIntentText(`${product.category || ""} ${product.category_name || ""} ${product.category_ar || ""} ${product.category_name_ar || ""}`);
  const tags = Array.isArray(product.tags) ? normalizeIntentText(product.tags.join(" ")) : normalizeIntentText(product.tags || "");

  let score = 0;

  if (product.in_stock === false) score -= 100;
  else score += 25;

  // Family-aware boost:
  // عند البحث بكلمات عامة مثل "موبايلات" أو "سوبر ماركت" قد لا تحتوي كل المنتجات
  // على نفس كلمة البحث حرفيًا، لكنها تنتمي لنفس عائلة المنتج في المعجم.
  // لذلك نعطي نقاطًا قوية للمنتج إذا احتوى الاسم/القسم/التاجات على إشارات العائلة،
  // مع بقاء فلتر الاستبعاد الصارم في productMatchesStrictRequestedFamily كما هو.
  const activeFamilies = getActiveStrictFamiliesForQuery(originalQuery) as any[];
  if (activeFamilies.length) {
    const strongProductText = getStrongProductSearchableText(product);

    for (const family of activeFamilies) {
      const familyTerms = Array.from(new Set([
        family.labelAr,
        family.labelEn,
        ...(family.requiredProductTerms || []),
        ...(family.terms || []),
      ].filter(Boolean)));

      if (familyTerms.length && hasAnyTermInText(strongProductText, familyTerms)) {
        score += 70 + Math.min(30, Math.floor(toNumber(family.priority, 0) / 10));
      }
    }
  }

  for (const term of searchTerms) {
    const normalizedTerm = normalizeIntentText(term);
    if (!normalizedTerm) continue;

    if (name === normalizedTerm) score += 140;
    if (name.includes(normalizedTerm)) score += 85;
    if (tags.includes(normalizedTerm)) score += 45;
    if (category.includes(normalizedTerm)) score += 25;
    if (description.includes(normalizedTerm)) score += 12;
  }

  if (joinedTerms && name.includes(joinedTerms)) score += 35;
  if (intent.wantsBest) score += toNumber((product as any).rating) * 12;
  if (intent.wantsSale && toNumber(product.original_price) > toNumber(product.local_price_egp)) score += 35;

  const price = toNumber(product.local_price_egp || product.price);
  if (intent.wantsCheap && price > 0) {
    score += Math.max(0, 40 - Math.log10(price + 1) * 9);
  }

  return score;
};

const formatProductsContextRows = (
  products: ProductMatch[],
  isArabic: boolean,
  piRate?: number,
) => {
  const cleanProducts = uniqueBy(products, (product) => `${product.source || "admin"}:${cleanText(product.id)}`)
    .slice(0, MAX_PRODUCT_MATCHES);

  if (!cleanProducts.length) {
    return isArabic ? "المنتج المطابق تمامًا غير متوفر حاليًا في قاعدة بيانات المول. لا تخترع منتجات، واعتذر للعميل بلطف واقترح عليه تصفح [المنتجات](/products) أو تجربة ماركة/نوع آخر متوفر." : "The exact matching product is not currently available in the mall database. Do not invent products; politely apologize and suggest browsing [Products](/products) or trying another available brand/type.";
  }

  return cleanProducts
    .map((product, index) => {
      const name = getProductName(product, isArabic);
      const description = truncateText(getProductDescription(product, isArabic), 220);
      const link = getProductLink(product, name);
      const category = getDisplayProductCategory(product, isArabic);
      const categoryLink = getProductCategoryLink(product, isArabic);
      const price = formatProductPrice(product, piRate);
      const priceText = /^\d+(?:\.\d+)?$/.test(price) ? `${price} Pi` : price;
      const merchantName = cleanText(product.merchant_name);
      const stockQuantity = cleanText(product.stock_quantity);
      const stockText = product.in_stock === false
        ? isArabic ? "غير متوفر" : "Out of stock"
        : isArabic ? "متوفر" : "Available";
      const shippingType = cleanText(product.shipping_type);
      const tagsText = Array.isArray(product.tags)
        ? product.tags.map(cleanText).filter(Boolean).join(", ")
        : cleanText(product.tags);

      const recommendationReason = isArabic
        ? "مطابق للبحث ومتوفر في قاعدة بيانات المول"
        : "Matches the search and is available in the mall database";

      return [
        `${index + 1}. ${link}`,
        `   - ${isArabic ? "سبب الترشيح" : "Recommendation reason"}: ${recommendationReason}`,
        `   - ${isArabic ? "القسم" : "Category"}: ${category}`,
        categoryLink ? `   - ${isArabic ? "للمزيد من نفس القسم" : "More from this category"}: ${categoryLink}` : "",
        `   - ${isArabic ? "السعر" : "Price"}: ${priceText}`,
        `   - ${isArabic ? "الحالة" : "Status"}: ${stockText}${stockQuantity ? ` (${stockQuantity})` : ""}`,
        shippingType ? `   - ${isArabic ? "الشحن" : "Shipping"}: ${shippingType}` : "",
        merchantName ? `   - ${isArabic ? "التاجر" : "Merchant"}: ${merchantName}` : "",
        tagsText ? `   - ${isArabic ? "كلمات مرتبطة" : "Tags"}: ${tagsText}` : "",
        description ? `   - ${isArabic ? "وصف مختصر" : "Short description"}: ${description}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
};


const uniqueCleanTerms = (terms: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const term of terms) {
    const cleaned = escapeIlikeTerm(stripArabicDefiniteArticle(term));
    if (!cleaned || cleaned.length < 2) continue;
    const normalized = normalizeIntentText(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(cleaned);
  }

  return result;
};

const getExpandedSearchVariants = (term: string) => {
  const variants = new Set<string>();

  const addTerm = (value: string) => {
    getNormalizedTextVariants(value).forEach((variant) => {
      const cleaned = escapeIlikeTerm(stripArabicDefiniteArticle(variant));
      const normalized = normalizeIntentText(cleaned);
      if (normalized && normalized.length >= 2) variants.add(cleaned);
    });
  };

  addTerm(term);

  const normalizedTerm = normalizeIntentText(stripArabicDefiniteArticle(term));

  Object.entries(PRODUCT_TEXT_SYNONYMS).forEach(([key, synonyms]) => {
    const normalizedKey = normalizeIntentText(stripArabicDefiniteArticle(key));
    if (!normalizedKey) return;

    if (normalizedTerm === normalizedKey || normalizedTerm.includes(normalizedKey) || normalizedKey.includes(normalizedTerm)) {
      addTerm(key);
      synonyms.forEach(addTerm);
    }
  });

  ECOMMERCE_PRODUCT_BRAND_GROUPS.forEach((group) => {
    const groupMatched = group.some((word) => {
      const normalizedWord = normalizeIntentText(stripArabicDefiniteArticle(word));
      return normalizedWord && (normalizedTerm === normalizedWord || normalizedTerm.includes(normalizedWord) || normalizedWord.includes(normalizedTerm));
    });

    if (groupMatched) group.forEach(addTerm);
  });

  return Array.from(variants).filter(Boolean).slice(0, 12);
};

const getRpcRequiredSearchGroups = (query: string) => {
  const tokens = tokenizeProductQuery(query)
    .map((token) => stripArabicDefiniteArticle(token))
    .filter((token) => token.length >= 2);

  const activeFamilies = getActiveStrictFamiliesForQuery(query) as any[];
  const genericTerms = new Set([
    ...Array.from(PRODUCT_TYPE_WORDS),
    ...ECOMMERCE_GENERIC_TYPE_WORDS,
    ...activeFamilies.flatMap((family) => [
      ...(family.genericTerms || []),
      ...(family.terms || []),
      ...(family.strictQueryTerms || []),
    ]),
    "منتج", "منتجات",
  ].map((term) => normalizeIntentText(stripArabicDefiniteArticle(term))));

  const meaningfulTokens = activeFamilies.length
    ? tokens.filter((token) => {
        const normalized = normalizeIntentText(stripArabicDefiniteArticle(token));
        return normalized.length >= 2 && !genericTerms.has(normalized);
      })
    : tokens;

  const seenGroups = new Set<string>();
  const groups: string[][] = [];

  meaningfulTokens.forEach((token) => {
    const group = getExpandedSearchVariants(token);
    if (!group.length) return;

    const groupKey = group.map((term) => normalizeIntentText(term)).sort().join("|");
    if (seenGroups.has(groupKey)) return;
    seenGroups.add(groupKey);
    groups.push(group);
  });

  return groups.slice(0, 6);
};

const getRpcFamilyTerms = (query: string) => {
  const activeFamilies = getActiveStrictFamiliesForQuery(query) as any[];
  return uniqueCleanTerms(
    activeFamilies.flatMap((family) => [
      ...(family.requiredProductTerms || []),
      ...(family.terms || []),
    ]),
  );
};

const getRpcExcludeTerms = (query: string) => {
  const activeFamilies = getActiveStrictFamiliesForQuery(query) as any[];
  return uniqueCleanTerms(
    activeFamilies.flatMap((family) => family.excludeProductTerms || []),
  );
};

type ProductSearchRpcRow = ProductMatch & {
  search_rank?: number | null;
};


type ServiceProductRow = {
  id: string;
  name?: string | null;
  name_ar?: string | null;
  description?: string | null;
  description_ar?: string | null;
  image?: string | null;
  category_id?: string | null;
  min_amount_egp?: number | string | null;
  max_amount_egp?: number | string | null;
  is_featured?: boolean | null;
};

const mapServiceProductToProductMatch = (product: ServiceProductRow): ProductMatch => ({
  id: cleanText(product.id),
  source: "service",
  name: product.name,
  name_ar: product.name_ar,
  description: product.description,
  description_ar: product.description_ar,
  image: product.image,
  category: "services",
  category_ar: "المنتجات الخدمية",
  category_id: product.category_id,
  category_name: "Service Products",
  category_name_ar: "المنتجات الخدمية",
  price: null,
  local_price_egp: product.min_amount_egp,
  min_amount_egp: product.min_amount_egp,
  max_amount_egp: product.max_amount_egp,
  original_price: null,
  in_stock: true,
  stock_quantity: 999,
  shipping_type: "free",
  tags: ["service", "services", "خدمة", "خدمات"],
  is_featured: product.is_featured,
});

const fetchServiceProductsByText = async (
  supabase: ReturnType<typeof createClient>,
  lastUserQuery: string,
) => {
  const searchTerms = extractProductSearchTerms(lastUserQuery);
  if (!searchTerms.length) return [] as ProductMatch[];

  const activeFamilies = getActiveStrictFamiliesForQuery(lastUserQuery) as any[];
  const isGenericFamilyBrowse = activeFamilies.length > 0 && getRpcRequiredSearchGroups(lastUserQuery).length === 0;
  const expandedTerms = uniqueCleanTerms([
    ...searchTerms,
    ...getRpcRequiredSearchGroups(lastUserQuery).flat(),
    ...getRpcFamilyTerms(lastUserQuery),
  ]).slice(0, 24);

  if (!expandedTerms.length) return [] as ProductMatch[];

  const serviceSelect = "id, name, name_ar, description, description_ar, image, category_id, min_amount_egp, max_amount_egp, is_featured";
  const serviceFilters = expandedTerms.flatMap((safeQuery) => [
    `name.ilike.%${safeQuery}%`,
    `name_ar.ilike.%${safeQuery}%`,
    `description.ilike.%${safeQuery}%`,
    `description_ar.ilike.%${safeQuery}%`,
  ]);

  let serviceResult = await supabase
    .from("service_products")
    .select(serviceSelect)
    .eq("is_active", true)
    .or(serviceFilters.join(","))
    .limit(Math.max(MAX_TEXT_PRODUCT_MATCHES, MAX_PRODUCT_MATCHES * 10));

  // لو عمود is_active غير موجود في نسخة قاعدة البيانات، لا نوقف البحث كله.
  if (serviceResult.error) {
    const retryResult = await supabase
      .from("service_products")
      .select(serviceSelect)
      .or(serviceFilters.join(","))
      .limit(Math.max(MAX_TEXT_PRODUCT_MATCHES, MAX_PRODUCT_MATCHES * 10));

    if (retryResult.error) {
      console.warn("service_products text search skipped:", retryResult.error.message);
      return [] as ProductMatch[];
    }

    serviceResult = retryResult;
  }

  const serviceProducts = ((serviceResult.data || []) as ServiceProductRow[])
    .map(mapServiceProductToProductMatch)
    .filter((product) => cleanText(product.id));

  return uniqueBy(serviceProducts, (product) => `service:${cleanText(product.id)}`)
    .map((product) => ({
      product,
      score: scoreProductForQuery(product, searchTerms, lastUserQuery),
    }))
    .filter((item) => {
      if (!Number.isFinite(item.score)) return false;
      if (isGenericFamilyBrowse && item.score > 0) return true;
      return item.score >= MIN_PRODUCT_CONTEXT_SCORE;
    })
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;

      return toNumber(a.product.local_price_egp || a.product.price) - toNumber(b.product.local_price_egp || b.product.price);
    })
    .map((item) => item.product)
    .slice(0, MAX_PRODUCT_MATCHES);
};

const fetchProductsByText = async (
  supabase: ReturnType<typeof createClient>,
  lastUserQuery: string,
) => {
  const searchTerms = extractProductSearchTerms(lastUserQuery);
  if (!searchTerms.length) return [] as ProductMatch[];

  const activeFamilies = getActiveStrictFamiliesForQuery(lastUserQuery) as any[];
  const requiredGroups = getRpcRequiredSearchGroups(lastUserQuery);
  const familyTerms = getRpcFamilyTerms(lastUserQuery);
  const excludeTerms = getRpcExcludeTerms(lastUserQuery);
  const isGenericFamilyBrowse = activeFamilies.length > 0 && requiredGroups.length === 0;

  console.info("product RPC group search", {
    originalQuery: lastUserQuery,
    requiredGroups,
    familyTerms: familyTerms.slice(0, 20),
    excludeTerms: excludeTerms.slice(0, 20),
    isGenericFamilyBrowse,
  });

  const { data, error } = await supabase.rpc("search_products_by_groups", {
    required_groups: requiredGroups,
    family_terms: familyTerms,
    exclude_terms: excludeTerms,
    result_limit: Math.max(MAX_TEXT_PRODUCT_MATCHES, MAX_PRODUCT_MATCHES * 10),
  });

  if (error) {
    console.error("search_products_by_groups RPC failed:", error.message);
    return [] as ProductMatch[];
  }

  const uniqueProducts = uniqueBy(((data || []) as ProductSearchRpcRow[]), (product) => `${product.source || "admin"}:${cleanText(product.id)}`)
    .filter(isProductAvailableForChat);

  return uniqueProducts
    .map((product) => ({
      product,
      score: scoreProductForQuery(product, searchTerms, lastUserQuery) + toNumber(product.search_rank) * 10,
    }))
    .filter((item) => {
      if (!Number.isFinite(item.score)) return false;

      // A generic family browse such as "الموبايلات المتوفرة" is already filtered in DB by family_terms.
      // Do not drop valid products just because the literal query word does not appear in every product name.
      if (isGenericFamilyBrowse && item.score > 0) return true;

      return item.score >= MIN_PRODUCT_CONTEXT_SCORE;
    })
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;

      return toNumber(a.product.local_price_egp || a.product.price) - toNumber(b.product.local_price_egp || b.product.price);
    })
    .map((item) => item.product)
    .slice(0, MAX_PRODUCT_MATCHES);
};

const enrichProductsWithCategoryNames = async (
  supabase: ReturnType<typeof createClient>,
  products: ProductMatch[],
) => {
  if (!products.length) return products;

  const [categoriesResult, serviceCategoriesResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, name_ar, slug")
      .limit(500),
    supabase
      .from("service_categories")
      .select("id, name, name_ar, slug")
      .limit(500),
  ]);

  const categories = categoriesResult.error ? [] : ((categoriesResult.data || []) as CategoryRow[]);
  const serviceCategories = serviceCategoriesResult.error ? [] : ((serviceCategoriesResult.data || []) as CategoryRow[]);

  if (categoriesResult.error) {
    console.warn("category enrichment skipped:", categoriesResult.error.message);
  }

  if (serviceCategoriesResult.error) {
    console.warn("service category enrichment skipped:", serviceCategoriesResult.error.message);
  }

  if (!categories.length && !serviceCategories.length) return products;

  return products.map((product: any) => {
    const rawValues = [product.category_id, product.category]
      .map((value) => normalizeIntentText(cleanText(value)))
      .filter(Boolean);

    if (!rawValues.length) return product;

    const categorySource = product.source === "service" ? serviceCategories : categories;
    const matchedCategory = categorySource.find((category) => {
      const possibleValues = [category.id, category.slug, category.name, category.name_ar]
        .map((value) => normalizeIntentText(cleanText(value)))
        .filter(Boolean);

      return rawValues.some((rawValue) => possibleValues.includes(rawValue));
    });

    if (!matchedCategory) return product;

    return {
      ...product,
      category_name: product.category_name || matchedCategory.name || product.category,
      category_name_ar: product.category_name_ar || matchedCategory.name_ar,
    };
  });
};

const fetchProductsContext = async (
  supabase: ReturnType<typeof createClient>,
  queryEmbedding: number[] | null,
  lastUserQuery: string,
  isArabic: boolean,
  piRate?: number,
  forceProductSearch = false,
) => {
  if (!forceProductSearch && !shouldFetchProductsForQuery(lastUserQuery)) {
    return isArabic
      ? "السؤال الحالي ليس سؤال بحث عن منتج. لا تعرض منتجات إلا إذا طلب العميل منتجا بوضوح."
      : "The current question is not a product-search request. Do not show products unless the customer clearly asks for a product.";
  }

  const products: ProductMatch[] = [];

  // 1. تشغيل البحث النصي والخدمي أولًا لضمان أولوية النسخ الكاملة التي تحتوي local_price_egp.
  const [textProducts, serviceProducts] = await Promise.all([
    fetchProductsByText(supabase, lastUserQuery),
    fetchServiceProductsByText(supabase, lastUserQuery),
  ]);
  products.push(...textProducts, ...serviceProducts);

  // 2. تشغيل البحث المتجهي ثانيًا. لو رجّع نسخة ناقصة لن تغلب النسخة النصية بسبب uniqueBy.
  if (queryEmbedding) {
    const { data, error } = await supabase.rpc("match_all_products", {
      query_embedding: queryEmbedding,
      match_threshold: PRODUCT_VECTOR_MATCH_THRESHOLD,
      match_count: MAX_PRODUCT_MATCHES,
    });

    if (!error && data?.length) {
      products.push(...((data || []) as ProductMatch[]));
    } else if (error) {
      console.warn("match_all_products failed, falling back to text search:", error.message);
    }
  }

  // إزالة التكرار مع الحفاظ على أولوية نتائج البحث النصي والخدمي.
  let uniqueProductsRaw = uniqueBy(products, (product) => `${product.source || "admin"}:${cleanText(product.id)}`);

  // 3. طبقة حماية إضافية: لو وصل منتج من البحث المتجهي بدون local_price_egp، نجلب السعر المحلي من الجدول الأصلي.
  const missingAdminIds = uniqueProductsRaw
    .filter((product) => product.source !== "merchant" && product.source !== "service" && product.local_price_egp == null)
    .map((product) => cleanText(product.id))
    .filter(Boolean);

  const missingMerchantIds = uniqueProductsRaw
    .filter((product) => product.source === "merchant" && product.local_price_egp == null)
    .map((product) => cleanText(product.id))
    .filter(Boolean);

  if (missingAdminIds.length > 0 || missingMerchantIds.length > 0) {
    const [adminRes, merchantRes] = await Promise.all([
      missingAdminIds.length > 0
        ? supabase.from("products").select("id, local_price_egp").in("id", missingAdminIds)
        : Promise.resolve({ data: [] as Array<{ id: string; local_price_egp: number | string | null }> }),
      missingMerchantIds.length > 0
        ? supabase.from("merchant_products").select("id, local_price_egp").in("id", missingMerchantIds)
        : Promise.resolve({ data: [] as Array<{ id: string; local_price_egp: number | string | null }> }),
    ]);

    const adminPrices = new Map((adminRes.data || []).map((row: any) => [cleanText(row.id), row.local_price_egp]));
    const merchantPrices = new Map((merchantRes.data || []).map((row: any) => [cleanText(row.id), row.local_price_egp]));

    uniqueProductsRaw = uniqueProductsRaw.map((product) => {
      const productId = cleanText(product.id);

      if (product.source !== "merchant" && product.source !== "service" && product.local_price_egp == null && adminPrices.has(productId)) {
        return { ...product, local_price_egp: adminPrices.get(productId) as number | string | null };
      }

      if (product.source === "merchant" && product.local_price_egp == null && merchantPrices.has(productId)) {
        return { ...product, local_price_egp: merchantPrices.get(productId) as number | string | null };
      }

      return product;
    });
  }

  const searchTerms = extractProductSearchTerms(lastUserQuery);
  const enrichedProducts = await enrichProductsWithCategoryNames(
    supabase,
    uniqueProductsRaw,
  );

  const availableProducts = enrichedProducts.filter(isProductAvailableForChat);

  const uniqueProducts = availableProducts
    .map((product) => ({
      product,
      score: scoreProductForQuery(product, searchTerms, lastUserQuery),
    }))
    .filter((item) => Number.isFinite(item.score) && item.score >= MIN_PRODUCT_CONTEXT_SCORE)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;

      return toNumber(a.product.local_price_egp || a.product.price) - toNumber(b.product.local_price_egp || b.product.price);
    })
    .map((item) => item.product)
    .slice(0, MAX_PRODUCT_MATCHES);

  if (!uniqueProducts.length) {
    const decision = getProductSearchDecision(lastUserQuery);
    return isArabic
      ? `المنتج المطابق تمامًا غير متوفر حاليًا في قاعدة بيانات المول. (${decision.reason}) لا تخترع منتجات. اعتذر للعميل بلطف واقترح عليه تصفح [المنتجات](/products) أو تجربة ماركة/نوع آخر متوفر.`
      : `The exact matching product is not currently available in the mall database. (${decision.reason}) Do not invent products. Politely suggest browsing [Products](/products) or trying another available brand/type.`;
  }

  return formatProductsContextRows(uniqueProducts, isArabic, piRate);
};


const formatKnowledgeRows = (rows: KnowledgeMatch[], isArabic: boolean) => {
  const cleanRows = uniqueBy(rows, (row) => {
    return cleanText(row.source_key || row.id || `${row.title}-${row.title_ar}-${row.url}`);
  });

  return cleanRows
    .map((row, index) => {
      const title = isArabic
        ? cleanText(row.title_ar || row.title, "معلومة")
        : cleanText(row.title || row.title_ar, "Info");

      const content = isArabic
        ? cleanMultiline(row.content_ar || row.content)
        : cleanMultiline(row.content || row.content_ar);

      const section = cleanText(row.section);
      const url = cleanText(row.url);
      const linkTitle = url && title ? `[${title}](${url})` : title;

      if (!content) return "";

      return [
        `${index + 1}. ${linkTitle}`,
        section ? `   - ${isArabic ? "القسم" : "Section"}: ${section}` : "",
        `   - ${truncateText(content, 850)}`,
      ].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
};


const knowledgeRowText = (row: KnowledgeMatch) => normalizeIntentText([
  row.section,
  row.source_key,
  row.title,
  row.title_ar,
  row.content,
  row.content_ar,
].filter(Boolean).join(" "));

const filterKnowledgeRowsForQuery = (rows: KnowledgeMatch[], lastUserQuery: string) => {
  const mode = getKnowledgeModeForQuery(lastUserQuery);

  if (mode === "compare_pi_st") return rows;

  if (mode === "pi") {
    return rows.filter((row) => {
      const text = knowledgeRowText(row);
      const section = normalizeIntentText(row.section || "");
      // سؤال Pi لا يجب أن يسحب معلومات ST ويبدل اسم العملة؛ هذا كان سبب الخلط.
      if (section === "st" || text.includes("salla token") || text.includes("توكن st") || text.includes("عملة st") || /(^|\s)st(\s|$)/i.test(text)) {
        return false;
      }
      return true;
    });
  }

  if (mode === "st") {
    return rows.filter((row) => {
      const text = knowledgeRowText(row);
      const section = normalizeIntentText(row.section || "");
      if (section === "pi" || text.includes("pi network") || text.includes("عملة باي")) return false;
      return true;
    });
  }

  return rows;
};

const getGeneralKnowledgeSections = (lastUserQuery: string) => {
  const intent = getAssistantIntent(lastUserQuery);
  const mode = getKnowledgeModeForQuery(lastUserQuery);

  if (mode === "compare_pi_st") return ["payments", "pi", "st"];
  if (mode === "st") return ["st"];
  if (mode === "pi") return ["payments", "pi"];

  if (intent === "coupon") return ["coupons"];
  if (intent === "returns") return ["returns"];
  if (intent === "merchant") return ["merchant"];
  if (intent === "payment") return ["payments"];

  return ["mall", "payments", "merchant", "returns", "coupons", "services"];
};

const fetchKnowledgeContext = async (
  supabase: ReturnType<typeof createClient>,
  queryEmbedding: number[] | null,
  lastUserQuery: string,
  isArabic: boolean,
) => {
  const rows: KnowledgeMatch[] = [];

  if (queryEmbedding) {
    const { data, error } = await supabase.rpc("match_mall_knowledge", {
      query_embedding: queryEmbedding,
      match_threshold: KNOWLEDGE_VECTOR_MATCH_THRESHOLD,
      match_count: MAX_KNOWLEDGE_MATCHES,
    });

    if (!error && data?.length) {
      rows.push(...(data as KnowledgeMatch[]));
    } else if (error) {
      console.warn("match_mall_knowledge skipped:", error.message);
    }
  }

  const textQueries = uniqueBy(
    [lastUserQuery, ...getIntentKnowledgeTerms(lastUserQuery, isArabic)]
      .map((query) => escapeIlikeTerm(query))
      .filter((query) => query.length >= 3),
    (query) => query,
  ).slice(0, 5);

  for (const safeQuery of textQueries) {
    const { data, error } = await supabase
      .from("mall_knowledge")
      .select("id, section, source_table, source_id, source_key, title, title_ar, content, content_ar, url, metadata")
      .eq("is_active", true)
      .or(`title.ilike.%${safeQuery}%,title_ar.ilike.%${safeQuery}%,content.ilike.%${safeQuery}%,content_ar.ilike.%${safeQuery}%,section.ilike.%${safeQuery}%`)
      .limit(MAX_TEXT_KNOWLEDGE_MATCHES);

    if (!error && data?.length) {
      rows.push(...(data as KnowledgeMatch[]));
    } else if (error) {
      console.warn("mall_knowledge text search skipped:", error.message);
    }
  }

  const filteredRows = filterKnowledgeRowsForQuery(uniqueBy(rows, (row) => cleanText(row.id || `${row.source_key || ""}:${row.title || row.title_ar || ""}`)), lastUserQuery);
  const formatted = formatKnowledgeRows(filteredRows, isArabic);

  return formatted || (isArabic ? "لا توجد معلومات إضافية مطابقة." : "No matching extra information.");
};

const fetchGeneralKnowledgeContext = async (
  supabase: ReturnType<typeof createClient>,
  isArabic: boolean,
  lastUserQuery: string,
) => {
  const { data, error } = await supabase
    .from("mall_knowledge")
    .select("id, section, source_key, title, title_ar, content, content_ar, url")
    .eq("is_active", true)
    .in("section", getGeneralKnowledgeSections(lastUserQuery))
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    if (error) console.warn("general mall_knowledge skipped:", error.message);
    return "";
  }

  return formatKnowledgeRows(filterKnowledgeRowsForQuery(data as KnowledgeMatch[], lastUserQuery), isArabic);
};

const fetchMerchantsContext = async (
  supabase: ReturnType<typeof createClient>,
  lastUserQuery: string,
  isArabic: boolean,
) => {
  const safeQuery = escapeIlikeTerm(lastUserQuery);

  if (safeQuery.length < 3) return "";

  const { data, error } = await supabase
    .from("merchants")
    .select("id, name, specialty, country, slug, bio")
    .eq("status", "active")
    .or(`name.ilike.%${safeQuery}%,specialty.ilike.%${safeQuery}%,bio.ilike.%${safeQuery}%`)
    .limit(MAX_MERCHANT_MATCHES);

  if (error || !data?.length) {
    if (error) console.warn("merchants context skipped:", error.message);
    return "";
  }

  return (data as MerchantRow[])
    .map((merchant, index) => {
      const name = cleanText(merchant.name, isArabic ? "تاجر" : "Merchant");
      const slugOrId = cleanText(merchant.slug || merchant.id);
      const specialty = cleanText(merchant.specialty);
      const country = cleanText(merchant.country);
      const bio = truncateText(cleanText(merchant.bio), 250);

      return [
        `${index + 1}. [${name}](/merchants/${slugOrId})`,
        specialty ? `   - ${isArabic ? "التخصص" : "Specialty"}: ${specialty}` : "",
        country ? `   - ${isArabic ? "الدولة" : "Country"}: ${country}` : "",
        bio ? `   - ${isArabic ? "نبذة" : "Bio"}: ${bio}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
};



type CouponRow = {
  id: string;
  code?: string | null;
  discount_percentage?: number | string | null;
  max_uses?: number | string | null;
  max_uses_per_user?: number | string | null;
  current_uses?: number | string | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  max_discount_amount?: number | string | null;
  min_order_amount?: number | string | null;
};

const shouldFetchCouponsForQuery = (query: string) => getAssistantIntent(query) === "coupon";
const shouldFetchOrdersForQuery = (query: string) => getAssistantIntent(query) === "order";

const fetchCouponsContext = async (
  supabase: ReturnType<typeof createClient>,
  lastUserQuery: string,
  isArabic: boolean,
) => {
  if (!shouldFetchCouponsForQuery(lastUserQuery)) {
    return isArabic
      ? "السؤال الحالي ليس سؤال كوبونات. لا تذكر كوبونات إلا إذا سأل العميل عنها بوضوح."
      : "The current question is not about coupons. Do not mention coupons unless the customer clearly asks.";
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("coupons")
    .select("id, code, discount_percentage, max_uses, max_uses_per_user, current_uses, is_active, expires_at, max_discount_amount, min_order_amount")
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order("discount_percentage", { ascending: false })
    .limit(MAX_COUPON_CONTEXT_ROWS);

  if (error) {
    console.warn("coupons context skipped:", error.message);
    return isArabic ? "لا توجد معلومات كوبونات مؤكدة حاليا." : "No confirmed coupon information is currently available.";
  }

  const coupons = ((data || []) as CouponRow[]).filter((coupon) => {
    const maxUses = toNumber(coupon.max_uses);
    const currentUses = toNumber(coupon.current_uses);
    return !maxUses || currentUses < maxUses;
  });

  if (!coupons.length) {
    return isArabic ? "لا توجد كوبونات خصم فعالة مؤكدة حاليا." : "No confirmed active coupons are currently available.";
  }

  return coupons.map((coupon, index) => {
    const discount = toNumber(coupon.discount_percentage);
    const minOrder = toNumber(coupon.min_order_amount);
    const maxDiscount = toNumber(coupon.max_discount_amount);
    const expiresAt = cleanText(coupon.expires_at);

    return [
      `${index + 1}. ${cleanText(coupon.code, isArabic ? "كوبون" : "Coupon")}`,
      discount > 0 ? `   - ${isArabic ? "نسبة الخصم" : "Discount"}: ${discount}%` : "",
      minOrder > 0 ? `   - ${isArabic ? "الحد الأدنى" : "Minimum order"}: ${minOrder}` : "",
      maxDiscount > 0 ? `   - ${isArabic ? "الحد الأقصى للخصم" : "Maximum discount"}: ${maxDiscount}` : "",
      expiresAt ? `   - ${isArabic ? "ينتهي في" : "Expires at"}: ${expiresAt}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n");
};

const fetchOrdersContext = async (
  supabase: ReturnType<typeof createClient>,
  lastUserQuery: string,
  isArabic: boolean,
  userId?: string,
) => {
  if (!shouldFetchOrdersForQuery(lastUserQuery)) {
    return isArabic
      ? "السؤال الحالي ليس سؤال تتبع طلب. لا تعرض طلبات إلا إذا طلب العميل ذلك."
      : "The current question is not about order tracking. Do not show orders unless the customer asks.";
  }

  if (!userId) {
    return isArabic ? "العميل غير مسجل الدخول؛ اطلب منه تسجيل الدخول لعرض الطلبات." : "The customer is not logged in; ask them to log in to view orders.";
  }

  const [adminOrdersResult, merchantOrdersResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, status, total_amount, payment_method, tracking_number, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_ORDER_CONTEXT_ROWS),
    supabase
      .from("merchant_orders")
      .select("id, status, total_amount, payment_method, tracking_number, created_at, merchant_id")
      .eq("buyer_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_ORDER_CONTEXT_ROWS),
  ]);

  if (adminOrdersResult.error) console.warn("orders context skipped:", adminOrdersResult.error.message);
  if (merchantOrdersResult.error) console.warn("merchant orders context skipped:", merchantOrdersResult.error.message);

  const adminOrders = (adminOrdersResult.data || []).map((order: any) => ({ ...order, source: "admin" }));
  const merchantOrders = (merchantOrdersResult.data || []).map((order: any) => ({ ...order, source: "merchant" }));
  const orders = [...adminOrders, ...merchantOrders]
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, MAX_ORDER_CONTEXT_ROWS);

  if (!orders.length) {
    return isArabic ? "لا توجد طلبات حديثة مرتبطة بهذا الحساب." : "No recent orders are linked to this account.";
  }

  return orders.map((order: any, index: number) => {
    const type = order.source === "merchant" ? (isArabic ? "طلب تاجر" : "Merchant order") : (isArabic ? "طلب المول" : "Mall order");
    const shortId = cleanText(order.id).slice(0, 8);
    const tracking = cleanText(order.tracking_number);
    return [
      `${index + 1}. ${type} #${shortId}`,
      `   - ${isArabic ? "الحالة" : "Status"}: ${cleanText(order.status, isArabic ? "غير محدد" : "unknown")}`,
      tracking ? `   - ${isArabic ? "رقم التتبع" : "Tracking"}: ${tracking}` : "",
      order.created_at ? `   - ${isArabic ? "التاريخ" : "Date"}: ${order.created_at}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n");
};

const shrinkContext = (value: string) => truncateText(cleanMultiline(value), MAX_CONTEXT_CHARS);

const buildSystemPrompt = ({
  isArabic,
  userName,
  categoriesContext,
  staticMallContext,
  generalKnowledgeContext,
  productsContext,
  knowledgeContext,
  merchantsContext,
  couponsContext,
  ordersContext,
  lastUserQuery,
  allowExternalAiKnowledge,
}: {
  isArabic: boolean;
  userName?: string;
  categoriesContext: string;
  staticMallContext: string;
  generalKnowledgeContext: string;
  productsContext: string;
  knowledgeContext: string;
  merchantsContext: string;
  couponsContext: string;
  ordersContext: string;
  lastUserQuery: string;
  allowExternalAiKnowledge: boolean;
}) => {
  const name = cleanText(userName, isArabic ? "صديقي" : "my friend");
  const intent = getAssistantIntent(lastUserQuery);
  const knowledgeMode = getKnowledgeModeForQuery(lastUserQuery);
  const externalKnowledgeRuleAr = allowExternalAiKnowledge
    ? "إذا كان سؤال العميل عاما خارج بيانات المول ولا توجد له معلومة مؤكدة في السياق، يمكنك الإجابة من معرفتك العامة بصياغة حذرة، مع توضيح أنها معلومات عامة وليست سياسة رسمية للمول. في الأسئلة المالية أو العملات الرقمية لا تقدم نصيحة استثمارية ولا توقعات مؤكدة."
    : "لا تستخدم المعرفة العامة خارج سياق المول لهذا السؤال؛ التزم ببيانات المول فقط.";
  const externalKnowledgeRuleEn = allowExternalAiKnowledge
    ? "If the customer's question is general and outside mall data, and no confirmed mall context is available, you may answer from general knowledge carefully, making clear it is general information and not an official mall policy. For finance or crypto questions, do not give investment advice or confident price predictions."
    : "Do not use general external knowledge for this question; use only mall data.";

  const context = shrinkContext(`
${staticMallContext}

${isArabic ? "تصنيف السؤال الحالي:" : "Current query classification:"} ${intent} / ${knowledgeMode}

${generalKnowledgeContext ? `معلومات عامة من جدول معرفة المول:\n${generalKnowledgeContext}` : ""}

${isArabic ? "الأقسام المتاحة:" : "Available categories:"}
${categoriesContext || (isArabic ? "غير متاح حاليا" : "Unavailable")}

${isArabic ? "معلومات معرفة مرتبطة بسؤال العميل:" : "Knowledge related to the customer question:"}
${knowledgeContext}

${isArabic ? "تجار مطابقون إن وجدوا:" : "Matching merchants if any:"}
${merchantsContext || (isArabic ? "لا يوجد تجار مطابقون." : "No matching merchants.")}

${isArabic ? "الكوبونات عند السؤال عنها:" : "Coupons when asked:"}
${couponsContext}

${isArabic ? "طلبات العميل عند طلب التتبع:" : "Customer orders when tracking is requested:"}
${ordersContext}

${isArabic ? "المنتجات المطابقة لبحث العميل:" : "Matching Products:"}
${productsContext}
`);

  if (isArabic) {
    return `أنت مساعد الذكاء الصناعي الرسمي لمول Salla Shop Mall.

اسم العميل الحالي: ${name}.
خاطبه بود، لكن لا تكرر اسمه في كل رد حتى لا يبدو الرد آليا.

قواعد صارمة:
1. أجب بالعربية فقط وباختصار مفيد.
2. لا تعرض أي خطوات تفكير داخلية أو وسوم مثل <think>. أعط العميل الإجابة النهائية فقط.
3. استخدم بيانات المول المرفقة للمنتجات والأسعار والكوبونات والطلبات والسياسات. لا تخترع أي منتج أو سعر أو كوبون أو سياسة.
3-أ. ${externalKnowledgeRuleAr}
3-ب. امنع الخلط بين Pi و ST: إذا كان السؤال عن Pi فقط فلا تستخدم معلومات ST، وإذا كان السؤال عن ST فقط فلا تشرح Pi إلا لو طلب العميل المقارنة صراحة.
4. إذا سأل عن منتج، اقترح فقط المنتجات الموجودة في قسم "المنتجات المطابقة لبحث العميل"، سواء كانت منتجات عادية أو منتجات تجار أو منتجات خدمية.
5. إذا كانت المنتجات المطابقة غير كافية، يمكنك توجيهه إلى رابط الأقسام أو المنتجات، لكن لا تخترع اسم منتج.
6. الأسعار تظهر للعميل بعملة Pi فقط. ممنوع ذكر الجنيه المصري أو EGP أو أي عملة ورقية.
7. حافظ على روابط Markdown كما هي، وإذا ظهر سطر "للمزيد من نفس القسم" فاستخدمه عند الحاجة كزر/رابط إضافي مناسب.
8. إذا لم تجد معلومة، قل بوضوح أنك لا تملكها حاليا واقترح رابطا مناسبا داخل المول.
9. لا تقدم وعود ربحية أو نصائح استثمارية بخصوص ST أو Pi أو أي عملة رقمية.
10. لو السؤال عن الدعم أو مشكلة حساب، وجهه للتواصل مع الإدارة أو صفحة الحساب عند الحاجة.
11. لا تذكر تفاصيل تقنية داخلية مثل أسماء الجداول أو embeddings أو Supabase للعميل.
12. عند عرض عدة اختيارات، اجعلها 3 اختيارات كحد أقصى إلا إذا طلب العميل المزيد.
13. افهم نية السؤال أولا: الكوبونات/أكواد الخصم/القسائم ليست بحث منتجات، والدفع/الطلبات/الدعم/التاجر/ST/Pi لكل منها نية مستقلة.
14. إذا سأل العميل عن كوبونات أو أكواد خصم، استخدم معلومات الكوبونات من السياق فقط، ولا تعرض منتجات لمجرد وجود كلمة "خصم".
15. إذا لم توجد كوبونات مؤكدة في السياق، قل بوضوح أنه لا توجد لديك كوبونات مؤكدة حاليا أو أن المعلومة غير متاحة، ولا تخترع كود خصم.
16. إذا سأل العميل عن تتبع الطلب، استخدم قسم طلبات العميل فقط. لا تعرض طلبات مستخدم آخر، ولا تخترع أرقام تتبع.
17. إذا كانت الإجابة يمكن تنفيذها من الواجهة مثل فتح السلة أو إضافة منتج، وجه العميل لاستخدام الأزرار الظاهرة في الشات عند توفرها.
18. اسأل سؤالا توضيحيا واحدا فقط إذا كان الطلب غير واضح.
19. إذا كان السؤال بصيغة طبيعية مثل "ايه الشاي المتوفر" أو "هل فيه غلايات" فاعتبره بحثا عن منتج متوفر، لكن اعرض فقط ما يظهر في قسم المنتجات المطابقة ولا تبدل المنتج بمنتج آخر.
20. لا تضف أو ترشح منتجا غير مطابق للكلمة الأساسية التي ذكرها العميل.

السياق المتاح:
${context}`;
  }

  return `You are the official AI assistant for Salla Shop Mall.

Current customer name: ${name}.
Be friendly, but do not repeat the name in every answer.

Strict rules:
1. Reply in English only and keep answers concise.
2. Do not reveal internal reasoning, chain-of-thought, or tags like <think>. Give the customer the final answer only.
3. Use mall-provided data for products, prices, coupons, orders, and policies. Do not invent any product, price, coupon, or policy.
3-A. ${externalKnowledgeRuleEn}
3-B. Prevent Pi/ST mixing: if the question is about Pi only, do not use ST information; if it is about ST only, do not explain Pi unless the customer explicitly asks for a comparison.
4. For product questions, suggest only products listed under "Matching Products", including admin, merchant, or service products.
5. If matching products are not enough, guide the customer to a relevant category/products link, but do not invent product names.
6. Customer-facing prices must be in Pi only. Never mention EGP, Egyptian Pounds, or fiat currencies.
7. Keep Markdown links exactly as provided, and use the "More from this category" line when it is relevant as an additional internal link.
8. If information is missing, say you do not currently have it and suggest a relevant mall link.
9. Do not provide profit promises or investment advice about ST, Pi, or any cryptocurrency.
10. For support/account issues, direct the user to the admin or relevant account page when needed.
11. Do not mention internal technical details such as table names, embeddings, or Supabase to customers.
12. When showing options, show up to 3 options unless the customer asks for more.
13. Understand the customer's intent first: coupons/discount codes/vouchers are not product searches, and payments/orders/support/merchant/ST/Pi each have independent intents.
14. For coupon or discount-code questions, use only coupon information from the context and do not show products just because the word "discount" appears.
15. If no confirmed coupons exist in the context, clearly say that no confirmed active coupon is available or that the information is unavailable; never invent a coupon code.
16. When recommending a product, include a short reason: available, matches the search, belongs to the requested category, or is on sale.
17. If the filtered database results are empty, say there are no matching available products. Do not recommend approximate alternatives unless the customer explicitly asks for alternatives.
18. Do not over-apologize or give generic answers; act like a real mall assistant that guides customers to the right internal link.
19. For order tracking, use only the customer orders context. Never invent order or tracking numbers.
20. If the UI can perform an action such as opening the cart or adding a product, guide the customer to use the chat action buttons when available.
21. Ask only one clarifying question when the request is unclear.
22. Natural questions like "what tea is available" or "do you have kettles" are product searches, but show only products listed in Matching Products and never substitute a different item.
23. Do not recommend a product that does not match the customer's key product word.

Available context:
${context}`;
};

serve(async (req) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.warn("store-chat method rejected", { requestId, method: req.method });
    return jsonResponse({ error: "Method not allowed", requestId }, 405);
  }

  let body: RequestBody | null = null;

  try {
    try {
      body = (await req.json()) as RequestBody;
    } catch (jsonError) {
      console.error("store-chat invalid JSON body", { requestId, error: jsonError instanceof Error ? jsonError.message : String(jsonError) });
      return jsonResponse({ error: "Invalid JSON body", requestId }, 400);
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const language = body.language || "ar";
    const isArabic = isArabicLanguage(language);
    const userName = body.userName;
    const piRate = toNumber(body.piRate);
    const conversationSearchText = getConversationSearchText(messages);

    console.log("store-chat request received", {
      requestId,
      mode: body.mode || "chat",
      language,
      userIdPresent: Boolean(body.userId),
      messageCount: messages.length,
    });

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") || null;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.error("store-chat missing Supabase env", { requestId, hasUrl: Boolean(supabaseUrl), hasServiceKey: Boolean(supabaseKey) });
      const msg = isArabic ? "عذرا، إعدادات الاتصال غير مكتملة حاليا." : "Sorry, the connection settings are incomplete right now.";
      return body.mode === "analyze"
        ? jsonResponse({ analysis: defaultAiIntentAnalysis(isArabic), requestId, error: "missing_supabase_env" }, 200)
        : openAiStyleSseFallback(msg);
    }

    if (!getConfiguredAiProviders().length) {
      console.error("store-chat missing AI providers", { requestId });
      const msg = isArabic ? "عذرا، مزود الذكاء الصناعي غير مضبوط حاليا." : "Sorry, the AI provider is not configured right now.";
      return body.mode === "analyze"
        ? jsonResponse({ analysis: defaultAiIntentAnalysis(isArabic), requestId, error: "missing_ai_provider" }, 200)
        : openAiStyleSseFallback(msg);
    }

    const lastUserQuery = getLastUserQuery(messages);

    if (!lastUserQuery) {
      console.warn("store-chat missing last user query", { requestId });
      const msg = isArabic ? "اكتب سؤالك أولا." : "Please write your question first.";
      return body.mode === "analyze"
        ? jsonResponse({ error: msg, requestId }, 400)
        : openAiStyleSseFallback(msg);
    }

    const suppliedAnalysis = body.analysis && typeof body.analysis === "object" ? body.analysis : null;
    const rawAnalysis = suppliedAnalysis
      ? { ...defaultAiIntentAnalysis(isArabic), ...suppliedAnalysis, language: isArabic ? "ar" : "en" }
      : await analyzeUserIntentWithAI({ messages, lastUserQuery, isArabic });
    const analysis = strengthenProductAnalysisWithRawText(rawAnalysis, lastUserQuery);

    console.log("store-chat intent resolved", {
      requestId,
      supplied: Boolean(suppliedAnalysis),
      intent: analysis.intent,
      action: analysis.action,
      product_query: analysis.product_query,
      target_index: analysis.target_index,
      confidence: analysis.confidence,
    });

    if (body.mode === "analyze") {
      console.log("store-chat analyze response", { requestId, ms: Date.now() - startedAt, intent: analysis.intent });
      return jsonResponse({ analysis, requestId });
    }

    const quickReply = getQuickReply(lastUserQuery, isArabic, userName);

    if (quickReply && !["product_search", "add_to_cart", "general_external_question", "general_mall_question", "pi_info", "st_info", "pi_st_compare"].includes(analysis.intent)) {
      return openAiStyleSseFallback(quickReply);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const productDataQuery = mergeSearchQueries(analysis.product_query, lastUserQuery) || lastUserQuery;
    const knowledgeDataQuery = cleanText(analysis.topic) || lastUserQuery;
    const queryEmbedding = await getEmbedding(geminiApiKey, [productDataQuery, knowledgeDataQuery].filter(Boolean).join("\\n"));

    console.log("store-chat fetching mall context", { requestId, productDataQuery, knowledgeDataQuery, needsProductContext: PRODUCT_SEARCH_INTENTS.has(analysis.intent) });

    const [
      categoriesContext,
      staticMallContext,
      generalKnowledgeContext,
      productsContext,
      knowledgeContext,
      merchantsContext,
      couponsContext,
      ordersContext,
    ] = await Promise.all([
      fetchCategoriesContext(supabase, isArabic),
      fetchStaticMallContext(supabase, isArabic),
      fetchGeneralKnowledgeContext(supabase, isArabic, lastUserQuery),
      fetchProductsContext(supabase, queryEmbedding, productDataQuery, isArabic, piRate, PRODUCT_SEARCH_INTENTS.has(analysis.intent)),
      fetchKnowledgeContext(supabase, queryEmbedding, knowledgeDataQuery, isArabic),
      fetchMerchantsContext(supabase, lastUserQuery, isArabic),
      fetchCouponsContext(supabase, lastUserQuery, isArabic),
      fetchOrdersContext(supabase, lastUserQuery, isArabic, body.userId),
    ]);

    console.log("store-chat context ready", {
      requestId,
      categoriesChars: categoriesContext.length,
      staticChars: staticMallContext.length,
      generalKnowledgeChars: generalKnowledgeContext.length,
      productsChars: productsContext.length,
      couponsChars: couponsContext.length,
      ordersChars: ordersContext.length,
      knowledgeChars: knowledgeContext.length,
    });

    const systemPrompt = buildSystemPrompt({
      isArabic,
      userName,
      categoriesContext,
      staticMallContext,
      generalKnowledgeContext,
      productsContext,
      knowledgeContext,
      merchantsContext,
      couponsContext,
      ordersContext,
      lastUserQuery,
      allowExternalAiKnowledge: Boolean(analysis.allow_external_knowledge) || shouldAllowExternalAiKnowledge(lastUserQuery),
    });

    console.log("store-chat requesting answer stream", { requestId });

    const response = await fetchAiStreamWithProviderFallback({
      systemPrompt,
      messages,
    });

    console.log("store-chat provider response", { requestId, status: response.status, ok: response.ok, ms: Date.now() - startedAt });

    if (isRetryableAiStatus(response.status)) {
      return openAiStyleSseFallback(getFallbackMessage(isArabic, userName));
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("AI provider non-retryable error:", { requestId, status: response.status, body: truncateText(errorBody, 1000) });
      return openAiStyleSseFallback(getFallbackMessage(isArabic, userName));
    }

    const sanitizedBody = sanitizeAiSseStream(response.body);

    if (!sanitizedBody) {
      return openAiStyleSseFallback(getFallbackMessage(isArabic, userName));
    }

    console.log("store-chat streaming response", { requestId, ms: Date.now() - startedAt });

    return new Response(sanitizedBody, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("store-chat fatal error", { requestId, error: errorMessage, stack: error instanceof Error ? error.stack : undefined, ms: Date.now() - startedAt });

    const isArabic = isArabicLanguage(body?.language || "ar");
    const safeMessage = isArabic
      ? "عذرا، حدث خطأ أثناء الاتصال. يرجى المحاولة مرة أخرى."
      : "Sorry, a connection error occurred. Please try again.";

    if (body?.mode === "analyze") {
      return jsonResponse({ analysis: defaultAiIntentAnalysis(isArabic), requestId, error: errorMessage }, 200);
    }

    return openAiStyleSseFallback(safeMessage);
  }
});