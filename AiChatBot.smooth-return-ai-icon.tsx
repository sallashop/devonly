import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X, Send, Loader2, Bot, User, LogIn, MessageCircle, Trash2, ShoppingCart, ThumbsUp, ThumbsDown, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePriceCalculator } from '@/hooks/usePriceCalculator';
import { useCart } from '@/contexts/CartContext';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

type ChatAction = {
  type: 'add_to_cart' | 'open_product' | 'show_cart' | 'show_coupons' | 'track_orders' | 'compare_products' | 'feedback_good' | 'feedback_bad';
  label: string;
  payload?: {
    productId?: string;
    source?: 'admin' | 'merchant';
    quantity?: number;
    href?: string;
  };
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatAction[];
};

type AiIntentAnalysis = {
  intent:
    | 'product_search'
    | 'add_to_cart'
    | 'show_cart'
    | 'coupons'
    | 'orders'
    | 'compare_products'
    | 'support'
    | 'payment'
    | 'st_info'
    | 'pi_info'
    | 'pi_st_compare'
    | 'general_mall_question'
    | 'general_external_question'
    | 'clarification'
    | 'unknown';
  action?: string;
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
};

const getFallbackAnalysis = (): AiIntentAnalysis => ({
  intent: 'unknown',
  action: 'answer',
  confidence: 0.2,
});

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/store-chat`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const MAX_MESSAGES_CONTEXT = 8;
const CHAT_CACHE_TTL_MS = 5 * 60 * 1000;
const STREAM_RENDER_THROTTLE_MS = 60;
const CHAT_HISTORY_STORAGE_KEY = 'salla-chat:history:v1';
const CHAT_LAST_PRODUCTS_STORAGE_KEY = 'salla-chat:last-products:v1';
const CHAT_FEEDBACK_STORAGE_KEY = 'salla-chat:feedback:v1';
const CHAT_COUPONS_CACHE_KEY = 'salla-chat:coupons-cache:v1';
const MAX_STORED_MESSAGES = 80;
const COUPONS_CACHE_TTL_MS = 5 * 60 * 1000;

const CHAT_PANEL_CLASS =
  'fixed z-50 flex flex-col w-[92vw] sm:w-[380px] h-[70vh] sm:h-[500px] rounded-[2rem] border-0 bg-card shadow-[0_10px_40px_-10px_rgba(0,0,0,0.18)] ring-1 ring-border/5 animate-slide-up overflow-hidden dark:shadow-black/40';

const ASSISTANT_BUBBLE_CLASS =
  'max-w-[82%] rounded-2xl rounded-bl-sm border-0 bg-card px-4 py-2.5 text-sm text-foreground shadow-sm dark:shadow-none';

const USER_BUBBLE_CLASS =
  'max-w-[82%] rounded-2xl rounded-br-sm border-0 bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm dark:shadow-none';

const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670]/g;

const CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

const MAX_CHAT_PRODUCT_RESULTS = 5;
const AI_ANALYSIS_TIMEOUT_MS = 12_000;
const CHAT_REQUEST_TIMEOUT_MS = 45_000;
const STREAM_READ_TIMEOUT_MS = 25_000;

type ChatProductRecord = {
  id: string;
  source: 'admin' | 'merchant';
  name: string;
  name_ar: string | null;
  description?: string | null;
  description_ar?: string | null;
  image?: string | null;
  category?: string | null;
  category_ar?: string | null;
  category_name?: string | null;
  category_name_ar?: string | null;
  category_id?: string | null;
  price?: number | null;
  local_price_egp?: number | null;
  shipping_type?: string | null;
  tags?: string[] | null;
  in_stock?: boolean | null;
  stock_quantity?: number | null;
  is_featured?: boolean | null;
  is_on_sale?: boolean | null;
  merchant_id?: string | null;
};

const getProductRoute = (product: Pick<ChatProductRecord, 'id' | 'source'>) => {
  return product.source === 'merchant' ? `/merchant-product/${product.id}` : `/product/${product.id}`;
};

const getChatProductDisplayName = (product: ChatProductRecord, isRtl: boolean) => {
  return isRtl ? product.name_ar || product.name : product.name || product.name_ar || 'Product';
};

const persistLastChatProducts = (products: ChatProductRecord[]) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      CHAT_LAST_PRODUCTS_STORAGE_KEY,
      JSON.stringify({
        products: products.slice(0, MAX_CHAT_PRODUCT_RESULTS),
        updatedAt: Date.now(),
      })
    );
  } catch {
    // تجاهل أخطاء التخزين المحلي حتى لا تتأثر تجربة الشات.
  }
};

const loadLastChatProducts = () => {
  if (typeof window === 'undefined') return [] as ChatProductRecord[];

  try {
    const raw = window.localStorage.getItem(CHAT_LAST_PRODUCTS_STORAGE_KEY);
    if (!raw) return [] as ChatProductRecord[];

    const parsed = JSON.parse(raw) as { products?: ChatProductRecord[]; updatedAt?: number };
    if (!Array.isArray(parsed.products)) return [] as ChatProductRecord[];

    return parsed.products.filter((product) => product?.id && product?.name).slice(0, MAX_CHAT_PRODUCT_RESULTS);
  } catch {
    return [] as ChatProductRecord[];
  }
};

const buildProductActions = (products: ChatProductRecord[], isRtl: boolean): ChatAction[] => {
  const firstProducts = products.slice(0, 3);
  const actions: ChatAction[] = [];

  firstProducts.forEach((product, index) => {
    const labelPrefix = isRtl ? ['أضف الأول للسلة', 'أضف الثاني للسلة', 'أضف الثالث للسلة'][index] : ['Add first to cart', 'Add second to cart', 'Add third to cart'][index];

    actions.push({
      type: 'add_to_cart',
      label: labelPrefix,
      payload: {
        productId: product.id,
        source: product.source,
        quantity: 1,
      },
    });
  });

  if (firstProducts[0]) {
    actions.push({
      type: 'open_product',
      label: isRtl ? 'فتح أول منتج' : 'Open first product',
      payload: {
        productId: firstProducts[0].id,
        source: firstProducts[0].source,
        href: getProductRoute(firstProducts[0]),
      },
    });
  }

  return actions;
};

const getRequestedProductIndex = (text: string) => {
  const normalized = normalizeText(text);

  if (/(^|\s)(3|third|ثالث|الثالث|التالت)(\s|$)/i.test(normalized)) return 2;
  if (/(^|\s)(2|second|ثاني|الثاني|التاني)(\s|$)/i.test(normalized)) return 1;
  if (/(^|\s)(1|first|اول|الأول|الاول)(\s|$)/i.test(normalized)) return 0;

  return null as number | null;
};

const isAddToCartRequest = (text: string) => {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const hasAddWord = includesAny(normalized, ['اضف', 'أضف', 'ضيف', 'حط', 'ضع', 'add']);
  const hasCartWord = includesAny(normalized, ['سلة', 'سله', 'السلة', 'السله', 'كارت', 'cart', 'basket']);
  const hasReference = includesAny(normalized, ['اول', 'الأول', 'الاول', 'ثاني', 'الثاني', 'ثالث', 'الثالث', 'ده', 'هذا', 'المنتج', 'it', 'this']);

  return hasAddWord && (hasCartWord || hasReference);
};

const isShowCartRequest = (text: string) => {
  const normalized = normalizeText(text);

  return includesAny(normalized, ['افتح السلة', 'فتح السلة', 'اعرض السلة', 'السلة', 'show cart', 'open cart', 'my cart']);
};

const buildCartProductFromChatProduct = ({
  product,
  quantity,
  calculatePrice,
}: {
  product: ChatProductRecord;
  quantity: number;
  calculatePrice: (price: number, shippingType?: string) => any;
}) => {
  const localPriceEgp = Number(product.local_price_egp || 0);
  const priceCalc = calculatePrice(localPriceEgp, product.shipping_type || undefined);
  const calculatedPriceInPi = Number(priceCalc?.priceInPi || 0);
  // لا نستخدم product.price الخام كبديل إذا كان local_price_egp موجودًا؛
  // لأن product.price في بعض الجداول قد يكون سعرًا محليًا/قديمًا وليس Pi.
  const fallbackStoredPiPrice = localPriceEgp <= 0 ? Number(product.price || 0) : 0;
  const priceInPi = calculatedPriceInPi > 0 ? calculatedPriceInPi : fallbackStoredPiPrice;
  const image = product.image || '/placeholder.svg';

  return {
    id: product.id,
    name: product.name,
    nameAr: product.name_ar,
    name_ar: product.name_ar,
    description: product.description || '',
    descriptionAr: product.description_ar || '',
    description_ar: product.description_ar || '',
    image,
    localPriceEgp,
    stockQuantity: Number(product.stock_quantity || 1),
    inStock: product.in_stock !== false,
    shippingType: product.shipping_type || 'light',
    category: product.category || product.category_name || product.category_id || null,
    price: priceInPi,
    priceAtAdd: priceInPi,
    quantity,
    isMerchantProduct: product.source === 'merchant',
    merchantId: product.merchant_id || null,
    merchantName: null,
  } as any;
};




type ChatCouponRecord = {
  id: string;
  code: string;
  discount_percentage?: number | null;
  max_uses?: number | null;
  current_uses?: number | null;
  is_active?: boolean | null;
  expires_at?: string | null;
  max_discount_amount?: number | null;
  min_order_amount?: number | null;
};

type CouponCachePayload = {
  coupons: ChatCouponRecord[];
  expiresAt: number;
};

const isCouponRequest = (text: string) => {
  const normalized = normalizeText(text);
  return includesAny(normalized, COUPON_INTENT_WORDS) || includesAny(normalized, ['كوبون', 'كود خصم', 'خصومات', 'coupon', 'discount code']);
};

const isTrackOrderRequest = (text: string) => {
  const normalized = normalizeText(text);
  return includesAny(normalized, ['تتبع طلبي', 'تتبع الطلب', 'طلباتي', 'حالة الطلب', 'الشحن', 'tracking', 'track order', 'my orders', 'order status']);
};

const isCompareProductsRequest = (text: string) => {
  const normalized = normalizeText(text);
  return includesAny(normalized, ['قارن', 'مقارنة', 'compare', 'comparison', 'الفرق بين']);
};

const readCouponsCache = () => {
  if (typeof window === 'undefined') return null as CouponCachePayload | null;
  try {
    const raw = window.sessionStorage.getItem(CHAT_COUPONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CouponCachePayload;
    if (!Array.isArray(parsed.coupons) || !parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(CHAT_COUPONS_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeCouponsCache = (coupons: ChatCouponRecord[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CHAT_COUPONS_CACHE_KEY, JSON.stringify({ coupons, expiresAt: Date.now() + COUPONS_CACHE_TTL_MS }));
  } catch {
    // ignore cache failures
  }
};

const fetchActiveCouponsForChat = async (isRtl: boolean) => {
  const cached = readCouponsCache();
  if (cached) return cached.coupons;

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('coupons')
    .select('id, code, discount_percentage, max_uses, current_uses, is_active, expires_at, max_discount_amount, min_order_amount')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('discount_percentage', { ascending: false })
    .limit(8);

  if (error) {
    console.warn('Chat coupon fetch failed:', error.message);
    return [] as ChatCouponRecord[];
  }

  const coupons = ((data || []) as ChatCouponRecord[]).filter((coupon) => {
    const maxUses = Number(coupon.max_uses || 0);
    const currentUses = Number(coupon.current_uses || 0);
    return !maxUses || currentUses < maxUses;
  });

  writeCouponsCache(coupons);
  return coupons;
};

const formatCouponsReply = (coupons: ChatCouponRecord[], isRtl: boolean) => {
  if (!coupons.length) {
    return isRtl
      ? 'لا أجد كوبونات خصم فعالة مؤكدة حاليًا في بيانات المول. يمكنك متابعة صفحة المنتجات أو أخبرني باسم منتج لأبحث لك عن العروض المتاحة.'
      : 'I do not see confirmed active coupon codes right now. You can browse products, or tell me a product name and I will look for available deals.';
  }

  const lines = coupons.slice(0, 5).map((coupon, index) => {
    const discount = Number(coupon.discount_percentage || 0);
    const minOrder = Number(coupon.min_order_amount || 0);
    const maxDiscount = Number(coupon.max_discount_amount || 0);
    const details = [
      discount > 0 ? (isRtl ? `خصم ${discount}%` : `${discount}% off`) : '',
      minOrder > 0 ? (isRtl ? `حد أدنى ${minOrder}` : `min order ${minOrder}`) : '',
      maxDiscount > 0 ? (isRtl ? `حد أقصى ${maxDiscount}` : `max discount ${maxDiscount}`) : '',
    ].filter(Boolean).join(' - ');

    return `${index + 1}. **${coupon.code}**${details ? ` — ${details}` : ''}`;
  });

  return isRtl
    ? `هذه الكوبونات الفعالة المؤكدة حاليًا:\n\n${lines.join('\n')}\n\nجرّب الكود أثناء إتمام الطلب، وقد تختلف قابلية الاستخدام حسب المنتج أو القسم.`
    : `These are the currently confirmed active coupons:\n\n${lines.join('\n')}\n\nTry the code during checkout; eligibility may depend on the product or category.`;
};

const formatCartSummaryReply = ({ items, total, itemCount, isRtl }: { items: any[]; total: number; itemCount: number; isRtl: boolean }) => {
  if (!items.length) {
    return isRtl ? 'السلة فارغة حاليًا. ابحث عن منتج وسأساعدك في إضافته.' : 'Your cart is empty. Search for a product and I can help you add it.';
  }

  const lines = items.slice(0, 5).map((item, index) => {
    const name = isRtl ? item.name_ar || item.nameAr || item.name : item.name || item.nameAr || item.name_ar;
    const qty = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    return `${index + 1}. ${name} × ${qty}${price > 0 ? ` - ${(price * qty).toFixed(4)} Pi` : ''}`;
  });

  return isRtl
    ? `في سلتك ${itemCount} منتج/كمية تقريبًا:\n\n${lines.join('\n')}\n\nالإجمالي التقريبي: ${Number(total || 0).toFixed(4)} Pi`
    : `Your cart has about ${itemCount} item(s):\n\n${lines.join('\n')}\n\nEstimated total: ${Number(total || 0).toFixed(4)} Pi`;
};

const fetchRecentOrdersForChat = async (userId: string, isRtl: boolean) => {
  if (!userId) {
    return isRtl ? 'سجّل الدخول أولًا حتى أستطيع عرض طلباتك.' : 'Please log in first so I can show your orders.';
  }

  const [adminOrdersResult, merchantOrdersResult] = await Promise.all([
    supabase
      .from('orders')
      .select('id, status, total_amount, payment_method, tracking_number, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('merchant_orders')
      .select('id, status, total_amount, payment_method, tracking_number, created_at, merchant_id')
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const adminOrders = adminOrdersResult.error ? [] : (adminOrdersResult.data || []).map((order: any) => ({ ...order, type: 'admin' }));
  const merchantOrders = merchantOrdersResult.error ? [] : (merchantOrdersResult.data || []).map((order: any) => ({ ...order, type: 'merchant' }));
  const orders = [...adminOrders, ...merchantOrders]
    .sort((a: any, b: any) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 5);

  if (!orders.length) {
    return isRtl ? 'لا أجد طلبات حديثة مرتبطة بحسابك حاليًا.' : 'I do not see recent orders linked to your account right now.';
  }

  const lines = orders.map((order: any, index: number) => {
    const typeLabel = order.type === 'merchant' ? (isRtl ? 'طلب تاجر' : 'merchant order') : (isRtl ? 'طلب المول' : 'mall order');
    const tracking = order.tracking_number ? (isRtl ? ` - التتبع: ${order.tracking_number}` : ` - tracking: ${order.tracking_number}`) : '';
    const shortId = String(order.id || '').slice(0, 8);
    return `${index + 1}. ${typeLabel} #${shortId} - ${order.status || (isRtl ? 'غير محدد' : 'unknown')}${tracking}`;
  });

  return isRtl
    ? `هذه آخر طلباتك التي وجدتها:\n\n${lines.join('\n')}\n\nلو تريد تفاصيل طلب معين، اكتب رقم الطلب أو كود التتبع.`
    : `Here are the latest orders I found:\n\n${lines.join('\n')}\n\nFor details, send the order number or tracking code.`;
};

const formatProductComparisonReply = (products: ChatProductRecord[], isRtl: boolean, calculatePrice: (price: number, shippingType?: string) => any) => {
  const candidates = products.slice(0, 2);
  if (candidates.length < 2) {
    return isRtl ? 'أحتاج منتجين على الأقل للمقارنة. ابحث عن منتجات أولًا ثم اكتب: قارن بينهم.' : 'I need at least two products to compare. Search for products first, then say: compare them.';
  }

  const lines = candidates.map((product, index) => {
    const name = getChatProductDisplayName(product, isRtl);
    const priceInfo = calculatePrice(Number(product.local_price_egp || 0), product.shipping_type || undefined);
    const priceText = Number(priceInfo?.priceInPi || 0) > 0 ? `${Number(priceInfo.priceInPi).toFixed(4)} Pi` : (isRtl ? 'السعر غير محدد' : 'price unavailable');
    const stockText = product.in_stock === false ? (isRtl ? 'غير متوفر' : 'out of stock') : (isRtl ? 'متوفر' : 'available');
    const category = isRtl ? product.category_name_ar || product.category_ar || product.category : product.category_name || product.category;
    return `${index + 1}. **${name}**\n   - ${isRtl ? 'السعر' : 'Price'}: ${priceText}\n   - ${isRtl ? 'الحالة' : 'Status'}: ${stockText}${category ? `\n   - ${isRtl ? 'القسم' : 'Category'}: ${category}` : ''}`;
  });

  return isRtl
    ? `مقارنة سريعة بين أقرب منتجين:\n\n${lines.join('\n\n')}\n\nلو تريد مقارنة أدق، اكتب الميزانية أو الماركة المفضلة.`
    : `Quick comparison between the closest two products:\n\n${lines.join('\n\n')}\n\nFor a sharper comparison, tell me your budget or preferred brand.`;
};

const saveChatFeedbackLocally = (payload: { value: 'good' | 'bad'; answer: string; language: string }) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(CHAT_FEEDBACK_STORAGE_KEY);
    const previous = raw ? JSON.parse(raw) : [];
    const items = Array.isArray(previous) ? previous : [];
    items.push({ ...payload, createdAt: Date.now() });
    window.localStorage.setItem(CHAT_FEEDBACK_STORAGE_KEY, JSON.stringify(items.slice(-80)));
  } catch {
    // ignore local feedback failures
  }
};

type ChatCategoryRecord = {
  id: string;
  name: string | null;
  name_ar: string | null;
  slug?: string | null;
};

let categoriesCache: {
  items: ChatCategoryRecord[];
  expiresAt: number;
} | null = null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string) => UUID_REGEX.test(String(value || '').trim());


const removeArabicDiacritics = (value: string) => {
  return value.replace(ARABIC_DIACRITICS_REGEX, '').replace(/ـ/g, '');
};

const normalizeText = (value: string) => {
  return removeArabicDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};


type ChatIntent =
  | 'greeting'
  | 'coupon'
  | 'support'
  | 'products'
  | 'product_search'
  | 'merchant'
  | 'st'
  | 'pi'
  | 'payment'
  | 'order'
  | 'returns'
  | 'category'
  | 'general';

const includesAny = (value: string, needles: string[]) => {
  return needles.some((needle) => value.includes(normalizeText(needle)));
};

const countWords = (value: string) => normalizeText(value).split(' ').filter(Boolean).length;

const COUPON_INTENT_WORDS = [
  'كوبون',
  'كوبونات',
  'كود خصم',
  'اكواد خصم',
  'أكواد خصم',
  'قسيمة',
  'قسائم',
  'برومو كود',
  'coupon',
  'coupons',
  'promo code',
  'discount code',
  'voucher',
  'vouchers',
];

const PRODUCT_INTENT_HINTS = [
  'منتج',
  'منتجات',
  'اشتري',
  'شراء',
  'عايز',
  'عاوز',
  'ابحث',
  'هات',
  'اعرض',
  'سعر',
  'ارخص',
  'الأرخص',
  'افضل',
  'أفضل',
  'موبايل',
  'موبايلات',
  'الموبايلات',
  'هاتف',
  'هواتف',
  'الهاتف',
  'الهواتف',
  'جوال',
  'سامسونج',
  'samsung',
  'iphone',
  'ايفون',
  'شاومي',
  'xiaomi',
  'oppo',
  'اوبو',
  'product',
  'products',
  'buy',
  'search',
  'find',
  'show',
  'price',
  'cheapest',
  'best',
];

const classifyChatIntent = (text: string): ChatIntent => {
  const normalized = normalizeText(text);

  if (!normalized) return 'general';
  if (isGreetingMessage(text)) return 'greeting';

  const couponLike =
    includesAny(normalized, COUPON_INTENT_WORDS) ||
    ((normalized.includes('خصم') || normalized.includes('discount')) &&
      includesAny(normalized, ['كود', 'اكواد', 'أكواد', 'قسيمة', 'قسائم', 'فعالة', 'صالحة', 'متاحة حاليا', 'available', 'valid', 'active', 'code']));

  if (couponLike) return 'coupon';

  if (includesAny(normalized, ['الدعم', 'مشكلة', 'مشكله', 'تواصل', 'شكوى', 'بلاغ', 'support', 'contact', 'help'])) {
    return 'support';
  }

  if (includesAny(normalized, ['انضم كتاجر', 'تاجر', 'بائع', 'merchant', 'seller', 'vendor'])) {
    return 'merchant';
  }

  if (normalized === 'st' || includesAny(normalized, ['عملة st', 'توكن st', 'st token', 'salla token'])) {
    return 'st';
  }

  if (normalized === 'pi' || includesAny(normalized, ['عملة pi', 'عملة باي', 'pi currency', 'what is pi', 'explain pi'])) {
    return 'pi';
  }

  if (includesAny(normalized, ['الدفع', 'ادفع', 'محفظة', 'wallet', 'payment', 'checkout', 'pay'])) {
    return 'payment';
  }

  if (includesAny(normalized, ['طلب', 'طلباتي', 'اوردر', 'الشحن', 'تتبع', 'order', 'orders', 'shipping', 'tracking'])) {
    return 'order';
  }

  if (includesAny(normalized, ['استرجاع', 'استبدال', 'مرتجع', 'refund', 'return', 'returns', 'exchange'])) {
    return 'returns';
  }

  if (normalized === 'المنتجات' || normalized === 'products' || includesAny(normalized, PRODUCT_INTENT_HINTS)) {
    return 'product_search';
  }

  if (includesAny(normalized, ['قسم', 'اقسام', 'أقسام', 'تصنيف', 'category', 'categories'])) {
    return 'category';
  }

  return 'general';
};

const shouldBypassDirectProductSearch = (text: string) => {
  const intent = classifyChatIntent(text);

  return [
    'coupon',
    'support',
    'merchant',
    'st',
    'pi',
    'payment',
    'order',
    'returns',
    'category',
  ].includes(intent);
};


const normalizeCategoryLookupValue = (value: string) => {
  return normalizeText(
    decodeURIComponent(String(value || ''))
      .replace(/[-_]+/g, ' ')
      .replace(/^#+/g, '')
  );
};

const getCategoriesForChatLinks = async () => {
  if (categoriesCache && categoriesCache.expiresAt > Date.now()) {
    return categoriesCache.items;
  }

  const { data, error } = await supabase
    .from('categories')
    .select('id, name, name_ar, slug')
    .limit(500);

  if (error) {
    console.error('Failed to load categories for chat link normalization:', error);
    return categoriesCache?.items || [];
  }

  const items = (data || []) as ChatCategoryRecord[];

  categoriesCache = {
    items,
    expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS,
  };

  return items;
};

const resolveCategoryParamToId = async (categoryValue: string) => {
  const rawValue = String(categoryValue || '').trim();

  if (!rawValue || isUuid(rawValue)) {
    return rawValue;
  }

  const normalizedWanted = normalizeCategoryLookupValue(rawValue);

  if (!normalizedWanted) {
    return rawValue;
  }

  const categories = await getCategoriesForChatLinks();

  const matchedCategory = categories.find((category) => {
    const possibleValues = [
      category.id,
      category.slug,
      category.name,
      category.name_ar,
    ];

    return possibleValues.some((value) => {
      if (!value) return false;

      const normalizedValue = normalizeCategoryLookupValue(String(value));

      return (
        normalizedValue === normalizedWanted ||
        normalizedValue.replace(/\s+/g, '') === normalizedWanted.replace(/\s+/g, '')
      );
    });
  });

  return matchedCategory?.id || rawValue;
};

const resolveInternalFilterHref = async (href: string) => {
  const normalizedHref = normalizeChatHref(href);

  if (!normalizedHref.startsWith('/')) {
    return normalizedHref;
  }

  try {
    const url = new URL(normalizedHref, getAppOrigin());
    const path = url.pathname;

    if (path === '/products' || path === '/merchant-products') {
      const categoryValue = url.searchParams.get('category');

      if (categoryValue) {
        const resolvedCategoryId = await resolveCategoryParamToId(categoryValue);
        url.searchParams.set('category', resolvedCategoryId);
      }
    }

    const queryString = url.searchParams.toString();
    return `${url.pathname}${queryString ? `?${queryString}` : ''}${url.hash}`;
  } catch {
    return normalizedHref;
  }
};

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const parseStreamContent = (jsonStr: string) => {
  const parsed = JSON.parse(jsonStr);

  return (
    parsed.choices?.[0]?.delta?.content ||
    parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
    ''
  ) as string;
};

const getFallbackErrorMessage = (isRtl: boolean) => {
  return isRtl
    ? 'عذرا، حدث خطأ أثناء الاتصال. يرجى المحاولة مرة اخرى.'
    : 'Sorry, a connection error occurred. Please try again.';
};

/**
 * نفس منطق الحساب الصحيح المستخدم قبل التحديث.
 * piRate هنا يعني: كم Pi يقابل 1 EGP.
 * لذلك الدالة الخلفية يجب أن تحسب:
 * local_price_egp * piRate
 */
const getPiRateForChat = (calculatePrice: (price: number, shippingType?: string) => any) => {
  try {
    const rateInfo = calculatePrice(1, 'free');
    const priceInPi = toNumber(rateInfo?.priceInPi);

    return priceInPi > 0 ? priceInPi : 0;
  } catch {
    return 0;
  }
};



const CART_TARGET_STOP_WORDS = new Set([
  'اضف', 'أضف', 'ضيف', 'ضف', 'حط', 'زود', 'add', 'put',
  'الي', 'إلى', 'الى', 'في', 'على', 'علي', 'داخل',
  'السله', 'السلة', 'سله', 'cart', 'basket',
  'المنتج', 'منتج', 'اول', 'الأول', 'الاول', 'ثاني', 'الثاني',
  'تاني', 'التاني', 'رقم', 'واحد', 'اتنين', 'اثنين', '1', '2', '3',
]);

const mapAdminChatProduct = (item: any): ChatProductRecord => ({
  id: item.id,
  source: 'admin',
  name: item.name,
  name_ar: item.name_ar,
  description: item.description,
  description_ar: item.description_ar,
  image: item.image || (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null),
  category: item.category,
  category_ar: item.category_ar,
  category_name: item.category_name,
  category_name_ar: item.category_name_ar,
  category_id: item.category_id,
  price: item.price,
  local_price_egp: item.local_price_egp,
  shipping_type: item.shipping_type,
  tags: item.tags,
  in_stock: item.in_stock,
  stock_quantity: item.stock_quantity,
  is_featured: item.is_featured,
  is_on_sale: item.is_on_sale,
});

const mapMerchantChatProduct = (item: any): ChatProductRecord => ({
  id: item.id,
  source: 'merchant',
  name: item.name,
  name_ar: item.name_ar,
  description: item.description,
  description_ar: item.description_ar,
  image: item.image || (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null),
  category: item.category,
  category_ar: item.category_ar,
  category_name: item.category_name,
  category_name_ar: item.category_name_ar,
  category_id: item.category_id,
  price: item.price,
  local_price_egp: item.local_price_egp,
  shipping_type: item.shipping_type,
  tags: item.tags,
  in_stock: item.in_stock,
  stock_quantity: item.stock_quantity,
  is_featured: item.is_featured,
  is_on_sale: item.is_on_sale,
  merchant_id: item.merchant_id,
});

const isGreetingMessage = (text: string) => {
  const normalized = normalizeText(text);

  if (!normalized) return false;

  const greetings = new Set([
    'مرحبا',
    'مرحبه',
    'اهلا',
    'اهلين',
    'اهلا وسهلا',
    'السلام عليكم',
    'سلام',
    'هاي',
    'هلا',
    'hello',
    'hi',
    'hey',
    'good morning',
    'good evening',
  ]);

  if (greetings.has(normalized)) return true;

  const words = normalized.split(' ');
  return words.length <= 3 && words.some((word) => greetings.has(word));
};

const getGreetingReply = (isRtl: boolean, userName: string) => {
  const name = userName || (isRtl ? 'صديقي' : 'there');

  return isRtl
    ? `مرحبا بك يا ${name} 👋\nأنا مساعد Salla Shop الذكي. أقدر أساعدك في البحث عن المنتجات، معرفة الأقسام، شرح الدفع بعملة Pi، معلومات ST، الكوبونات، أو الانضمام كتاجر.\n\nجرب تسألني مثلا: "عايز موبايل بسعر كويس" أو "اشرحلي عملة ST".`
    : `Hello ${name} 👋\nI'm the Salla Shop AI assistant. I can help you find products, browse categories, understand Pi payments, ST, coupons, or becoming a merchant.\n\nTry asking: "I want a good phone" or "Explain ST Token".`;
};


type CachePayload = {
  content: string;
  expiresAt: number;
};

type StoredChatPayload = {
  messages: Message[];
  updatedAt: number;
};

const isValidMessage = (message: unknown): message is Message => {
  if (!message || typeof message !== 'object') return false;

  const candidate = message as Message;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    candidate.content.trim().length > 0
  );
};

const getStoredChatMessages = () => {
  if (typeof window === 'undefined') return [] as Message[];

  try {
    const raw = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!raw) return [] as Message[];

    const parsed = JSON.parse(raw) as StoredChatPayload | Message[];
    const storedMessages = Array.isArray(parsed) ? parsed : parsed?.messages;

    if (!Array.isArray(storedMessages)) {
      window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
      return [] as Message[];
    }

    return storedMessages.filter(isValidMessage).slice(-MAX_STORED_MESSAGES);
  } catch {
    window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
    return [] as Message[];
  }
};

const setStoredChatMessages = (messages: Message[]) => {
  if (typeof window === 'undefined') return;

  try {
    const safeMessages = messages.filter(isValidMessage).slice(-MAX_STORED_MESSAGES);

    if (safeMessages.length === 0) {
      window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
      return;
    }

    const payload: StoredChatPayload = {
      messages: safeMessages,
      updatedAt: Date.now(),
    };

    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // تجاهل أخطاء localStorage حتى لا تتسبب في صفحة بيضاء.
  }
};

const clearStoredChatMessages = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY);
  } catch {
    // تجاهل أخطاء localStorage.
  }
};

const THINK_BLOCK_REGEX = /<think>[\s\S]*?<\/think>|<thinking>[\s\S]*?<\/thinking>/gi;
const OPEN_THINK_BLOCK_REGEX = /<think>[\s\S]*$|<thinking>[\s\S]*$/gi;

const removeThinkBlocks = (value: string) => {
  return String(value || '')
    .replace(THINK_BLOCK_REGEX, '')
    .replace(OPEN_THINK_BLOCK_REGEX, '')
    .trimStart();
};

const buildCacheKey = ({
  text,
  language,
  piRate,
  userId,
}: {
  text: string;
  language: string;
  piRate: number;
  userId?: string;
}) => {
  const normalizedText = normalizeText(text).slice(0, 280);
  const roundedPiRate = piRate > 0 ? piRate.toFixed(8) : '0';
  return `salla-chat:v15-no-backend-reply-cache:${language}:${userId || 'guest'}:${roundedPiRate}:${normalizedText}`;
};

const getCachedReply = (cacheKey: string) => {
  if (typeof window === 'undefined' || !cacheKey) return '';

  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return '';

    const parsed = JSON.parse(raw) as CachePayload;

    if (!parsed?.content || !parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(cacheKey);
      return '';
    }

    return parsed.content;
  } catch {
    return '';
  }
};

const setCachedReply = (cacheKey: string, content: string) => {
  if (typeof window === 'undefined' || !cacheKey || !content.trim()) return;

  try {
    const payload: CachePayload = {
      content,
      expiresAt: Date.now() + CHAT_CACHE_TTL_MS,
    };

    window.sessionStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // تجاهل أخطاء sessionStorage.
  }
};

const trimHref = (value: string) => {
  return String(value || '')
    .trim()
    .replace(/[\u200E\u200F]/g, '')
    .replace(/[.,،؛;:!?]+$/g, '');
};

const getAppOrigin = () => {
  if (typeof window === 'undefined') return 'http://localhost';
  return window.location.origin;
};

const normalizeQueryAliases = (params: URLSearchParams) => {
  const categoryAlias =
    params.get('category') ||
    params.get('categoryId') ||
    params.get('category_id') ||
    params.get('cat');

  if (categoryAlias) {
    params.set('category', categoryAlias);
    params.delete('categoryId');
    params.delete('category_id');
    params.delete('cat');
  }

  const tagAlias = params.get('tag') || params.get('tagName') || params.get('tag_name');

  if (tagAlias) {
    params.set('tag', tagAlias);
    params.delete('tagName');
    params.delete('tag_name');
  }

  const merchantAlias = params.get('merchant') || params.get('merchantId') || params.get('merchant_id');

  if (merchantAlias) {
    params.set('merchant', merchantAlias);
    params.delete('merchantId');
    params.delete('merchant_id');
  }
};

const normalizeInternalRoute = (href: string) => {
  const safeHref = trimHref(href);

  if (!safeHref.startsWith('/')) return safeHref;

  try {
    const url = new URL(safeHref, getAppOrigin());
    const parts = url.pathname.split('/').filter(Boolean);
    const params = new URLSearchParams(url.search);

    if (parts[0] === 'products' && parts[1] === 'category' && parts[2]) {
      url.pathname = '/products';
      params.set('category', decodeURIComponent(parts[2]));
    }

    if (parts[0] === 'merchant-products' && parts[1] === 'category' && parts[2]) {
      url.pathname = '/merchant-products';
      params.set('category', decodeURIComponent(parts[2]));
    }

    if (parts[0] === 'products' && parts[1] === 'tag' && parts[2]) {
      url.pathname = '/products';
      params.set('tag', decodeURIComponent(parts[2]));
    }

    if (parts[0] === 'merchant-products' && parts[1] === 'tag' && parts[2]) {
      url.pathname = '/merchant-products';
      params.set('tag', decodeURIComponent(parts[2]));
    }

    normalizeQueryAliases(params);

    const queryString = params.toString();
    return `${url.pathname}${queryString ? `?${queryString}` : ''}${url.hash}`;
  } catch {
    return safeHref;
  }
};

const normalizeChatHref = (href: string) => {
  const safeHref = trimHref(href);

  if (!safeHref) return '';
  if (safeHref.startsWith('#')) return safeHref;

  if (safeHref.startsWith('/')) {
    return normalizeInternalRoute(safeHref);
  }

  if (/^www\./i.test(safeHref)) {
    return `https://${safeHref}`;
  }

  if (/^https?:\/\//i.test(safeHref)) {
    try {
      const url = new URL(safeHref);

      if (typeof window !== 'undefined' && url.origin === window.location.origin) {
        return normalizeInternalRoute(`${url.pathname}${url.search}${url.hash}`);
      }

      return url.toString();
    } catch {
      return safeHref;
    }
  }

  return safeHref;
};

const isInternalChatHref = (href: string) => {
  const normalizedHref = normalizeChatHref(href);
  return normalizedHref.startsWith('/') || normalizedHref.startsWith('#');
};

const createLinkLabel = (href: string) => {
  const normalizedHref = normalizeChatHref(href);

  try {
    const url = normalizedHref.startsWith('/')
      ? new URL(normalizedHref, getAppOrigin())
      : new URL(normalizedHref);

    const pathname = url.pathname.replace(/^\//, '') || url.hostname;
    const category = url.searchParams.get('category');
    const tag = url.searchParams.get('tag');

    if (category) return `${pathname} - category`;
    if (tag) return `${pathname} - tag`;

    return normalizedHref.startsWith('/') ? pathname : url.hostname;
  } catch {
    return normalizedHref;
  }
};

const linkifySegment = (segment: string) => {
  const urlRegex = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/gi;
  const internalPathRegex = /(^|[\s(])((?:\/(?:products|merchant-products|product|merchant-product|categories|category|merchants|merchant|st-token-info|profile|cart|checkout|orders|become-merchant)[^\s<>()]*)+)/gi;
  const placeholders: string[] = [];

  const withUrlPlaceholders = segment.replace(urlRegex, (match) => {
    const href = normalizeChatHref(match);
    const markdownLink = `[${href}](${href})`;
    const index = placeholders.push(markdownLink) - 1;
    return `\u0000CHAT_LINK_${index}\u0000`;
  });

  const withInternalLinks = withUrlPlaceholders.replace(
    internalPathRegex,
    (match, prefix, rawPath) => {
      const href = normalizeChatHref(rawPath);
      return `${prefix}[${createLinkLabel(href)}](${href})`;
    }
  );

  return withInternalLinks.replace(/\u0000CHAT_LINK_(\d+)\u0000/g, (_, index) => {
    return placeholders[Number(index)] || '';
  });
};

const linkifyChatContent = (content: string) => {
  const value = String(content || '');
  const markdownLinkRegex = /\[[^\]]+\]\([^)]+\)/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markdownLinkRegex.exec(value)) !== null) {
    result += linkifySegment(value.slice(lastIndex, match.index));
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  result += linkifySegment(value.slice(lastIndex));
  return result;
};

const CHAT_LINK_GUIDELINES = {
  markdownRequired: true,
  productLinks: [
    '/product/{product_id}',
    '/merchant-product/{product_id}',
  ],
  categoryFilterLinks: [
    '/products?category={category_id}',
    '/merchant-products?category={category_id}',
  ],
  tagFilterLinks: [
    '/products?category={category_id}&tag={tag}',
    '/merchant-products?category={category_id}&tag={tag}',
  ],
  instructions:
    'When recommending products, categories, tags, merchants, or internal pages, always return clickable Markdown links. For product links, use /product/{product_id}. For category filtering, use the exact query parameter category with the category UUID/id, not the display name. For tag filtering, use tag. Do not use categoryId, category_id, cat, or plain category names as URLs. If the user mentions a product name, use available product search results and links instead of saying no products exist.',
};

const getLocalQuickReply = (text: string, isRtl: boolean, userName: string) => {
  const normalized = normalizeText(text);

  if (!normalized) return '';

  if (isGreetingMessage(text)) {
    return getGreetingReply(isRtl, userName);
  }

  const intent = classifyChatIntent(text);
  const wordCount = countWords(text);

  // أسئلة Pi العامة مثل "هل عملة Pi كويسة؟" لا نرد عليها محليا؛
  // نتركها لطبقة AI fallback حتى تجيب من المزود الخارجي بحذر وبدون خلطها مع ST.

  if (intent === 'coupon' && wordCount <= 4) {
    return isRtl
      ? `اسألني عن كوبون محدد أو عن الكوبونات المتاحة حاليا وسأتحقق من معلومات المول المتاحة بدون عرض منتجات غير مرتبطة.`
      : `Ask me about a specific coupon or currently available coupons, and I will check the available mall information without showing unrelated products.`;
  }

  const asksSupport =
    normalized.includes('الدعم') ||
    normalized.includes('مشكله') ||
    normalized.includes('مشكلة') ||
    normalized.includes('تواصل') ||
    normalized.includes('support') ||
    normalized.includes('contact') ||
    normalized.includes('help');

  if (asksSupport && wordCount <= 8) {
    return isRtl
      ? `تقدر تتواصل مع دعم Salla Shop من خلال بريد الدعم: support@salla-shop.com أو من صفحة حسابي إذا كانت المشكلة مرتبطة بحسابك.

[حسابي](/profile)`
      : `You can contact Salla Shop support at support@salla-shop.com, or use your account page if the issue is related to your account.

[My Account](/profile)`;
  }

  const asksProducts =
    normalized === 'المنتجات' ||
    normalized === 'products' ||
    normalized.includes('كل المنتجات') ||
    normalized.includes('تصفح المنتجات') ||
    normalized.includes('browse products');

  if (asksProducts) {
    return isRtl
      ? `تقدر تتصفح المنتجات من هنا:

[المنتجات](/products)
[منتجات التجار](/merchant-products)`
      : `You can browse products here:

[Products](/products)
[Merchant Products](/merchant-products)`;
  }

  const asksMerchant =
    normalized.includes('انضم كتاجر') ||
    normalized.includes('تاجر') ||
    normalized.includes('merchant') ||
    normalized.includes('seller');

  if (asksMerchant && wordCount <= 8) {
    return isRtl
      ? `للانضمام كتاجر في Salla Shop، استخدم الرابط التالي:

[انضم كتاجر](/become-merchant)`
      : `To become a merchant on Salla Shop, use this link:

[Become Merchant](/become-merchant)`;
  }

  const asksSt =
    normalized === 'st' ||
    normalized.includes('عملة st') ||
    normalized.includes('اشرحلي عملة st') ||
    normalized.includes('st token');

  if (asksSt && wordCount <= 8) {
    return isRtl
      ? `ST هي عملة منفعة ومكافآت داخل Salla Shop، تستخدم في الخصومات وبطاقات الهدايا وبعض مزايا المول. قيمتها قد تتغير حسب السيولة في Pi Dex، وليست وعدا ربحيا أو نصيحة استثمارية.

[نظام عملة ST](/st-token-info)`
      : `ST is a utility and rewards token inside Salla Shop. It can be used for discounts, gift cards, and some mall features. Its value can vary based on Pi Dex liquidity, and it is not a profit promise or investment advice.

[ST Token System](/st-token-info)`;
  }

  return '';
};

const ChatIcon = memo(function ChatIcon({
  role,
}: {
  role: 'user' | 'assistant';
}) {
  const isAssistant = role === 'assistant';

  return (
    <div
      className={cn(
        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[1rem] shadow-inner',
        isAssistant ? 'bg-primary/10' : 'bg-secondary/20'
      )}
    >
      {isAssistant ? (
        <Bot className="h-4 w-4 text-primary" strokeWidth={2.5} />
      ) : (
        <User className="h-4 w-4 text-secondary-foreground" strokeWidth={2.5} />
      )}
    </div>
  );
});

const ChatMessage = memo(function ChatMessage({
  message,
  onLinkClick,
  onAction,
  rating,
}: {
  message: Message;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  onAction: (action: ChatAction) => void;
  rating?: 'good' | 'bad';
}) {
  const isUser = message.role === 'user';
  const assistantContent = useMemo(() => linkifyChatContent(message.content), [message.content]);

  return (
    <div className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && <ChatIcon role="assistant" />}

      <div className={isUser ? USER_BUBBLE_CLASS : ASSISTANT_BUBBLE_CLASS}>
        {isUser ? (
          <p className="font-semibold leading-relaxed">{message.content}</p>
        ) : (
          <div>
            <div className="prose prose-sm max-w-none whitespace-pre-wrap font-medium dark:prose-invert [&_a]:font-black [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_li]:my-0 [&_p]:m-0 [&_ul]:my-1">
              <ReactMarkdown
                components={{
                  a: ({ href, children }) => {
                    const normalizedHref = normalizeChatHref(String(href || ''));
                    const isInternal = isInternalChatHref(normalizedHref);

                    return (
                      <a
                        href={normalizedHref || '#'}
                        target={isInternal ? undefined : '_blank'}
                        rel={isInternal ? undefined : 'noopener noreferrer'}
                        onClick={(event) => onLinkClick(event, normalizedHref)}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {assistantContent}
              </ReactMarkdown>
            </div>

            {!!message.actions?.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {message.actions.map((action, actionIndex) => (
                  <button
                    key={`${action.type}-${actionIndex}`}
                    type="button"
                    onClick={() => onAction(action)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-black text-primary transition-all hover:bg-primary hover:text-primary-foreground"
                  >
                    {action.type === 'add_to_cart' && <ShoppingCart className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}

            {!isUser && message.content.trim().length > 0 && (
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!!rating}
                  onClick={() => onAction({ type: 'feedback_good', label: 'good', payload: { href: message.content } })}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-xl transition-all',
                    rating === 'good'
                      ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-300'
                  )}
                  title="Helpful"
                >
                  {rating === 'good' ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.7} /> : <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2.7} />}
                </button>
                <button
                  type="button"
                  disabled={!!rating}
                  onClick={() => onAction({ type: 'feedback_bad', label: 'bad', payload: { href: message.content } })}
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-xl transition-all',
                    rating === 'bad'
                      ? 'bg-red-100 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300'
                      : 'bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/20 dark:text-red-300'
                  )}
                  title="Not accurate"
                >
                  {rating === 'bad' ? <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.7} /> : <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2.7} />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isUser && <ChatIcon role="user" />}
    </div>
  );
});

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <ChatIcon role="assistant" />

      <div className="rounded-2xl rounded-bl-sm border-0 bg-card px-4 py-3 shadow-sm dark:shadow-none">
        <Loader2 className="h-4 w-4 animate-spin text-primary" strokeWidth={2.5} />
      </div>
    </div>
  );
});

const LoginRequired = memo(function LoginRequired({
  isRtl,
  onLogin,
  loginLoading,
}: {
  isRtl: boolean;
  onLogin: () => void;
  loginLoading: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background/50 p-6 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-primary/10 shadow-inner">
        <User className="h-10 w-10 text-primary" strokeWidth={2} />
      </div>

      <h3 className="mb-2 text-lg font-black text-foreground">
        {isRtl ? 'تسجيل الدخول مطلوب' : 'Login Required'}
      </h3>

      <p className="mb-8 text-sm font-semibold leading-relaxed text-muted-foreground">
        {isRtl
          ? 'يجب تسجيل الدخول عبر حساب Pi الخاص بك لاستخدام المساعد الذكي.'
          : 'You must be logged in with your Pi account to use the AI assistant.'}
      </p>

      <Button
        onClick={onLogin}
        disabled={loginLoading}
        className="h-12 w-full rounded-2xl border-0 text-base font-black shadow-md transition-all hover:shadow-lg"
      >
        {loginLoading ? (
          <Loader2 className={cn('h-5 w-5 animate-spin', isRtl ? 'ml-2' : 'mr-2')} />
        ) : (
          <LogIn className={cn('h-5 w-5', isRtl ? 'ml-2' : 'mr-2')} />
        )}

        {isRtl ? 'تسجيل الدخول الان' : 'Login Now'}
      </Button>
    </div>
  );
});

const EmptyChat = memo(function EmptyChat({
  isRtl,
  userName,
  suggestions,
  onPickSuggestion,
}: {
  isRtl: boolean;
  userName: string;
  suggestions: string[];
  onPickSuggestion: (suggestion: string) => void;
}) {
  const displayName = userName || (isRtl ? 'صديقي' : 'there');

  return (
    <div className="mt-4 flex h-full flex-col items-center justify-center gap-4 px-2 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 shadow-inner">
        <Bot className="h-8 w-8 text-primary" strokeWidth={2.5} />
      </div>

      <p className="text-sm font-black text-foreground">
        {isRtl
          ? `مرحبا بك يا ${displayName}! كيف اقدر اساعدك؟`
          : `Hello ${displayName}! How can I help you?`}
      </p>

      <div className="mt-2 w-full space-y-2.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPickSuggestion(suggestion)}
            className="w-full rounded-2xl border-0 bg-muted/40 px-4 py-3 text-start text-xs font-semibold text-muted-foreground shadow-sm transition-all hover:bg-primary/5 hover:text-primary hover:shadow-md dark:shadow-none"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
});

const ChatHeader = memo(function ChatHeader({
  isRtl,
  onClose,
  onClearChat,
  hasMessages,
  isLoading,
}: {
  isRtl: boolean;
  onClose: () => void;
  onClearChat: () => void;
  hasMessages: boolean;
  isLoading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-primary via-primary/90 to-primary/80 px-4 py-4 sm:px-5">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.1rem] bg-white/20 shadow-inner">
        <MessageCircle className="h-5 w-5 text-white" strokeWidth={2.5} />
        <span className="absolute -bottom-1 -end-1 rounded-md bg-white px-1 text-[8px] font-black leading-4 text-primary shadow-sm">
          AI
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-black text-white">
          {isRtl ? 'مساعد سلة الذكي' : 'Salla AI Assistant'}
        </h3>

        <p className="truncate text-[10px] font-semibold text-white/80">
          {isRtl ? 'اسألني عن أي منتج أو مساعدة' : 'Ask me about any product or help'}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClearChat}
        disabled={!hasMessages || isLoading}
        title={isRtl ? 'مسح الشات' : 'Clear chat'}
        aria-label={isRtl ? 'مسح الشات' : 'Clear chat'}
        className="h-8 w-8 shrink-0 rounded-full border-0 text-white/90 transition-colors hover:bg-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2.5} />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        title={isRtl ? 'إغلاق' : 'Close'}
        aria-label={isRtl ? 'إغلاق' : 'Close'}
        className="h-8 w-8 shrink-0 rounded-full border-0 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </Button>
    </div>
  );
});


const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000
) => {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timeoutId: number | undefined;

  const abortFromExternalSignal = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }
  }

  timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
};

const readStreamChunkWithTimeout = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  onTimeout: () => void
) => {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          onTimeout();
          reject(new Error('Chat stream timed out before receiving more data'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};


const analyzeUserTextWithAI = async ({
  text,
  messages,
  language,
  piRate,
  userName,
  userId,
}: {
  text: string;
  messages: Message[];
  language: string;
  piRate: number;
  userName: string;
  userId?: string;
}) => {
  try {
    const response = await fetchWithTimeout(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        mode: 'analyze',
        messages: [...messages.slice(-MAX_MESSAGES_CONTEXT), { role: 'user', content: text }],
        language,
        piRate,
        userName,
        userId,
      }),
    }, AI_ANALYSIS_TIMEOUT_MS);

    if (!response.ok) return getFallbackAnalysis();

    const data = await response.json();
    return (data?.analysis || getFallbackAnalysis()) as AiIntentAnalysis;
  } catch (error) {
    console.warn('AI analyzer request failed:', error);
    return getFallbackAnalysis();
  }
};

const getAnalysisProductQuery = (analysis: AiIntentAnalysis, fallback: string) => {
  const query = String(analysis.product_query || '').trim();
  return query || fallback;
};

const getFriendlyConnectionError = (isRtl: boolean) => {
  return isRtl
    ? 'عذرا، حدث خطأ أثناء الاتصال. يرجى المحاولة مرة أخرى.'
    : 'Sorry, a connection error occurred. Please try again.';
};

function AiChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => getStoredChatMessages());
  const [ratedMessages, setRatedMessages] = useState<Record<string, 'good' | 'bad'>>({});
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const lastRequestKeyRef = useRef<string>('');
  const lastStreamRenderRef = useRef(0);

  const { language } = useLanguage();
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const { calculatePrice } = usePriceCalculator();
  const { addToCart, itemCount, items: cartItems, total: cartTotal } = useCart();

  const isRtl = language === 'ar';
  const userName = user?.username || '';

  const piRate = useMemo(() => {
    return getPiRateForChat(calculatePrice);
  }, [calculatePrice]);

  const suggestions = useMemo(() => {
    return isRtl
      ? [
          'هل توجد كوبونات خصم فعالة حاليا؟',
          'رشح لي موبايل رخيص ومتوفر',
          'افتح السلة',
          'تتبع طلباتي',
        ]
      : [
          'Are there any active coupon codes?',
          'Recommend a cheap available phone',
          'Open my cart',
          'Track my orders',
        ];
  }, [isRtl]);

  const panelPositionClass = isRtl ? 'left-4 sm:left-6' : 'right-4 sm:right-6';

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const scrollNow = () => {
      const latestTop = scrollElement.scrollHeight;
      scrollElement.scrollTo({
        top: latestTop,
        behavior,
      });
    };

    requestAnimationFrame(() => {
      scrollNow();

      window.setTimeout(scrollNow, 80);
      window.setTimeout(scrollNow, 220);
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    setStoredChatMessages(messages);
  }, [messages]);

  useEffect(() => {
    const handleOpenChat = () => setIsOpen(true);

    window.addEventListener('open-ai-chat', handleOpenChat);

    return () => window.removeEventListener('open-ai-chat', handleOpenChat);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;

    scrollToLatestMessage('smooth');
  }, [isOpen, user, messages, isLoading, scrollToLatestMessage]);

  useEffect(() => {
    if (!isOpen || !user) return;

    const handleReturnToChat = () => {
      if (document.visibilityState === 'visible') {
        scrollToLatestMessage('smooth');
      }
    };

    const handlePageShow = () => {
      scrollToLatestMessage('smooth');
    };

    window.addEventListener('focus', handleReturnToChat);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleReturnToChat);

    return () => {
      window.removeEventListener('focus', handleReturnToChat);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleReturnToChat);
    };
  }, [isOpen, user, scrollToLatestMessage]);

  useEffect(() => {
    if (isOpen && inputRef.current && user && !isLoading) {
      inputRef.current.focus();
    }
  }, [isLoading, isOpen, user]);

  useEffect(() => {
    if (isOpen) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    lastRequestKeyRef.current = '';
    setIsLoading(false);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleClearChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    lastRequestKeyRef.current = '';
    lastStreamRenderRef.current = 0;
    messagesRef.current = [];
    clearStoredChatMessages();
    setMessages([]);
    setInput('');
    setIsLoading(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleLogin = useCallback(async () => {
    if (loginLoading) return;

    setLoginLoading(true);

    try {
      await login();
    } catch (error) {
      console.error('Login failed:', error);
    } finally {
      setLoginLoading(false);
    }
  }, [login, loginLoading]);

  const handlePickSuggestion = useCallback((suggestion: string) => {
    setInput(suggestion);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleLinkClick = useCallback(
    async (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      const normalizedHref = normalizeChatHref(href);

      if (!normalizedHref) return;

      if (normalizedHref.startsWith('#')) {
        event.preventDefault();
        return;
      }

      if (normalizedHref.startsWith('/')) {
        event.preventDefault();

        const resolvedHref = await resolveInternalFilterHref(normalizedHref);

        navigate(resolvedHref);
        setIsOpen(false);
      }
    },
    [navigate]
  );

  const pushLocalAssistantReply = useCallback((userMsg: Message, assistantContent: string, actions?: ChatAction[]) => {
    setMessages((previous) => {
      const last = previous[previous.length - 1];
      const shouldAppendUser = !(last?.role === 'user' && last.content === userMsg.content);

      return [
        ...previous,
        ...(shouldAppendUser ? [userMsg] : []),
        {
          role: 'assistant',
          content: assistantContent,
          actions,
        },
      ];
    });
  }, []);

  const upsertStreamingAssistantMessage = useCallback((content: string, force = false) => {
    const cleanedContent = removeThinkBlocks(content);
    const now = Date.now();

    if (!cleanedContent && !force) return;
    if (!force && now - lastStreamRenderRef.current < STREAM_RENDER_THROTTLE_MS) return;

    lastStreamRenderRef.current = now;

    setMessages((previous) => {
      const last = previous[previous.length - 1];

      if (last?.role === 'assistant') {
        return previous.map((message, index) =>
          index === previous.length - 1 ? { ...message, content: cleanedContent } : message
        );
      }

      return [...previous, { role: 'assistant', content: cleanedContent }];
    });
  }, []);


  const normalizeProductMatchText = useCallback((value: string) => {
    return normalizeText(value)
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const extractCartTargetText = useCallback((textValue: string) => {
    const normalizedValue = normalizeProductMatchText(textValue);
    const cleaned = normalizedValue
      .replace(/\b(اضف|أضف|ضيف|ضف|حط|زود|add|put)\b/g, ' ')
      .replace(/\b(الي|إلى|الى|في|على|علي|داخل|السله|السلة|سله|cart|basket)\b/g, ' ')
      .replace(/\b(المنتج|منتج|اول|الأول|الاول|ثاني|الثاني|تاني|التاني|رقم|واحد|اتنين|اثنين|1|2|3)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }, [normalizeProductMatchText]);

  const scoreProductForCartTarget = useCallback((product: ChatProductRecord, targetText: string) => {
    const target = normalizeProductMatchText(targetText);
    if (!target) return 0;

    const productText = normalizeProductMatchText([
      product.name,
      product.name_ar,
      product.description,
      product.description_ar,
      product.category,
      product.category_ar,
      product.category_name,
      product.category_name_ar,
      Array.isArray(product.tags) ? product.tags.join(' ') : '',
    ].filter(Boolean).join(' '));

    const nameText = normalizeProductMatchText(`${product.name || ''} ${product.name_ar || ''}`);
    const targetWords = target.split(' ').filter((word) => word.length >= 2 && !CART_TARGET_STOP_WORDS.has(word));
    if (!targetWords.length) return 0;

    let score = 0;
    if (nameText.includes(target)) score += 120;
    if (productText.includes(target)) score += 70;

    targetWords.forEach((word) => {
      if (nameText.includes(word)) score += 35;
      else if (productText.includes(word)) score += 18;
    });

    if (product.in_stock === true && Number(product.stock_quantity || 0) > 0) score += 20;
    return score;
  }, [normalizeProductMatchText]);

  const findBestProductForCartCommand = useCallback(async (textValue: string, analysis?: AiIntentAnalysis) => {
    const lastProducts = loadLastChatProducts().filter((product) => product.in_stock === true && Number(product.stock_quantity || 0) > 0);
    const requestedIndex = typeof analysis?.target_index === 'number' ? analysis.target_index : getRequestedProductIndex(textValue);
    const targetText = String(analysis?.product_query || '').trim() || extractCartTargetText(textValue);

    if (requestedIndex !== null && requestedIndex >= 0 && lastProducts[requestedIndex]) {
      return { product: lastProducts[requestedIndex], status: 'matched_index' as const };
    }

    if (targetText) {
      const rankedLast = lastProducts
        .map((product) => ({ product, score: scoreProductForCartTarget(product, targetText) }))
        .filter((item) => item.score >= 55)
        .sort((a, b) => b.score - a.score);

      if (rankedLast.length === 1 || (rankedLast[0] && rankedLast[0].score >= (rankedLast[1]?.score || 0) + 25)) {
        return { product: rankedLast[0].product, status: 'matched_memory' as const };
      }

      // لا نبحث من الواجهة عند أوامر الإضافة للسلة.
      // الإضافة تعتمد فقط على آخر منتجات حقيقية أرجعها الباك إند وتم حفظها من روابط الرد.
    }

    if (!targetText && lastProducts.length === 1) {
      return { product: lastProducts[0], status: 'matched_single_memory' as const };
    }

    return { product: null, status: targetText ? 'not_found' as const : 'needs_product' as const, options: lastProducts.slice(0, 3) };
  }, [extractCartTargetText, scoreProductForCartTarget]);

  const handleChatAction = useCallback(async (action: ChatAction) => {
    if (action.type === 'feedback_good' || action.type === 'feedback_bad') {
      const value = action.type === 'feedback_good' ? 'good' : 'bad';
      const answer = String(action.payload?.href || '');
      saveChatFeedbackLocally({ value, answer, language });
      setRatedMessages((previous) => ({ ...previous, [answer]: value }));
      toast.success(
        value === 'good'
          ? (isRtl ? 'تم تسجيل تقييمك الإيجابي' : 'Positive feedback saved')
          : (isRtl ? 'تم تسجيل ملاحظتك لتحسين الردود' : 'Feedback saved for improvement')
      );
      return;
    }

    if (action.type === 'show_coupons') {
      const coupons = await fetchActiveCouponsForChat(isRtl);
      setMessages((previous) => [...previous, { role: 'assistant', content: formatCouponsReply(coupons, isRtl) }]);
      return;
    }

    if (action.type === 'track_orders') {
      const reply = await fetchRecentOrdersForChat(user?.id || '', isRtl);
      setMessages((previous) => [...previous, { role: 'assistant', content: reply }]);
      return;
    }

    if (action.type === 'compare_products') {
      const reply = formatProductComparisonReply(loadLastChatProducts(), isRtl, calculatePrice);
      setMessages((previous) => [...previous, { role: 'assistant', content: reply }]);
      return;
    }

    if (action.type === 'show_cart') {
      navigate('/cart');
      setIsOpen(false);
      return;
    }

    if (action.type === 'open_product') {
      const href = action.payload?.href;
      if (href) {
        navigate(href);
        setIsOpen(false);
      }
      return;
    }

    if (action.type === 'add_to_cart') {
      const lastProducts = loadLastChatProducts();
      const product = lastProducts.find((item) => {
        return item.id === action.payload?.productId && item.source === action.payload?.source;
      });

      if (!product) {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: isRtl
              ? 'لم أعد أجد بيانات هذا المنتج في ذاكرة الشات. افتح المنتج أو ابحث عنه مرة أخرى ثم أضفه للسلة.'
              : 'I no longer have this product in chat memory. Open it or search again, then add it to cart.',
          },
        ]);
        return;
      }

      addToCart(buildCartProductFromChatProduct({
        product,
        quantity: action.payload?.quantity || 1,
        calculatePrice,
      }));

      const productName = getChatProductDisplayName(product, isRtl);
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: isRtl
            ? `تم إرسال **${productName}** إلى السلة ✅

لديك الآن ${itemCount + 1} منتج/كمية تقريبًا في السلة.`
            : `**${productName}** was sent to your cart ✅

You now have about ${itemCount + 1} item(s) in your cart.`,
          actions: [
            {
              type: 'show_cart',
              label: isRtl ? 'فتح السلة' : 'Open cart',
              payload: { href: '/cart' },
            },
          ],
        },
      ]);
    }
  }, [addToCart, calculatePrice, isRtl, itemCount, navigate, language, user?.id]);


  const hydrateProductsFromAssistantReply = useCallback(async (reply: string) => {
    const productMatches = Array.from(reply.matchAll(/\]\((\/product\/([^\)\s#?]+))/g));
    const merchantMatches = Array.from(reply.matchAll(/\]\((\/merchant-product\/([^\)\s#?]+))/g));

    const adminIds = Array.from(new Set(productMatches.map((match) => decodeURIComponent(match[2] || '').trim()).filter(Boolean))).slice(0, MAX_CHAT_PRODUCT_RESULTS);
    const merchantIds = Array.from(new Set(merchantMatches.map((match) => decodeURIComponent(match[2] || '').trim()).filter(Boolean))).slice(0, MAX_CHAT_PRODUCT_RESULTS);

    const [adminResult, merchantResult] = await Promise.all([
      adminIds.length
        ? supabase
            .from('products')
            .select('id, name, name_ar, description, description_ar, image, images, category, category_id, price, local_price_egp, shipping_type, tags, in_stock, stock_quantity, is_featured, is_on_sale')
            .in('id', adminIds)
        : Promise.resolve({ data: [], error: null } as any),
      merchantIds.length
        ? supabase
            .from('merchant_products')
            .select('id, name, name_ar, description, description_ar, local_price_egp, original_price, category, category_id, shipping_type, images, tags, in_stock, stock_quantity, is_featured, is_on_sale, merchant_id')
            .in('id', merchantIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (adminResult.error) console.warn('Chat exact product hydration failed:', adminResult.error.message);
    if (merchantResult.error) console.warn('Chat exact merchant product hydration failed:', merchantResult.error.message);

    const adminProducts = ((adminResult.data || []) as any[]).map(mapAdminChatProduct);
    const merchantProducts = ((merchantResult.data || []) as any[]).map(mapMerchantChatProduct);
    const productsByKey = new Map<string, ChatProductRecord>();

    adminProducts.forEach((product) => productsByKey.set(`admin:${product.id}`, product));
    merchantProducts.forEach((product) => productsByKey.set(`merchant:${product.id}`, product));

    const orderedProducts: ChatProductRecord[] = [];
    productMatches.forEach((match) => {
      const id = decodeURIComponent(match[2] || '').trim();
      const product = productsByKey.get(`admin:${id}`);
      if (product) orderedProducts.push(product);
    });
    merchantMatches.forEach((match) => {
      const id = decodeURIComponent(match[2] || '').trim();
      const product = productsByKey.get(`merchant:${id}`);
      if (product) orderedProducts.push(product);
    });

    const uniqueProducts = orderedProducts.filter((product, index, arr) => {
      return arr.findIndex((item) => item.id === product.id && item.source === product.source) === index;
    }).slice(0, MAX_CHAT_PRODUCT_RESULTS);

    if (uniqueProducts.length > 0) {
      persistLastChatProducts(uniqueProducts);
    }

    return uniqueProducts;
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();

    if (!text || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    const cleanUserName = removeArabicDiacritics(userName);
    const cacheKey = buildCacheKey({ text, language, piRate, userId: user?.id });

    setInput('');
    setMessages((previous) => [...previous, userMsg]);

    if (isShowCartRequest(text)) {
      setInput('');
      pushLocalAssistantReply(
        userMsg,
        formatCartSummaryReply({ items: cartItems, total: cartTotal, itemCount, isRtl }),
        [{ type: 'show_cart', label: isRtl ? 'فتح السلة' : 'Open cart', payload: { href: '/cart' } }]
      );
      return;
    }

    setIsLoading(true);

    if (isAddToCartRequest(text)) {
      setIsLoading(false);
      const matchResult = await findBestProductForCartCommand(text);
      const product = matchResult.product;

      if (product) {
        addToCart(buildCartProductFromChatProduct({ product, quantity: 1, calculatePrice }));
        const productName = getChatProductDisplayName(product, isRtl);
        pushLocalAssistantReply(
          userMsg,
          isRtl ? `تم إضافة **${productName}** للسلة ✅` : `**${productName}** has been added to your cart ✅`,
          [{ type: 'show_cart', label: isRtl ? 'فتح السلة' : 'Open cart', payload: { href: '/cart' } }]
        );
        return;
      }

      if (matchResult.status === 'ambiguous' && matchResult.options?.length) {
        const lines = matchResult.options.map((option, index) => `${index + 1}. ${getChatProductDisplayName(option, isRtl)}`).join('\n');
        persistLastChatProducts(matchResult.options);
        pushLocalAssistantReply(
          userMsg,
          isRtl ? `وجدت أكثر من منتج قريب من طلبك. اختر الرقم الذي تريد إضافته:\n\n${lines}` : `I found more than one close product. Tell me which number to add:\n\n${lines}`,
          buildProductActions(matchResult.options, isRtl)
        );
        return;
      }

      pushLocalAssistantReply(
        userMsg,
        isRtl
          ? 'لم أجد منتجًا واضحًا من آخر نتائج البحث لإضافته للسلة. ابحث عن المنتج أولًا ثم اضغط زر الإضافة أو اكتب: أضف الأول للسلة.'
          : 'I could not find a clear product from the latest search results to add. Search first, then tap add or say: add the first to cart.'
      );
      return;
    }

    // مهم: الواجهة لا تقوم بتحليل أو بحث منتجات.
    // كل أسئلة المنتجات والكوبونات والطلبات والسياسات تذهب إلى دالة Supabase.
    // الواجهة فقط تعرض الرد وتنفذ أزرار السلة/التنقل بناءً على روابط منتجات حقيقية راجعة من الباك إند.

    // مهم: لا نرد على product_search من الواجهة.
    // البحث المحلي في الواجهة كان يسبب نتائج غير مطابقة مثل: Smart TV -> سكر/كرة/منظف شاشة.
    // دالة Supabase store-chat هي المصدر الوحيد الآن لبحث المنتجات لأنها تستخدم المعجم والفلاتر الخلفية.

    // لا نستخدم كاش للردود القادمة من الباك إند.
    // أسعار المنتجات والمخزون تتغير، وأي كاش هنا قد يعرض سعرًا قديمًا أو خامًا مثل 7500 Pi.
    if (lastRequestKeyRef.current === cacheKey) {
      setIsLoading(false);
      return;
    }

    lastRequestKeyRef.current = cacheKey;

    const nextMessages = [...messagesRef.current, userMsg].slice(-MAX_MESSAGES_CONTEXT);

    setIsLoading(true);

    let assistantSoFar = '';

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    lastStreamRenderRef.current = 0;

    try {
      const response = await fetchWithTimeout(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          messages: nextMessages,
          language,
          piRate,
          userName: cleanUserName,
          userId: user?.id,
          linkGuidelines: CHAT_LINK_GUIDELINES,
        }),
      }, CHAT_REQUEST_TIMEOUT_MS);

      if (!response.ok || !response.body) {
        let errorPreview = '';
        try {
          errorPreview = await response.text();
        } catch {
          errorPreview = '';
        }
        console.warn('store-chat stream failed:', { status: response.status, body: errorPreview.slice(0, 500) });
        throw new Error(`Failed to start stream: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await readStreamChunkWithTimeout(
          reader,
          STREAM_READ_TIMEOUT_MS,
          () => abortControllerRef.current?.abort()
        );

        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;

        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();

          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const content = parseStreamContent(jsonStr);

            if (!content) continue;

            assistantSoFar = removeThinkBlocks(`${assistantSoFar}${content}`);
            upsertStreamingAssistantMessage(assistantSoFar);
          } catch {
            textBuffer = `${line}\n${textBuffer}`;
            break;
          }
        }
      }

      const finalReply = removeThinkBlocks(assistantSoFar).trim();

      if (finalReply) {
        upsertStreamingAssistantMessage(finalReply, true);
        // لا نخزن ردود المنتجات/الأسعار في sessionStorage حتى لا تظهر أسعار قديمة بعد تحديث الدالة.

        const hydratedProducts = await hydrateProductsFromAssistantReply(finalReply);
        if (hydratedProducts.length > 0) {
          const actions = buildProductActions(hydratedProducts, isRtl);
          setMessages((previous) => {
            const lastIndex = previous.length - 1;
            if (lastIndex < 0 || previous[lastIndex]?.role !== 'assistant') return previous;
            return previous.map((message, index) =>
              index === lastIndex ? { ...message, actions } : message
            );
          });
        }
      } else {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: getFallbackErrorMessage(isRtl),
          },
        ]);
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Chat error:', error);

        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: getFallbackErrorMessage(isRtl),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      lastRequestKeyRef.current = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [
    input,
    isLoading,
    isRtl,
    language,
    piRate,
    addToCart,
    calculatePrice,
    pushLocalAssistantReply,
    upsertStreamingAssistantMessage,
    user?.id,
    userName,
    cartItems,
    cartTotal,
    itemCount,
    findBestProductForCartCommand,
    hydrateProductsFromAssistantReply,
  ]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(CHAT_PANEL_CLASS, panelPositionClass, 'bottom-20 sm:bottom-24')}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <ChatHeader
        isRtl={isRtl}
        onClose={closeChat}
        onClearChat={handleClearChat}
        hasMessages={messages.length > 0}
        isLoading={isLoading}
      />

      {!user ? (
        <LoginRequired isRtl={isRtl} onLogin={handleLogin} loginLoading={loginLoading} />
      ) : (
        <>
          <div
            ref={scrollRef}
            className="scrollbar-hide flex-1 space-y-4 overflow-y-auto scroll-smooth overscroll-contain bg-background/50 p-4"
          >
            {messages.length === 0 && (
              <EmptyChat
                isRtl={isRtl}
                userName={removeArabicDiacritics(userName)}
                suggestions={suggestions}
                onPickSuggestion={handlePickSuggestion}
              />
            )}

            {messages.map((message, index) => (
              <ChatMessage
                key={`${message.role}-${index}`}
                message={message}
                onLinkClick={handleLinkClick}
                onAction={handleChatAction}
                rating={message.role === 'assistant' ? ratedMessages[message.content] : undefined}
              />
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && <TypingIndicator />}
          </div>

          <div className="bg-background/95 p-3 shadow-[0_-12px_30px_-24px_rgba(0,0,0,0.35)] sm:p-4 dark:bg-background/95">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
              className="flex gap-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={isRtl ? 'اكتب رسالتك...' : 'Type your message...'}
                className="h-12 flex-1 rounded-2xl border-0 bg-muted/30 px-4 text-sm font-semibold text-foreground shadow-inner transition-all placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 dark:bg-muted/20"
                disabled={isLoading}
              />

              <Button
                type="submit"
                size="icon"
                disabled={isLoading || !input.trim()}
                className="h-12 w-12 rounded-2xl border-0 bg-primary text-white shadow-md shadow-primary/20 transition-transform hover:bg-primary/90 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Send className={cn('h-5 w-5', isRtl && 'rotate-180')} strokeWidth={2.5} />
                )}
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(AiChatBot);