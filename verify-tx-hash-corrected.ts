import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-idempotency-key",
};

type Network = "bep20" | "trc20" | "aptos" | "okx_internal" | "binance_internal";

const BSC_RPC_URL = "https://bsc-dataseed.binance.org/";

const BEP20_DECIMALS = 18;
const TRC20_DECIMALS = 6;
const APTOS_DECIMALS = 6;
const BINANCE_DECIMALS = 6;

const INTERNAL_OVERPAY_TOLERANCE = 0.2;
const HASH_ALREADY_USED_MESSAGE = "تم استخدام هاش المعاملة هذا في طلب سابق (مرفوض أمنياً)";

const EVM_USDT_BEP20 = "0x55d398326f99059ff775485246999027b3197955".toLowerCase();
const EVM_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRC20_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const APTOS_DEFAULT_HINTS = [
  "0x1::coin::depositevent",
  "0x1::fungible_asset::deposit",
  "0x1::coin::transferevent",
  "0x1::fungible_asset::transfer",
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function apiError(
  code: string,
  message: string,
  _status = 400, 
  extra: Record<string, unknown> = {},
) {
  // لوج الفشل الموحد ليظهر بشكل واضح في السيرفر عند حدوث أي خطأ
  console.error(`❌ [Verification Failed] Code: ${code} | Message: ${message} | Details:`, JSON.stringify(extra));
  return jsonResponse(
    {
      verified: false,
      code,
      message,
      error: message,
      ...extra,
    },
    200, 
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeInternalReference(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^off[-\s]*chain\s+transfer\s+/i, "")
    .replace(/^internal\s+transfer\s+/i, "")
    .trim();
}

function internalReferenceMatches(sourceRef: unknown, requestedRef: string): boolean {
  const sourceRaw = normalizeText(sourceRef);
  const requestedRaw = normalizeText(requestedRef);
  const sourceNorm = normalizeInternalReference(sourceRef);
  const requestedNorm = normalizeInternalReference(requestedRef);

  if (!sourceRaw || !requestedRaw || !sourceNorm || !requestedNorm) return false;

  return (
    sourceRaw === requestedRaw ||
    sourceNorm === requestedNorm ||
    sourceRaw === requestedNorm ||
    sourceNorm === requestedRaw
  );
}

function isHashAlreadyUsedError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? "");
  return message.includes(HASH_ALREADY_USED_MESSAGE) || message.includes("تم استخدام هاش المعاملة");
}

function normalizeNetwork(value: unknown): Network | null {
  const n = normalizeText(value || "bep20");
  if (n === "bep20" || n === "trc20" || n === "aptos" || n === "okx_internal" || n === "binance_internal") return n as Network;
  return null;
}

function isLikelyHexHash(hash: string): boolean {
  return /^0x[a-f0-9]{64}$/i.test(hash);
}

function isLikelyTronHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

function isTransactionExpired(txTimestampMs: number): boolean {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return (Date.now() - txTimestampMs) > TWENTY_FOUR_HOURS_MS;
}

function parseDecimalToUnits(value: unknown, decimals: number): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;

  const [wholePart, fracPart = ""] = raw.split(".");
  if (fracPart.length > decimals) return null;

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || "0");
  const frac = BigInt((fracPart + "0".repeat(decimals)).slice(0, decimals) || "0");

  return whole * scale + frac;
}

function formatUnits(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const frac = units % scale;

  if (frac === 0n) return whole.toString();

  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}

function toBigIntFlexible(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const s = String(value).trim();
    if (!s) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}

function includesAny(text: string, hints: string[]): boolean {
  if (!hints.length) return true;
  return hints.some((hint) => text.includes(hint));
}

function parseHintList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeAptosAddress(addr: unknown): string {
  const s = String(addr ?? "").trim().toLowerCase();
  if (!s || s === "0x") return "";
  const hex = s.replace(/^0x/, "");
  return "0x" + hex.padStart(64, "0");
}

function normalizeEvmAddress(addr: unknown): string {
  const s = String(addr ?? "").trim().toLowerCase();
  if (!s || s === "0x") return "";
  const hex = s.replace(/^0x/, "");
  return "0x" + hex.padStart(40, "0");
}

function aptosAddressMatches(a: unknown, b: unknown): boolean {
  const aa = normalizeAptosAddress(a);
  const bb = normalizeAptosAddress(b);
  return !!aa && !!bb && aa === bb;
}

function decodeBase58ToHex(str: string): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const base = 58n;
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const p = ALPHABET.indexOf(str[i]);
    if (p === -1) throw new Error("Invalid char");
    num = num * base + BigInt(p);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  return hex;
}

function tronBase58ToEvmHex(base58Str: string): string {
  try {
    const s = String(base58Str).trim();
    if (s.startsWith('0x')) return s.toLowerCase();
    const hex = decodeBase58ToHex(s);
    const addressHex = hex.slice(0, -8);
    if (addressHex.startsWith('41')) {
      return '0x' + addressHex.slice(2).toLowerCase();
    }
    return '0x' + addressHex.toLowerCase();
  } catch (e) {
    return String(base58Str).trim().toLowerCase();
  }
}

function getAptosAddressCandidates(source: any): unknown[] {
  return [
    source?.data?.store,
    source?.data?.owner,
    source?.owner_address,
    source?.data?.account_address,
    source?.data?.to,
    source?.data?.recipient,
    source?.data?.receiver,
    source?.guid?.account_address,
    source?.store,
    source?.owner,
    source?.account_address,
    source?.to,
    source?.recipient,
    source?.receiver,
    source?.address,
  ];
}

function getAptosAmountFromSource(source: any): bigint | null {
  return (
    toBigIntFlexible(source?.data?.amount) ??
    toBigIntFlexible(source?.data?.value) ??
    toBigIntFlexible(source?.data?.coin_amount) ??
    toBigIntFlexible(source?.data?.qty) ??
    toBigIntFlexible(source?.amount) ??
    toBigIntFlexible(source?.value) ??
    toBigIntFlexible(source?.coin_amount) ??
    toBigIntFlexible(source?.qty) ??
    null
  );
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key);
}

async function alreadyUsedHash(supabase: any, cleanHash: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("used_tx_hashes")
    .select("id")
    .eq("tx_hash", cleanHash.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("used_tx_hashes lookup error:", error);
    throw new Error("Database lookup failed");
  }

  return !!data;
}

async function getSettings(supabase: any) {
  const { data, error } = await supabase
    .from("settings")
    .select("usdt_wallet_address, usdt_wallet_address_trc20, usdt_wallet_address_aptos")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("settings lookup error:", error);
    throw new Error("Settings lookup failed");
  }

  return data ?? null;
}

async function storeUsedHash(
  supabase: any,
  cleanHash: string,
  orderId: string,
  amount: number,
) {
  const { error } = await supabase
    .from("used_tx_hashes")
    .insert([
      {
        tx_hash: cleanHash.toLowerCase(),
        order_id: orderId,
        amount,
      },
    ]);

  if (error) {
    if (error.code === "23505") {
      throw new Error(HASH_ALREADY_USED_MESSAGE);
    }
    console.error("used_tx_hashes insert error:", error);
    throw new Error("حدث خطأ أثناء حفظ بيانات المعاملة");
  }
}

async function triggerFulfillment(supabase: any, orderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quantity, star_price")
    .eq("id", orderId)
    .single();

  if (orderError) {
    console.error(`❌ [Fulfillment Error] Order ID: ${orderId} | Error: Could not fetch order details.`);
    return;
  }

  if (order) {
    const isPremium = [3, 6, 12].includes(order.quantity) && Number(order.star_price) > 1;
    const deliveryFn = isPremium ? "fulfill-premium" : "fragment-order";

    console.log(`🚀 [Fulfillment Trigger] Order ID: ${orderId} | Calling function: ${deliveryFn}`);

    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${deliveryFn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ order_id: order.id }),
      });
      
      const text = await res.text();
      
      if (!res.ok) {
         console.error(`❌ [Fulfillment Failed] Order ID: ${orderId} | Status: ${res.status} | Response: ${text}`);
         await supabase.from("orders").update({
             status: "failed",
             error_message: `فشل الشحن التلقائي: ${text}`.substring(0, 500) 
           }).eq("id", orderId);
      } else {
         console.log(`✅ [Fulfillment Success] Order ID: ${orderId} | Delivery triggered.`);
      }
    } catch (e) {
      console.error(`🔥 [Fulfillment Crash] Order ID: ${orderId} | Error: ${e}`);
      await supabase.from("orders").update({
          status: "failed",
          error_message: `انقطع الاتصال بخادم الشحن: ${String(e)}`.substring(0, 500)
        }).eq("id", orderId);
    }
  }
}

async function markPaidOnly(
  supabase: any,
  cleanHash: string,
  orderId: string,
  amountUnits: bigint,
  decimals: number,
  network: string,
  orderData: any,
  options: { internalOverpayTolerance?: number } = {}
) {
  const normalizedPaymentRef = String(cleanHash ?? "").trim().toLowerCase();
  const actualHumanAmount = Number(formatUnits(amountUnits, decimals));
  const expectedAmount = Number(orderData.total_cost);
  const originalQuantity = Number(orderData.quantity);
  const starPrice = Number(orderData.star_price || 0);

  if (!normalizedPaymentRef) {
    return apiError("INVALID_PAYMENT_REF", "رقم/هاش المعاملة غير صالح", 400);
  }

  const diff = expectedAmount - actualHumanAmount;
  let isApproved = false;
  let isPartial = false;

  const internalOverpayTolerance = Number(options.internalOverpayTolerance ?? 0);
  const isInternalOverpayWithinTolerance =
    internalOverpayTolerance > 0 &&
    actualHumanAmount >= expectedAmount &&
    (actualHumanAmount - expectedAmount) <= internalOverpayTolerance + 1e-9;

  if (isInternalOverpayWithinTolerance) {
    isApproved = true;
    isPartial = false;
  } else if (Math.abs(diff) < 0.0001) {
    isApproved = true;
  } else if (diff > 0 && diff <= 3) {
    const expectedFraction = Number((expectedAmount % 1).toFixed(4));
    const actualFraction = Number((actualHumanAmount % 1).toFixed(4));
    const fractionDiff = Math.abs(expectedFraction - actualFraction);

    if (fractionDiff < 0.0001 || Math.abs(fractionDiff - 1) < 0.0001) {
      isApproved = true;
      isPartial = true;
    } else {
      const knownFees = [0.01, 0.1, 0.15, 0.19, 0.2, 0.22, 0.25, 0.29, 0.3, 0.5, 0.8, 1.0, 1.1, 1.2, 1.5, 2.0];
      if (knownFees.some((fee) => Math.abs(diff - fee) < 0.0001)) {
        isApproved = true;
        isPartial = true;
      }
    }
  } else if (diff < 0) {
    const expectedFraction = Number((expectedAmount % 1).toFixed(4));
    const actualFraction = Number((actualHumanAmount % 1).toFixed(4));
    const fractionDiff = Math.abs(expectedFraction - actualFraction);

    if (fractionDiff < 0.0001 || Math.abs(fractionDiff - 1) < 0.0001) {
      isApproved = true;
    }
  }

  if (!isApproved) {
    console.error(`❌ [Hash Error] TxHash: ${normalizedPaymentRef} | Details: Amount mismatch. Expected: ${expectedAmount}, Actual: ${actualHumanAmount}`);
    return apiError(
      "AMOUNT_MISMATCH",
      `المبلغ المرسل غير متطابق. المطلوب ${expectedAmount.toFixed(4)} USDT، والمرسل ${actualHumanAmount} USDT. (الكسور تستخدم كتشفير أمني ويجب تطابقها لتجنب رفض الطلب، تواصل مع الدعم).`,
      400,
      { expected_amount: expectedAmount, actual_amount: actualHumanAmount }
    );
  }

  // حماية مزدوجة:
  // 1) فحص قبل الحفظ لعرض رسالة واضحة.
  // 2) catch للـ unique constraint لحماية السباق بين طلبين متزامنين.
  if (await alreadyUsedHash(supabase, normalizedPaymentRef)) {
    return apiError("HASH_ALREADY_USED", "تم استخدام هاش/رقم المعاملة هذا في طلب سابق", 409);
  }

  try {
    await storeUsedHash(supabase, normalizedPaymentRef, orderId, actualHumanAmount);
  } catch (error) {
    if (isHashAlreadyUsedError(error)) {
      return apiError("HASH_ALREADY_USED", "تم استخدام هاش/رقم المعاملة هذا في طلب سابق", 409);
    }
    throw error;
  }

  const isPremium = [3, 6, 12].includes(originalQuantity) && starPrice > 1;

  if (isPremium && isPartial) {
    await supabase.from("orders").update({
      status: "pending_review",
      payment_ref: normalizedPaymentRef,
      error_message: `Partial payment: Sent ${actualHumanAmount}, Expected ${expectedAmount}`
    }).eq("id", orderId);

    return jsonResponse({
      verified: true,
      status: "pending_review",
      partial: true,
      message: "تم استلام دفعتك لكنها ناقصة بسبب رسوم المنصة. تم تحويل الطلب للمراجعة اليدوية لعدم إمكانية تجزئة اشتراك البريميوم."
    }, 200);
  }

  let finalQuantity = originalQuantity;
  let responseMessage = "تم التحقق وبدء الشحن التلقائي!";
  let dbUpdates: any = {
    status: "paid",
    payment_ref: normalizedPaymentRef
  };

  if (isPartial) {
    finalQuantity = Math.floor(originalQuantity * (actualHumanAmount / expectedAmount));
    dbUpdates.quantity = finalQuantity;
    dbUpdates.total_cost = actualHumanAmount;
    dbUpdates.notes = `Partial fulfillment: Originally requested ${originalQuantity} for ${expectedAmount} USDT. Received ${actualHumanAmount}.`;

    responseMessage = `تنبيه: تم استلام ${actualHumanAmount} USDT (تم خصم رسوم المنصة). سيتم شحن ${finalQuantity} نجمة تلقائياً بناءً على المبلغ الصافي.`;
  }

  const { error } = await supabase.from("orders").update(dbUpdates).eq("id", orderId);

  if (error) {
    console.error("orders update error:", error);
    throw new Error("Failed to update order status");
  }

  console.log(`✅ [Success] TxHash: ${normalizedPaymentRef} | OrderID: ${orderId} | Network: ${network.toUpperCase()} | Amount: ${actualHumanAmount} USDT | Partial: ${isPartial}`);

  await triggerFulfillment(supabase, orderId);

  return jsonResponse({
    verified: true,
    partial: isPartial,
    expected_amount: expectedAmount,
    actual_amount: actualHumanAmount,
    new_quantity: finalQuantity,
    message: responseMessage
  }, 200);
}

// -------------------------------------------------------------

async function verifyBep20(cleanHash: string, orderId: string, orderData: any, walletAddress: string, supabase: any) {
  const wallet = normalizeEvmAddress(walletAddress);
  if (!wallet) return apiError("WALLET_NOT_CONFIGURED", "عنوان محفظة الاستلام غير مضبوط في الإعدادات", 500);

  const receiptRes = await fetchJsonWithTimeout(BSC_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getTransactionReceipt", params: [cleanHash], id: 1 }),
  }, 15000);

  if (!receiptRes.ok) return apiError("BEP20_NETWORK_UNREACHABLE", "تعذر الاتصال بشبكة BSC للتحقق، حاول مجدداً", 502);

  const receiptData = receiptRes.data;
  if (!receiptData?.result || receiptData.result.status !== "0x1") return apiError("BEP20_TX_FAILED", "المعاملة فاشلة أو لم يتم تأكيدها على البلوكتشين بعد", 400);

  const blockRes = await fetchJsonWithTimeout(BSC_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBlockByNumber", params: [receiptData.result.blockNumber, false], id: 2 }),
  }, 15000);

  if (blockRes.ok && blockRes.data?.result?.timestamp) {
    const txTimestampMs = parseInt(blockRes.data.result.timestamp, 16) * 1000;
    if (isTransactionExpired(txTimestampMs)) return apiError("TX_EXPIRED", "عذراً، هذه المعاملة قديمة جداً. يرجى إجراء تحويل جديد.", 400);
  }

  const logs = Array.isArray(receiptData.result.logs) ? receiptData.result.logs : [];
  let transferUnits: bigint | null = null;
  let isToOurWallet = false;

  for (const log of logs) {
    if (normalizeText(log?.address) === EVM_USDT_BEP20 && normalizeText(log?.topics?.[0]) === EVM_TRANSFER_TOPIC) {
      if (normalizeEvmAddress(`0x${String(log?.topics?.[2] ?? "").slice(-40)}`) === wallet) {
        const units = toBigIntFlexible(log?.data);
        if (units !== null) { isToOurWallet = true; transferUnits = units; break; }
      }
    }
  }

  if (!isToOurWallet || transferUnits === null) return apiError("BEP20_RECIPIENT_MISMATCH", "التحويل لم يُرسل إلى عنوان المحفظة الصحيح الخاص بنا", 400);

  return await markPaidOnly(supabase, cleanHash, orderId, transferUnits, BEP20_DECIMALS, "bep20", orderData);
}

async function verifyTrc20(cleanHash: string, orderId: string, orderData: any, walletAddress: string, supabase: any) {
  const walletBase58 = String(walletAddress ?? "").trim();
  if (!walletBase58) return apiError("WALLET_NOT_CONFIGURED", "عنوان محفظة TRC20 غير مضبوط في الإعدادات", 500);
  
  const expectedEvmHex = tronBase58ToEvmHex(walletBase58);
  const eventsRes = await fetchJsonWithTimeout(`https://api.trongrid.io/v1/transactions/${cleanHash}/events?only_confirmed=true&only_unconfirmed=false`, { headers: { Accept: "application/json" } }, 15000);

  if (!eventsRes.ok) return apiError("TRC20_NETWORK_UNREACHABLE", "تعذر الاتصال بشبكة TronGrid للتحقق", 502);

  const events = Array.isArray(eventsRes.data?.data) ? eventsRes.data.data : [];
  if (!events.length) return apiError("TRC20_TX_NOT_FOUND", "لم يتم العثور على المعاملة على شبكة Tron", 404);

  const statusRes = await fetchJsonWithTimeout(`https://api.trongrid.io/walletsolidity/gettransactioninfobyid`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ value: cleanHash }),
  }, 15000);

  if (!statusRes.ok) return apiError("TRC20_NETWORK_UNREACHABLE", "تعذر الاتصال بشبكة TronGrid للتحقق", 502);

  const statusData = statusRes.data ?? {};
  if (statusData?.receipt?.result && statusData.receipt.result !== "SUCCESS") return apiError("TRC20_TX_FAILED", "المعاملة فاشلة أو تم التراجع عنها على البلوكتشين", 400);

  if (statusData?.blockTimeStamp && isTransactionExpired(statusData.blockTimeStamp)) return apiError("TX_EXPIRED", "عذراً، هذه المعاملة قديمة جداً. يرجى إجراء تحويل جديد.", 400);

  let transferUnits: bigint | null = null;
  let isToOurWallet = false;

  for (const event of events) {
    if (String(event?.contract_address).trim() !== TRC20_USDT_CONTRACT || String(event?.event_name).trim().toLowerCase() !== "transfer") continue;
    const toAddr = String(event?.result?.to ?? event?.result?.["1"] ?? event?.result?.["_1"] ?? "").trim().toLowerCase();
    if (toAddr !== expectedEvmHex) continue;

    const units = toBigIntFlexible(event?.result?.value ?? event?.result?.["2"] ?? event?.result?.["_2"] ?? "0");
    if (units === null) continue;

    transferUnits = units;
    isToOurWallet = true;
    break;
  }

  if (!isToOurWallet || transferUnits === null) return apiError("TRC20_RECIPIENT_MISMATCH", "التحويل لم يُرسل إلى عنوان المحفظة الصحيح الخاص بنا", 400);

  return await markPaidOnly(supabase, cleanHash, orderId, transferUnits, TRC20_DECIMALS, "trc20", orderData);
}

async function verifyAptos(cleanHash: string, orderId: string, orderData: any, walletAddress: string, supabase: any) {
  const wallet = normalizeAptosAddress(walletAddress);
  if (!wallet) return apiError("APTOS_WALLET_NOT_CONFIGURED", "عنوان محفظة Aptos غير مضبوط", 500);

  const txRes = await fetchJsonWithTimeout(`https://fullnode.mainnet.aptoslabs.com/v1/transactions/by_hash/${cleanHash}`, { headers: { Accept: "application/json" } }, 15000);
  if (!txRes.ok) return apiError("APTOS_NETWORK_UNREACHABLE", "تعذر الاتصال بشبكة Aptos", 502);

  const txData = txRes.data;
  if (!txData || txData.type !== "user_transaction") return apiError("APTOS_TX_NOT_FOUND", "لم يتم العثور على المعاملة", 404);
  if (!txData.success) return apiError("APTOS_TX_FAILED", "المعاملة فاشلة على شبكة Aptos", 400);

  if (txData?.timestamp && isTransactionExpired(Number(txData.timestamp) / 1000)) return apiError("TX_EXPIRED", "المعاملة قديمة جداً", 400);

  const candidateSources = [
    ...(Array.isArray(txData.events) ? txData.events : []).map((item) => ({ kind: "event", item })),
    ...(Array.isArray(txData.changes) ? txData.changes : []).map((item) => ({ kind: "change", item })),
    ...(Array.isArray(txData.balance_changes) ? txData.balance_changes : []).map((item) => ({ kind: "balance_change", item })),
  ];

  let transferUnits: bigint | null = null;
  for (const { item } of candidateSources) {
    if (getAptosAddressCandidates(item).some((addr) => aptosAddressMatches(addr, wallet))) {
      const units = getAptosAmountFromSource(item);
      if (units !== null) { transferUnits = units; break; }
    }
  }

  if (transferUnits === null) return apiError("APTOS_RECIPIENT_MISMATCH", "التحويل لم يُرسل للمحفظة الصحيحة", 400);

  return await markPaidOnly(supabase, cleanHash, orderId, transferUnits, APTOS_DECIMALS, "aptos", orderData);
}

// -------------------------------------------------------------
// 2️⃣ دوال الاتصال والتحقق المتقدمة الخاصة بـ OKX
// -------------------------------------------------------------
async function signOkxRequest(method: string, path: string, bodyStr: string = '') {
  const apiKey = Deno.env.get('OKX_API_KEY') || '';
  const apiSecret = Deno.env.get('OKX_SECRET') || '';
  const passphrase = Deno.env.get('OKX_PASSPHRASE') || '';

  const timestamp = new Date().toISOString();
  const payload = `${timestamp}${method}${path}${bodyStr}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const signatureBase64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signatureBuffer))));

  return {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': signatureBase64,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    'Content-Type': 'application/json'
  };
}

async function okxRequestJSON(method: string, path: string, bodyObj?: Record<string, unknown>) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers = await signOkxRequest(method, path, bodyStr);
  const res = await fetch(`https://www.okx.com${path}`, { method, headers, body: method === 'GET' ? undefined : bodyStr });
  return await res.json();
}

async function verifyOkxInternal(transferId: string, orderId: string, orderData: any, supabase: any) {
  const cleanId = String(transferId).trim();
  const expectedAmount = Number(orderData.total_cost);
  let matchedDeposit: any = null;
  let amountField = '';

  console.log(`🔍 [OKX Internal] Starting verification. ID: ${cleanId}, Expected Amount: ${expectedAmount}`);

  // 1. البحث في سجل الإيداعات فقط برقم مرجعي واضح.
  // مهم: تم إلغاء البحث بالمبلغ فقط لأنه قد يلتقط تحويل قديم/مكرر.
  try {
    console.log(`📡 [OKX Internal] Fetching deposit-history...`);
    const depositData = await okxRequestJSON('GET', '/api/v5/asset/deposit-history?ccy=USDT');
    console.log(`📦 [OKX Internal] deposit-history response:`, JSON.stringify(depositData).substring(0, 300) + '...');

    if (depositData?.code === '0' && Array.isArray(depositData?.data)) {
      matchedDeposit = depositData.data.find((dep: any) =>
        [
          dep?.depId,
          dep?.txId,
          dep?.internalId,
          dep?.fromWdId,
        ].some((ref) => internalReferenceMatches(ref, cleanId))
      );

      if (matchedDeposit) {
        console.log(`✅ [OKX Internal] Found by ID in deposit-history`);
        amountField = matchedDeposit.amt;
      }
    }
  } catch (e) {
    console.error(`❌ [OKX Internal] Deposit API Error:`, e);
  }

  // 2. البحث في سجل الحساب Bills برقم billId فقط.
  if (!matchedDeposit) {
    try {
      console.log(`📡 [OKX Internal] Not found yet. Fetching bills...`);
      const billsData = await okxRequestJSON('GET', '/api/v5/asset/bills?ccy=USDT');
      console.log(`📦 [OKX Internal] bills response:`, JSON.stringify(billsData).substring(0, 300) + '...');

      if (billsData?.code === '0' && Array.isArray(billsData?.data)) {
        matchedDeposit = billsData.data.find((bill: any) =>
          [
            bill?.billId,
            bill?.instId,
          ].some((ref) => internalReferenceMatches(ref, cleanId)) &&
          Number(bill?.balChg) > 0
        );

        if (matchedDeposit) {
          console.log(`✅ [OKX Internal] Found by ID in bills`);
          amountField = matchedDeposit.balChg;
        }
      }
    } catch (e) {
      console.error(`❌ [OKX Internal] Bills API Error:`, e);
    }
  }

  if (!matchedDeposit) {
    console.error(`❌ [OKX Internal] Transfer NOT FOUND. ID: ${cleanId}, Expected: ${expectedAmount}`);
    return apiError(
      "OKX_TRANSFER_NOT_FOUND",
      "لم يتم العثور على التحويل الداخلي برقم المرجع المرسل. لا يمكن الاعتماد على المبلغ فقط منعاً لاستخدام تحويل قديم أو مكرر.",
      404
    );
  }

  if (matchedDeposit.state && matchedDeposit.state !== '2') {
    return apiError("OKX_TRANSFER_PENDING", "التحويل موجود ولكنه لم يكتمل بعد في المنصة", 400);
  }

  const transferUnits = parseDecimalToUnits(amountField, TRC20_DECIMALS);
  if (transferUnits === null) return apiError("PARSE_ERROR", "خطأ في قراءة المبلغ من المنصة", 500);

  const finalCleanId = String(
    matchedDeposit.depId ||
    matchedDeposit.txId ||
    matchedDeposit.internalId ||
    matchedDeposit.fromWdId ||
    matchedDeposit.billId ||
    cleanId
  ).trim().toLowerCase();

  return await markPaidOnly(
    supabase,
    finalCleanId,
    orderId,
    transferUnits,
    TRC20_DECIMALS,
    "okx_internal",
    orderData,
    { internalOverpayTolerance: INTERNAL_OVERPAY_TOLERANCE },
  );
}

// -------------------------------------------------------------
// 3️⃣ دوال الاتصال والتحقق المتقدمة الخاصة بـ Binance
// -------------------------------------------------------------
async function binanceRequestJSON(path: string, queryString: string = '') {
  const apiKey = Deno.env.get('BINANCE_API_KEY') || '';
  const apiSecret = Deno.env.get('BINANCE_SECRET') || '';

  const timestamp = Date.now().toString();
  const queryWithTime = queryString ? `${queryString}&timestamp=${timestamp}` : `timestamp=${timestamp}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(apiSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(queryWithTime));
  const signatureHex = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  const finalQuery = `${queryWithTime}&signature=${signatureHex}`;

  const res = await fetch(`https://api.binance.com${path}?${finalQuery}`, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': apiKey },
  });

  return await res.json();
}

async function verifyBinanceInternal(transferId: string, orderId: string, orderData: any, supabase: any) {
  const cleanId = String(transferId).trim();
  const expectedAmount = Number(orderData.total_cost);
  let matchedDeposit: any = null;
  let amountField = '';

  console.log(`🔍 [Binance Internal] Starting verification. ID: ${cleanId}, Expected Amount: ${expectedAmount}`);

  // 1. فحص سجل الإيداعات العادي (Deposit History) برقم المرجع فقط.
  // مهم: تم إلغاء البحث بالمبلغ فقط لأنه كان سبب التقاط تحويل قديم ثم ظهور HASH_ALREADY_USED.
  try {
    console.log(`📡 [Binance Internal] Fetching deposit/hisrec...`);
    const depositData = await binanceRequestJSON('/sapi/v1/capital/deposit/hisrec', 'coin=USDT');
    console.log(`📦 [Binance Internal] deposit/hisrec response:`, JSON.stringify(depositData).substring(0, 300) + '...');

    if (Array.isArray(depositData)) {
      matchedDeposit = depositData.find((dep: any) =>
        [
          dep?.txId,
          dep?.id,
        ].some((ref) => internalReferenceMatches(ref, cleanId))
      );

      if (matchedDeposit) {
        console.log(`✅ [Binance Internal] Found by ID in deposit/hisrec`);
        amountField = matchedDeposit.amount;
      }
    }
  } catch (e) {
    console.error(`❌ [Binance Internal] Deposit API Error`, e);
  }

  // 2. فحص سجل Binance Pay برقم orderId أو transactionId فقط.
  if (!matchedDeposit) {
    try {
      console.log(`📡 [Binance Internal] Not found yet. Fetching pay/transactions...`);
      const payData = await binanceRequestJSON('/sapi/v1/pay/transactions');
      console.log(`📦 [Binance Internal] pay/transactions response:`, JSON.stringify(payData).substring(0, 300) + '...');

      if (payData?.code === "000000" && Array.isArray(payData?.data)) {
        matchedDeposit = payData.data.find((tx: any) =>
          tx?.currency === 'USDT' &&
          [
            tx?.orderId,
            tx?.transactionId,
          ].some((ref) => internalReferenceMatches(ref, cleanId))
        );

        if (matchedDeposit) {
          console.log(`✅ [Binance Internal] Found by ID in pay/transactions`);
          amountField = matchedDeposit.amount;
        }
      }
    } catch (e) {
      console.error(`❌ [Binance Internal] Pay API Error`, e);
    }
  }

  if (!matchedDeposit) {
    console.error(`❌ [Binance Internal] Transfer NOT FOUND. ID: ${cleanId}, Expected: ${expectedAmount}`);
    return apiError(
      "BINANCE_TRANSFER_NOT_FOUND",
      "لم يتم العثور على التحويل الداخلي برقم المرجع المرسل. لا يمكن الاعتماد على المبلغ فقط منعاً لاستخدام تحويل قديم أو مكرر.",
      404
    );
  }

  if (
    matchedDeposit.status !== undefined &&
    matchedDeposit.status !== null &&
    !(matchedDeposit.status === 1 || matchedDeposit.status === 6)
  ) {
    return apiError("BINANCE_TRANSFER_PENDING", "التحويل موجود ولكنه لم يكتمل بعد في Binance", 400);
  }

  const transferUnits = parseDecimalToUnits(amountField, BINANCE_DECIMALS);
  if (transferUnits === null) return apiError("PARSE_ERROR", "خطأ في قراءة المبلغ من المنصة", 500);

  const finalCleanId = String(
    matchedDeposit.orderId ||
    matchedDeposit.transactionId ||
    matchedDeposit.txId ||
    matchedDeposit.id ||
    cleanId
  ).trim().toLowerCase();

  return await markPaidOnly(
    supabase,
    finalCleanId,
    orderId,
    transferUnits,
    BINANCE_DECIMALS,
    "binance_internal",
    orderData,
    { internalOverpayTolerance: INTERNAL_OVERPAY_TOLERANCE },
  );
}

// -------------------------------------------------------------

serve(async (req) => {
  console.info(`🌐 [Incoming Request] Method: ${req.method} | URL: ${req.url}`);

  if (req.method === "OPTIONS") {
    console.info(`🌐 [CORS] OPTIONS request handled successfully.`);
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      console.error("❌ [Validation Error] Invalid JSON body.");
      return apiError("BAD_REQUEST", "بيانات الطلب غير صالحة", 400);
    }

    const txHash = String(body?.tx_hash ?? "").trim();
    const orderId = String(body?.order_id ?? "").trim();
    const network = normalizeNetwork(body?.network);

    if (!network) {
      console.error("❌ [Validation Error] Network is missing or invalid.");
      return apiError("NETWORK_INVALID", "الشبكة غير صالحة أو مفقودة", 400);
    }

    if (!txHash || !orderId) {
      console.error("❌ [Validation Error] Missing txHash or orderId.");
      return apiError("MISSING_DATA", "رقم الطلب أو الهاش مفقود", 400);
    }

    if (network === "bep20" && !isLikelyHexHash(txHash)) {
      return apiError("BEP20_INVALID_HASH", "صيغة هاش المعاملة (BEP20) غير صحيحة", 400);
    }
    if (network === "trc20" && !isLikelyTronHash(txHash)) {
      return apiError("TRC20_INVALID_HASH", "صيغة هاش المعاملة (TRC20) غير صحيحة", 400);
    }
    if (network === "aptos" && !isLikelyHexHash(txHash)) {
      return apiError("APTOS_INVALID_HASH", "صيغة هاش المعاملة (Aptos) غير صحيحة", 400);
    }

    const supabase = await getSupabase();
    const cleanHash = txHash.toLowerCase();

    const { data: orderData, error: orderErr } = await supabase
      .from("orders")
      .select("status, total_cost, quantity, star_price")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr || !orderData) {
      return apiError("ORDER_NOT_FOUND", "لم يتم العثور على الطلب المراد التحقق منه", 404);
    }

    if (["paid", "completed", "processing"].includes(orderData.status)) {
      return apiError("ORDER_ALREADY_PAID", "هذا الطلب مدفوع أو قيد المعالجة بالفعل", 400);
    }

    const expectedAmount = Number(orderData.total_cost);
    if (!expectedAmount || expectedAmount <= 0 || isNaN(expectedAmount)) {
      return apiError("INVALID_ORDER_AMOUNT", "قيمة الطلب المسجلة في النظام غير صالحة", 400);
    }

    if (await alreadyUsedHash(supabase, cleanHash)) {
      return apiError("HASH_ALREADY_USED", "تم استخدام هاش المعاملة هذا في طلب سابق", 409);
    }

    const settings = await getSettings(supabase);
    if (!settings) return apiError("SETTINGS_NOT_AVAILABLE", "إعدادات المحافظ غير متوفرة", 500);

    switch (network) {
      case "bep20":
        return await verifyBep20(cleanHash, orderId, orderData, settings.usdt_wallet_address ?? "", supabase);
      case "trc20":
        return await verifyTrc20(cleanHash, orderId, orderData, settings.usdt_wallet_address_trc20 ?? "", supabase);
      case "aptos":
        return await verifyAptos(cleanHash, orderId, orderData, settings.usdt_wallet_address_aptos ?? "", supabase);
      case "okx_internal":
        return await verifyOkxInternal(cleanHash, orderId, orderData, supabase);
      case "binance_internal":
        return await verifyBinanceInternal(cleanHash, orderId, orderData, supabase);
      default:
        return apiError("NETWORK_NOT_SUPPORTED", "شبكة غير مدعومة", 400);
    }
  } catch (error) {
    console.error("🔥 Unhandled error:", error);
    return apiError("UNEXPECTED_ERROR", "حدث خطأ غير متوقع أثناء التحقق", 500);
  }
});