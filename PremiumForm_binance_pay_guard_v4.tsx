                    <div className="bg-destructive/5 rounded-2xl p-4 border-none">
                      <div className="flex items-start gap-2 border-none">
                        <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5 border-none" />
                        <div className="text-xs text-destructive font-bold leading-relaxed border-none w-full">
                          {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? (
                            <>
                              <p className="text-sm font-black mb-2 border-none">{lang === 'ar' ? 'تنبيه التحويل الداخلي' : 'Internal transfer note'}</p>
                              <ul className="space-y-1 list-disc pl-4 border-none">
                                <li>{lang === 'ar' ? 'أرسل المبلغ بدقة لضمان تنفيذ الطلب.' : 'Send the exact amount to ensure the order is processed.'}</li>
                                <li>{lang === 'ar' ? 'التحويل الداخلي سريع وغالبا بلا رسوم شبكة.' : 'Internal transfer is usually instant and fee-free.'}</li>
                                <li>{lang === 'ar' ? 'إذا كنت سترسل من محفظة خارجية فابقَ على BEP20.' : 'If you are sending from an external wallet, stay on BEP20.'}</li>
                              </ul>
                              <p className="mt-2 text-[11px] leading-relaxed border-none">
                                {lang === 'ar' ? 'عند الإرسال من Binance Pay استخدم زر التحويل الداخلي فقط.' : 'When sending from Binance Pay, use the internal transfer button only.'}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-black mb-2 border-none">{lang === 'ar' ? 'تنبيه الشبكة' : 'Network note'}</p>
                              <ul className="space-y-1 list-disc pl-4 border-none">
                                <li>{lang === 'ar' ? 'أرسل USDT على الشبكة المطابقة فقط.' : 'Send USDT only on the matching network.'}</li>
                                <li>{lang === 'ar' ? 'اختيار شبكة خاطئة قد يؤدي إلى فقدان الأموال.' : 'Choosing the wrong network can lead to permanent loss of funds.'}</li>
                              </ul>
                              <p className="mt-2 text-[11px] leading-relaxed border-none">
                                {lang === 'ar' ? (
                                  <>
                                    إذا كنت سترسل من Binance Pay على العنوان، استخدم{' '}
                                    <button
                                      type="button"
                                      onClick={goToBinancePayInternal}
                                  className="font-black text-primary underline underline-offset-4 decoration-2 hover:opacity-80 transition"
                                    >
                                      طريقة الدفع Binance Pay الداخلي من هنا
                                    </button>
                                    .
                                  </>
                                ) : (
                                  <>
                                    If you are sending from Binance Pay to this address, use{' '}
                                    <button
                                      type="button"
                                      onClick={goToBinancePayInternal}
                                  className="font-black text-primary underline underline-offset-4 decoration-2 hover:opacity-80 transition"
                                    >
                                      Binance Pay internal transfer here
                                    </button>
                                    .
                                  </>
                                )}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import PaymentWaitingModal from './PaymentWaitingModal';
import type { PaymentModalStatus } from './PaymentWaitingModal';
import {
  Crown,
  Copy,
  Check,
  Loader2,
  UserCheck,
  Clock,
  AlertCircle,
  Info,
  Phone,
  Zap,
  Clipboard
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { AnimatePresence, motion } from 'framer-motion';

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
type PremiumDuration = 3 | 6 | 12;
type ModalStatus = 'waiting' | 'processing' | 'completed' | 'failed';

interface TonPaymentData {
  to: string;
  amount_usdt: number;
  amount_units: string;
  jetton_master: string;
  comment: string;
}

interface PremiumFormProps {
  onOrderSuccess: (months: number, username: string, orderId?: string) => void;
}

const PREMIUM_DURATIONS: PremiumDuration[] = [3, 6, 12];
const COOLDOWN_TIME = 130;
// أرقام UID الثابتة
const OKX_UID = '376335861018725858';
const BINANCE_UID = '266940142';

const PremiumForm = ({ onOrderSuccess }: PremiumFormProps) => {
  const { t, lang } = useLanguage();

  const [username, setUsername] = useState('');
  const [debouncedUsername, setDebouncedUsername] = useState('');
  const [months, setMonths] = useState<PremiumDuration>(3);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('vf_cash');
  const [paymentTab, setPaymentTab] = useState<'local' | 'global'>('local');
  const [currency, setCurrency] = useState<Currency>('egp');
  const [fulfillmentProvider, setFulfillmentProvider] = useState<'fragment' | 'istar'>('fragment');
  const [fragmentCurrency, setFragmentCurrency] = useState<'ton' | 'usdt_ton'>('ton');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [step1Attempted, setStep1Attempted] = useState(false);
  const [step2Attempted, setStep2Attempted] = useState(false);

  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [showUserGuide, setShowUserGuide] = useState(false);

  const [pricesUsd, setPricesUsd] = useState<Record<PremiumDuration, number>>({
    3: 8.99,
    6: 15.99,
    12: 27.99,
  });

  const [pricesEgp, setPricesEgp] = useState<Record<PremiumDuration, number>>({
    3: 450,
    6: 800,
    12: 1400,
  });

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
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [backendSolanaLink, setBackendSolanaLink] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [waitingModal, setWaitingModal] = useState(false);
  const [orderStatus, setOrderStatus] = useState<ModalStatus>('waiting');

  const [modalError, setModalError] = useState<string | null>(null);
  const [modalErrorCode, setModalErrorCode] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [telegramName, setTelegramName] = useState<string | null>(null);
  const [telegramPhoto, setTelegramPhoto] = useState<string | null>(null);
  const [verifyingUser, setVerifyingUser] = useState(false);
  const [userVerifyError, setUserVerifyError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [hasPremium, setHasPremium] = useState(false);

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
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);

  const [blockedDurations, setBlockedDurations] = useState<Record<PremiumDuration, boolean>>({
    3: false,
    6: false,
    12: false,
  });

  // ✅ أسعار تنفيذ Fragment الفعلية في مسار USDT-TON تأتي من check-balance
  // check-balance يجلبها من Fragment /misc/prices ويضيف 1% رسوم API.
  // الواجهة تستخدمها للعرض وإنشاء الطلب بدل أسعار settings القديمة عند تفعيل Fragment + usdt_ton.
  const [fragmentUsdPlanCosts, setFragmentUsdPlanCosts] = useState<Record<PremiumDuration, number | null>>({
    3: null,
    6: null,
    12: null,
  });

  const [cryptoFraction, setCryptoFraction] = useState(0);

  const channelRef = useRef<any>(null);
  const pokeIntervalRef = useRef<any>(null);
  const isCompletingRef = useRef(false);
  const completedOrderRef = useRef<string | null>(null);
  const completedDataRef = useRef<{ qty: number; user: string; oid: string } | null>(null);

  // ✅ Performance caches: تقلل تكرار طلبات الشبكة بدون تغيير منطق الدفع أو التحقق
  const telegramVerifyCacheRef = useRef<Record<string, {
    name: string;
    photo: string | null;
    hasPremium: boolean;
    expiresAt: number;
  }>>({});
  const tonUsdPriceCacheRef = useRef<{ price: number; expiresAt: number } | null>(null);

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
    try {
      const lastAttempt = localStorage.getItem('last_premium_order_time');
      if (lastAttempt) {
        const secondsPassed = Math.floor((Date.now() - parseInt(lastAttempt, 10)) / 1000);
        if (secondsPassed < COOLDOWN_TIME) {
          setCooldownSeconds(COOLDOWN_TIME - secondsPassed);
        }
      }
    } catch {
      // ignore
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
    try {
      const now = Date.now();
      localStorage.setItem('last_premium_order_time', now.toString());
      setCooldownSeconds(COOLDOWN_TIME);
    } catch {
      // ignore
    }
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
          // لو الحقول الجديدة غير موجودة سيظل المسار القديم يعمل بنفس أسعار premium_*_usd الحالية.
          setPricesUsd({
            3: Number(isFragmentUsdtTon ? ((data as any).fragment_premium_3m_usd ?? (data as any).premium_3m_usd) : (data as any).premium_3m_usd) || 8.99,
            6: Number(isFragmentUsdtTon ? ((data as any).fragment_premium_6m_usd ?? (data as any).premium_6m_usd) : (data as any).premium_6m_usd) || 15.99,
            12: Number(isFragmentUsdtTon ? ((data as any).fragment_premium_12m_usd ?? (data as any).premium_12m_usd) : (data as any).premium_12m_usd) || 27.99,
          });

          setPricesEgp({
            3: Number((data as any).premium_3m_egp) || 450,
            6: Number((data as any).premium_6m_egp) || 800,
            12: Number((data as any).premium_12m_egp) || 1400,
          });

          setUsdtWallet((data as any).usdt_wallet_address || '');
          setUsdtWalletTrc20((data as any).usdt_wallet_address_trc20 || '');
          setUsdtWalletAptos((data as any).usdt_wallet_address_aptos || '');
          setUsdtWalletSolana((data as any).usdt_wallet_address_solana || '');
          setUsdtWalletTon((data as any).usdt_wallet_address_ton || '');
          setInstapayLink((data as any).instapay_link || 'https://ipn.eg/S/sallaweb3/instapay/36kZ1k');

          setEnabledNetworks({
            bep20: String((data as any).pay_usdt_bep20_enabled) !== 'false',
            trc20: String((data as any).pay_usdt_trc20_enabled) !== 'false',
            aptos: String((data as any).pay_usdt_aptos_enabled) !== 'false',
            okx_internal: true,
            binance_internal: true,
          });

          setEnabledPayments({
            vf_cash: String((data as any).pay_vf_cash_enabled) !== 'false',
            or_cash: String((data as any).pay_or_cash_enabled) !== 'false',
            et_cash: String((data as any).pay_et_cash_enabled) !== 'false',
            usdt: String((data as any).pay_usdt_enabled) !== 'false',
            solana: (data as any).pay_solana_usdt_enabled ?? false,
            ton: (data as any).pay_ton_usdt_enabled ?? false,
            pi: (data as any).pay_pi_enabled ?? false,
            st: (data as any).pay_st_enabled ?? false,
            instapay: (data as any).pay_instapay_enabled ?? false,
          });

          setPiPrice(Number((data as any).pi_price_usd) || null);
          setStRate(Number((data as any).st_rate_pi) || null);
        }
      } catch {
        // ignore
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
        // ignore
      }
    };

    const fetchStRate = async () => {
      try {
        const { data } = await supabase.functions.invoke('st-rate');
        if (data?.success && data?.rate && mounted) setStRate(Number(data.rate));
      } catch {
        // ignore
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

  const isWalletMethod = ['vf_cash', 'or_cash', 'et_cash'].includes(paymentMethod);
  const isUsernameMissing = !username.trim();
  const isPhoneMissing = isWalletMethod && phoneNumber.length < 11;
  const isHashMissing = paymentMethod === 'usdt' && !txHash.trim();
  const isInstapayRefMissing = paymentMethod === 'instapay' && instapayRef.length < 12;
  const isPremiumBlocked = hasPremium;
  const currentPlanBlocked = blockedDurations[months];
  
  const canProceedToStep2 = !isPriceLoading && !!telegramName && !verifyingUser && !userVerifyError && !isUsernameMissing && !isPremiumBlocked && !currentPlanBlocked;
  
  const isFormInvalid = isUsernameMissing || isPhoneMissing || isHashMissing || isInstapayRefMissing || !!userVerifyError || !telegramName;

  useEffect(() => {
    if (paymentMethod === 'usdt') {
      const cacheKey = `salla_fraction_premium_${months}`;
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        try {
          const { fraction, timestamp } = JSON.parse(cachedData);
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
          if (Date.now() - timestamp < TWENTY_FOUR_HOURS) {
            setCryptoFraction(fraction);
            return;
          }
        } catch {
          // ignore
        }
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
  }, [months, paymentMethod]);

  const isFragmentUsdtTonActive = useMemo(
    () => fulfillmentProvider === 'fragment' && fragmentCurrency === 'usdt_ton',
    [fulfillmentProvider, fragmentCurrency]
  );

  const getEffectiveUsdPlanPrice = useCallback(
    (plan: PremiumDuration) => {
      const backendCost = fragmentUsdPlanCosts[plan];

      if (
        isFragmentUsdtTonActive &&
        Number.isFinite(Number(backendCost)) &&
        Number(backendCost) > 0
      ) {
        return Number(backendCost);
      }

      return Number(pricesUsd[plan]) || 0;
    },
    [fragmentUsdPlanCosts, isFragmentUsdtTonActive, pricesUsd]
  );

  const priceUsd = useMemo(() => getEffectiveUsdPlanPrice(months), [getEffectiveUsdPlanPrice, months]);
  const priceEgp = useMemo(() => pricesEgp[months], [pricesEgp, months]);

  const getPiTotal = useCallback(() => {
    if (!piPrice || piPrice <= 0) return 0;
    return priceUsd / piPrice;
  }, [piPrice, priceUsd]);

  const getStTotal = useCallback(() => {
    if (!piPrice || piPrice <= 0 || !stRate || stRate <= 0) return 0;
    const costInPi = priceUsd / piPrice;
    return costInPi / stRate;
  }, [piPrice, priceUsd, stRate]);

  const baseTotalCost = useMemo(() => {
    if (currency === 'pi') return getPiTotal();
    if (currency === 'st') return getStTotal();
    if (currency === 'egp') return priceEgp;
    return priceUsd;
  }, [currency, getPiTotal, getStTotal, priceEgp, priceUsd]);

  // 🚀 استثناء OKX Pay و Binance Pay من كسور الأمان
  const isInternalUsdtTransfer = useMemo(
    () => usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal',
    [usdtNetwork]
  );
  const totalCost = useMemo(
    () => (paymentMethod === 'usdt' && !isInternalUsdtTransfer ? baseTotalCost + cryptoFraction : baseTotalCost),
    [baseTotalCost, cryptoFraction, isInternalUsdtTransfer, paymentMethod]
  );

  const buildBalanceCheckBody = useCallback((payload: Record<string, unknown>) => ({
    ...payload,
    fulfillment_provider: fulfillmentProvider,
    fragment_currency: fragmentCurrency,
    frontend_fulfillment_provider: fulfillmentProvider,
    frontend_fragment_currency: fragmentCurrency,
  }), [fulfillmentProvider, fragmentCurrency]);

  const describeBalanceFailure = useCallback((balCheck: any) => {
    const isUsdtFragmentBalance =
      balCheck?.display_currency === 'USDT' ||
      balCheck?.fragment_currency === 'usdt_ton';

    const balance = Number(isUsdtFragmentBalance ? (balCheck?.balance_usdt ?? balCheck?.balance ?? 0) : (balCheck?.balance_ton ?? balCheck?.balance ?? 0));
    const required = Number(isUsdtFragmentBalance ? (balCheck?.actual_cost_usd ?? 0) : (balCheck?.actual_cost_ton ?? 0));
    const symbol = isUsdtFragmentBalance ? 'USDT' : 'TON';

    if (balance > 0 && required > 0) {
      return lang === 'ar'
        ? `الخطة الحالية تحتاج ${required.toFixed(4)} ${symbol} والمتاح ${balance.toFixed(4)} ${symbol}`
        : `Current plan requires ${required.toFixed(4)} ${symbol}; available ${balance.toFixed(4)} ${symbol}`;
    }

    return lang === 'ar' ? 'اختر خطة أقل حاليا' : 'Choose a lower plan currently';
  }, [lang]);

  useEffect(() => {
    let cancelled = false;

    const checkPresetsAvailability = async () => {
      if (isPriceLoading) return;

      try {
        // ✅ أسرع من التنفيذ المتسلسل: فحص الخطط الثلاثة بالتوازي مع نفس المنطق والردود
        const results = await Promise.all(
          PREMIUM_DURATIONS.map(async (preset) => {
            try {
              const { data } = await supabase.functions.invoke('check-balance', {
                body: buildBalanceCheckBody({ type: 'premium', months: preset }),
              });

              return { preset, data, error: null as unknown };
            } catch (error) {
              console.error(`Error checking premium duration ${preset}:`, error);
              return { preset, data: null, error };
            }
          })
        );

        if (cancelled) return;

        const nextBlocked: Record<PremiumDuration, boolean> = { 3: false, 6: false, 12: false };
        const fragmentCostUpdates: Partial<Record<PremiumDuration, number>> = {};

        for (const result of results) {
          nextBlocked[result.preset] = !!(result.data && !result.data.sufficient);

          // ✅ في مسار Fragment + USDT-TON، السعر الصحيح يأتي من check-balance:
          // actual_cost_usd = سعر Fragment من /misc/prices + 1% رسوم API.
          if (
            result.data?.provider === 'fragment' &&
            result.data?.fragment_currency === 'usdt_ton' &&
            Number(result.data?.actual_cost_usd) > 0
          ) {
            fragmentCostUpdates[result.preset] = Number(result.data.actual_cost_usd);
          }
        }

        setBlockedDurations(nextBlocked);
        if (Object.keys(fragmentCostUpdates).length > 0) {
          setFragmentUsdPlanCosts((prev) => ({ ...prev, ...fragmentCostUpdates }));
        }
      } catch {
        if (!cancelled) setBlockedDurations({ 3: false, 6: false, 12: false });
      }
    };

    checkPresetsAvailability();

    return () => {
      cancelled = true;
    };
  }, [isPriceLoading, buildBalanceCheckBody]);

  // تعيين التبويب وطريقة الدفع الافتراضية
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
  }, [months]);

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
      setHasPremium(false);
      return;
    }

    const cacheKey = debouncedUsername.toLowerCase();
    const cachedUser = telegramVerifyCacheRef.current[cacheKey];
    if (cachedUser && cachedUser.expiresAt > Date.now()) {
      setTelegramName(cachedUser.name);
      setTelegramPhoto(cachedUser.photo);
      setHasPremium(cachedUser.hasPremium);
      setUserVerifyError(null);
      setVerifyingUser(false);
      return;
    }

    setVerifyingUser(true);
    setTelegramName(null);
    setTelegramPhoto(null);
    setUserVerifyError(null);
    setHasPremium(false);

    let cancelled = false;

    const verifyUser = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('verify-telegram-user', {
          body: { username: debouncedUsername, type: 'premium', months: 3 },
        });

        if (cancelled) return;
        if (error) throw error;

        let responseData = data;
        if (typeof data === 'string') {
          try {
            responseData = JSON.parse(data);
          } catch {
            // ignore
          }
        }

        if (responseData?.name && (responseData?.success || responseData?.username)) {
          const nextPhoto = responseData.photo || null;
          const nextHasPremium = responseData.has_premium || false;
          setTelegramName(responseData.name);
          setTelegramPhoto(nextPhoto);
          setHasPremium(nextHasPremium);
          telegramVerifyCacheRef.current[cacheKey] = {
            name: responseData.name,
            photo: nextPhoto,
            hasPremium: nextHasPremium,
            expiresAt: Date.now() + 5 * 60 * 1000,
          };
          setUserVerifyError(null);
        } else {
          setTelegramName(null);
          setTelegramPhoto(null);
          setHasPremium(false);

          let backendErr = responseData?.error;
          if (backendErr === 'المستخدم غير موجود' || backendErr === 'User not found' || backendErr === 'Not found') {
            backendErr = lang === 'ar' ? 'المستخدم غير موجود' : 'User not found';
          }
          
          setUserVerifyError(backendErr || (lang === 'ar' ? 'المستخدم غير موجود' : 'User not found'));
        }
      } catch {
        if (cancelled) return;
        setTelegramName(null);
        setTelegramPhoto(null);
        setHasPremium(false);
        setUserVerifyError(lang === 'ar' ? 'المستخدم غير موجود أو خطأ في البحث' : 'User not found or search error');
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

  const currencyLabel = currency === 'egp'
      ? lang === 'ar'
        ? 'جنيه'
        : 'EGP'
      : currency === 'pi'
        ? 'Pi'
        : currency === 'st'
          ? 'ST'
          : 'USDT';

  const planCurrencyLabel = currency === 'egp' ? 'ج.م' : currency === 'pi' ? 'Pi' : currency === 'st' ? 'ST' : '$';
  const decimals = currency === 'pi' || currency === 'st' ? 4 : paymentMethod === 'usdt' || paymentMethod === 'solana' || paymentMethod === 'ton' ? 4 : 2;

  const formatPlanPrice = useCallback((plan: PremiumDuration) => {
    if (currency === 'pi') {
      if (!piPrice || piPrice <= 0) return 0;
      return getEffectiveUsdPlanPrice(plan) / piPrice;
    }

    if (currency === 'st') {
      if (!piPrice || piPrice <= 0 || !stRate || stRate <= 0) return 0;
      const costInPi = getEffectiveUsdPlanPrice(plan) / piPrice;
      return costInPi / stRate;
    }

    if (currency === 'egp') return pricesEgp[plan];
    return getEffectiveUsdPlanPrice(plan);
  }, [currency, getEffectiveUsdPlanPrice, piPrice, pricesEgp, stRate]);

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
      setModalErrorCode(null);

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
    (m: number, user: string, oId?: string) => {
      const oid = oId || pendingOrderId || '';

      if (isCompletingRef.current || (oid && completedOrderRef.current === oid)) return;

      isCompletingRef.current = true;
      completedOrderRef.current = oid || null;
      completedDataRef.current = { qty: m, user, oid };

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
    setModalError(null);
    setModalErrorCode(null);
    setTonTxSending(false);
    // keep the current one-time BEP20 prompt state for this purchase
    isCompletingRef.current = false;
    completedOrderRef.current = null;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
  };

  const pollOrderUntilDone = (orderId: string, m: number, user: string) => {
    setWaitingModal(true);
    setOrderStatus('waiting');

    const pollInterval = setInterval(async () => {
      try {
        const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).single();

        if (order?.status === 'paid' || order?.status === 'processing' || order?.status === 'blockchain_sent' || order?.status === 'BLOCKCHAIN_SENT') {
          setOrderStatus('processing');
        } else if (order?.status === 'completed') {
          clearInterval(pollInterval);
          handleOrderComplete(m, user, orderId);
        } else if (order?.status === 'failed') {
          clearInterval(pollInterval);
          setWaitingModal(false);
          setOrderStatus('waiting');
          toast.error(lang === 'ar' ? 'فشل الطلب' : 'Order failed');
        } else if (order?.status === 'pending_review') {
          clearInterval(pollInterval);
          setWaitingModal(false);
          setOrderStatus('waiting');
          toast.info(
            lang === 'ar'
              ? 'تم استلام دفعتك وجاري مراجعة طلبك يدويا - سيتم التفعيل قريبا'
              : 'Payment received - your order is under manual review and will be activated soon'
          );
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(pollInterval);
      setWaitingModal(false);
      setOrderStatus('waiting');
    }, 600000);
  };

  useEffect(() => {
    if (!pendingOrderId) return;

    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase
      .channel(`premium-status-${pendingOrderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${pendingOrderId}` },
        (payload) => {
          const status = (payload.new as any)?.status;
          const eventOrderId = (payload.new as any)?.id as string;

          if (status === 'paid' || status === 'processing' || status === 'blockchain_sent' || status === 'BLOCKCHAIN_SENT') {
            setOrderStatus('processing');
          } else if (status === 'completed') {
            handleOrderComplete(months, username, eventOrderId);
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
  }, [pendingOrderId, months, username, lang, handleOrderComplete]);


  const getTonUsdPrice = useCallback(async () => {
    const cached = tonUsdPriceCacheRef.current;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.price;
    }

    try {
      const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=TON-USDT');
      const data = await res.json();
      const price = Number(data?.data?.[0]?.last);

      if (Number.isFinite(price) && price > 0) {
        tonUsdPriceCacheRef.current = { price, expiresAt: Date.now() + 30 * 1000 };
        return price;
      }
    } catch {}

    // fallback احتياطي لو فشل جلب السعر
    return 2;
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


  const getTonUsdtUnits = (payment: TonPaymentData) => {
    const rawUnits = String(payment.amount_units || '').trim();

    // السيرفر الصحيح بيرجع وحدات USDT بأصغر وحدة: 17.7 USDT = 17700000
    if (/^\d+$/.test(rawUnits)) {
      return BigInt(rawUnits);
    }

    // حماية إضافية لو السيرفر رجع رقم عشري مثل 17.7000 بدل الوحدات
    const amount = Number(payment.amount_usdt || rawUnits);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        lang === 'ar'
          ? 'قيمة USDT غير صحيحة من السيرفر'
          : 'Invalid USDT amount from server'
      );
    }

    return BigInt(Math.round(amount * 1_000_000));
  };

  const toSafeTonNano = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        lang === 'ar'
          ? 'قيمة رسوم TON غير صحيحة'
          : 'Invalid TON fee amount'
      );
    }

    // مهم: يمنع أرقام JavaScript العشرية الطويلة التي تسبب Invalid number
    return toNano(amount.toFixed(9));
  };

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
        .storeCoins(getTonUsdtUnits(tonPayment)) // مبلغ USDT بـ 6 decimals
        .storeAddress(Address.parse(tonPayment.to)) // عنوان استلام USDT الخاص بك
        .storeAddress(Address.parse(tonAddress)) // عنوان المستخدم للرد
        .storeBit(0) // no custom_payload
        .storeCoins(toSafeTonNano(forwardTon)) // forward TON لإرسال المذكرة
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
            amount: toSafeTonNano(safeTon).toString(),

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

  const paymentMethodIcons: Record<string, any> = useMemo(() => ({
    vf_cash: vodafoneCashImg,
    or_cash: orangeCashImg,
    et_cash: etisalatCashImg,
    usdt: usdtImg,
    solana: usdtImg, 
    ton: usdtImg,
    pi: piImg,
    st: sallaTokenImg,
    instapay: instapayImg,
  }), []);

  const paymentMethods = useMemo(() => [
    { id: 'instapay' as const, label: lang === 'ar' ? 'انستا باي' : 'InstaPay', currency: 'egp' as Currency },
    { id: 'vf_cash' as const, label: lang === 'ar' ? 'فودافون كاش' : 'Vodafone Cash', currency: 'egp' as Currency },
    { id: 'or_cash' as const, label: lang === 'ar' ? 'أورانج كاش' : 'Orange Cash', currency: 'egp' as Currency },
    { id: 'et_cash' as const, label: lang === 'ar' ? 'اتصالات كاش' : 'Etisalat Cash', currency: 'egp' as Currency },
    { id: 'usdt' as const, label: 'USDT', currency: 'usd' as Currency },
    { id: 'solana' as const, label: lang === 'ar' ? 'محفظة سولانا' : 'Solana Wallet', subtitle: 'Fast & Secure', currency: 'usd' as Currency },
    { id: 'ton' as const, label: lang === 'ar' ? 'محفظة تليجرام Web3' : 'Telegram wallet web3', subtitle: 'USDT TON Network', currency: 'usd' as Currency },
    { id: 'pi' as const, label: 'Pi Network', subtitle: 'SallaNet Pay', currency: 'pi' as Currency },
    { id: 'st' as const, label: 'Salla Token (ST)', subtitle: 'SallaNet Pay', currency: 'st' as Currency },
  ].filter((pm) => enabledPayments[pm.id as keyof typeof enabledPayments]), [enabledPayments, lang]);

  const handlePaymentSelect = useCallback((method: PaymentMethod) => {
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
    setModalErrorCode(null);
    completedOrderRef.current = null;
    isCompletingRef.current = false;
    setStep2Attempted(false);
    setTonTxSending(false);

    if (pokeIntervalRef.current) {
      clearInterval(pokeIntervalRef.current);
      pokeIntervalRef.current = null;
    }
  }, [paymentMethods]);

  const handleTabChange = useCallback((tab: 'local' | 'global') => {
    if (paymentTab === tab) return;
    setPaymentTab(tab);

    const visible = paymentMethods.filter((pm) => tab === 'local' ? pm.currency === 'egp' : pm.currency !== 'egp');
    if (visible.length > 0) {
      handlePaymentSelect(visible[0].id);

      if (tab === 'global' && visible[0].id === 'usdt' && (usdtNetwork === 'binance_internal' || usdtNetwork === 'okx_internal')) {
        setUsdtNetwork(resolveWalletNetwork());
      }
    }
  }, [handlePaymentSelect, paymentMethods, paymentTab, resolveWalletNetwork, usdtNetwork]);

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

  const durationLabels: Record<PremiumDuration, { ar: string; en: string }> = {
    3: { ar: '3 اشهر', en: '3 Months' },
    6: { ar: '6 اشهر', en: '6 Months' },
    12: { ar: '12 شهر', en: '12 Months' },
  };

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

    if (!canProceedToStep2 || isPriceLoading || isFormInvalid) return;
    if (cooldownSeconds > 0) return;

    if (isPremiumBlocked) {
      toast.error(lang === 'ar' ? 'لا يمكن الشحن لان الحساب لديه اشتراك بريميوم فعال بالفعل' : 'Cannot proceed: user already has active Premium');
      return;
    }

    if (currentPlanBlocked) {
      toast.error(lang === 'ar' ? 'هذه الخطة غير متاحة حاليا' : 'This plan is unavailable right now');
      return;
    }

    if (paymentMethod === 'usdt' && !txHash.trim()) {
      toast.error(lang === 'ar' ? 'أدخل هاش المعاملة' : 'Enter transaction hash');
      return;
    }

    if (['vf_cash', 'or_cash', 'et_cash'].includes(paymentMethod) && phoneNumber.length < 11) {
      toast.error(lang === 'ar' ? 'أدخل رقم المحفظة بالكامل' : 'Enter a complete wallet phone number');
      return;
    }

    if (paymentMethod === 'instapay' && instapayRef.length < 12) {
      toast.error(lang === 'ar' ? 'أدخل الرقم المرجعي المكون من 12 رقم' : 'Enter the 12-digit reference number');
      return;
    }

    setBalanceError(false);
    completedOrderRef.current = null;
    isCompletingRef.current = false;

    // ===================================
    // ✅ مسار دفع USDT التقليدي
    // ===================================
    if (paymentMethod === 'usdt') {
      setLoading(true);
      setVerifying(true);
      setWaitingModal(true);
      setOrderStatus('waiting');
      setModalError(null);
      setModalErrorCode(null);

      try {
        const cleanUser = username.replace('@', '').trim();

        const { data: balCheck } = await supabase.functions.invoke('check-balance', {
          body: buildBalanceCheckBody({ type: 'premium', months, username: cleanUser }),
        });

        if (balCheck && !balCheck.sufficient) {
          setBalanceError(true);
          toast.error(describeBalanceFailure(balCheck));
          setWaitingModal(false);
          setLoading(false);
          return;
        }

        const { data: orderData, error: orderError } = await supabase.functions.invoke('create-premium-order', {
          body: {
            username: cleanUser,
            months,
            payment_method: paymentMethod,
            currency,
            total_cost: totalCost,
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
          let errCode = null;

          try {
            const errorString = typeof verifyError === 'string' ? verifyError : (verifyError as any).message || '{}';
            const parsed = JSON.parse(errorString);
            errorMsg = parsed?.message || parsed?.error || errorMsg;
            if (parsed?.code) errCode = parsed.code;
          } catch {
            const errObj = verifyError as any;
            if (errObj?.message && !errObj.message.includes('Unexpected token') && !errObj.message.includes('JSON')) {
              errorMsg = errObj.message;
            } else if (errObj?.error) {
              errorMsg = errObj.error;
            }
          }

          setModalError(errorMsg);
          setModalErrorCode(errCode);
          setOrderStatus('failed');
          return;
        }

        if (verifyData?.verified) {
          setOrderStatus('processing');
          toast.success(lang === 'ar' ? 'تم التحقق! جاري التفعيل... ✅' : 'Verified! Activating... ✅');
          pollOrderUntilDone(newOrderId, months, username);
          startCooldown();
        } else {
          setOrderStatus('failed');
          setModalError(verifyData?.message || verifyData?.error || (lang === 'ar' ? 'فشل التحقق' : 'Verification failed'));
          if (verifyData?.code) setModalErrorCode(verifyData.code);
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
    // ✅ مسار دفع Web3 (سولانا و TON) للبريميوم
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
      setModalErrorCode(null);
      setBackendSolanaLink(null);
      setTonPayment(null);

      try {
        const cleanUser = username.replace('@', '').trim();

        const { data: balCheck } = await supabase.functions.invoke('check-balance', {
          body: buildBalanceCheckBody({ type: 'premium', months, username: cleanUser }),
        });

        if (balCheck && !balCheck.sufficient) {
          setBalanceError(true);
          toast.error(describeBalanceFailure(balCheck));
          setLoading(false);
          return;
        }

        const { data: orderData, error: orderError } = await supabase.functions.invoke('create-premium-order', {
          body: {
            username: cleanUser,
            months,
            payment_method: paymentMethod, // سيرسل solana أو ton
            currency: 'usd',
            total_cost: totalCost,
            user_id: userId,
          },
        });

        if (orderError || orderData?.error) throw new Error(orderData?.error || orderError?.message);

        if (paymentMethod === 'ton') {
          const generatedTonPayment = orderData.ton_payment as TonPaymentData | undefined;

          // تأكد من أن السيرفر يُرجع ton_payment عند اختيار TON
          if (!generatedTonPayment) {
            throw new Error('السيرفر لم يقم بإرجاع بيانات دفع TON - يرجى تحديث دالة السيرفر');
          }

          setPendingOrderId(orderData.order_id);
          setTonPayment(generatedTonPayment);
          setBackendSolanaLink(null);
        } else {
          const generatedLink = orderData?.solana_pay_link;

          if (!generatedLink) {
            throw new Error('السيرفر لم يقم بإرجاع رابط الدفع');
          }

          setPendingOrderId(orderData.order_id);
          setBackendSolanaLink(generatedLink);
          setTonPayment(null);
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
        body: buildBalanceCheckBody({ type: 'premium', months, username: cleanUser }),
      });

      if (balCheck && !balCheck.sufficient) {
        setBalanceError(true);
        toast.error(describeBalanceFailure(balCheck));
        setLoading(false);
        return;
      }

      if (paymentMethod === 'pi' || paymentMethod === 'st') {
        const { data, error } = await supabase.functions.invoke('salla-checkout', {
          body: {
            username: cleanUser,
            months,
            payment_method: paymentMethod,
            currency: paymentMethod,
            total_cost: totalCost,
            user_id: userId,
            type: 'premium',
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

      let currentOrderId = pendingOrderId;

      if (!currentOrderId) {
        const { data, error } = await supabase.functions.invoke('create-premium-order', {
          body: {
            username: cleanUser,
            months,
            payment_method: paymentMethod,
            currency,
            total_cost: totalCost,
            phone_number: phoneNumber,
            payment_ref: paymentMethod === 'instapay' ? instapayRef : undefined,
            user_id: userId,
          },
        });

        if (error || data?.error) {
          const errorMsg = data?.error || (error as any)?.message || (lang === 'ar' ? 'فشل إنشاء الطلب' : 'Failed to create order');
          setModalError(errorMsg);
          setOrderStatus('failed');
          setWaitingModal(true);
          setLoading(false);
          return;
        }

        currentOrderId = data.order_id;
        setPendingOrderId(currentOrderId);

        if (['vf_cash', 'or_cash', 'et_cash'].includes(paymentMethod)) {
          const refCode = data?.reference || data?.ref_code || data?.payment_ref || null;
          startWalletConfirmationPolling(
            refCode,
            data?.confirm_message ||
              (lang === 'ar'
                ? 'في انتظار تأكيد العميل داخل تطبيق المحفظة...'
                : 'Waiting for customer confirmation in wallet app...')
          );
          startCooldown();
          setLoading(false);
          return;
        } else if (paymentMethod === 'instapay') {
          setConfirmMessage(lang === 'ar' ? 'جاري التحقق من التحويل البنكي عبر انستا باي...' : 'Verifying InstaPay bank transfer...');
          setWaitingModal(true);
          
          if (data?.status === 'processing' || data?.status === 'paid') {
            setOrderStatus('processing');
            pollOrderUntilDone(currentOrderId, months, username);
          } else {
            setOrderStatus('waiting');
          }
          
          startCooldown();
          setLoading(false);
          return;
        } else if (data?.confirm_message && paymentMethod !== 'usdt') {
          setConfirmMessage(data.confirm_message);
          setWaitingModal(true);
          setOrderStatus('waiting');
          toast.info(data.confirm_message);
          startCooldown();
          setLoading(false);
          return;
        }
      }
    } catch (err: any) {
      setWaitingModal(false);
      setOrderStatus('waiting');
      toast.error(err?.message || (lang === 'ar' ? 'حدث خطأ، حاول مرة أخرى' : 'An error occurred, please try again'));
    } finally {
      setLoading(false);
      setVerifying(false);
    }
  };

  const getButtonContent = () => {
    if (isPremiumBlocked) {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-1">
          <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
          <span className="text-sm sm:text-base truncate">
            {lang === 'ar' ? 'الحساب لديه بريميوم فعال' : 'Active Premium Account'}
          </span>
        </div>
      );
    }

    if (currentPlanBlocked) {
      return (
        <div className="flex items-center justify-center gap-1.5 w-full px-1">
          <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
          <span className="text-sm sm:text-base truncate">
            {lang === 'ar' ? 'هذه الخطة غير متاحة حاليا' : 'Plan unavailable right now'}
          </span>
        </div>
      );
    }

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

    if (isUsernameMissing) return lang === 'ar' ? 'أدخل اسم المستخدم أولا' : 'Enter username first';
    if (isPhoneMissing) return lang === 'ar' ? 'أدخل رقم المحفظة' : 'Enter wallet number';
    if (isHashMissing) return lang === 'ar' ? 'أدخل هاش المعاملة' : 'Enter transaction hash';
    if (isInstapayRefMissing) return lang === 'ar' ? 'أدخل الرقم المرجعي' : 'Enter reference number';

    if (paymentMethod === 'solana') {
      return (
        <div className="flex items-center justify-center gap-2 w-full px-2">
          <Zap className="w-5 h-5 text-white/90 shrink-0" fill="currentColor" />
          <span className="font-bold truncate text-base sm:text-lg">
            {lang === 'ar' ? 'تأكيد الدفع (Solana)' : 'Confirm (Solana)'}
          </span>
        </div>
      );
    }

    if (paymentMethod === 'ton') {
      return (
        <div className="flex items-center justify-center gap-2 w-full px-2">
          <Zap className="w-5 h-5 text-white/90 shrink-0" fill="currentColor" />
          <span className="font-bold truncate text-base sm:text-lg">
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
            <Crown className="w-7 h-7 text-star-gold" strokeWidth={2.5} />
          </div>
          <h3 className="text-2xl font-black text-foreground">
            {lang === 'ar' ? 'تليجرام المميز' : 'Telegram Premium'}
          </h3>
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
              <button type="button" onClick={() => (canProceedToStep2 ? setActiveStep(2) : validateStep1())} className={stepButtonClass(2)}>
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-[11px]">2</span>
                <span>{lang === 'ar' ? 'الدفع' : 'Payment'}</span>
              </button>
            </div>

            <AnimatePresence mode="wait">
              {activeStep === 1 ? (
                <motion.div
                  key="step-1"
                  initial={{ opacity: 0, x: lang === 'ar' ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: lang === 'ar' ? -20 : 20 }}
                  transition={{ duration: 0.22 }}
                >
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
                              <li>افتح تطبيق تليجرام</li>
                              <li>اضغط على الإعدادات (Settings)</li>
                              <li>ادخل للحساب (Account)</li>
                              <li>انسخ اسم المستخدم وضعه هنا</li>
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
                              ? 'إذا لم يكن لديك اسم مستخدم، يمكنك إنشاؤه من الإعدادات باستخدام حروف إنجليزية وأرقام فقط.'
                              : 'If you do not have a username, you can create one in settings using English letters and numbers only.'}
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="relative">
                      <span className="absolute top-1/2 -translate-y-1/2 text-muted-foreground/60 text-xl font-bold ltr:left-4 rtl:right-4 pointer-events-none">@</span>
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

                    {telegramName && !verifyingUser && hasPremium && (
                      <div className="flex items-start gap-2 mt-3 px-3 py-2.5 bg-amber-500/10 rounded-xl text-amber-500 font-bold text-xs border-none shadow-inner">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          {lang === 'ar'
                            ? 'تنبيه: هذا الحساب لديه اشتراك بريميوم فعال بالفعل، لذلك تم تعطيل الشراء.'
                            : 'Notice: This account already has an active Premium subscription, so purchase has been disabled.'}
                        </p>
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
                      <label className="text-sm font-bold text-foreground/80">
                        {lang === 'ar' ? 'مدة الاشتراك' : 'Subscription Duration'}
                      </label>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      {PREMIUM_DURATIONS.map((dur) => {
                        const isSelected = months === dur;
                        const planPrice = formatPlanPrice(dur);
                        const isBlocked = blockedDurations[dur];

                        return (
                          <button
                            key={dur}
                            type="button"
                            onClick={() => {
                              if (!isBlocked) setMonths(dur);
                            }}
                            disabled={isBlocked}
                            className={`relative flex flex-col items-center justify-center p-3 rounded-[1.25rem] border-none focus:ring-0 outline-none transition-all overflow-hidden ${
                              isBlocked
                                ? 'bg-muted/20 text-muted-foreground opacity-45 cursor-not-allowed grayscale'
                                : isSelected
                                  ? 'bg-star-gold/10 text-star-gold font-black shadow-inner'
                                  : 'bg-muted/40 text-muted-foreground font-bold hover:bg-muted/70'
                            }`}
                          >
                            <Crown className="w-6 h-6 mb-1" strokeWidth={2.5} />
                            <span className="text-sm">{durationLabels[dur][lang === 'ar' ? 'ar' : 'en']}</span>

                            {isSelected && !isBlocked && (
                              <span className={`mt-1 text-[11px] font-bold ${currency !== 'egp' ? 'tracking-wider' : ''}`}>
                                {planPrice.toFixed(decimals)} {planCurrencyLabel}
                              </span>
                            )}

                            {isBlocked && (
                              <div className="mt-1 flex flex-col items-center">
                                <span className="text-[10px] font-black text-destructive whitespace-nowrap">
                                  {lang === 'ar' ? 'غير متاحة حاليا' : 'Currently Unavailable'}
                                </span>
                                <span className="text-[9px] font-bold text-muted-foreground mt-0.5 text-center leading-tight">
                                  {lang === 'ar' ? 'سيتم تجديد المخزون' : 'Restocking soon'}
                                </span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
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
                </motion.div>
              ) : (
                <motion.div
                  key="step-2"
                  initial={{ opacity: 0, x: lang === 'ar' ? -20 : 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: lang === 'ar' ? 20 : -20 }}
                  transition={{ duration: 0.22 }}
                >
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
                          {lang === 'ar' ? 'المدة:' : 'Duration:'}
                        </span>
                        <span className="text-sm sm:text-base font-black text-foreground flex items-center gap-1">
                          {durationLabels[months][lang === 'ar' ? 'ar' : 'en']}
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
                              ? `اضغط لفتح انستا باي ودفع مبلغ ${totalCost.toFixed(decimals)} ${currencyLabel}` 
                              : `Tap to open InstaPay & pay ${totalCost.toFixed(decimals)} ${currencyLabel}`}
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

                  {/* ✅ قسم الدفع عبر Web3 (سولانا و TON) للبريميوم */}
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
                            ? `اضغط لتأكيد دفع مبلغ قدره ${totalCost.toFixed(decimals)} USDT. سيتم تجهيز المعاملة الخاصة بك في ثواني.`
                            : `Click to confirm payment of ${totalCost.toFixed(decimals)} USDT. Your transaction will be prepared in seconds.`}
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

                    <div className="bg-destructive/10 rounded-xl p-3 flex items-start gap-2 shadow-inner border-none">
                      <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5 border-none" />
                      <div className="text-xs text-destructive font-bold leading-relaxed border-none">
                        <p>
                          {lang === 'ar' ? (
                            <>
                              أرسل فقط USDT عبر <span className="text-primary font-black border-none">
                                {usdtNetwork === 'bep20' ? 'BEP20 (BSC)' : usdtNetwork === 'trc20' ? 'TRC20 (Tron)' : usdtNetwork === 'aptos' ? 'Aptos' : usdtNetwork === 'okx_internal' ? 'التحويل الداخلي (OKX)' : 'Binance Pay'}
                              </span> إلى هذا {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? 'الحساب (Pay ID/UID)' : 'العنوان'}.
                            </>
                          ) : (
                            <>
                              Only send USDT on the <span className="text-primary font-black border-none">
                                {usdtNetwork === 'bep20' ? 'BEP20 (BSC)' : usdtNetwork === 'trc20' ? 'TRC20 (Tron)' : usdtNetwork === 'aptos' ? 'Aptos' : usdtNetwork === 'okx_internal' ? 'OKX Internal' : 'Binance Pay'}
                              </span> network to this {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? 'Account (Pay ID/UID)' : 'address'}.
                            </>
                          )}
                        </p>
                        {usdtNetwork === 'bep20' && (
                          <p className="mt-2 text-[11px] leading-relaxed border-none">
                            {lang === 'ar' ? (
                              <>
                                إذا كنت سترسل من Binance Pay على العنوان، استخدم{' '}
                                <button
                                  type="button"
                                  onClick={goToBinancePayInternal}
                                  className="font-black text-primary underline underline-offset-4 decoration-2 hover:opacity-80 transition"
                                >
                                  طريقة الدفع Binance Pay الداخلي من هنا
                                </button>
                                .
                              </>
                            ) : (
                              <>
                                If you are sending from Binance Pay to this address, use{' '}
                                <button
                                  type="button"
                                  onClick={goToBinancePayInternal}
                                  className="font-black text-primary underline underline-offset-4 decoration-2 hover:opacity-80 transition"
                                >
                                  Binance Pay internal transfer here
                                </button>
                                .
                              </>
                            )}
                          </p>
                        )}
                        <p className="mt-1 border-none">
                          {usdtNetwork === 'okx_internal' || usdtNetwork === 'binance_internal' ? (
                            lang === 'ar' ? 'تأكد من اختيار "تحويل داخلي" (Internal Transfer / Pay) لتجنب دفع رسوم شبكة. الإرسال فوري.' : 'Make sure to select "Internal Transfer / Pay" to avoid network fees. Transfer is instant.'
                          ) : (
                            lang === 'ar'
                              ? 'تأكد من اختيار الشبكة الصحيحة قبل الإرسال، اختيار شبكة خاطئة يؤدي لضياع أصولك نهائيا!'
                              : 'Verify you selected the correct network before sending, wrong network means permanent loss of funds!'
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="bg-muted/40 rounded-[1.5rem] p-5 border-none shadow-inner">
                      <div className="flex items-center gap-2 mb-3 border-none">
                        <Zap className="w-5 h-5 text-amber-500" />
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
                              {totalCost.toFixed(decimals)} {currencyLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(totalCost.toFixed(decimals), 'amount')}
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
                            {lang === 'ar' ? 'الخطة المحددة' : 'Selected Plan'}
                          </span>
                          <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap truncate border-none">
                            {durationLabels[months][lang === 'ar' ? 'ar' : 'en']}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 bg-amber-500/10 rounded-xl p-3 flex items-start gap-2 shadow-inner border-none">
                        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 border-none" />
                        <div className="text-[11px] text-amber-600 font-bold leading-relaxed space-y-1.5 border-none">
                          {lang === 'ar' ? (
                            <>
                              <p>
                                <span className="font-black border-none">تنبيه هام:</span> يجب إرسال هذا المبلغ بدقة متناهية (بالكسور) لأنه يعمل كتشفير رقمي لطلبك.
                              </p>
                              <p className="text-destructive font-black border-none">
                                المنصات تخصم رسوما من الاجمالي! تأكد أن "مبلغ الاستلام الصافي" مطابق للإجمالي المطلوب بدقة قبل تأكيد الإرسال.
                              </p>
                            </>
                          ) : (
                            <>
                              <p>
                                <span className="font-black border-none">Important:</span> Send the exact amount (including fractions) as it acts as a digital signature for your order.
                              </p>
                              <p className="text-destructive font-black border-none">
                                Exchanges deduct fees! Ensure the "Net Receive Amount" exactly matches the requested total before confirming.
                              </p>
                            </>
                          )}
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
                            {totalCost.toFixed(decimals)} {currencyLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-2 gap-3 border-none">
                        <span className="text-[11px] sm:text-xs font-medium text-muted-foreground whitespace-nowrap border-none">
                          {lang === 'ar' ? 'المدة المحددة' : 'Selected Duration'}
                        </span>
                        <span className="text-[11px] sm:text-xs font-bold text-muted-foreground whitespace-nowrap border-none">
                          {durationLabels[months][lang === 'ar' ? 'ar' : 'en']}
                        </span>
                      </div>
                    </div>
                  )}

                  {balanceError && (
                    <div className="mb-5 overflow-hidden border-none">
                      <div className="bg-destructive/5 rounded-[1.25rem] p-4 flex flex-col items-center justify-center gap-2 text-center border-none shadow-inner">
                        <AlertCircle className="w-6 h-6 text-destructive border-none" />
                        <p className="text-sm font-black text-destructive border-none">
                          {lang === 'ar' ? 'اختر خطة أقل حاليا' : 'Choose a lower plan currently'}
                        </p>
                      </div>
                    </div>
                  )}

                  {cooldownSeconds > 0 && !pendingOrderId && (
                    <div className="mb-5 bg-amber-500/10 rounded-[1.5rem] p-5 text-center shadow-inner border-none">
                      <div className="flex items-center justify-center gap-2 text-amber-600 mb-2 border-none">
                        <Clock className="w-5 h-5 animate-pulse border-none" strokeWidth={2.5} />
                        <span className="text-sm font-black border-none">{lang === 'ar' ? 'فترة حماية' : 'Protection Cooldown'}</span>
                      </div>
                      <div className="text-4xl font-black text-amber-500 font-mono tracking-tighter my-2 border-none">
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
                        disabled={loading || verifying || balanceError || verifyingUser || cooldownSeconds > 0 || isPriceLoading || isPremiumBlocked || currentPlanBlocked || isFormInvalid}
                        className={`relative w-2/3 h-14 sm:h-16 rounded-[1.4rem] overflow-hidden transition-all shadow-md flex items-center justify-center gap-3 border-none outline-none focus:ring-0 ${
                          isPremiumBlocked || currentPlanBlocked || (isFormInvalid && cooldownSeconds <= 0 && !loading && !verifying && !isPriceLoading)
                            ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                            : cooldownSeconds > 0 || balanceError || isPriceLoading
                              ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-80'
                              : 'gradient-telegram text-white hover:opacity-90'
                        }`}
                      >
                        {(!isFormInvalid) && cooldownSeconds <= 0 && !isPriceLoading && !loading && !balanceError && !isPremiumBlocked && !currentPlanBlocked && (
                          <div className="absolute inset-0 bg-white/20 animate-pulse mix-blend-overlay border-none" />
                        )}
                        <div className="relative z-10 flex items-center justify-center w-full h-full border-none">{getButtonContent()}</div>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
        type="premium"
        quantity={months}
        username={username}
        orderId={pendingOrderId}
        paymentMethod={paymentMethod}
        status={orderStatus as any}
        errorMessage={modalError}
        errorCode={modalErrorCode}
        partialMessage={confirmMessage} 
        onClose={handlePaymentClose}
        onComplete={() => {
          setWaitingModal(false);
          setOrderStatus('waiting');
          setPendingOrderId(null);
          setConfirmMessage('');
          setTxHash('');
          // keep the current one-time BEP20 prompt state for this purchase
          clearWalletPreference();

          if (completedDataRef.current) {
            onOrderSuccess(completedDataRef.current.qty, completedDataRef.current.user, completedDataRef.current.oid);
            completedDataRef.current = null;
          }

          isCompletingRef.current = false;
        }}
      />
    </>
  );
};

export default PremiumForm;