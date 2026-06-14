import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const normalizeRef = (value: string) =>
  String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)])
    .replace(/\s+/g, "");

function resolveFragmentCurrency(settings: any): "ton" | "usdt_ton" {
  const provider = String(settings?.fulfillment_provider || "fragment").toLowerCase();
  const currency = String(settings?.fragment_currency || "ton").toLowerCase();

  // هذا الحقل خاص بمسار تنفيذ Fragment فقط.
  // لو المزود iStar أو الحقل غير مضبوط، نبقي القيمة TON حتى لا نكسر المسار القديم.
  if (provider === "fragment" && currency === "usdt_ton") return "usdt_ton";
  return "ton";
}

async function insertOrderSafely(supabase: any, payload: Record<string, unknown>, fragmentCurrency: "ton" | "usdt_ton") {
  const payloadWithFragmentMeta = {
    ...payload,
    fragment_currency: fragmentCurrency,
  };

  let result = await supabase
    .from("orders")
    .insert(payloadWithFragmentMeta)
    .select()
    .single();

  if (result.error) {
    const msg = String(result.error.message || result.error.details || "").toLowerCase();
    const isMissingFragmentColumn =
      msg.includes("fragment_currency") ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("column");

    // حماية مؤقتة: لو لم تنفذ migration بعد، لا نكسر إنشاء الطلبات القديمة.
    // بعد تنفيذ SQL سيحفظ الحقل تلقائيا.
    if (isMissingFragmentColumn) {
      console.warn("[CREATE-PAYMENT] ⚠️ fragment_currency column not available yet. Retrying insert without it.");
      result = await supabase
        .from("orders")
        .insert(payload)
        .select()
        .single();
    }
  }

  return result;
}

function getStarUnitPrice(qty: number, basePrice: number) {
  const safeBase = Number(basePrice) || 0;

  // مطابق لآخر تعديل في الواجهة:
  // لو السعر الأساسي 1.10، السعر عند 5000+ يصل إلى 1.05
  if (qty >= 5000) return safeBase * (1.05 / 1.10);
  if (qty >= 2500) return safeBase * (1.055 / 1.10);
  if (qty >= 2000) return safeBase * (1.06 / 1.10);
  if (qty >= 1500) return safeBase * (1.067 / 1.10);
  if (qty >= 1000) return safeBase * (1.075 / 1.10);
  if (qty >= 500) return safeBase * (1.083 / 1.10);

  return safeBase;
}

function roundMoney(value: number, decimals: number) {
  return Number(Number(value).toFixed(decimals));
}

// ✅ انستا باي والمحافظ: نقرب الإجمالي لأعلى جنيه كامل حتى لا توجد كسور في التحويلات المحلية
function calculateBackendTotalCost(params: {
  qty: number;
  starPrice: number;
  currency: string;
  paymentMethod: string;
}) {
  const rawTotal = params.qty * params.starPrice;

  if (
    params.currency === "egp" &&
    ["instapay", "vf_cash", "or_cash", "et_cash"].includes(params.paymentMethod)
  ) {
    return Math.ceil(rawTotal);
  }

  return params.currency === "egp"
    ? roundMoney(rawTotal, 2)
    : roundMoney(rawTotal, 6);
}

// دالة التريجر مخصصة هنا للنجوم فقط
async function triggerDelivery(supabaseUrl: string, serviceRoleKey: string, orderId: string) {
  const deliveryFn = "fragment-order";
  console.log(`[CREATE-PAYMENT] 🚀 Triggering ${deliveryFn} for order ${orderId}...`);
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${deliveryFn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ order_id: orderId }),
    });
    const text = await res.text().catch(() => "");
    console.log(`[CREATE-PAYMENT] ✅ ${deliveryFn} response: ${res.status} ${text}`);
  } catch (e) {
    console.error("[CREATE-PAYMENT] 🛑 Delivery trigger error:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { username, quantity, payment_method, currency, total_cost, star_price, phone_number, payment_ref, user_id } = body ?? {};

    const cleanUsername = String(username || "").replace("@", "").trim();
    const qty = Number(quantity);
    let totalCostNum = Number(total_cost);
    let starPriceNum = Number(star_price);

    console.log(`\n=================================================`);
    console.log(`[CREATE-PAYMENT] 🚀 NEW STARS REQUEST: [@${cleanUsername}], Qty: [${qty}], Method: [${payment_method}], Cost: [${totalCostNum}]`);

    if (!cleanUsername || !qty || !payment_method) return jsonResponse({ error: "Missing required fields" }, 200);
    if (!Number.isFinite(qty) || qty < 1) return jsonResponse({ error: "Invalid quantity" }, 200);
    if (!Number.isFinite(totalCostNum) || totalCostNum <= 0) {
      console.warn("[CREATE-PAYMENT] ⚠️ Frontend total_cost is invalid or missing. Backend will recalculate.");
    }

    // 🛑 إضافة "solana" و "ton" للطرق المسموحة
    const allowedMethods = ["vf_cash", "or_cash", "et_cash", "usdt", "solana", "ton", "pi", "st", "instapay"];
    if (!allowedMethods.includes(payment_method)) return jsonResponse({ error: "Unsupported payment method" }, 200);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: pricingSettings, error: pricingSettingsErr } = await supabase
      .from("settings")
      .select("star_price_usd, star_price_egp, fulfillment_provider, fragment_currency")
      .limit(1)
      .single();

    if (pricingSettingsErr || !pricingSettings) {
      console.error("[CREATE-PAYMENT] 🛑 Failed to load pricing settings:", pricingSettingsErr);
      return jsonResponse({ error: "Failed to load pricing settings" }, 200);
    }

    const requestedCurrencyRaw = String(currency || "").toLowerCase();
    const requestCurrency = ["usdt", "solana", "ton"].includes(String(payment_method))
      ? "usd"
      : requestedCurrencyRaw || "egp";

    const fragmentCurrency = resolveFragmentCurrency(pricingSettings);

    const baseStarPrice =
      requestCurrency === "egp"
        ? Number((pricingSettings as any).star_price_egp ?? 0.65)
        : Number((pricingSettings as any).star_price_usd ?? 0.013);

    // ✅ إعادة الحساب من الباك إند فقط مع الإبقاء على نفس أسماء المتغيرات
    starPriceNum = getStarUnitPrice(qty, baseStarPrice);

    totalCostNum = calculateBackendTotalCost({
      qty,
      starPrice: starPriceNum,
      currency: requestCurrency,
      paymentMethod: payment_method,
    });

    console.log("[CREATE-PAYMENT] 🔐 Backend recalculated price:", {
      qty,
      currency: requestCurrency,
      starPriceNum,
      totalCostNum,
      frontend_total_cost: total_cost,
      frontend_star_price: star_price,
      instapay_ceil_applied: payment_method === "instapay" && requestCurrency === "egp",
      fragment_currency_for_fulfillment: fragmentCurrency,
    });

    // ==========================================
    // 🎯 مسار انستا باي (InstaPay)
    // ==========================================
    if (payment_method === "instapay") {
      const cleanRef = normalizeRef(payment_ref);
      if (cleanRef.length < 12) return jsonResponse({ error: "الرقم المرجعي مطلوب ويجب أن يكون 12 رقم" }, 200);

      console.log(`[CREATE-PAYMENT] 🔍 Step 1: Checking history for Ref: [${cleanRef}]`);
      const { data: existingOrder } = await supabase.from("orders").select("id, status, telegram_username, quantity, total_cost, fragment_order_id")
        .eq("payment_ref", cleanRef).neq("status", "failed").order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (existingOrder) {
        if (String(existingOrder.status) === "completed") {
          console.log(`[CREATE-PAYMENT] ⛔ Order [${existingOrder.id}] is already COMPLETED! Rejecting Ref [${cleanRef}].`);
          return jsonResponse({ error: "عذراً، هذا الرقم المرجعي تم استخدامه واكتمل طلبه مسبقاً." }, 200);
        }
        if (existingOrder.telegram_username.toLowerCase() === cleanUsername.toLowerCase()) {
          if (Number(existingOrder.quantity) === qty) {
            console.log(`[CREATE-PAYMENT] ♻️ User refreshed! Order ID: [${existingOrder.id}], Status: [${existingOrder.status}]`);

            if (["pending", "pending_review"].includes(String(existingOrder.status))) {
              const { data: matchedLog } = await supabase.from("instapay_logs").select("id, amount, status").eq("payment_ref", cleanRef).eq("status", "unclaimed").maybeSingle();
              if (matchedLog) {
                const safeLogAmount = Number(Number(matchedLog.amount).toFixed(2));
                const safeOrderCost = Number(Number(existingOrder.total_cost).toFixed(2));
                if (safeLogAmount === safeOrderCost) {
                  await supabase.from("orders").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", existingOrder.id).in("status", ["pending", "pending_review"]);
                  await supabase.from("instapay_logs").update({ status: "claimed", order_id: existingOrder.id, claimed_at: new Date().toISOString() }).eq("id", matchedLog.id);
                  await triggerDelivery(supabaseUrl, serviceRoleKey, existingOrder.id);
                  return jsonResponse({ order_id: existingOrder.id, status: "paid", message: "تم تأكيد الدفع وجاري معالجة الطلب..." }, 200);
                }
              }
            }

            if (String(existingOrder.status) === "paid" && !existingOrder.fragment_order_id) {
              console.log(`[CREATE-PAYMENT] ℹ️ Order is already paid. Delivery is running in background. Skipping re-trigger.`);
            }

            return jsonResponse({ order_id: existingOrder.id, status: existingOrder.status, message: "طلبك قيد المعالجة حالياً، يرجى الانتظار..." }, 200);
          } else {
            console.log(`[CREATE-PAYMENT] ⛔ Quantity mismatch for Ref [${cleanRef}]`);
            return jsonResponse({ error: `عذراً، لديك طلب مسبق بهذا الرقم المرجعي ولكن بكمية مختلفة (${existingOrder.quantity}).` }, 200);
          }
        } else {
          console.log(`[CREATE-PAYMENT] ⛔ Username mismatch for Ref [${cleanRef}]`);
          return jsonResponse({ error: "عذراً، هذا الرقم المرجعي تم استخدامه في حساب آخر" }, 200);
        }
      }

      console.log(`[CREATE-PAYMENT] 🔍 Step 2: Checking 'instapay_logs' for early payment or used ref...`);
      const { data: logEntry } = await supabase.from("instapay_logs").select("*").eq("payment_ref", cleanRef).maybeSingle();

      if (logEntry) {
        if (logEntry.status === "claimed" || logEntry.status === "manual_consumed") {
          console.log(`[CREATE-PAYMENT] ⛔ Ref [${cleanRef}] is already ${logEntry.status}! Rejecting.`);
          return jsonResponse({ error: "عذراً، هذا الرقم المرجعي تم استخدامه أو إعدامه مسبقاً." }, 200);
        }
        if (logEntry.status === "unclaimed") {
          const safeLogAmount = Number(Number(logEntry.amount).toFixed(2));
          const safeOrderCost = Number(Number(totalCostNum).toFixed(2));
          if (safeLogAmount !== safeOrderCost) {
            console.log(`[CREATE-PAYMENT] ⛔ Amount mismatch for Ref [${cleanRef}]. Log: ${safeLogAmount}, Order: ${safeOrderCost}`);
            return jsonResponse({ error: `المبلغ المحول (${safeLogAmount}) لا يطابق قيمة الطلب (${safeOrderCost})` }, 200);
          }
        }
      } else {
        console.log(`[CREATE-PAYMENT] ℹ️ Ref [${cleanRef}] not found in logs yet. Creating pending order...`);
      }

      const { data: order, error: insertErr } = await insertOrderSafely(supabase, {
        telegram_username: cleanUsername,
        quantity: qty,
        payment_method,
        currency: requestCurrency,
        total_cost: totalCostNum,
        star_price: Number.isFinite(starPriceNum) ? starPriceNum : null,
        status: "pending",
        payment_ref: cleanRef,
        user_id: user_id || null,
      }, fragmentCurrency);

      if (insertErr || !order) return jsonResponse({ error: "Failed to create order" }, 200);

      if (logEntry && logEntry.status === "unclaimed") {
        await supabase.from("orders").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", order.id).eq("status", "pending");
        await supabase.from("instapay_logs").update({ status: "claimed", order_id: order.id, claimed_at: new Date().toISOString() }).eq("id", logEntry.id);
        await triggerDelivery(supabaseUrl, serviceRoleKey, order.id);
        return jsonResponse({ order_id: order.id, status: "paid", message: "تم استلام التحويل وجاري معالجة الطلب!" }, 200);
      }
      return jsonResponse({ order_id: order.id, status: "pending", message: "جاري مراجعة التحويل البنكي..." }, 200);
    }

    // ==========================================
    // 🎯 مسار USDT ، Solana ، و TON
    // ==========================================
    if (payment_method === "usdt" || payment_method === "solana" || payment_method === "ton") {
      const { data: order, error: insertErr } = await insertOrderSafely(supabase, {
        telegram_username: cleanUsername,
        quantity: qty,
        payment_method,
        currency: requestCurrency,
        total_cost: totalCostNum,
        star_price: Number.isFinite(starPriceNum) ? starPriceNum : null,
        status: "pending",
        user_id: user_id || null,
      }, fragmentCurrency);

      if (insertErr || !order) return jsonResponse({ error: "Failed to create order" }, 200);

      // 🚀 بناء الرابط في السيرفر لمسار سولانا
      if (payment_method === "solana") {
        const { data: settings } = await supabase.from("settings").select("usdt_wallet_address_solana").maybeSingle();
        const walletAddress = settings?.usdt_wallet_address_solana?.trim();

        if (!walletAddress) return jsonResponse({ error: "عنوان محفظة السولانا غير مهيأ في الإعدادات." }, 200);

        const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
        const safeAmount = parseFloat(totalCostNum.toFixed(6)).toString();

        const solanaPayLink = `solana:${walletAddress}?amount=${safeAmount}&spl-token=${USDT_MINT}&memo=${encodeURIComponent(order.id)}`;

        console.log(`[CREATE-PAYMENT] ✅ Solana Pay Link Generated: ${solanaPayLink}`);
        return jsonResponse({ order_id: order.id, status: "pending", solana_pay_link: solanaPayLink }, 200);
      }

      // 🚀 مسار TON المعدل فقط:
      // لا نرجع ton://transfer حتى لا يلتقطه Tonkeeper مباشرة.
      // نرجع بيانات الدفع للواجهة كي تستخدم TON Connect وتسمح للمستخدم باختيار المحفظة.
      if (payment_method === "ton") {
        const { data: settings } = await supabase.from("settings").select("usdt_wallet_address_ton").maybeSingle();
        const walletAddress = settings?.usdt_wallet_address_ton?.trim() || "UQCsUp6q4s5m2upt1Hf_RihzJi1K3htMODQfiVDEzsyj72-D";

        if (!walletAddress) return jsonResponse({ error: "عنوان محفظة TON غير مهيأ." }, 200);

        const TON_USDT_MASTER = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

        // USDT على TON يستخدم 6 خانات عشرية
        const usdtAmountUnits = Math.round(Number(totalCostNum.toFixed(6)) * 1_000_000).toString();

        console.log(`[CREATE-PAYMENT] ✅ TON Connect Payment Data Generated For Order: ${order.id}`);

        return jsonResponse({
          order_id: order.id,
          status: "pending",
          ton_payment: {
            to: walletAddress,
            amount_usdt: totalCostNum,
            amount_units: usdtAmountUnits,
            jetton_master: TON_USDT_MASTER,
            comment: order.id,
          },
        }, 200);
      }

      return jsonResponse({ order_id: order.id, status: "pending", message: "Send USDT and submit hash." }, 200);
    }

    // ==========================================
    // 🎯 مسار المحافظ (الشحناوي)
    // ==========================================
    if (["vf_cash", "or_cash", "et_cash"].includes(payment_method)) {
      const cleanPhone = String(phone_number || "").trim();

      // ✅ فحص رقم الهاتف المصري:
      // 010 / 011 / 012 / 015 + إجمالي 11 رقم
      if (!/^01[0125][0-9]{8}$/.test(cleanPhone)) {
        return jsonResponse({ error: "رقم الهاتف غير صحيح" }, 200);
      }

      // ✅ حدود شحناوي حسب التوثيق: من 5 إلى 10000
      if (!Number.isFinite(totalCostNum) || totalCostNum < 5 || totalCostNum > 10000) {
        return jsonResponse({
          error: "المبلغ يجب أن يكون بين 5 و 10000 جنيه",
        }, 200);
      }

      const SHA7NAWY_PUBLIC_KEY = Deno.env.get("SHA7NAWY_PUBLIC_KEY");
      if (!SHA7NAWY_PUBLIC_KEY) return jsonResponse({ status: "pending", message: "Payment gateway not configured." }, 200);

      const { data: order, error: insertErr } = await insertOrderSafely(supabase, {
        telegram_username: cleanUsername,
        quantity: qty,
        payment_method,
        currency: requestCurrency,
        total_cost: totalCostNum,
        star_price: Number.isFinite(starPriceNum) ? starPriceNum : null,
        status: "pending",
        user_id: user_id || null,
      }, fragmentCurrency);

      if (insertErr || !order) return jsonResponse({ error: "Failed to create order" }, 200);

      const webhookUrl = `${supabaseUrl}/functions/v1/sha7nawy-webhook`;
      const orderDetailsMessage = `${qty} salla tst order - ID:${order.id}`;

      const payRes = await fetch("https://gate.sha7nawy.com/api/payment/create", {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: SHA7NAWY_PUBLIC_KEY },
        body: JSON.stringify({ number: cleanPhone, amount: totalCostNum, method: payment_method, client: cleanUsername, details: orderDetailsMessage, webhook_url: webhookUrl }),
      });

      let payData = await payRes.json().catch(() => null);

      if (!payRes.ok || !payData?.status) {
        await supabase.from("orders").update({ status: "failed", error_message: payData?.message }).eq("id", order.id);
        return jsonResponse({ error: payData?.message || "Gateway Error" }, 200);
      }

      const reference = payData.data.reference || payData.data.ref_code || null;
      await supabase.from("orders").update({ payment_ref: reference }).eq("id", order.id);

      return jsonResponse({ order_id: order.id, status: "pending", reference, confirm_message: payData.message, payment_method }, 200);
    }

    return jsonResponse({ error: "Unsupported payment method" }, 200);
  } catch (error: any) {
    console.error("[CREATE-PAYMENT] 🛑 FATAL Error:", error);
    return jsonResponse({ error: error?.message || "Unknown error" }, 200);
  }
});
