import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import PaymentWaitingModal from './PaymentWaitingModal';
import type { PaymentModalStatus } from './PaymentWaitingModal';
import StarIcon from './StarIcon';
import {
  Star,
  Copy,
  Check,
  Loader2,
  Phone,
  UserCheck,
  AlertCircle,
  Clock,
  Zap,
  Info,
  Clipboard,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// استيرادات TON Connect
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { Address, beginCell, toNano } from '@ton/core';

import vodafoneCashImg from '@/assets/vodafone-cash.png';
import orangeCashImg from '@/assets/orange-cash.png';
import etisalatCashImg from '@/assets/etisalat-cash.png';
import usdtImg from '@/assets/usdt.png';
import piImg from '@/assets/pi-network.jpeg';
import sallaTokenImg from '@/assets/salla-token.png';
import instapayImg from '@/assets/insta.png';

type PaymentMethod = 'vf_cash' | 'or_cash' | 'et_cash' | 'usdt' | 'solana' | 'ton' | 'pi' | 'st' | 'instapay';
type Currency = 'egp' | 'usd' | 'pi' | 'st';

interface TonPaymentData {
  to: string;
  amount_usdt: number;
  amount_units: string;
  jetton_master: string;
  comment: string;
}

interface PurchaseFormProps {
  onOrderSuccess: (quantity: number, username: string, orderId?: string) => void;
  onAvailableStarsChange?: (stars: number) => void;
}

const STAR_PRESETS = [50, 100, 250, 500, 1000, 5000];
const COOLDOWN_TIME = 130;
const OKX_UID = '376335861018725858';
const BINANCE_UID = '266940142';
const WALLET_NETWORK_PREFERENCE_KEY = 'usdt_wallet_network_preference_v1';

const PurchaseForm = ({ onOrderSuccess, onAvailableStarsChange }: PurchaseFormProps) => {
  const { t, lang } = useLanguage();

  const [username, setUsername] = useState('');
  const [debouncedUsername, setDebouncedUsername] = useState('');
  const [quantity, setQuantity] = useState(50);
  const [customQty, setCustomQty] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('vf_cash');
  const [paymentTab, setPaymentTab] = useState<'local' | 'global'>('local');
  const [currency, setCurrency] = useState<Currency>('egp');
  const [fulfillmentProvider, setFulfillmentProvider] = useState<'fragment' | 'istar'>('fragment');
  const [fragmentCurrency, setFragmentCurrency] = useState<'ton' | 'usdt_ton'>('ton');
  const [loading, setLoading] = useState(false);

  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [step1Attempted, setStep1Attempted] = useState(false);
  const [step2Attempted, setStep2Attempted] = useState(false);

  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [showUserGuide, setShowUserGuide] = useState(false);

  const [starPriceUsd, setStarPriceUsd] = useState(0.013);
  const [starPriceEgp, setStarPriceEgp] = useState(0.65);
  const [starPriceUsdBulk, setStarPriceUsdBulk] = useState(0.012);
  const [starPriceEgpBulk, setStarPriceEgpBulk] = useState(0.6);

  const [usdtWallet, setUsdtWallet] = useState('');
  const [usdtWalletTrc20, setUsdtWalletTrc20] = useState('');
  const [usdtWalletAptos, setUsdtWalletAptos] = useState('');
  const [usdtWalletSolana, setUsdtWalletSolana] = useState('');
  const [usdtWalletTon, setUsdtWalletTon] = useState('');
  const [instapayLink, setInstapayLink] = useState('');
  
  const [usdtNetwork, setUsdtNetwork] = useState<'bep20' | 'trc20' | 'aptos' | 'okx_internal' | 'binance_internal'>('bep20');
  const [enabledNetworks, setEnabledNetworks] = useState({ bep20: true, trc20: true, aptos: true, okx_internal: true, binance_internal: true });

  const [txHash, setTxHash] = useState('');
  const [instapayRef, setInstapayRef] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [backendSolanaLink, setBackendSolanaLink] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [minStarsEnabled, setMinStarsEnabled] = useState(true);
  const [waitingModal, setWaitingModal] = useState(false);
  const [orderStatus, setOrderStatus] = useState<PaymentModalStatus>('waiting');
  const [modalError, setModalError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [telegramName, setTelegramName] = useState<string | null>(null);
  const [telegramPhoto, setTelegramPhoto] = useState<string | null>(null);
  const [verifyingUser, setVerifyingUser] = useState(false);
  const [userVerifyError, setUserVerifyError] = useState<string | null>(null);
  
  const [enabledPayments, setEnabledPayments] = useState({
    vf_cash: true,
    or_cash: true,
    et_cash: true,
    usdt: true,
    solana: false,
    ton: false,
    pi: false,
    st: false,
    instapay: false,
  });
  
  const [piPrice, setPiPrice] = useState<number | null>(null);
  const [stRate, setStRate] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [maxAvailable, setMaxAvailable] = useState<number | null>(null);
  const [globalMaxStars, setGlobalMaxStars] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  const [blockedPresets, setBlockedPresets] = useState<Record<number, boolean>>({});
  const [cryptoFraction, setCryptoFraction] = useState(0);

  const channelRef = useRef<any>(null);
  const pokeIntervalRef = useRef<any>(null);
  const isCompletingRef = useRef(false);
  const completedOrderRef = useRef<string | null>(null);
  const usernameVerifyCacheRef = useRef<Record<string, { name: string | null; photo: string | null; error: string | null; timestamp: number }>>({});
  const tonUsdPriceCacheRef = useRef<{ price: number; timestamp: number } | null>(null);

  // --- TON Connect Hooks ---
  const [tonConnectUI] = useTonConnectUI();
  const tonAddress = useTonAddress();
  const [tonPayment, setTonPayment] = useState<TonPaymentData | null>(null);
  const [tonTxSending, setTonTxSending] = useState(false);

  // --- دالة اللصق المشتركة ---
  const handlePaste = async (setter: (val: string) => void) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setter(text);
        toast.success(lang === 'ar' ? 'تم اللصق' : 'Pasted successfully');
      }
    } catch (err) {
      toast.error(lang === 'ar' ? 'يرجى السماح بصلاحية اللصق للمتصفح' : 'Please allow clipboard access');
    }
  };

  useEffect(() => {
    const lastAttempt = localStorage.getItem('last_stars_purchase_time');
    if (lastAttempt) {
      const secondsPassed = Math.floor((Date.now() - parseInt(lastAttempt, 10)) / 1000);
      if (secondsPassed < COOLDOWN_TIME) {
        setCooldownSeconds(COOLDOWN_TIME - secondsPassed);
      }
    }
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const timer = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const startCooldown = useCallback(() => {
    const now = Date.now();
    localStorage.setItem('last_stars_purchase_time', now.toString());
    setCooldownSeconds(COOLDOWN_TIME);
  }, []);

  const formatCooldownTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setUserId(session?.user?.id || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUserId(session?.user?.id || null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const minQty = minStarsEnabled ? 50 : 1;

  useEffect(() => {
    let mounted = true;

    const fetchSettings = async () => {
      try {
        const { data } = await supabase.from('settings').select('*').limit(1).single();

        if (!mounted) return;

        if (data) {
          const nextFulfillmentProvider = ((data as any).fulfillment_provider === 'istar' ? 'istar' : 'fragment') as 'fragment' | 'istar';
          const nextFragmentCurrency = ((data as any).fragment_currency === 'usdt_ton' ? 'usdt_ton' : 'ton') as 'ton' | 'usdt_ton';
          const isFragmentUsdtTon = nextFulfillmentProvider === 'fragment' && nextFragmentCurrency === 'usdt_ton';

          setFulfillmentProvider(nextFulfillmentProvider);
          setFragmentCurrency(nextFragmentCurrency);

          // ✅ عند تفعيل Fragment بالدولار، استخدم أسعار Fragment USD إن وجدت.
          // لو الحقول الجديدة غير موجودة سيظل المسار القديم يعمل بنفس أسعار star_price_usd الحالية.
          setStarPriceUsd(Number(isFragmentUsdtTon ? ((data as any).fragment_star_price_usd ?? data.star_price_usd ?? 0.013) : (data.star_price_usd ?? 0.013)));
          setStarPriceEgp(Number(data.star_price_egp ?? 0.65));
          setStarPriceUsdBulk(Number((data as any).star_price_usd_bulk ?? 0.012));
          setStarPriceEgpBulk(Number((data as any).star_price_egp_bulk ?? 0.6));

          setUsdtWallet((data as any).usdt_wallet_address || '');
          setUsdtWalletTrc20((data as any).usdt_wallet_address_trc20 || '');
          setUsdtWalletAptos((data as any).usdt_wallet_address_aptos || '');
          setUsdtWalletSolana((data as any).usdt_wallet_address_solana || '');
          setUsdtWalletTon((data as any).usdt_wallet_address_ton || '');
          setInstapayLink((data as any).instapay_link || 'https://ipn.eg/S/sallaweb3/instapay/36kZ1k');
          
          setEnabledNetworks({
            bep20: (data as any).pay_usdt_bep20_enabled ?? true,
            trc20: (data as any).pay_usdt_trc20_enabled ?? true,
            aptos: (data as any).pay_usdt_aptos_enabled ?? true,
            okx_internal: true,
            binance_internal: true,
          });

          setMinStarsEnabled((data as any).min_stars_enabled ?? true);
          setEnabledPayments({
            vf_cash: (data as any).pay_vf_cash_enabled ?? true,
            or_cash: (data as any).pay_or_cash_enabled ?? true,
            et_cash: (data as any).pay_et_cash_enabled ?? true,
            usdt: (data as any).pay_usdt_enabled ?? true,
            solana: (data as any).pay_solana_usdt_enabled ?? false,
            ton: (data as any).pay_ton_usdt_enabled ?? false,
            pi: (data as any).pay_pi_enabled ?? false,
            st: (data as any).pay_st_enabled ?? false,
            instapay: (data as any).pay_instapay_enabled ?? false,
          });
        }
      } catch {
      } finally {
        if (mounted) setIsPriceLoading(false);
      }
    };

    fetchSettings();

    const fetchPiPrice = async () => {
      try {
        const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=PI-USDT');
        const data = await res.json();
        if (data?.data?.[0]?.last && mounted) setPiPrice(parseFloat(data.data[0].last));
      } catch {
      }
    };

    const fetchStRate = async () => {
      try {
        const { data } = await supabase.functions.invoke('st-rate');
        if (data?.success && data?.rate && mounted) setStRate(Number(data.rate));
      } catch {
      }
    };

    fetchPiPrice();
    fetchStRate();

    const piInterval = setInterval(fetchPiPrice, 30000);
    const stInterval = setInterval(fetchStRate, 60000);

    return () => {
      mounted = false;
      clearInterval(piInterval);
      clearInterval(stInterval);
    };
  }, []);

  const actualQty = useMemo(() => (customQty ? Math.max(0, parseInt(customQty, 10) || 0) : quantity), [customQty, quantity]);

  const getStarUnitPrice = useCallback((qty: number, basePrice: number) => {
    const safeBase = Number(basePrice) || 0;

    // خصم تدريجي بحد أقصى: من 1.10 إلى 1.05 عند 5000+.
    // يبدأ الخصم من 500 بثلث الخصم الكامل تقريبًا، ثم يزيد تدريجيًا حتى يصل للخصم الكامل.
    if (qty >= 5000) return safeBase * (1.05 / 1.10);
    if (qty >= 2500) return safeBase * (1.055 / 1.10);
    if (qty >= 2000) return safeBase * (1.06 / 1.10);
    if (qty >= 1500) return safeBase * (1.067 / 1.10);
    if (qty >= 1000) return safeBase * (1.075 / 1.10);
    if (qty >= 500) return safeBase * (1.083 / 1.10);

    return safeBase;
  }, []);

  const getStarDiscountLabel = (qty: number) => {
    if (qty >= 5000) return lang === 'ar' ? 'أكبر خصم 🔥' : 'Max Discount 🔥';
    if (qty >= 2500) return lang === 'ar' ? 'قيمة أفضل' : 'Best Value';
    if (qty >= 2000) return lang === 'ar' ? 'عرض قوي' : 'Great Deal';
    if (qty >= 1500) return lang === 'ar' ? 'خصم أعلى' : 'Higher Discount';
    if (qty >= 1000) return lang === 'ar' ? 'الأكثر طلبًا' : 'Most Popular';
    if (qty >= 500) return lang === 'ar' ? 'وفر الآن' : 'Save Now';
    return '';
  };

  const isBulk = actualQty >= 500;
  const isExceedingMax = globalMaxStars !== null && actualQty > globalMaxStars;
  const isUsernameMissing = !username.trim();
  const hasValidQuantity = actualQty >= minQty;
  const isPhoneMissing = ['vf_cash', 'or_cash', 'et_cash'].includes(paymentMethod) && phoneNumber.length < 11;
  const isHashMissing = paymentMethod === 'usdt' && !txHash.trim();
  const isInstapayRefMissing = paymentMethod === 'instapay' && instapayRef.length < 12;

  const isFormInvalid = isUsernameMissing || !hasValidQuantity || isPhoneMissing || isHashMissing || isInstapayRefMissing || !!userVerifyError || !telegramName;

  useEffect(() => {
    if (paymentMethod === 'usdt') {
      const cacheKey = `salla_fraction_stars_${actualQty}`;
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        try {
          const { fraction, timestamp } = JSON.parse(cachedData);
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          if (Date.now() - timestamp < TWENTY_FOUR_HOURS) {
            setCryptoFraction(fraction);
            return;
          }
        } catch {}
      }

      const randomFraction = Math.floor(Math.random() * 999 + 1) / 10000;
      setCryptoFraction(randomFraction);
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          fraction: randomFraction,
          timestamp: Date.now(),
        })
      );
    } else {
      setCryptoFraction(0);
    }
  }, [actualQty, paymentMethod]);

  const calculateTotalPi = useCallback((qty: number) => {
    if (!piPrice || piPrice <= 0) return 0;
    const usdPrice = getStarUnitPrice(qty, starPriceUsd);
    return (qty * usdPrice) / piPrice;
  }, [getStarUnitPrice, piPrice, starPriceUsd]);

  const calculateTotalSt = useCallback((qty: number) => {
    if (!piPrice || piPrice <= 0 || !stRate || stRate <= 0) return 0;
    const usdPrice = getStarUnitPrice(qty, starPriceUsd);
    const costInPi = (qty * usdPrice) / piPrice;
    return costInPi / stRate;
  }, [getStarUnitPrice, piPrice, stRate, starPriceUsd]);

  const calculateBaseTotalCost = useCallback((qty: number) => {
    if (currency === 'pi') return calculateTotalPi(qty);
    if (currency === 'st') return calculateTotalSt(qty);

    const price =
      currency === 'egp'
        ? getStarUnitPrice(qty, starPriceEgp)
        : getStarUnitPrice(qty, starPriceUsd);

    return qty * price;
  }, [calculateTotalPi, calculateTotalSt, currency, getStarUnitPrice, starPriceEgp, starPriceUsd]);

  const baseTotalCost = useMemo(() => calculateBaseTotalCost(actualQty), [actualQty, calculateBaseTotalCost]);
  
  // 🚀 استثناء OKX Pay و Binance Pay من كسور الأمان
  const isInternalUsdtTransfer = useMemo(() => usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal', [usdtNetwork]);
  const isWalletMethod = useMemo(() => ['vf_cash', 'or_cash', 'et_cash'].includes(paymentMethod), [paymentMethod]);
  const totalCost = useMemo(() => (
    isWalletMethod && currency === 'egp'
      ? Math.ceil(baseTotalCost)
      : paymentMethod === 'instapay' && currency === 'egp'
        ? Math.ceil(baseTotalCost)
        : (paymentMethod === 'usdt' && !isInternalUsdtTransfer)
          ? baseTotalCost + cryptoFraction
          : baseTotalCost
  ), [baseTotalCost, cryptoFraction, currency, isInternalUsdtTransfer, isWalletMethod, paymentMethod]);
  
  const buildBalanceCheckBody = useCallback((payload: Record<string, unknown>) => ({
    ...payload,
    // ✅ نرسل القيمتين بصيغتين:
    // 1) بدون prefix كي تعتمد عليها دالة check-balance مباشرة لو كانت محدثة.
    // 2) مع frontend_ كـ fallback للنسخ القديمة.
    fulfillment_provider: fulfillmentProvider,
    fragment_currency: fragmentCurrency,
    frontend_fulfillment_provider: fulfillmentProvider,
    frontend_fragment_currency: fragmentCurrency,
  }), [fulfillmentProvider, fragmentCurrency]);

  const calculateMaxStarsFromBalanceCheck = useCallback((balCheck: any, qtyForCost: number) => {
    if (!balCheck || qtyForCost <= 0) return 0;

    const responseCurrency = String(balCheck?.display_currency || '').toUpperCase();
    const responseFragmentCurrency = String(balCheck?.fragment_currency || '').toLowerCase();

    // ✅ المهم هنا: نعتمد على إعدادات الواجهة أيضاً، وليس رد السيرفر فقط.
    // بعض نسخ check-balance القديمة قد لا ترجع display_currency أو fragment_currency بشكل ثابت.
    const isUsdtFragmentBalance =
      fulfillmentProvider === 'fragment' &&
      (fragmentCurrency === 'usdt_ton' || responseCurrency === 'USDT' || responseFragmentCurrency === 'usdt_ton');

    if (isUsdtFragmentBalance) {
      const balanceUsdt = Number(balCheck?.balance_usdt ?? balCheck?.balance ?? 0);
      const actualCostUsd = Number(balCheck?.actual_cost_usd ?? balCheck?.actual_cost ?? 0);

      // ✅ في مسار الدولار لا نخصم رسوم TON من المعادلة، لأن USDT هو رصيد التنفيذ.
      // TON الموجود في الرد مجرد reserve للرسوم ولا يدخل في حساب عدد النجوم.
      if (balanceUsdt > 0 && actualCostUsd > 0) {
        return Math.max(0, Math.floor((qtyForCost * balanceUsdt) / actualCostUsd));
      }

      return 0;
    }

    const balanceTon = Number(balCheck?.balance_ton ?? balCheck?.balance ?? 0);
    const actualCostTon = Number(balCheck?.actual_cost_ton ?? balCheck?.actual_cost ?? 0);

    // ✅ مسار TON القديم كما هو: خصم الرسوم الثابتة التقديرية حتى لا نبالغ في الحد الأقصى.
    if (balanceTon > 0.05 && actualCostTon > 0.05) {
      return Math.max(0, Math.floor((qtyForCost * (balanceTon - 0.05)) / (actualCostTon - 0.05)));
    }

    return 0;
  }, [fulfillmentProvider, fragmentCurrency]);

  const pricePerStarUsdCurrent = useMemo(() => getStarUnitPrice(actualQty, starPriceUsd), [actualQty, getStarUnitPrice, starPriceUsd]);
  const pricePerStarEgpCurrent = useMemo(() => getStarUnitPrice(actualQty, starPriceEgp), [actualQty, getStarUnitPrice, starPriceEgp]);

  useEffect(() => {
    let cancelled = false;

    const checkPresetsAvailability = async () => {
      if (isPriceLoading) return;

      try {
        const results = await Promise.all(
          STAR_PRESETS.map(async (preset) => {
            try {
              const { data } = await supabase.functions.invoke('check-balance', {
                body: buildBalanceCheckBody({ type: 'stars', quantity: preset }),
              });

              return { preset, data, blocked: !!(data && !data.sufficient) };
            } catch {
              return { preset, data: null, blocked: false };
            }
          })
        );

        if (cancelled) return;

        const nextBlocked = results.reduce<Record<number, boolean>>((acc, item) => {
          acc[item.preset] = item.blocked;
          return acc;
        }, {});

        const firstBalanceResult = results.find((item) => item.data?.balance !== undefined);
        if (firstBalanceResult) {
          const max = calculateMaxStarsFromBalanceCheck(firstBalanceResult.data, firstBalanceResult.preset);
          setGlobalMaxStars(max);
          if (onAvailableStarsChange) onAvailableStarsChange(max);
        }

        setBlockedPresets(nextBlocked);
      } catch {
        if (!cancelled) setBlockedPresets({});
      }
    };

    checkPresetsAvailability();

    return () => {
      cancelled = true;
    };
  }, [isPriceLoading, calculateMaxStarsFromBalanceCheck, buildBalanceCheckBody, onAvailableStarsChange]);

  useEffect(() => {
    if (!enabledPayments[paymentMethod]) {
      if (enabledPayments.instapay) {
        setPaymentMethod('instapay');
        setCurrency('egp');
        setPaymentTab('local');
      } else if (enabledPayments.vf_cash) {
        setPaymentMethod('vf_cash');
        setCurrency('egp');
        setPaymentTab('local');
      } else if (enabledPayments.or_cash) {
        setPaymentMethod('or_cash');
        setCurrency('egp');
        setPaymentTab('local');
      } else if (enabledPayments.et_cash) {
        setPaymentMethod('et_cash');
        setCurrency('egp');
        setPaymentTab('local');
      } else if (enabledPayments.usdt) {
        setPaymentMethod('usdt');
        setCurrency('usd');
        setPaymentTab('global');
      } else if (enabledPayments.solana) {
        setPaymentMethod('solana');
        setCurrency('usd');
        setPaymentTab('global');
      } else if (enabledPayments.ton) {
        setPaymentMethod('ton');
        setCurrency('usd');
        setPaymentTab('global');
      } else if (enabledPayments.pi) {
        setPaymentMethod('pi');
        setCurrency('pi');
        setPaymentTab('global');
      } else if (enabledPayments.st) {
        setPaymentMethod('st');
        setCurrency('st');
        setPaymentTab('global');
      }
    }
  }, [enabledPayments, paymentMethod]);

  useEffect(() => {
    setBalanceError(false);
    setMaxAvailable(null);
  }, [actualQty]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedUsername(username.replace('@', '').trim());
    }, 1000);

    return () => clearTimeout(handler);
  }, [username]);

  useEffect(() => {
    if (debouncedUsername.length < 3) {
      setTelegramName(null);
      setTelegramPhoto(null);
      setUserVerifyError(null);
      setVerifyingUser(false);
      return;
    }

    const cached = usernameVerifyCacheRef.current[debouncedUsername.toLowerCase()];
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      setTelegramName(cached.name);
      setTelegramPhoto(cached.photo);
      setUserVerifyError(cached.error);
      setVerifyingUser(false);
      return;
    }

    setVerifyingUser(true);
    setTelegramName(null);
    setTelegramPhoto(null);
    setUserVerifyError(null);

    let cancelled = false;

    const verifyUser = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('verify-telegram-user', {
          body: { username: debouncedUsername, type: 'stars', quantity: 50 },
        });

        if (cancelled) return;
        if (error) throw error;

        let responseData = data;
        if (typeof data === 'string') {
          try {
            responseData = JSON.parse(data);
          } catch {}
        }

        if (responseData?.name && (responseData?.success || responseData?.username)) {
          setTelegramName(responseData.name);
          setTelegramPhoto(responseData.photo || null);
          setUserVerifyError(null);
          usernameVerifyCacheRef.current[debouncedUsername.toLowerCase()] = {
            name: responseData.name,
            photo: responseData.photo || null,
            error: null,
            timestamp: Date.now(),
          };
        } else {
          setTelegramName(null);
          setTelegramPhoto(null);
          
          let backendErr = responseData?.error;
          if (backendErr === 'المستخدم غير موجود' || backendErr === 'User not found' || backendErr === 'Not found') {
            backendErr = lang === 'ar' ? 'المستخدم غير موجود' : 'User not found';
          }
          
          const nextError = backendErr || (lang === 'ar' ? 'المستخدم غير موجود' : 'User not found');
          setUserVerifyError(nextError);
          usernameVerifyCacheRef.current[debouncedUsername.toLowerCase()] = {
            name: null,
            photo: null,
            error: nextError,
            timestamp: Date.now(),
          };
        }
      } catch {
        if (cancelled) return;
        const nextError = lang === 'ar' ? 'المستخدم غير موجود أو خطأ في البحث' : 'User not found or search error';
        setTelegramName(null);
        setTelegramPhoto(null);
        setUserVerifyError(nextError);
        usernameVerifyCacheRef.current[debouncedUsername.toLowerCase()] = {
          name: null,
          photo: null,
          error: nextError,
          timestamp: Date.now(),
        };
      } finally {
        if (!cancelled) setVerifyingUser(false);
      }
    };

    verifyUser();

    return () => {
      cancelled = true;
    };
  }, [debouncedUsername, lang]);



  const BEP20_BINANCE_GUARD_SEEN_KEY = 'purchase_bep20_binance_guard_seen_v1';
  const [showBep20BinanceModal, setShowBep20BinanceModal] = useState(false);
  const [bep20GuardSeen, setBep20GuardSeen] = useState(false);
  const [lastWalletNetwork, setLastWalletNetwork] = useState<'bep20' | 'trc20' | 'aptos'>('bep20');
  const walletNetworkBeforeModalRef = useRef<'bep20' | 'trc20' | 'aptos'>('bep20');

  const markBep20GuardSeen = useCallback(() => {
    try {
      sessionStorage.setItem(BEP20_BINANCE_GUARD_SEEN_KEY, '1');
    } catch {
      // ignore
    }
    setBep20GuardSeen(true);
  }, []);

  const hasSeenBep20Guard = useCallback(() => {
    if (bep20GuardSeen) return true;
    try {
      return sessionStorage.getItem(BEP20_BINANCE_GUARD_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }, [bep20GuardSeen]);

  const readWalletPreference = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(WALLET_NETWORK_PREFERENCE_KEY);
      if (stored === 'bep20' || stored === 'trc20' || stored === 'aptos') return stored;
      return null;
    } catch {
      return null;
    }
  }, []);

  const saveWalletPreference = useCallback((value: 'bep20' | 'trc20' | 'aptos') => {
    try {
      sessionStorage.setItem(WALLET_NETWORK_PREFERENCE_KEY, value);
    } catch {
      // ignore
    }
  }, []);

  const clearWalletPreference = useCallback(() => {
    try {
      sessionStorage.removeItem(WALLET_NETWORK_PREFERENCE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const resolveWalletNetwork = useCallback((): 'bep20' | 'trc20' | 'aptos' => {
    const stored = readWalletPreference();
    const candidate = stored || lastWalletNetwork;

    if (candidate === 'trc20' && enabledNetworks.trc20) return 'trc20';
    if (candidate === 'aptos' && enabledNetworks.aptos) return 'aptos';
    if (candidate === 'bep20' && enabledNetworks.bep20) return 'bep20';

    if (enabledNetworks.bep20) return 'bep20';
    if (enabledNetworks.trc20) return 'trc20';
    return 'aptos';
  }, [enabledNetworks.aptos, enabledNetworks.bep20, enabledNetworks.trc20, lastWalletNetwork, readWalletPreference]);

  useEffect(() => {
    const stored = readWalletPreference();
    if (stored === 'bep20' || stored === 'trc20' || stored === 'aptos') {
      setLastWalletNetwork(stored);
    }

    try {
      setBep20GuardSeen(sessionStorage.getItem(BEP20_BINANCE_GUARD_SEEN_KEY) === '1');
    } catch {
      setBep20GuardSeen(false);
    }
  }, [readWalletPreference]);

  const selectWalletNetwork = useCallback((network: 'bep20' | 'trc20' | 'aptos') => {
    setLastWalletNetwork(network);
    saveWalletPreference(network);
    setUsdtNetwork(network);
  }, [saveWalletPreference]);

  const openBep20NetworkGuard = useCallback(() => {
    if (hasSeenBep20Guard()) {
      setLastWalletNetwork('bep20');
      saveWalletPreference('bep20');
      setUsdtNetwork('bep20');
      return;
    }

    walletNetworkBeforeModalRef.current = resolveWalletNetwork();
    setUsdtNetwork('bep20');
    markBep20GuardSeen();
    setShowBep20BinanceModal(true);
  }, [hasSeenBep20Guard, markBep20GuardSeen, resolveWalletNetwork, saveWalletPreference]);

  const goToBinancePayInternal = useCallback(() => {
    markBep20GuardSeen();
    setPaymentTab('global');
    setUsdtNetwork('binance_internal');
  }, [markBep20GuardSeen]);

  const handleWalletsNetworkClick = useCallback(() => {
    setPaymentTab('global');

    const preferredWallet = resolveWalletNetwork();

    if (usdtNetwork === 'binance_internal' || usdtNetwork === 'okx_internal') {
      setUsdtNetwork(preferredWallet);
      return;
    }

    setUsdtNetwork(preferredWallet);

    if (preferredWallet === 'bep20' && !hasSeenBep20Guard()) {
      walletNetworkBeforeModalRef.current = preferredWallet;
      markBep20GuardSeen();
      setShowBep20BinanceModal(true);
    }
  }, [hasSeenBep20Guard, markBep20GuardSeen, resolveWalletNetwork, usdtNetwork]);

  const closeBep20NetworkGuard = useCallback(() => {
    setUsdtNetwork(walletNetworkBeforeModalRef.current || 'bep20');
    setShowBep20BinanceModal(false);
  }, []);

  const handleBep20NetworkDecision = useCallback((useBinance: boolean) => {
    if (useBinance) {
      goToBinancePayInternal();
    } else {
      const fallbackNetwork = walletNetworkBeforeModalRef.current || 'bep20';
      setLastWalletNetwork(fallbackNetwork);
      saveWalletPreference(fallbackNetwork);
      setUsdtNetwork(fallbackNetwork);
    }

    setShowBep20BinanceModal(false);
  }, [goToBinancePayInternal, saveWalletPreference]);

  const currencyLabel = useMemo(() => (
    currency === 'egp'
      ? lang === 'ar' ? 'جنيه' : 'EGP'
      : currency === 'pi' ? 'Pi' : currency === 'st' ? 'ST' : 'USDT'
  ), [currency, lang]);

  const currencySymbol = useMemo(() => (
    currency === 'egp'
      ? lang === 'ar' ? 'ج.م' : 'EGP'
      : currency === 'pi' ? 'Pi' : currency === 'st' ? 'ST' : 'USDT'
  ), [currency, lang]);


  const decimals = useMemo(() => (
    paymentMethod === 'instapay' && currency === 'egp'
      ? 0
      : currency === 'pi' || currency === 'st'
        ? 4
        : paymentMethod === 'usdt' || paymentMethod === 'solana' || paymentMethod === 'ton'
          ? 4
          : 2
  ), [currency, paymentMethod]);

  const formatPaymentAmount = useCallback((value: number) => {
    const numericValue = Number(value) || 0;
    const shouldRoundUp = (paymentMethod === 'instapay' || isWalletMethod) && currency === 'egp';
    const normalizedValue = shouldRoundUp ? Math.ceil(numericValue) : numericValue;

    return normalizedValue.toFixed(shouldRoundUp ? 0 : decimals);
  }, [currency, decimals, isWalletMethod, paymentMethod]);
  const startWalletConfirmationPolling = useCallback(
    (refCode: string, fallbackMessage?: string) => {
      if (!refCode) return;

      setConfirmMessage(
        fallbackMessage ||
          (lang === 'ar'
            ? 'في انتظار تأكيد العميل داخل تطبيق المحفظة...'
            : 'Waiting for customer confirmation in wallet app...')
      );
      setWaitingModal(true);
      setOrderStatus('waiting');
      setModalError(null);

      if (pokeIntervalRef.current) clearInterval(pokeIntervalRef.current);

      const runConfirm = () => {
        supabase.functions.invoke('sha7nawy-confirm', { body: { ref_code: refCode } }).catch(console.error);
      };

      runConfirm();
      pokeIntervalRef.current = setInterval(runConfirm, 10000);
    },
    [lang]
  );

  const handleOrderComplete = useCallback(
    (_qty: number, _user: string, oId?: string) => {
      const oid = oId || pendingOrderId || '';

      if (isCompletingRef.current || (oid && completedOrderRef.current === oid)) return;

      isCompletingRef.current = true;
      completedOrderRef.current = oid || null;

      if (pokeIntervalRef.current) {
        clearInterval(pokeIntervalRef.current);
        pokeIntervalRef.current = null;
      }

      setOrderStatus('completed');
    },
    [pendingOrderId]
  );

  const handlePaymentClose = () => {
    if (pokeIntervalRef.current) {
      clearInterval(pokeIntervalRef.current);
      pokeIntervalRef.current = null;
    }
    setWaitingModal(false);
    setOrderStatus('waiting');
    setPendingOrderId(null);
    setBackendSolanaLink(null);
    setTonPayment(null);
    setConfirmMessage('');
    setInstapayRef('');
    setTxHash('');
    setModalError(null);
    setTonTxSending(false);
    // keep the current one-time BEP20 prompt state for this purchase
    isCompletingRef.current = false;
    completedOrderRef.current = null;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
  };

  useEffect(() => {
    if (!pendingOrderId) return;

    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel(`order-track-${pendingOrderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${pendingOrderId}` },
        (payload) => {
          const status = (payload.new as any)?.status;
          const eventOrderId = (payload.new as any)?.id as string;

          if (status === 'paid' || status === 'processing' || status === 'blockchain_sent') {
            setOrderStatus('processing');
          } else if (status === 'completed') {
            handleOrderComplete(actualQty, username, eventOrderId);
          } else if (status === 'failed' || status === 'cancelled') {
            if (pokeIntervalRef.current) clearInterval(pokeIntervalRef.current);
            setWaitingModal(false);
            setOrderStatus('waiting');
            setPendingOrderId(null);
            setConfirmMessage('');
            completedOrderRef.current = null;
            toast.error(lang === 'ar' ? 'فشل الطلب' : 'Order failed');
          } else if (status === 'pending_review') {
            setOrderStatus('waiting');
            setConfirmMessage((prev) =>
              prev || (lang === 'ar' ? 'في انتظار وصول وتأكيد التحويل...' : 'Waiting for transfer confirmation...')
            );
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [pendingOrderId, actualQty, username, lang, handleOrderComplete]);

const getTonUsdPrice = useCallback(async () => {
  const cached = tonUsdPriceCacheRef.current;
  if (cached && Date.now() - cached.timestamp < 30 * 1000) {
    return cached.price;
  }

  try {
    const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=TON-USDT');
    const data = await res.json();
    const price = Number(data?.data?.[0]?.last);

    if (Number.isFinite(price) && price > 0) {
      tonUsdPriceCacheRef.current = { price, timestamp: Date.now() };
      return price;
    }
  } catch {}

  // fallback احتياطي لو فشل جلب السعر
  return cached?.price || 2;
}, []);

const buildTonFeeAmount = useCallback(async () => {
  const tonUsdPrice = await getTonUsdPrice();

  // المبلغ الذي سيتم تمريره مع المذكرة داخل تحويل USDT
  const forwardTon = 0.005;

  // رسوم تنفيذ تقديرية لعقد Jetton Transfer
  const estimatedExecutionTon = 0.025;

  // زيادة أمان = 1 سنت بالدولار محولة إلى TON
  const oneCentSafetyTon = 0.01 / tonUsdPrice;

  // الإجمالي الذي سيرسل للعقد
  const totalTonForContract = forwardTon + estimatedExecutionTon + oneCentSafetyTon;

  // حد أدنى آمن وحد أقصى حتى لا يظهر رقم كبير للمستخدم
  const safeTon = Math.min(Math.max(totalTonForContract, 0.035), 0.05);

  return {
    forwardTon,
    safeTon,
  };
}, [getTonUsdPrice]);
  
  // 🚀 دالة تنفيذ الدفع عبر TON Connect
  const executeTonPayment = async () => {
  if (!tonPayment || !tonAddress) return;

  try {
    setTonTxSending(true);

    // 1️⃣ الحصول على Jetton Wallet الخاص بالمستخدم المتصل لعملة USDT
    const jettonWalletRes = await fetch(
      `https://tonapi.io/v2/accounts/${tonAddress}/jettons/${tonPayment.jetton_master}`
    );

    const jettonWalletData = await jettonWalletRes.json();

    const rawUserJettonWalletAddress =
      typeof jettonWalletData?.wallet_address === 'string'
        ? jettonWalletData.wallet_address
        : jettonWalletData?.wallet_address?.address;

    if (!rawUserJettonWalletAddress) {
      throw new Error(
        lang === 'ar'
          ? 'لم يتم العثور على محفظة USDT داخل حسابك. تأكد أن لديك USDT على شبكة TON.'
          : 'USDT jetton wallet not found. Make sure you have USDT on TON network.'
      );
    }

    // ✅ مهم: تحويل العنوان إلى صيغة Friendly صالحة لـ TON Connect
    const userJettonWalletAddress = Address.parse(rawUserJettonWalletAddress).toString({
      bounceable: true,
      urlSafe: true,
    });
    const { forwardTon, safeTon } = await buildTonFeeAmount();
    
    // 2️⃣ بناء Payload تحويل USDT Jetton مع المذكرة Order ID
    const bodyCell = beginCell()
      .storeUint(0x0f8a7ea5, 32) // jetton transfer op
      .storeUint(Date.now(), 64) // query_id
      .storeCoins(BigInt(tonPayment.amount_units)) // مبلغ USDT بـ 6 decimals
      .storeAddress(Address.parse(tonPayment.to)) // عنوان استلام USDT الخاص بك
      .storeAddress(Address.parse(tonAddress)) // عنوان المستخدم للرد
      .storeBit(0) // no custom_payload
      .storeCoins(toNano(forwardTon.toString())) // forward TON لإرسال المذكرة
      .storeBit(1) // forward_payload as ref
      .storeRef(
        beginCell()
          .storeUint(0, 32) // text comment opcode
          .storeStringTail(tonPayment.comment) // المذكرة: order id
          .endCell()
      )
      .endCell();

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [
        {
          // ✅ Jetton Wallet بصيغة Friendly
          address: userJettonWalletAddress,

          // هذا TON للرسوم فقط وليس مبلغ USDT
          amount: toNano('0.08').toString(),

          payload: btoa(String.fromCharCode(...bodyCell.toBoc())),
        },
      ],
    };

    await tonConnectUI.sendTransaction(transaction);

    toast.success(
      lang === 'ar'
        ? 'تم إرسال معاملة USDT بنجاح، جاري التأكيد...'
        : 'USDT transaction sent successfully, confirming...'
    );

    setWaitingModal(true);
    setOrderStatus('waiting');
  } catch (e: any) {
    console.error('TON Tx Error:', e);

    const errorText = String(e?.message || e?.toString?.() || '');
    const errorName = String(e?.name || '');

    const isTonWalletCancelled =
      errorName.includes('UserRejectsError') ||
      errorName.includes('BadRequestError') ||
      errorText.includes('TON_CONNECT_SDK_ERROR') ||
      errorText.includes('BadRequestError') ||
      errorText.includes('Wallet declined the request') ||
      errorText.includes('Request to the wallet contains errors') ||
      errorText.includes('UserRejectsError') ||
      errorText.toLowerCase().includes('declined') ||
      errorText.toLowerCase().includes('cancel') ||
      errorText.toLowerCase().includes('reject');

    if (isTonWalletCancelled) {
      toast.info(
        lang === 'ar'
          ? 'تم إلغاء الدفع من المحفظة'
          : 'Payment was cancelled from the wallet'
      );

      setWaitingModal(false);
      setOrderStatus('waiting');
      setModalError(null);
      return;
    }

    toast.error(
      lang === 'ar'
        ? 'حدث خطأ أثناء تجهيز معاملة TON'
        : 'An error occurred while preparing TON transaction'
    );

    setOrderStatus('failed');
    setModalError(
      lang === 'ar'
        ? 'حدث خطأ أثناء تجهيز معاملة TON'
        : 'An error occurred while preparing TON transaction'
    );
  } finally {
    setTonTxSending(false);
  }
};

const paymentMethodIcons: Record<string, string> = {
    vf_cash: vodafoneCashImg,
    or_cash: orangeCashImg,
    et_cash: etisalatCashImg,
    usdt: usdtImg,
    solana: usdtImg,
    ton: usdtImg, 
    pi: piImg,
    st: sallaTokenImg,
    instapay: instapayImg,
  };

  const paymentMethods = useMemo(() => [
    { id: 'instapay' as const, label: lang === 'ar' ? 'انستا باي' : 'InstaPay', currency: 'egp' as Currency },
    { id: 'vf_cash' as const, label: lang === 'ar' ? 'فودافون كاش' : 'Vodafone Cash', currency: 'egp' as Currency },
    { id: 'or_cash' as const, label: lang === 'ar' ? 'أورانج كاش' : 'Orange Cash', currency: 'egp' as Currency },
    { id: 'et_cash' as const, label: lang === 'ar' ? 'اتصالات كاش' : 'Etisalat Cash', currency: 'egp' as Currency },
    { id: 'usdt' as const, label: 'USDT', currency: 'usd' as Currency },
    { id: 'solana' as const, label: lang === 'ar' ? 'محفظة Web3' : 'Web3 Wallet', subtitle: 'USDT Solana', currency: 'usd' as Currency },
    { id: 'ton' as const, label: lang === 'ar' ? ' محفظة تليجرام Web3' : 'Telegram wallet web3', subtitle: 'USDT TON Network', currency: 'usd' as Currency },
    { id: 'pi' as const, label: 'Pi Network', subtitle: 'SallaNet Pay', currency: 'pi' as Currency },
    { id: 'st' as const, label: 'Salla Token (ST)', subtitle: 'SallaNet Pay', currency: 'st' as Currency },
  ].filter((pm) => enabledPayments[pm.id as keyof typeof enabledPayments]), [enabledPayments, lang]);

  const handlePaymentSelect = (method: PaymentMethod) => {
    setPaymentMethod(method);
    const pm = paymentMethods.find((p) => p.id === method);
    if (pm) setCurrency(pm.currency);
    setPendingOrderId(null);
    setBackendSolanaLink(null);
    setTonPayment(null);
    setTxHash('');
    setInstapayRef('');
    setConfirmMessage('');
    setOrderStatus('waiting');
    setModalError(null);
    completedOrderRef.current = null;
    isCompletingRef.current = false;
    setTonTxSending(false);

    if (pokeIntervalRef.current) {
      clearInterval(pokeIntervalRef.current);
      pokeIntervalRef.current = null;
    }
  };

  const handleTabChange = (tab: 'local' | 'global') => {
    if (paymentTab === tab) return;
    setPaymentTab(tab);

    const visible = paymentMethods.filter((pm) => tab === 'local' ? pm.currency === 'egp' : pm.currency !== 'egp');
    if (visible.length > 0) {
      handlePaymentSelect(visible[0].id);

      if (tab === 'global' && visible[0].id === 'usdt' && (usdtNetwork === 'binance_internal' || usdtNetwork === 'okx_internal')) {
        setUsdtNetwork(resolveWalletNetwork());
      }
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(lang === 'ar' ? 'تم النسخ' : 'Copied!');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(lang === 'ar' ? 'تعذر النسخ' : 'Copy failed');
    }
  };

  const handleBalanceFailure = (balCheck: any) => {
    const maxAllowed = calculateMaxStarsFromBalanceCheck(balCheck, actualQty);

    setMaxAvailable(maxAllowed > 0 ? maxAllowed : 0);
    setBalanceError(true);
    toast.error(
      lang === 'ar'
        ? 'الكمية المطلوبة تتخطى المتاح حاليا'
        : 'Requested quantity exceeds currently available limit'
    );
    setLoading(false);
  };

  const canProceedToStep2 = !isPriceLoading && !isUsernameMissing && hasValidQuantity && !isExceedingMax && !!telegramName && !userVerifyError && !verifyingUser;

  const validateStep1 = () => {
    setStep1Attempted(true);
    return canProceedToStep2;
  };

  const goToStep2 = () => {
    if (!validateStep1()) return;
    setActiveStep(2);
  };

  const goBackToStep1 = () => {
    setActiveStep(1);
  };

  const handleSubmit = async () => {
    setStep1Attempted(true);
    setStep2Attempted(true);

    if (isFormInvalid || isPriceLoading || isExceedingMax) return;
    if (actualQty < minQty) {
      toast.error(
        minStarsEnabled
          ? t('app.invalidQuantity')
          : lang === 'ar'
            ? 'أدخل عدد نجوم صحيح'
            : 'Enter a valid quantity'
      );
      return;
    }
    if (cooldownSeconds > 0) return;

    setBalanceError(false);
    setMaxAvailable(null);
    completedOrderRef.current = null;
    isCompletingRef.current = false;

    // ===================================
    // ✅ مسار دفع USDT التقليدي
    // ===================================
    if (paymentMethod === 'usdt') {
      if (!txHash.trim()) {
        toast.error(lang === 'ar' ? 'أدخل إثبات المعاملة' : 'Enter transaction reference');
        return;
      }

      setLoading(true);
      setVerifying(true);
      setWaitingModal(true);
      setOrderStatus('waiting');
      setModalError(null);

      try {
        const cleanUser = username.replace('@', '').trim();

        const { data: balCheck } = await supabase.functions.invoke('check-balance', {
          body: buildBalanceCheckBody({ type: 'stars', quantity: actualQty, username: cleanUser }),
        });

        if (balCheck && !balCheck.sufficient) {
          handleBalanceFailure(balCheck);
          setWaitingModal(false);
          return;
        }

        const { data: orderData, error: orderError } = await supabase.functions.invoke('create-payment', {
          body: {
            username: cleanUser,
            quantity: actualQty,
            payment_method: paymentMethod,
            currency,
            total_cost: totalCost,
            star_price: pricePerStarUsdCurrent,
            user_id: userId,
          },
        });

        if (orderError) throw orderError;

        const newOrderId = orderData.order_id;
        setPendingOrderId(newOrderId);

        const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-tx-hash', {
          body: { tx_hash: txHash, order_id: newOrderId, expected_amount: totalCost, network: usdtNetwork },
        });

        if (verifyError) {
          let errorMsg = lang === 'ar' ? 'فشل التحقق من المعاملة' : 'Transaction verification failed';

          try {
            const errorString = typeof verifyError === 'string' ? verifyError : (verifyError as any).message || '{}';
            const parsed = JSON.parse(errorString);
            errorMsg = parsed?.message || parsed?.error || errorMsg;
          } catch {
            const errObj = verifyError as any;
            if (errObj?.message && !errObj.message.includes('Unexpected token') && !errObj.message.includes('JSON')) {
              errorMsg = errObj.message;
            } else if (errObj?.error) {
              errorMsg = errObj.error;
            }
          }

          setModalError(errorMsg);
          setOrderStatus('failed');
          return;
        }

        if (verifyData?.verified) {
          setOrderStatus('processing');
          startCooldown();
        } else {
          setModalError(verifyData?.message || verifyData?.error || (lang === 'ar' ? 'فشل التحقق' : 'Verification failed'));
          setOrderStatus('failed');
        }
      } catch {
        setModalError(lang === 'ar' ? 'خطأ غير متوقع في التحقق أو إنشاء الطلب' : 'Unexpected error during verification');
        setOrderStatus('failed');
      } finally {
        setVerifying(false);
        setLoading(false);
      }

      return;
    }

    // ===================================
    // ✅ مسار دفع Web3 (سولانا و TON)
    // ===================================
    if (paymentMethod === 'solana' || paymentMethod === 'ton') {
      if (paymentMethod === 'solana' && !usdtWalletSolana) {
        toast.error(lang === 'ar' ? 'عنوان محفظة سولانا غير مهيأ في الإعدادات' : 'Solana wallet not configured in settings');
        return;
      }
      if (paymentMethod === 'ton' && !usdtWalletTon) {
        toast.error(lang === 'ar' ? 'عنوان محفظة TON غير مهيأ في الإعدادات' : 'TON wallet not configured in settings');
        return;
      }

      setLoading(true);
      setOrderStatus('waiting');
      setModalError(null);
      setBackendSolanaLink(null);
      setTonPayment(null);

      try {
        const cleanUser = username.replace('@', '').trim();

        // 1️⃣ التحقق من الرصيد المتاح
        const { data: balCheck } = await supabase.functions.invoke('check-balance', {
          body: buildBalanceCheckBody({ type: 'stars', quantity: actualQty, username: cleanUser }),
        });

        if (balCheck && !balCheck.sufficient) {
          handleBalanceFailure(balCheck);
          return;
        }

        // 2️⃣ إنشاء الطلب في الداتابيز للحصول على الـ Order ID
        const { data: orderData, error: orderError } = await supabase.functions.invoke('create-payment', {
          body: {
            username: cleanUser,
            quantity: actualQty,
            payment_method: paymentMethod, // سيرسل 'solana' أو 'ton'
            currency: 'usd',
            total_cost: totalCost,
            star_price: pricePerStarUsdCurrent,
            user_id: userId,
          },
        });

        if (orderError || orderData?.error) throw new Error(orderData?.error || orderError?.message);

        // 🚀 توجيه البيانات حسب الشبكة
        if (paymentMethod === 'ton') {
          const generatedTonPayment = orderData.ton_payment as TonPaymentData | undefined;
          
          // تأكد من أن السيرفر يُرجع ton_payment بدلاً من solana_pay_link عند اختيار TON
          if (!generatedTonPayment) {
            throw new Error('السيرفر لم يقم بإرجاع بيانات دفع TON - يرجى تحديث دالة السيرفر');
          }
          
          setPendingOrderId(orderData.order_id);
          setTonPayment(generatedTonPayment);
          setBackendSolanaLink(null);
        } else {
          const generatedLink = orderData.solana_pay_link;
          if (!generatedLink) {
            throw new Error('السيرفر لم يقم بإرجاع رابط الدفع');
          }
          setPendingOrderId(orderData.order_id);
          setBackendSolanaLink(generatedLink);
        }

        startCooldown();

      } catch (err: any) {
        setModalError(err?.message || (lang === 'ar' ? 'فشل إعداد المعاملة' : 'Failed to setup transaction'));
        setOrderStatus('failed');
        setWaitingModal(true);
      } finally {
        setLoading(false);
      }

      return;
    }

    setLoading(true);

    try {
      const cleanUser = username.replace('@', '').trim();

      const { data: balCheck } = await supabase.functions.invoke('check-balance', {
        body: buildBalanceCheckBody({ type: 'stars', quantity: actualQty, username: cleanUser }),
      });

      if (balCheck && !balCheck.sufficient) {
        handleBalanceFailure(balCheck);
        return;
      }

      if (paymentMethod === 'pi' || paymentMethod === 'st') {
        const { data, error } = await supabase.functions.invoke('salla-checkout', {
          body: {
            username: cleanUser,
            quantity: actualQty,
            payment_method: paymentMethod,
            currency: paymentMethod,
            total_cost: totalCost,
            star_price: pricePerStarUsdCurrent,
            user_id: userId,
            type: 'stars',
          },
        });

        if (error) throw error;

        if (data?.checkout_url) {
          window.open(data.checkout_url, '_blank', 'noopener,noreferrer');
          
          setPendingOrderId(data.order_id);
          setWaitingModal(true);
          setOrderStatus('waiting');
          startCooldown();
        } else {
          throw new Error(data?.error || 'Failed to create checkout');
        }

        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          username: cleanUser,
          quantity: actualQty,
          payment_method: paymentMethod,
          currency,
          total_cost: totalCost,
          star_price: currency === 'egp' ? pricePerStarEgpCurrent : pricePerStarUsdCurrent,
          phone_number: phoneNumber,
          payment_ref: paymentMethod === 'instapay' ? instapayRef : undefined,
          user_id: userId,
        },
      });

      if (error || data?.error) {
        const errorMsg =
          data?.error ||
          (error as any)?.message ||
          (lang === 'ar' ? 'فشل إنشاء الطلب' : 'Failed to create order');

        setModalError(errorMsg);
        setOrderStatus('failed');
        setWaitingModal(true);
        setLoading(false);
        return;
      }

      if (paymentMethod === 'vf_cash' || paymentMethod === 'or_cash' || paymentMethod === 'et_cash') {
        const refCode = data?.reference || data?.ref_code || data?.payment_ref || null;
        setPendingOrderId(data?.order_id || null);

        startWalletConfirmationPolling(
          refCode,
          data?.confirm_message ||
            (lang === 'ar'
              ? 'في انتظار تأكيد العميل داخل تطبيق المحفظة...'
              : 'Waiting for customer confirmation in wallet app...')
        );
        startCooldown();
      } else if (paymentMethod === 'instapay') {
        setPendingOrderId(data?.order_id || null);
        setConfirmMessage(lang === 'ar' ? 'جاري التحقق من التحويل البنكي عبر انستا باي...' : 'Verifying InstaPay bank transfer...');
        setWaitingModal(true);
        
        if (data?.status === 'processing') {
          setOrderStatus('processing');
        } else {
          setOrderStatus('waiting');
        }
        
        startCooldown();
      } else if (data?.confirm_message) {
        setPendingOrderId(data?.order_id || null);
        setConfirmMessage(data.confirm_message);
        setWaitingModal(true);
        setOrderStatus('waiting');

        const refCode = data.reference || data.ref_code || data.payment_ref || null;

        if (pokeIntervalRef.current) clearInterval(pokeIntervalRef.current);

        if (refCode) {
          supabase.functions.invoke('sha7nawy-confirm', { body: { ref_code: refCode } }).catch(console.error);
          pokeIntervalRef.current = setInterval(() => {
            supabase.functions
              .invoke('sha7nawy-confirm', { body: { ref_code: refCode } })
              .catch(console.error);
          }, 10000);
        }
        startCooldown();
      } else {
        handleOrderComplete(actualQty, username, data?.order_id);
        startCooldown();
      }
    } catch (err: any) {
      setWaitingModal(false);
      setOrderStatus('waiting');
      toast.error(err?.message || (lang === 'ar' ? 'حدث خطأ، حاول مرة أخرى' : 'An error occurred, please try again'));
    } finally {
      setLoading(false);
    }
  };

  const getButtonContent = () => {
    if (isPriceLoading) {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-1">
          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-white/80 shrink-0" />
          <span className="text-sm sm:text-base truncate">
            {lang === 'ar' ? 'تجهيز الأسعار...' : 'Loading prices...'}
          </span>
        </div>
      );
    }

    if (loading || verifying) {
      return (
        <div className="flex flex-col items-center justify-center w-full px-1 overflow-hidden">
          <div className="flex items-center justify-center gap-1.5 w-full">
            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-white shrink-0" />
            <span className="text-sm sm:text-base font-bold truncate">
              {verifying
                ? lang === 'ar'
                  ? 'جاري التحقق...'
                  : 'Verifying...'
                : lang === 'ar'
                  ? 'جاري التحضير...'
                  : 'Preparing payment...'}
            </span>
          </div>
          {loading && !verifying && (
            <span className="text-[9px] sm:text-[11px] font-medium text-white/90 mt-0.5 whitespace-nowrap truncate w-full text-center">
              {lang === 'ar' ? 'لا تقم بإغلاق أو تحديث الصفحة' : 'Do not close or reload page'}
            </span>
          )}
        </div>
      );
    }

    if (verifyingUser) {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-1">
          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-white/80 shrink-0" />
          <span className="text-sm sm:text-base truncate">
            {lang === 'ar' ? 'جاري العثور على الحساب...' : 'Finding account...'}
          </span>
        </div>
      );
    }

    if (cooldownSeconds > 0) {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-1">
          <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-white/80 shrink-0" />
          <span className="text-sm sm:text-base truncate">
            {lang === 'ar' ? 'انتظر دقيقتين' : 'Wait 2 min'}
          </span>
        </div>
      );
    }

    if (paymentMethod === 'solana') {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-2">
          <Zap className="w-4 h-4 text-white/90 shrink-0" />
          <span className="font-bold truncate text-xs sm:text-sm">
            {lang === 'ar' ? 'تأكيد الدفع (Web3)' : 'Confirm (Web3)'}
          </span>
        </div>
      );
    }

    if (paymentMethod === 'ton') {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-2">
          <Zap className="w-4 h-4 text-white/90 shrink-0" />
          <span className="font-bold truncate text-xs sm:text-sm">
            {lang === 'ar' ? 'تأكيد الدفع (USDT تليجرام)' : 'Confirm (USDT Telegram)'}
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center gap-2 w-full px-2">
        <span className="font-bold truncate text-base sm:text-lg">
          {lang === 'ar' ? 'تأكيد الدفع' : 'Confirm Payment'}
        </span>
      </div>
    );
  };

  const stepButtonClass = (step: 1 | 2) =>
    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition-all border-none focus:ring-0 outline-none ${
      activeStep === step
        ? 'bg-primary text-primary-foreground shadow-sm'
        : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
    }`;

  const paymentTabClass = (tab: 'local' | 'global') =>
    `flex-1 py-3 rounded-[1.25rem] text-sm font-black transition-all border-none focus:ring-0 outline-none flex justify-center items-center gap-2 ${
      paymentTab === tab
        ? 'bg-primary text-primary-foreground shadow-md'
        : 'bg-muted/40 text-muted-foreground hover:bg-muted/60'
    }`;

  const isWalletNetwork = ['bep20', 'trc20', 'aptos'].includes(usdtNetwork);

  const getAddressToCopy = () => {
    if (paymentMethod === 'solana') return usdtWalletSolana;
    if (paymentMethod === 'ton') return usdtWalletTon;
    if (usdtNetwork === 'bep20') return usdtWallet;
    if (usdtNetwork === 'trc20') return usdtWalletTrc20;
    if (usdtNetwork === 'aptos') return usdtWalletAptos;
    if (usdtNetwork === 'okx_internal') return OKX_UID;
    return BINANCE_UID;
  };

  const visiblePaymentMethods = useMemo(() => paymentMethods.filter((pm) => 
    paymentTab === 'local' ? pm.currency === 'egp' : pm.currency !== 'egp'
  ), [paymentMethods, paymentTab]);

  return (
    <>
      <div className="bg-card/80 backdrop-blur-xl rounded-[2.5rem] p-5 sm:p-7 max-w-lg mx-auto shadow-sm border-none focus:ring-0">
        <div className="text-center mb-6 sm:mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-[1.4rem] bg-star-gold/10 mb-3 shadow-inner">
            <Star className="w-7 h-7 text-star-gold fill-star-gold" />
          </div>
          <h3 className="text-2xl font-black text-foreground">{t('app.buyStars')}</h3>
          <p className="text-muted-foreground text-sm font-medium mt-1">
            {lang === 'ar' ? 'شحن فوري ومضمون' : 'Instant & Secure Top-up'}
          </p>
        </div>

        {isPriceLoading ? (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary opacity-80" />
            <span className="text-sm font-bold text-muted-foreground animate-pulse">
              {lang === 'ar' ? 'جاري تجهيز وتحديث الأسعار...' : 'Updating prices...'}
            </span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 mb-6">
              <button type="button" onClick={() => setActiveStep(1)} className={stepButtonClass(1)}>
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-[11px]">1</span>
                <span>{lang === 'ar' ? 'البيانات' : 'Details'}</span>
              </button>
              <button
                type="button"
                onClick={() => (canProceedToStep2 ? setActiveStep(2) : validateStep1())}
                className={stepButtonClass(2)}
              >
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-[11px]">2</span>
                <span>{lang === 'ar' ? 'الدفع' : 'Payment'}</span>
              </button>
            </div>

            {activeStep === 1 ? (
              <div>
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2 px-1 gap-3">
                    <label className="text-sm font-bold text-foreground/80">{t('app.username')}</label>
                    <button
                      type="button"
                      onClick={() => setShowUserGuide(!showUserGuide)}
                      className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 transition-colors shrink-0 outline-none border-none focus:ring-0"
                    >
                      <Info className="w-3.5 h-3.5" />
                      {lang === 'ar' ? 'كيف أعرف اليوزر؟' : 'How to find username?'}
                    </button>
                  </div>

                  {showUserGuide && (
                    <div className="mb-3 bg-primary/10 rounded-xl p-3 shadow-inner border-none">
                      <div className="text-xs text-foreground/80 font-bold leading-relaxed mb-3">
                        {lang === 'ar' ? (
                          <ol className="list-decimal list-inside space-y-1.5">
                            <li>افتح تطبيق تليجرام بتاعك</li>
                            <li>هات الإعدادات (Settings)</li>
                            <li>ادخل على الحساب (Account)</li>
                            <li>انسخ اسم المستخدم (الـ Username) وضعه هنا</li>
                          </ol>
                        ) : (
                          <ol className="list-decimal list-inside space-y-1.5">
                            <li>Open Telegram app</li>
                            <li>Go to Settings</li>
                            <li>Go to Account</li>
                            <li>Copy your username and paste it here</li>
                          </ol>
                        )}
                      </div>

                      <div className="flex gap-2 items-start bg-primary/5 rounded-lg p-2 border-none">
                        <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <p className="text-[10px] sm:text-xs font-bold text-primary/90 leading-relaxed">
                          {lang === 'ar'
                            ? 'لو معندكش يوزرنيم، تقدر تعمله بسهولة من الإعدادات، بس خلي بالك لازم يكون حروف إنجليزي وأرقام بس.'
                            : 'If you do not have a username, you can create one in settings using English letters and numbers only.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <span className="absolute top-1/2 -translate-y-1/2 text-muted-foreground/60 text-base font-bold ltr:left-4 rtl:right-4 pointer-events-none">
                      @
                    </span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace('@', ''))}
                      placeholder={t('app.usernamePlaceholder')}
                      className={`w-full border-none focus:ring-0 outline-none rounded-[1.25rem] py-4 ltr:pl-10 ltr:pr-12 rtl:pr-10 rtl:pl-12 text-foreground font-semibold text-base transition-all shadow-inner ${
                        step1Attempted && isUsernameMissing
                          ? 'bg-destructive/10 placeholder:text-destructive/50 text-destructive'
                          : 'bg-muted/50 focus:bg-muted'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => handlePaste((text) => setUsername(text.replace('@', '')))}
                      className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 p-1.5 bg-background/50 hover:bg-background/80 rounded-md transition-colors text-muted-foreground hover:text-foreground border-none outline-none focus:ring-0"
                      title={lang === 'ar' ? 'لصق' : 'Paste'}
                    >
                      <Clipboard className="w-4 h-4" />
                    </button>
                  </div>

                  {step1Attempted && isUsernameMissing && (
                    <div className="mt-2 flex items-center gap-2 text-xs font-bold text-destructive px-1">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{lang === 'ar' ? 'اسم المستخدم مطلوب' : 'Username is required'}</span>
                    </div>
                  )}

                  {verifyingUser && debouncedUsername.length >= 3 && (
                    <div className="flex items-center gap-2 mt-3 px-2 text-xs font-bold text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {lang === 'ar' ? 'جاري التحقق...' : 'Verifying...'}
                    </div>
                  )}

                  {telegramName && !verifyingUser && (
                    <div className="flex items-center gap-3 mt-3 bg-green-500/10 rounded-[1.25rem] p-3 shadow-sm border-none">
                      <div className="relative shrink-0">
                        {telegramPhoto ? (
                          <img
                            src={telegramPhoto}
                            alt={telegramName}
                            className="w-12 h-12 rounded-full shadow-sm object-cover border-none"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '';
                              setTelegramPhoto(null);
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center shadow-sm border-none">
                            <UserCheck className="w-6 h-6 text-green-600" />
                          </div>
                        )}
                        <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1 shadow-sm border-none">
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </div>
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-black text-foreground truncate">{telegramName}</span>
                        <span className="text-xs text-green-600 dark:text-green-400 font-bold flex items-center gap-1">
                          {lang === 'ar' ? 'حساب مؤكد' : 'Verified Account'}
                        </span>
                      </div>
                    </div>
                  )}

                  {userVerifyError && !verifyingUser && (
                    <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-destructive/10 rounded-xl text-destructive font-bold text-xs border-none shadow-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {userVerifyError}
                    </div>
                  )}
                </div>

                <div className="mb-2">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <label className="text-sm font-bold text-foreground/80">{t('app.quantity')}</label>
                    {minStarsEnabled && (
                      <span className="text-xs font-bold text-muted-foreground/60 bg-muted/40 px-2 py-0.5 rounded-lg border-none">
                        {t('app.minStars')}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {STAR_PRESETS.map((preset) => {
                      const presetPrice = calculateBaseTotalCost(preset);
                      const isBlocked = blockedPresets[preset];

                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            if (!isBlocked) {
                              setQuantity(preset);
                              setCustomQty('');
                            }
                          }}
                          disabled={isBlocked}
                          className={`relative flex flex-col items-center justify-center p-3 rounded-[1.25rem] border-none focus:ring-0 outline-none transition-all overflow-hidden ${
                            isBlocked
                              ? 'bg-muted/20 text-muted-foreground opacity-45 cursor-not-allowed grayscale'
                              : quantity === preset && !customQty
                                ? 'bg-star-gold/10 text-star-gold font-black shadow-inner'
                                : 'bg-muted/40 text-muted-foreground font-bold hover:bg-muted/70'
                          }`}
                        >
                          {getStarDiscountLabel(preset) && !isBlocked && (
                            <div className="absolute top-0 right-0 bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-bl-lg rounded-tr-[1.25rem] shadow-sm z-10 border-none">
                              {getStarDiscountLabel(preset)}
                            </div>
                          )}
                          <StarIcon size={22} />
                          <span className="mt-1 text-sm">{preset.toLocaleString()}</span>

                          {quantity === preset && !customQty && !isBlocked && (
                            <span className={`text-[11px] mt-1 font-bold opacity-90 ${currency !== 'egp' ? 'tracking-wider' : ''}`}>
                              {formatPaymentAmount(presetPrice)} {currencySymbol}
                            </span>
                          )}

                          {isBlocked && (
                            <div className="mt-1 flex flex-col items-center">
                              <span className="text-[10px] font-black text-destructive whitespace-nowrap">
                                {lang === 'ar' ? 'غير متاح' : 'Unavailable'}
                              </span>
                              <span className="text-[9px] font-bold text-muted-foreground mt-0.5 text-center leading-tight">
                                {lang === 'ar' ? 'سيتم التجديد' : 'Restocking'}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative mb-2">
                    <input
                      type="number"
                      min={minQty}
                      value={customQty}
                      onChange={(e) => setCustomQty(e.target.value)}
                      placeholder={lang === 'ar' ? 'او ادخل رقم مخصص...' : 'Or enter custom amount...'}
                      className={`w-full border-none focus:ring-0 outline-none rounded-[1.25rem] py-3.5 ltr:pl-4 rtl:pr-4 ltr:pr-12 rtl:pl-12 font-bold transition-all text-center shadow-inner ${
                        step1Attempted && !hasValidQuantity
                          ? 'bg-destructive/10 text-destructive placeholder:text-destructive/50'
                          : isExceedingMax
                            ? 'bg-destructive/10 text-destructive placeholder:text-destructive/50'
                            : 'bg-muted/50 focus:bg-muted text-foreground'
                      }`}
                    />
                    {customQty && (
                      <div className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 pointer-events-none">
                        <Star className={`w-5 h-5 ${isExceedingMax ? 'text-destructive fill-destructive' : 'text-star-gold fill-star-gold'}`} />
                      </div>
                    )}
                  </div>

                  {step1Attempted && !hasValidQuantity && (
                    <div className="mt-2 flex items-center gap-2 text-xs font-bold text-destructive px-1">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{lang === 'ar' ? 'الكمية مطلوبة' : 'Quantity is required'}</span>
                    </div>
                  )}

                  {customQty && parseInt(customQty, 10) > 0 && !isExceedingMax && (
                    <div className="mt-2 flex justify-center z-10">
                      <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full backdrop-blur-sm border-none shadow-sm">
                        {lang === 'ar' ? 'الإجمالي:' : 'Total:'} {formatPaymentAmount(calculateBaseTotalCost(parseInt(customQty, 10)))} {currencySymbol}
                      </span>
                    </div>
                  )}

                  {globalMaxStars !== null && (
                    <div className={`flex items-center justify-between px-2 mt-2 ${isExceedingMax ? 'text-destructive' : 'text-muted-foreground/80'}`}>
                      <div className="flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[10px] sm:text-xs font-bold">
                          {lang === 'ar'
                            ? `الحد الأقصى المتاح حاليا: ${globalMaxStars.toLocaleString()} نجمة`
                            : `Currently available: ${globalMaxStars.toLocaleString()} stars`}
                        </span>
                      </div>

                      {globalMaxStars > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuantity(0);
                            setCustomQty(globalMaxStars.toString());
                          }}
                          className="text-[10px] font-black bg-primary/10 text-primary hover:bg-primary/20 px-2.5 py-1 rounded-lg transition-colors border-none focus:ring-0 outline-none shrink-0 shadow-sm"
                        >
                          {lang === 'ar' ? 'شراء الكل' : 'Buy All'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 mt-6">
                  <div />
                  <button
                    type="button"
                    onClick={goToStep2}
                    disabled={!canProceedToStep2}
                    className={`w-full h-14 rounded-[1.4rem] font-black transition-all border-none focus:ring-0 outline-none ${
                      canProceedToStep2 ? 'gradient-telegram text-white shadow-md' : 'bg-muted text-muted-foreground cursor-not-allowed'
                    }`}
                  >
                    {lang === 'ar' ? 'التالي: اختيار طريقة الدفع' : 'Next: Choose payment method'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="bg-secondary/40 rounded-[1.5rem] p-3 sm:p-4 mb-5 border-none shadow-inner">
                  <div className="flex justify-between items-center gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap">
                        {lang === 'ar' ? 'اليوزر:' : 'User:'}
                      </span>
                      <span className="text-sm sm:text-base font-black text-foreground truncate" dir="ltr">
                        @{username.replace('@', '').trim() || '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap">
                        {lang === 'ar' ? 'الكمية:' : 'Qty:'}
                      </span>
                      <span className="text-sm sm:text-base font-black text-foreground flex items-center gap-1">
                        {actualQty.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block text-sm font-bold text-foreground/80 mb-3 px-1">
                    {t('app.paymentMethod')}
                  </label>

                  <div className="flex gap-2 mb-4">
                    <button
                      type="button"
                      onClick={() => handleTabChange('local')}
                      className={paymentTabClass('local')}
                    >
                      {lang === 'ar' ? 'جنيه مصري' : 'EGP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTabChange('global')}
                      className={paymentTabClass('global')}
                    >
                      {lang === 'ar' ? 'عالميا' : 'Global'}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {visiblePaymentMethods.map((pm) => (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => handlePaymentSelect(pm.id)}
                        className={`relative flex flex-col items-center justify-center gap-1.5 p-3 sm:p-4 rounded-[1.25rem] border-none focus:ring-0 outline-none transition-all overflow-hidden ${
                          paymentMethod === pm.id
                            ? 'bg-primary/10 shadow-md ring-2 ring-primary/20'
                            : 'bg-muted/40 opacity-80 hover:opacity-100 hover:bg-muted/60 grayscale-[20%]'
                        }`}
                      >
                        {pm.id === 'solana' ? (
                          <div className="relative w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-[0.8rem] bg-[#14F195]/10 shadow-sm border border-[#14F195]/20">
                            <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-[#9945FF]" fill="#14F195" />
                            <img src={usdtImg} alt="USDT" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-background shadow-sm" />
                          </div>
                        ) : pm.id === 'ton' ? (
                          <div className="relative w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center rounded-[0.8rem] bg-[#0098EA]/10 shadow-sm border border-[#0098EA]/20">
                            <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-[#0098EA]" fill="#0098EA" />
                            <img src={usdtImg} alt="USDT" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-background shadow-sm" />
                          </div>
                        ) : (
                          <img
                            src={paymentMethodIcons[pm.id]}
                            alt={pm.label}
                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-[0.8rem] object-cover shadow-sm border-none"
                          />
                        )}
                        <span
                          className={`text-[10px] sm:text-xs font-bold text-center leading-tight ${
                            paymentMethod === pm.id ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        >
                          {pm.label}
                        </span>
                        {'subtitle' in pm && pm.subtitle ? (
                          <span className="text-[9px] sm:text-[10px] font-bold text-muted-foreground/75 leading-none text-center border-none">
                            {pm.subtitle}
                          </span>
                        ) : null}

                        {paymentMethod === pm.id && (
                          <div className="absolute top-2 right-2 bg-primary rounded-full p-0.5 shadow-sm border-none">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </div>
                        )}
                      </button>
                    ))}
                    {visiblePaymentMethods.length === 0 && (
                      <div className="col-span-3 text-center py-4 text-xs font-bold text-muted-foreground bg-muted/20 rounded-xl border-none">
                        {lang === 'ar' ? 'لا توجد طرق دفع متاحة في هذا القسم حاليا' : 'No payment methods available in this section currently'}
                      </div>
                    )}
                  </div>
                </div>

                {paymentMethod === 'instapay' && (
                  <div className="mb-5 space-y-4 overflow-hidden border-none">
                    <div className="bg-muted/40 rounded-[1.5rem] p-5 border-none shadow-inner">
                      <div className="flex items-center gap-2 mb-3 border-none">
                        <Zap className="w-5 h-5 text-purple-500" />
                        <p className="text-sm font-bold text-foreground">
                          {lang === 'ar' ? 'قم بتحويل المبلغ إلى عنوان انستا باي التالي:' : 'Transfer the amount to this InstaPay address:'}
                        </p>
                      </div>
                      <a
                        href={instapayLink || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl py-3 px-2 sm:p-4 shadow-md transition-all border-none focus:ring-0 outline-none w-full font-black text-[13px] sm:text-base mt-2 mb-1 h-auto min-h-[3.5rem]"
                      >
                        <Zap className="w-5 h-5 fill-white/20 shrink-0" />
                        <span className="whitespace-normal text-center leading-tight">
                          {lang === 'ar' 
                            ? `اضغط لفتح انستا باي ودفع مبلغ ${formatPaymentAmount(totalCost)} ${currencySymbol}` 
                            : `Tap to open InstaPay & pay ${formatPaymentAmount(totalCost)} ${currencySymbol}`}
                        </span>
                      </a>
                    </div>

                    <div className="bg-purple-500/10 rounded-xl p-4 shadow-inner border-none">
                      <div className="flex gap-2 items-start">
                        <Info className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                        <div className="text-purple-700 dark:text-purple-400 leading-relaxed space-y-1.5 border-none">
                          <p className="text-sm font-black">
                            {lang === 'ar'
                              ? 'كيف أحصل على الرقم المرجعي؟'
                              : 'How to get the Reference Number?'}
                          </p>
                          <ul className="list-disc list-inside space-y-1 mt-1 text-[11px] font-bold opacity-90 border-none">
                            {lang === 'ar' ? (
                              <>
                                <li>بالضغط على <b className="font-black">المزيد من التفاصيل</b> في شاشة نجاح معاملة انستا باي، انسخ الرقم الخاص بالمرجع.</li>
                                <li>أو من <b className="font-black">رسالة البنك</b> بعد نجاح التحويل، انسخ الرقم المرجعي وضعه هنا.</li>
                              </>
                            ) : (
                              <>
                                <li>By clicking on <b className="font-black">More Details</b> in the InstaPay successful transaction screen, copy the Reference Number.</li>
                                <li>Or from the <b className="font-black">Bank SMS</b> after a successful transfer, copy the Reference Number and paste it here.</li>
                              </>
                            )}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className={`flex items-center justify-between font-bold text-foreground/80 mb-3 px-1 ${lang === 'ar' ? 'text-sm' : 'text-xs'}`}>
                        {lang === 'ar' ? 'الرقم المرجعي (Reference Number)' : 'Reference Number'}
                        <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md border-none">
                          {lang === 'ar' ? '12 رقم' : '12 Digits'}
                        </span>
                      </label>
                      <div className="relative border-none">
                        <input
                          type="text"
                          value={instapayRef}
                          onChange={(e) => setInstapayRef(e.target.value.replace(/\D/g, '').slice(0, 12))}
                          placeholder={lang === 'ar' ? 'أدخل الـ 12 رقم هنا...' : 'Enter 12 digits here...'}
                          maxLength={12}
                          inputMode="numeric"
                          className={`w-full border-none focus:ring-0 outline-none rounded-[1.25rem] py-4 ltr:pl-4 rtl:pr-4 ltr:pr-12 rtl:pl-12 font-bold transition-all tracking-wider shadow-inner text-center ${lang === 'ar' ? 'text-lg' : 'text-base'} ${
                            instapayRef.length === 12
                              ? 'bg-green-500/10 text-green-600 focus:bg-green-500/20 placeholder:text-green-600/50'
                              : step2Attempted && isInstapayRefMissing
                              ? 'bg-destructive/10 text-destructive focus:bg-destructive/20 placeholder:text-destructive/50'
                              : 'bg-muted/50 focus:bg-muted text-foreground'
                          }`}
                        />
                        
                        {instapayRef.length === 12 ? (
                          <span className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 pointer-events-none">
                            <Check className="w-5 h-5 text-green-500" strokeWidth={3} />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handlePaste((text) => setInstapayRef(text.replace(/\D/g, '').slice(0, 12)))}
                            className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 p-1.5 bg-background/50 hover:bg-background/80 rounded-md transition-colors text-muted-foreground hover:text-foreground border-none outline-none focus:ring-0"
                            title={lang === 'ar' ? 'لصق' : 'Paste'}
                          >
                            <Clipboard className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {step2Attempted && isInstapayRefMissing && (
                        <div className="mt-2 flex items-center gap-2 text-xs font-bold text-destructive px-1 animate-in fade-in slide-in-from-top-1 border-none">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{lang === 'ar' ? 'يرجى إدخال الرقم المرجعي المكون من 12 رقم' : 'Please enter the 12-digit reference number'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ✅ قسم الدفع عبر Web3 (سولانا و TON) */}
                {(paymentMethod === 'solana' || paymentMethod === 'ton') && ((paymentMethod === 'solana' && usdtWalletSolana) || (paymentMethod === 'ton' && usdtWalletTon)) && (
                  <div className="mb-5 space-y-4 overflow-hidden border-none">
                    <div className={`bg-gradient-to-br rounded-[1.5rem] p-5 sm:p-6 shadow-inner border-none ${paymentMethod === 'solana' ? 'from-[#14F195]/10 to-[#9945FF]/10' : 'from-[#0098EA]/10 to-[#0098EA]/5'}`}>
                      <div className="flex items-center gap-2 mb-4 border-none">
                        <Zap className={`w-6 h-6 ${paymentMethod === 'solana' ? 'text-[#9945FF] fill-[#14F195]' : 'text-[#0098EA] fill-[#0098EA]'}`} />
                        <p className="text-base font-black text-foreground border-none">
                          {paymentMethod === 'solana' 
                            ? (lang === 'ar' ? 'تأكيد الدفع عبر شبكة سولانا' : 'Confirm Solana Network Payment')
                            : (lang === 'ar' ? 'تأكيد الدفع بـ USDT تليجرام' : 'Confirm USDT Telegram Payment')}
                        </p>
                      </div>
                      
                      <div className="text-sm text-foreground/80 font-bold leading-relaxed space-y-3 mb-5 border-none">
                        <p>
                          {lang === 'ar'
                            ? `اضغط لتأكيد دفع مبلغ قدره ${formatPaymentAmount(totalCost)} USDT. سيتم تجهيز المعاملة الخاصة بك في ثواني.`
                            : `Click to confirm payment of ${formatPaymentAmount(totalCost)} USDT. Your transaction will be prepared in seconds.`}
                        </p>
                        
                        <div className="bg-background/60 rounded-xl p-3 flex gap-2 items-start border-none shadow-sm">
                          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5 border-none" />
                          <p className="text-[11px] sm:text-xs border-none">
                            {lang === 'ar'
                              ? `تأكد من وجود رصيد USDT يكفي للطلب، و${paymentMethod === 'solana' ? 'بعض من عملة SOL' : 'بعض من نجوم تليجرام (Stars)'} لتغطية رسوم الشبكة في محفظتك.`
                              : `Ensure you have enough USDT for the order, and some ${paymentMethod === 'solana' ? 'SOL' : 'Telegram Stars'} to cover network fees in your wallet.`}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-none">
                          <Check className={`w-3.5 h-3.5 ${paymentMethod === 'solana' ? 'text-[#14F195]' : 'text-[#0098EA]'}`} strokeWidth={3} />
                          <span>{lang === 'ar' ? 'المحفظة الموصى بها:' : 'Recommended wallet:'} <strong>{paymentMethod === 'solana' ? 'Phantom' : (lang === 'ar' ? 'محفظة تليجرام (مثل @wallet)' : 'Telegram Wallet (@wallet)')}</strong></span>
                        </div>
                      </div>

                      {/* ✅ واجهة TON Connect الديناميكية */}
                      {paymentMethod === 'ton' && tonPayment ? (
                        <div className="animate-in fade-in zoom-in duration-300 border-none flex flex-col gap-3">
                          {!tonAddress ? (
                            <div className="flex flex-col items-center gap-3 bg-background/40 p-4 rounded-xl">
                              <p className="text-xs font-bold text-foreground text-center">
                                {lang === 'ar' ? 'يرجى ربط محفظتك أولاً لإتمام الدفع بضغطة واحدة:' : 'Please connect your wallet first to pay in 1-click:'}
                              </p>
                              <TonConnectButton className="w-full flex justify-center" />
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={tonTxSending}
                                onClick={executeTonPayment}
                                className="flex items-center justify-center gap-2 bg-[#0098EA] hover:bg-[#007BB5] text-white rounded-2xl py-4 sm:py-5 px-4 shadow-lg transition-all border-none focus:ring-0 outline-none w-full font-black text-base sm:text-lg disabled:opacity-50"
                              >
                                {tonTxSending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Zap className="w-6 h-6 fill-white/20 shrink-0" />}
                                {tonTxSending ? (lang === 'ar' ? 'جاري الدفع...' : 'Processing...') : (lang === 'ar' ? 'ادفع الآن بضغطة واحدة' : 'Pay Now in 1-Click')}
                              </button>
                              <div className="flex justify-center mt-2">
                                <TonConnectButton />
                              </div>
                            </>
                          )}
                        </div>
                      ) : loading && !backendSolanaLink ? (
                        <div className="flex flex-col items-center justify-center p-4 bg-background/40 rounded-xl border-none">
                          <Loader2 className={`w-8 h-8 animate-spin mb-2 ${paymentMethod === 'solana' ? 'text-[#9945FF]' : 'text-[#0098EA]'}`} />
                          <p className="text-sm font-bold text-foreground border-none">
                            {lang === 'ar' ? 'جاري تجهيز طلب الدفع...' : 'Preparing payment request...'}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1 text-center border-none">
                            {lang === 'ar' ? 'ملاحظة: بعد إتمامك لتأكيد الدفع ارجع للتطبيق عشان تتابع اكتمال الشحن لطلبك بسهولة' : 'Note: After confirming payment, return here to track your top-up easily.'}
                          </p>
                        </div>
                      ) : backendSolanaLink ? (
                        <div className="animate-in fade-in zoom-in duration-300 border-none">
                          <a 
                            href={backendSolanaLink}
                            onClick={() => setWaitingModal(true)}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className={`flex items-center justify-center gap-2 text-white rounded-2xl py-4 sm:py-5 px-4 shadow-lg transition-all border-none focus:ring-0 outline-none w-full font-black text-base sm:text-lg ${paymentMethod === 'solana' ? 'bg-gradient-to-r from-[#9945FF] to-[#14F195] hover:opacity-90' : 'bg-[#0098EA] hover:bg-[#007BB5]'}`}
                          >
                            <Zap className="w-6 h-6 fill-white/20 shrink-0" />
                            {lang === 'ar' ? 'تأكيد الدفع بمحفظة سولانا المتاحة لديك' : 'Confirm with your Solana Wallet'}
                          </a>
                          <p className="text-[10px] text-center text-muted-foreground font-medium mt-3 px-4 border-none">
                            {lang === 'ar' ? 'بعد الضغط سيتم فتح المحفظة تلقائياً. تأكد من العودة هنا بعد الدفع.' : 'Wallet will open automatically. Return here after paying.'}
                          </p>
                        </div>
                      ) : !loading && (
                        <div className="text-sm text-foreground/80 font-bold leading-relaxed space-y-2 mt-4 border-none">
                          <p>
                            {lang === 'ar'
                              ? 'اضغط على زر تأكيد الدفع بالأسفل، وسيتم تجهيز المعاملة لك في ثوانٍ.'
                              : 'Click confirm below, and the transaction will be prepared in seconds.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {paymentMethod === 'usdt' && (usdtWallet || usdtWalletTrc20 || usdtWalletAptos) && (
                  <div className="mb-5 space-y-4 overflow-hidden border-none">
                    <div>
                      <label className="block text-sm font-bold text-foreground/80 mb-2 px-1 border-none">
                        {lang === 'ar' ? 'طريقة الدفع (USDT)' : 'USDT Payment Method'}
                      </label>
                      <div className="flex gap-2 mb-3 border-none">
                        {enabledNetworks.binance_internal && (
                          <button
                            type="button"
                            onClick={() => setUsdtNetwork('binance_internal')}
                            className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all border-none focus:ring-0 outline-none ${
                              usdtNetwork === 'binance_internal'
                                ? 'bg-primary/20 text-primary shadow-sm'
                                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                            }`}
                          >
                            Binance Pay
                          </button>
                        )}
                        {enabledNetworks.okx_internal && (
                          <button
                            type="button"
                            onClick={() => setUsdtNetwork('okx_internal')}
                            className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all border-none focus:ring-0 outline-none ${
                              usdtNetwork === 'okx_internal'
                                ? 'bg-primary/20 text-primary shadow-sm'
                                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                            }`}
                          >
                            OKX Pay
                          </button>
                        )}
                        {(enabledNetworks.bep20 || enabledNetworks.trc20 || enabledNetworks.aptos) && (
                          <button
                            type="button"
                            onClick={handleWalletsNetworkClick}
                            className={`flex-1 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all border-none focus:ring-0 outline-none ${
                              isWalletNetwork
                                ? 'bg-primary/20 text-primary shadow-sm'
                                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                            }`}
                          >
                            {lang === 'ar' ? 'محافظ رقمية' : 'Crypto Wallets'}
                          </button>
                        )}
                      </div>

                      {isWalletNetwork && (
                        <div className="bg-background/40 p-2 rounded-2xl mb-3 shadow-inner border-none animate-in fade-in zoom-in duration-200">
                          <label className="block text-[11px] font-bold text-muted-foreground mb-2 px-1 border-none text-center">
                            {lang === 'ar' ? 'اختر الشبكة' : 'Select Network'}
                          </label>
                          <div className="flex gap-2 justify-center border-none">
                            {enabledNetworks.bep20 && (
                              <button
                                type="button"
                                onClick={openBep20NetworkGuard}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-none focus:ring-0 outline-none ${
                                  usdtNetwork === 'bep20'
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
                                }`}
                              >
                                BEP20
                              </button>
                            )}
                            {enabledNetworks.trc20 && (
                              <button
                                type="button"
                                onClick={() => selectWalletNetwork('trc20')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-none focus:ring-0 outline-none ${
                                  usdtNetwork === 'trc20'
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
                                }`}
                              >
                                TRC20
                              </button>
                            )}
                            {enabledNetworks.aptos && (
                              <button
                                type="button"
                                onClick={() => selectWalletNetwork('aptos')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all border-none focus:ring-0 outline-none ${
                                  usdtNetwork === 'aptos'
                                    ? 'bg-primary text-primary-foreground shadow-sm'
                                    : 'bg-secondary/60 text-muted-foreground hover:bg-secondary'
                                }`}
                              >
                                Aptos
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-background/40 rounded-2xl p-3 sm:p-3.5 flex items-start gap-2 shadow-none border-none">
                      <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5 border-none" />
                      <div className="text-xs text-muted-foreground font-bold leading-relaxed border-none">
                        <p>
                          {lang === 'ar' ? (
                            <>
                              أرسل فقط USDT عبر <span className="text-foreground font-black border-none">
                                {usdtNetwork === 'bep20' ? 'BEP20 (BSC)' : usdtNetwork === 'trc20' ? 'TRC20 (Tron)' : usdtNetwork === 'aptos' ? 'Aptos' : usdtNetwork === 'okx_internal' ? 'التحويل الداخلي (OKX)' : 'Binance Pay'}
                              </span> إلى هذا {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? 'الحساب (Pay ID/UID)' : 'العنوان'}.
                            </>
                          ) : (
                            <>
                              Only send USDT on the <span className="text-foreground font-black border-none">
                                {usdtNetwork === 'bep20' ? 'BEP20 (BSC)' : usdtNetwork === 'trc20' ? 'TRC20 (Tron)' : usdtNetwork === 'aptos' ? 'Aptos' : usdtNetwork === 'okx_internal' ? 'OKX Internal' : 'Binance Pay'}
                              </span> network to this {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? 'Account (Pay ID/UID)' : 'address'}.
                            </>
                          )}
                        </p>
                        <div className="mt-2 rounded-2xl bg-background/40 p-3 sm:p-4 border-none shadow-none">
                          <div className="flex items-start gap-2 border-none">
                            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 border-none" />
                            <div className="text-[11px] leading-relaxed text-muted-foreground border-none space-y-2">
                              <p className="font-bold text-foreground/80">{lang === 'ar' ? 'ملاحظات سريعة' : 'Quick notes'}</p>
                              <ul className="list-disc pl-4 space-y-1">
                                <li>{lang === 'ar' ? 'تأكد من ارسال المبلغ الاجمالي بدقه كما ظاهر لديك' : 'Make sure to send the exact total amount as shown.'}</li>
                                {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? (
                                  <>
                                    <li>{lang === 'ar' ? 'تأكد من اختيار الحساب الداخلي الصحيح قبل الإرسال.' : 'Make sure you select the correct internal account before sending.'}</li>
                                    <li>{lang === 'ar' ? 'إذا كان الإرسال من داخل المنصة، اختر التحويل الداخلي مباشرة.' : 'If sending from inside the exchange, choose internal transfer directly.'}</li>
                                  </>
                                ) : (
                                  <>
                                    <li>{lang === 'ar' ? 'تأكد من الشبكة قبل الإرسال.' : 'Double-check the network before sending.'}</li>
                                    <li>{lang === 'ar' ? 'إذا كنت سترسل من Binance Pay، استخدم التحويل الداخلي من هنا.' : 'If you are sending from Binance Pay, use internal transfer here.'}</li>
                                  </>
                                )}
                              </ul>
                              {usdtNetwork === 'bep20' && (
                                <button
                                  type="button"
                                  onClick={goToBinancePayInternal}
                                  className="inline-flex text-[11px] font-bold text-foreground underline underline-offset-4 decoration-dotted hover:opacity-80 transition"
                                >
                                  {lang === 'ar' ? 'افتح Binance Pay الداخلي' : 'Open Binance Pay internal'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-muted/40 rounded-[1.5rem] p-5 border-none shadow-inner">
                      <div className="flex items-center gap-2 mb-3 border-none">
                        <Zap className="w-5 h-5 text-muted-foreground" />
                        <p className="text-sm font-bold text-foreground border-none">
                          {lang === 'ar'
                            ? `أرسل USDT (${usdtNetwork === 'bep20' ? 'BEP20' : usdtNetwork === 'trc20' ? 'TRC20' : usdtNetwork === 'aptos' ? 'Aptos' : 'Internal'}) إلى:`
                            : `Send USDT (${usdtNetwork === 'bep20' ? 'BEP20' : usdtNetwork === 'trc20' ? 'TRC20' : usdtNetwork === 'aptos' ? 'Aptos' : 'Internal'}) to:`}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 border-none">
                        <div className="flex items-center gap-2 bg-background rounded-xl p-3 shadow-sm border-none">
                          <code className="text-[11px] sm:text-xs text-foreground break-all flex-1 font-mono font-bold border-none">
                            {getAddressToCopy()}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(
                                getAddressToCopy(),
                                'wallet'
                              )
                            }
                            className="p-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition shrink-0 border-none focus:ring-0 outline-none"
                          >
                            {copied === 'wallet' ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-primary" />}
                          </button>
                        </div>

                     {usdtNetwork === 'binance_internal' && (
  <a
    href="https://app.binance.com/"
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center justify-center w-full py-3 mt-1 bg-[#FCD535] hover:bg-[#FCD535]/90 text-black font-black rounded-xl transition-all shadow-sm border-none outline-none focus:ring-0"
  >
    {lang === 'ar' ? 'افتح تطبيق Binance' : 'Open Binance App'}
  </a>
)}
                        {usdtNetwork === 'okx_internal' && (
                          <a href="okx://" className="flex items-center justify-center w-full py-3 mt-1 bg-foreground hover:bg-foreground/90 text-background font-black rounded-xl transition-all shadow-sm border-none outline-none focus:ring-0">
                            {lang === 'ar' ? 'افتح تطبيق OKX' : 'Open OKX App'}
                          </a>
                        )}
                      </div>

                      <div className="mt-4 bg-secondary rounded-[1.25rem] p-4 shadow-inner border-none overflow-hidden">
                        <div className="flex justify-between items-center gap-2 border-none">
                          <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap shrink-0 border-none">
                            {t('app.totalCost')}
                          </span>
                          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end overflow-hidden border-none">
                            <span
                              className="text-base sm:text-lg font-black text-star-gold truncate border-none"
                              dir={currency !== 'egp' ? 'ltr' : undefined}
                            >
                              {formatPaymentAmount(totalCost)} {currencyLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(formatPaymentAmount(totalCost), 'amount')}
                              className="p-1.5 rounded-lg bg-muted hover:bg-muted/80 transition shadow-sm border-none focus:ring-0 outline-none shrink-0 ml-1"
                            >
                              {copied === 'amount' ? (
                                <Check className="w-3.5 h-3.5 text-green-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="flex justify-between items-center mt-2 gap-3 border-none">
                          <span className="text-[11px] sm:text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0 border-none">
                            {lang === 'ar' ? 'الكمية المحددة' : 'Selected Quantity'}
                          </span>
                          <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap truncate border-none">
                            {actualQty.toLocaleString()} {lang === 'ar' ? 'نجمة' : 'Stars'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-5 pt-2 border-none">
                        <label className="block text-xs font-bold text-muted-foreground mb-2 border-none">
                          {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal'
                            ? (lang === 'ar' ? 'الرقم المرجعي (Internal ID / Pay ID)' : 'Reference Number (Internal ID / Pay ID)')
                            : (lang === 'ar' ? 'هاش المعاملة (TxID / TxHash)' : 'Transaction Hash (TxID / TxHash)')}
                        </label>
                        <div className="relative border-none">
                          <input
                            type="text"
                            value={txHash}
                            onChange={(e) => setTxHash(e.target.value.trim())}
                            placeholder={usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? (lang === 'ar' ? 'مثال: 123456789' : 'e.g., 123456789') : usdtNetwork === 'bep20' ? '0x...' : usdtNetwork === 'aptos' ? '0x...' : ''}
                            className={`w-full border-none focus:ring-0 outline-none rounded-[1.25rem] py-3 ltr:pl-4 rtl:pr-4 ltr:pr-12 rtl:pl-12 text-foreground transition-all font-mono text-xs shadow-inner ${
                              step2Attempted && isHashMissing
                                ? 'bg-destructive/10 placeholder:text-destructive/50 text-destructive focus:bg-destructive/20'
                                : 'bg-muted/50 focus:bg-muted text-foreground'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => handlePaste((text) => setTxHash(text.trim()))}
                            className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 p-1.5 bg-background/50 hover:bg-background/80 rounded-md transition-colors text-muted-foreground hover:text-foreground border-none outline-none focus:ring-0"
                            title={lang === 'ar' ? 'لصق' : 'Paste'}
                          >
                            <Clipboard className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {isWalletMethod && !pendingOrderId && (
                  <div className="mb-5 overflow-hidden border-none">
                    <label className="flex items-center justify-between text-sm font-bold text-foreground/80 mb-3 px-1 border-none">
                      {lang === 'ar' ? 'رقم المحفظة للدفع' : 'Wallet Number'}
                      <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-md border-none">
                        {lang === 'ar' ? '11 رقم' : '11 Digits'}
                      </span>
                    </label>
                    <div className="relative border-none">
                      <span className="absolute top-1/2 -translate-y-1/2 ltr:left-4 rtl:right-4 pointer-events-none">
                        <Phone className={`w-5 h-5 transition-colors ${phoneNumber.length === 11 ? 'text-green-500' : 'text-destructive'}`} />
                      </span>
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        placeholder="01xxxxxxxxx"
                        maxLength={11}
                        inputMode="numeric"
                        className={`w-full border-none focus:ring-0 outline-none rounded-[1.25rem] py-4 ltr:pl-12 rtl:pr-12 ltr:pr-12 rtl:pl-12 font-bold text-lg transition-all tracking-wider shadow-inner ${
                          phoneNumber.length === 11
                            ? 'bg-green-500/10 text-green-600 focus:bg-green-500/20 placeholder:text-green-600/50'
                            : 'bg-destructive/10 text-destructive focus:bg-destructive/20 placeholder:text-destructive/50'
                        }`}
                      />
                      
                      {phoneNumber.length === 11 ? (
                        <span className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 pointer-events-none">
                          <Check className="w-5 h-5 text-green-500" strokeWidth={3} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handlePaste((text) => setPhoneNumber(text.replace(/\D/g, '').slice(0, 11)))}
                          className="absolute top-1/2 -translate-y-1/2 ltr:right-4 rtl:left-4 p-1.5 bg-background/50 hover:bg-background/80 rounded-md transition-colors text-muted-foreground hover:text-foreground border-none outline-none focus:ring-0"
                          title={lang === 'ar' ? 'لصق' : 'Paste'}
                        >
                          <Clipboard className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {phoneNumber.length < 11 && (
                      <div className="mt-2 flex items-center gap-2 text-xs font-bold text-destructive px-1 animate-in fade-in slide-in-from-top-1 border-none">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{lang === 'ar' ? 'يرجى كتابة رقم محفظة صحيح (11 رقم) لتأكيد الدفع' : 'Please enter a valid 11-digit wallet number to enable payment'}</span>
                      </div>
                    )}
                  </div>
                )}

                {isWalletMethod && confirmMessage && pendingOrderId && (
                  <div className="mb-5 overflow-hidden border-none">
                    <div className="bg-primary/5 border-none rounded-[1.5rem] p-5 text-center shadow-inner">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
                      <p className="text-base font-black text-primary mb-1 border-none">
                        {lang === 'ar' ? 'في انتظار تأكيدك' : 'Awaiting Confirmation'}
                      </p>
                      <p className="text-xs font-bold text-muted-foreground leading-relaxed border-none">{confirmMessage}</p>
                    </div>
                  </div>
                )}

                {paymentMethod !== 'usdt' && paymentMethod !== 'solana' && paymentMethod !== 'ton' && (
                  <div className="bg-secondary/40 rounded-[1.5rem] p-3 sm:p-4 mb-5 border-none shadow-inner">
                    <div className="flex justify-between items-center gap-3 border-none">
                      <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap border-none">
                        {t('app.totalCost')}
                      </span>
                      <div className="flex items-center gap-2 min-w-0 border-none">
                        <span
                          className="text-base sm:text-lg font-black text-star-gold whitespace-nowrap leading-none border-none"
                          dir={currency !== 'egp' ? 'ltr' : undefined}
                        >
                          {formatPaymentAmount(totalCost)} {currencyLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-2 gap-3 border-none">
                      <span className="text-[11px] sm:text-xs font-medium text-muted-foreground whitespace-nowrap border-none">
                        {lang === 'ar' ? 'الكمية المحددة' : 'Selected Quantity'}
                      </span>
                      <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap border-none">
                        {actualQty.toLocaleString()} {lang === 'ar' ? 'نجمة' : 'Stars'}
                      </span>
                    </div>
                  </div>
                )}

                {balanceError && (
                  <div className="mb-5 overflow-hidden border-none">
                    <div className="bg-destructive/5 rounded-[1.25rem] p-4 flex flex-col items-center justify-center gap-2 text-center border-none shadow-inner">
                      <AlertCircle className="w-6 h-6 text-destructive border-none" />
                      <p className="text-sm font-black text-destructive border-none">
                        {maxAvailable && maxAvailable > 0
                          ? lang === 'ar'
                            ? `المتاح حاليا: ${maxAvailable.toLocaleString()} نجمة فقط`
                            : `Available now: ${maxAvailable.toLocaleString()} stars only`
                          : lang === 'ar'
                            ? 'الخدمة تواجه ضغط عالي حاليا'
                            : 'High demand currently'}
                      </p>
                      {maxAvailable && maxAvailable > 0 && (
                        <p className="text-xs text-destructive/80 font-bold border-none">
                          {lang === 'ar' ? 'يرجى تقليل الكمية المطلوبة' : 'Please reduce the quantity'}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {cooldownSeconds > 0 && !pendingOrderId && (
                  <div className="mb-5 bg-amber-500/10 rounded-[1.5rem] p-5 text-center shadow-inner border-none">
                    <div className="flex items-center justify-center gap-2 text-amber-600 mb-2 border-none">
                      <Clock className="w-5 h-5 animate-pulse border-none" strokeWidth={2.5} />
                      <span className="text-sm font-black border-none">{lang === 'ar' ? 'فترة حماية' : 'Protection Cooldown'}</span>
                    </div>
                    <div className="text-4xl font-black text-muted-foreground font-mono tracking-tighter my-2 border-none">
                      {formatCooldownTime(cooldownSeconds)}
                    </div>
                    <p className="text-xs text-amber-600/70 font-bold leading-relaxed px-4 border-none">
                      {lang === 'ar'
                        ? 'يرجى الانتظار لتجنب تكرار الطلبات بالخطا'
                        : 'Please wait to prevent accidental duplicate orders'}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-4 border-none">
                  <button
                    type="button"
                    onClick={goBackToStep1}
                    className="w-1/3 h-12 rounded-[1.2rem] bg-muted text-muted-foreground font-black transition-all hover:bg-muted/80 border-none focus:ring-0 outline-none"
                  >
                    {lang === 'ar' ? 'رجوع' : 'Back'}
                  </button>

                  {!(isWalletMethod && confirmMessage && pendingOrderId) && (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={
                        loading ||
                        verifying ||
                        balanceError ||
                        verifyingUser ||
                        cooldownSeconds > 0 ||
                        isPriceLoading ||
                        isExceedingMax ||
                        isFormInvalid
                      }
                      className={`relative w-2/3 h-14 sm:h-16 rounded-[1.4rem] overflow-hidden transition-all shadow-md flex items-center justify-center gap-3 border-none outline-none focus:ring-0 ${
                        isFormInvalid || isExceedingMax
                          ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                          : cooldownSeconds > 0 || balanceError || isPriceLoading
                            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                            : 'gradient-telegram text-white hover:opacity-90'
                      }`}
                    >
                      {(!isFormInvalid && !isExceedingMax) && cooldownSeconds <= 0 && !isPriceLoading && !loading && !balanceError && (
                        <div className="absolute inset-0 bg-white/20 animate-pulse mix-blend-overlay border-none" />
                      )}
                      <div className="relative z-10 flex items-center justify-center w-full h-full border-none">
                        {getButtonContent()}
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showBep20BinanceModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-md rounded-[28px] border border-border/50 bg-background p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black text-foreground">
                  {lang === 'ar' ? 'هل سترسل من Binance Pay؟' : 'Will you send from Binance Pay?'}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {lang === 'ar'
                    ? 'يظهر هذا التنبيه مرة واحدة فقط خلال هذا الشراء. اختر التحويل الداخلي إذا كان الإرسال من Binance Pay، أو تابع على BEP20 إذا كانت محفظة خارجية.'
                    : 'This prompt appears only once during this purchase. Choose internal transfer if sending from Binance Pay, or continue with BEP20 for an external wallet.'}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleBep20NetworkDecision(true)}
                className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 px-4 py-3 text-sm font-black text-primary-foreground transition hover:opacity-90 shadow-sm"
              >
                {lang === 'ar' ? 'نعم، Binance Pay الداخلي' : 'Yes, Binance Pay internal'}
              </button>
              <button
                type="button"
                onClick={() => handleBep20NetworkDecision(false)}
                className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-black text-foreground transition hover:bg-secondary/60"
              >
                {lang === 'ar' ? 'لا، محفظة خارجية' : 'No, external wallet'}
              </button>
            </div>

            <button
              type="button"
              onClick={closeBep20NetworkGuard}
              className="mt-3 w-full rounded-2xl px-4 py-2 text-xs font-bold text-muted-foreground transition hover:text-foreground"
            >
              {lang === 'ar' ? 'متابعة لاحقًا' : 'Continue later'}
            </button>
          </div>
        </div>
      )}
      <PaymentWaitingModal
        isOpen={waitingModal}
        type="stars"
        quantity={actualQty}
        username={username}
        orderId={pendingOrderId}
        paymentMethod={paymentMethod}
        status={orderStatus}
        errorMessage={modalError}
        partialMessage={confirmMessage} 
        onClose={handlePaymentClose}
        onComplete={() => {
          setWaitingModal(false);
          setOrderStatus('waiting');
          setPendingOrderId(null);
          setConfirmMessage('');
          setTxHash('');
          setTonPayment(null);
          setTonTxSending(false);
          // keep the current one-time BEP20 prompt state for this purchase
          clearWalletPreference();

          if (completedOrderRef.current) {
            onOrderSuccess(actualQty, username, completedOrderRef.current);
            completedOrderRef.current = null;
          }

          isCompletingRef.current = false;
        }}
      />
    </>
  );
};

export default PurchaseForm;
