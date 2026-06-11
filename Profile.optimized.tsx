import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  LogOut,
  Copy,
  CheckCircle,
  User as UserIcon,
  History,
  AlertCircle,
  ExternalLink,
  ShoppingBag,
  Settings,
  RefreshCw,
  Hash,
  FileText,
  ChevronsLeftRight,
  ChevronsRightLeft,
  Lock,
  Store,
  MessageCircle,
  Coins,
  AlertTriangle,
  Crown,
  // Clock, // ST CARDS TAB HIDDEN TEMPORARILY
  Globe,
  Activity,
  Calendar as CalendarIcon,
  Filter,
  Home,
  CreditCard,
  Send,
  Zap
} from 'lucide-react';

import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useStoreSettings } from '@/hooks/useStoreSettings';
import { toast } from 'sonner';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import { cn } from '@/lib/utils';
import {
  getTransactionLabel,
  getUserTransactionColor,
  getUserTransactionIcon,
  isPositiveUserTransaction
} from '@/lib/transactionUtils';
import { useLanguage } from '@/contexts/LanguageContext';
import { parseWithdrawalError } from '@/lib/withdrawalErrorHandler';
import { useCurrentMerchant } from '@/hooks/useMerchant';
import MerchantDashboard from '@/components/merchant/MerchantDashboard';
/* ST CARDS TAB HIDDEN TEMPORARILY
import StTokenTab from '@/components/profile/StTokenTab';
*/
/* ST CARDS TAB HIDDEN TEMPORARILY
import { useStTokenSettings } from '@/hooks/useStToken';
*/
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useIsElite } from '@/hooks/useElite'; 
/* ST CASHBACK QUERY HIDDEN WITH ST CARDS TAB
import { useQuery } from '@tanstack/react-query';
*/
import { countries } from '@/data/countries';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EngagementScoreWidget } from '@/components/EngagementScoreWidget'; 
import PaymentCardsTab from '@/components/profile/PaymentCardsTab';
import InternalTransferSection from '@/components/profile/InternalTransferSection';
import ApiSubscribe from '@/pages/ApiSubscribe';
import TransactionStatusModal from '@/components/profile/TransactionStatusModal';

type Tab = 'engagement' | 'wallet' | 'history' | 'settings' | 'merchant' | 'orders' | 'cards' | 'sallanet-pay';

/*
  ST CARDS TAB HIDDEN TEMPORARILY
  كان النوع يحتوي على:
  | 'st-token'
*/
type WalletSubTab = 'deposit' | 'withdraw' | 'transfer';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  created_at: string;
  stellar_txid?: string | null;
  pi_payment_id?: string | null;
  metadata?: any;
  ref_id?: string | null;
  operation_id?: string | null;
  asset_code?: string | null;
  fee_amount?: number | null;
  fee_asset_code?: string | null;
  net_amount?: number | null;
}

const ITEMS_PER_PAGE = 10;
const SAFETY_MARGIN = 0.0000001;

const VALID_PROFILE_TABS: Tab[] = [
  'engagement',
  'wallet',
  'history',
  'settings',
  'merchant',
  'orders',
  'cards',
  'sallanet-pay',
];

const MIN_DEPOSIT_AMOUNT = 0.01;

const FIELD_CLASS =
  "h-14 rounded-2xl border-0 bg-muted/30 shadow-inner shadow-black/5 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0";

const SOFT_CARD_CLASS =
  "rounded-[2rem] border-0 bg-card shadow-sm dark:shadow-none";

const stTypesList = [
  'st_deposit',
  'st_withdrawal',
  'gift_card_create',
  'gift_card_redeem',
  'gift_card_sent',
  'gift_card_received'
];

const PriceFormatter = ({ value, className = "" }: { value: number, className?: string }) => {
  const formatted = Number(value || 0).toFixed(7);
  const [intPart, decPart] = formatted.split('.');
  const isLargeNumber = parseInt(intPart) > 0;

  if (!isLargeNumber) return <span className={className} dir="ltr">{formatted}</span>;

  return (
    <span className={cn("inline-flex items-baseline", className)} dir="ltr">
      <span>{intPart}</span>
      <span className="text-[0.6em] font-medium opacity-85 ml-0.5">.{decPart}</span>
    </span>
  );
};

const Profile = () => {
  const { user, logout, isAuthenticated, isLoading, updateBalance, refreshProfile, isSandbox, ensurePaymentsScope } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, language } = useLanguage();

  const tabFromUrl = searchParams.get('tab');
  const amountFromUrl = searchParams.get('amount');
  const returnToUrl = searchParams.get('returnTo');

  const initialTab: Tab =
    tabFromUrl === 'deposit' || tabFromUrl === 'withdraw' || tabFromUrl === 'st-token'
      ? 'wallet'
      : VALID_PROFILE_TABS.includes(tabFromUrl as Tab)
        ? (tabFromUrl as Tab)
        : 'wallet';

  /*
    ST CARDS TAB HIDDEN TEMPORARILY
    لو الرابط جاء بـ tab=st-token يتم تحويله للمحفظة حتى لا تظهر صفحة ST.
  */
  
  const [activeTab, setActiveTab] = useState<Tab>(initialTab as Tab);
  const activeTabRef = useRef<Tab>(initialTab as Tab);
  
  const [activeWalletTab, setActiveWalletTab] = useState<WalletSubTab>(
    (tabFromUrl === 'withdraw' || tabFromUrl === 'deposit') ? (tabFromUrl as WalletSubTab) : 'deposit'
  );

  
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    const tab = searchParams.get('tab');

    if (tab === 'deposit' || tab === 'withdraw') {
      setActiveTab('wallet');
      setActiveWalletTab(tab);
      return;
    }

    if (tab === 'st-token') {
      setActiveTab('wallet');
      return;
    }

    if (tab && VALID_PROFILE_TABS.includes(tab as Tab)) {
      setActiveTab(tab as Tab);
    }
  }, [searchParams]);
  
  const [depositAmount, setDepositAmount] = useState(amountFromUrl || '');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [refundWalletAddress, setRefundWalletAddress] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [userCountry, setUserCountry] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  
  // ✅ التعديل الأول: إضافة الـ useRef لحفظ مفتاح الـ Idempotency
  const withdrawIdempotencyKeyRef = useRef<string | null>(null);

  const [logoutStatus, setLogoutStatus] = useState<'idle' | 'confirm' | 'success'>('idle');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [showFullBalance, setShowFullBalance] = useState(() => {
    const saved = localStorage.getItem('pi_show_full_balance');
    return saved !== 'false';
  });

  const tabsContentRef = useRef<HTMLDivElement>(null);
  const walletFormRef = useRef<HTMLDivElement>(null);

  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'deposit' | 'withdraw'>('all');

  /*
    ST CARDS TAB HIDDEN TEMPORARILY
    كان فلتر السجل يحتوي على:
    | 'st'
  */
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  const [transactionModalConfig, setTransactionModalConfig] = useState<{
    isOpen: boolean;
    type: 'deposit' | 'withdraw';
    status: 'success' | 'error';
    amount?: number;
    errorMessage?: string;
  }>({ isOpen: false, type: 'deposit', status: 'success' });

  useEffect(() => {
    if (!tabsContentRef.current) return undefined;

    const timeoutId = window.setTimeout(() => {
      const yOffset = -100;
      const element = tabsContentRef.current;
      if (element) {
        const y = element.getBoundingClientRect().top + window.scrollY + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('pi_show_full_balance', String(showFullBalance));
  }, [showFullBalance]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const observer = useRef<IntersectionObserver | null>(null);
  const fetchingTransactionsRef = useRef(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: settings } = useStoreSettings();

  const {
    isEngagementEnabled,
    withdrawalFee,
    isDepositEnabled,
    isWithdrawEnabled,
  } = useMemo(() => ({
    isEngagementEnabled: (settings as any)?.enable_engagement_tracking ?? false,
    withdrawalFee: settings?.withdrawal_fee || 0,
    isDepositEnabled: (settings as any)?.enable_deposit ?? true,
    isWithdrawEnabled: (settings as any)?.enable_withdraw ?? true,
  }), [settings]);

  useEffect(() => {
    if (!isEngagementEnabled && activeTab === 'engagement') {
      setActiveTab('wallet');
    }
  }, [isEngagementEnabled, activeTab]);

  /*
    ST CARDS TAB HIDDEN TEMPORARILY
    تم تعليق استعلام رصيد ST حتى لا يظهر أي جزء خاص بـ ST في صفحة الملف الشخصي.

  const { data: stBalanceData, refetch: refetchStBalance } = useQuery({
    queryKey: ['st-balance', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('st_balances')
        .select('balance, pending_balance')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id
  });
  */

  const refetchStBalance = useCallback(async () => null, []);

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    let val = e.target.value;
    if (val.includes('.')) {
      const parts = val.split('.');
      if (parts[1].length > 7) val = `${parts[0]}.${parts[1].slice(0, 7)}`;
    }
    setter(val);
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && logoutStatus === 'idle') navigate('/login', { replace: true });
  }, [isLoading, isAuthenticated, navigate, logoutStatus]);

  const getTxKey = useCallback((tx: any) =>
    `${tx.type}::${tx.ref_id ?? tx.operation_id ?? tx.metadata?.operation_id ?? tx.metadata?.idempotency_key ?? tx.stellar_txid ?? tx.pi_payment_id ?? tx.id}`, []);

  const fetchTransactions = useCallback(async (pageIndex: number, reset = false) => {
    if (!user?.id || fetchingTransactionsRef.current) return;

    fetchingTransactionsRef.current = true;

    if (pageIndex === 0) setLoadingTx(true);
    else setLoadingMore(true);

    try {
      const from = pageIndex * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from('transactions')
        .select('id, type, amount, status, created_at, stellar_txid, pi_payment_id, metadata, ref_id, operation_id, asset_code, fee_amount, fee_asset_code, net_amount')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (historyTypeFilter === 'deposit') {
        query = query.eq('type', 'deposit');
      } else if (historyTypeFilter === 'withdraw') {
        query = query.eq('type', 'withdraw');
      }

      /*
        ST CARDS TAB HIDDEN TEMPORARILY
        تم تعليق فلترة معاملات ST من واجهة السجل.

      else if (historyTypeFilter === 'st') {
        query = query.in('type', stTypesList);
      }
      */

      if (dateFrom) {
        query = query.gte('created_at', dateFrom.toISOString());
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte('created_at', end.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      let newTransactions = (data as Transaction[]) || [];

      const merchantIdsToFetch = new Set<string>();
      newTransactions.forEach(tx => {
        if (tx.metadata?.merchant_id && !tx.metadata?.merchant_name) merchantIdsToFetch.add(tx.metadata.merchant_id);
      });

      if (merchantIdsToFetch.size > 0) {
        const { data: merchantsData } = await supabase
          .from('merchants')
          .select('id, name')
          .in('id', Array.from(merchantIdsToFetch));

        if (merchantsData) {
          const merchantMap = new Map(merchantsData.map(m => [m.id, m.name]));
          newTransactions = newTransactions.map(tx => {
            if (tx.metadata?.merchant_id && !tx.metadata?.merchant_name) {
              const merchantName = merchantMap.get(tx.metadata.merchant_id);
              if (merchantName) return { ...tx, metadata: { ...tx.metadata, merchant_name: merchantName } };
            }
            return tx;
          });
        }
      }

      setHasMore(newTransactions.length >= ITEMS_PER_PAGE);

      setTransactions(prev => {
        if (reset) return newTransactions;
        const combined = [...prev, ...newTransactions];
        const unique = Array.from(new Map(combined.map(item => [getTxKey(item), item])).values());
        return unique;
      });

      setPage(pageIndex);
    } catch (error) {
      console.error(error);
    } finally {
      fetchingTransactionsRef.current = false;
      setLoadingTx(false);
      setLoadingMore(false);
    }
  }, [user?.id, historyTypeFilter, dateFrom, dateTo, getTxKey]);

  const lastTransactionRef = useCallback((node: HTMLDivElement) => {
    if (loadingTx || loadingMore) return;
    if (observer.current) observer.current.disconnect();

    observer.current = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore) fetchTransactions(page + 1);
      },
      { rootMargin: '220px 0px' }
    );

    if (node) observer.current.observe(node);
  }, [loadingTx, loadingMore, hasMore, page, fetchTransactions]);

  useEffect(() => {
    if (user?.id && activeTab === 'history') {
      fetchTransactions(0, true);
    }
  }, [historyTypeFilter, dateFrom, dateTo, activeTab, fetchTransactions, user?.id]);

  const fetchRefundWalletAddress = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('refund_wallet_address, whatsapp_number, country')
        .eq('id', user.id)
        .single();

      if (data?.refund_wallet_address) setRefundWalletAddress(data.refund_wallet_address);
      if (data?.whatsapp_number) setWhatsappNumber(data.whatsapp_number);
      if (data?.country) setUserCountry(data.country);
    } catch (error) {
      console.error(error);
    }
  }, [user?.id]);

  const runCleanupSync = useCallback(async (force: boolean = false) => {
    if (!user?.id) return false;
    const LAST_CLEANUP_KEY = `last_cleanup_${user.id}`;
    const COOLDOWN_PERIOD = 5 * 60 * 1000;
    const lastRun = localStorage.getItem(LAST_CLEANUP_KEY);
    const now = Date.now();

    if (!force && lastRun && (now - parseInt(lastRun, 10) < COOLDOWN_PERIOD)) return false;

    try {
      const { data, error } = await supabase.functions.invoke('pi-cleanup', { body: { userId: user.id } });
      localStorage.setItem(LAST_CLEANUP_KEY, now.toString());
      if (error) return false;
      if (data && data.recovered && data.recovered.length > 0) return true;
    } catch (e) {
      console.warn("Cleanup skipped:", e);
    }
    return false;
  }, [user?.id]);

  const handleRefreshData = useCallback(async (showToast: boolean = false) => {
    if (isRefreshing || !user?.id) return;
    setIsRefreshing(true);
    try {
      await runCleanupSync(false);
      const { data: profileData } = await supabase
        .from('profiles')
        .select('internal_balance')
        .eq('id', user.id)
        .single();

      if (profileData) updateBalance(profileData.internal_balance);
      await refreshProfile();
      await refetchStBalance();
      if (activeTab === 'history') {
        await fetchTransactions(0, true);
      }
      if (showToast) toast.success(t('walletRefreshed'));
    } catch (error) {
      if (showToast) toast.error(t('errRefreshFailed'));
    } finally {
      setIsRefreshing(false);
    }
  }, [
    activeTab,
    fetchTransactions,
    isRefreshing,
    refetchStBalance,
    refreshProfile,
    runCleanupSync,
    t,
    updateBalance,
    user?.id,
  ]);

  useEffect(() => {
    if (activeTab === 'wallet' && activeWalletTab === 'withdraw') {
      runCleanupSync().then((recovered) => {
        if (recovered) handleRefreshData(false);
      });
    }
  }, [activeTab, activeWalletTab, handleRefreshData, runCleanupSync]);

  useEffect(() => {
    if (!user?.id) return;

    fetchRefundWalletAddress();
    handleRefreshData(false);

    const transactionsChannel = supabase.channel('realtime-transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => {
        if (activeTabRef.current === 'history') {
          fetchTransactions(0, true);
        }
        refreshProfile();
        refetchStBalance();
      }).subscribe();

    return () => { supabase.removeChannel(transactionsChannel); };
  }, [user?.id]);

  const handleSaveSettings = useCallback(async () => {
    if (!user?.id) return;

    if (refundWalletAddress && (refundWalletAddress.length < 20 || !refundWalletAddress.startsWith('G'))) {
      toast.error(t('errInvalidAddress'));
      return;
    }
    if (whatsappNumber && !/^\+?[0-9]{10,15}$/.test(whatsappNumber.replace(/\s/g, ''))) {
      toast.error(language === 'ar' ? 'رقم واتساب غير صالح' : 'Invalid WhatsApp number');
      return;
    }

    setIsSavingSettings(true);
    try {
      const { error } = await supabase.from('profiles').update({
        refund_wallet_address: refundWalletAddress || null,
        whatsapp_number: whatsappNumber || null,
        country: userCountry || null
      }).eq('id', user.id);

      if (error) throw error;
      toast.success(t('saveSuccess'));
    } catch (error) {
      toast.error(t('saveError'));
    } finally {
      setIsSavingSettings(false);
    }
  }, [refundWalletAddress, language, t, user?.id, userCountry, whatsappNumber]);

  const handleWalletTabChange = useCallback((value: WalletSubTab) => {
    setActiveWalletTab(value);
    window.setTimeout(() => {
      if (walletFormRef.current) {
        const yOffset = -80;
        const element = walletFormRef.current;
        const y = element.getBoundingClientRect().top + window.scrollY + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    }, 100);
  }, []);


  const { data: currentMerchant } = useCurrentMerchant();
  const { isElite } = useIsElite();

  const tabs = useMemo(() => [
    ...(isEngagementEnabled ? [{
      id: 'engagement' as Tab,
      label: language === 'ar' ? 'مستوى النشاط' : 'Engagement',
      icon: Activity,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    }] : []),
    { id: 'wallet' as Tab, label: t('tabWallet'), icon: Wallet, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { id: 'orders' as Tab, label: language === 'ar' ? 'طلباتي' : 'My Orders', icon: ShoppingBag, color: 'text-orange-500', bg: 'bg-orange-500/10' },
    { id: 'history' as Tab, label: t('tabHistory'), icon: History, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    /*
      ST CARDS TAB HIDDEN TEMPORARILY
      تم تعليق تاب بطاقات ST حتى لا يظهر في التابات.

    ...(stSettings?.enable_st_system ? [{ id: 'st-token' as Tab, label: language === 'ar' ? 'بطاقات ST' : 'ST Cards', icon: Coins, color: 'text-amber-500', bg: 'bg-amber-500/10' }] : []),
    */
    { id: 'cards' as Tab, label: language === 'ar' ? 'بطاقات الدفع' : 'Payment Cards', icon: CreditCard, color: 'text-teal-500', bg: 'bg-teal-500/10' },
    { id: 'sallanet-pay' as Tab, label: 'Sallanet Pay', icon: Zap, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
    { id: 'settings' as Tab, label: t('tabSettings'), icon: Settings, color: 'text-slate-500', bg: 'bg-slate-500/10' },
    ...(currentMerchant && currentMerchant.status === 'active' ? [{
      id: 'merchant' as Tab,
      label: language === 'ar' ? 'لوحة التاجر' : 'Merchant Dashboard',
      icon: Store,
      color: 'text-indigo-500',
      bg: 'bg-indigo-500/10',
    }] : []),
  ], [currentMerchant, isEngagementEnabled, language, t]);


  if (isLoading || (isAuthenticated && !user)) {
    return (
      <div className="flex h-screen w-full items-center justify-center flex-col gap-3 bg-background">
        <div className="h-10 w-10 rounded-2xl bg-muted/50 animate-pulse" />
        <p className="text-xs text-muted-foreground font-bold">
          {language === 'ar' ? 'جاري تحميل الملف الشخصي...' : 'Loading profile...'}
        </p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('copySuccess'));
  };

  const getPiPaymentId = (tx: Transaction) =>
    tx.pi_payment_id ?? tx.metadata?.pi_payment_id ?? tx.metadata?.paymentId ?? tx.metadata?.payment_id ?? tx.metadata?.pi_paymentId ?? null;

  const getTxHash = (tx: Transaction) =>
    tx.stellar_txid ?? tx.metadata?.stellar_txid ?? tx.metadata?.txid ?? tx.metadata?.transaction_hash ?? tx.metadata?.hash ?? null;

  const handleDeposit = async () => {
    if (!isDepositEnabled) { toast.error(t('depositDisabledMsg')); return; }

    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) { toast.error(t('errInvalidAmount')); return; }

    if (amount < MIN_DEPOSIT_AMOUNT) {
      toast.error(language === 'ar' ? `الحد الأدنى ${MIN_DEPOSIT_AMOUNT} Pi` : `Minimum ${MIN_DEPOSIT_AMOUNT} Pi`);
      return;
    }

    setIsProcessing(true);
    const isReady = await ensurePaymentsScope();

    if (!isReady) {
      setIsProcessing(false);
      return;
    }

    if (!window.Pi || typeof window.Pi.createPayment !== 'function') {
      setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'error', errorMessage: t('errPiSdk') });
      setIsProcessing(false);
      return;
    }

    const memoText = t('depositMemo').replace('{amount}', amount.toString());

    try {
      window.Pi.createPayment({
        amount: amount,
        memo: memoText,
        metadata: { type: 'deposit', user_id: user?.id }
      }, {
        onReadyForServerApproval: async (paymentId) => {
          try {
            const { error } = await supabase.functions.invoke('pi-approve', { body: { paymentId, userId: user?.id, amount, metadata: { type: 'deposit' } } });
            if (error) throw error;
          } catch (err) {
            setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'error', errorMessage: t('errPaymentApproval') });
            setIsProcessing(false);
          }
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          try {
            const { error } = await supabase.functions.invoke('pi-complete', { body: { paymentId, txid, userId: user?.id } });
            if (error) throw error;
            
            await handleRefreshData(false);
            
            setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'success', amount: amount });
            setDepositAmount('');

            if (returnToUrl === 'become-merchant') {
              setTimeout(() => navigate('/become-merchant'), 2000);
            } else {
              setActiveTab('wallet');
              setActiveWalletTab('deposit');
            }
          } catch (err) {
            setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'error', errorMessage: t('errPaymentCompletion') });
          } finally {
            setIsProcessing(false);
          }
        },
        onCancel: () => { 
          const cancelMsg = language === 'ar'
            ? 'العملية لم تكتمل وتم إلغاؤها.\n\nيرجى التأكد من:\n- تأكيد الدفع بنجاح داخل متصفح Pi.\n- استقرار اتصالك بالإنترنت.\n- وجود رصيد كافٍ في محفظة Pi الخاصة بك.'
            : 'Transaction not completed and cancelled.\n\nPlease ensure:\n- You confirmed the payment inside the Pi Browser.\n- Your internet connection is stable.\n- You have sufficient balance in your Pi wallet.';
            
          setTransactionModalConfig({ 
            isOpen: true, 
            type: 'deposit', 
            status: 'error', 
            errorMessage: cancelMsg 
          });
          setIsProcessing(false); 
        },
        onError: () => { 
          setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'error', errorMessage: t('errPaymentGeneric') });
          setIsProcessing(false); 
        }
      });
    } catch {
      setTransactionModalConfig({ isOpen: true, type: 'deposit', status: 'error', errorMessage: t('errPaymentGeneric') });
      setIsProcessing(false);
    }
  };

  const totalBalance = user?.internalBalance || 0;
  const maxSafeBalance = Math.max(0, totalBalance - SAFETY_MARGIN);
  const withdrawAmountNum = parseFloat(withdrawAmount) || 0;

  let effectiveRequestAmount = withdrawAmountNum;
  if (withdrawAmountNum <= totalBalance && withdrawAmountNum > maxSafeBalance) effectiveRequestAmount = maxSafeBalance;

  const netWithdrawAmount = Math.max(0, effectiveRequestAmount - withdrawalFee);

  const handleWithdrawAll = () => setWithdrawAmount(maxSafeBalance.toFixed(7));
  const handleQuickAmount = (amount: number) => setWithdrawAmount((amount > totalBalance ? maxSafeBalance : amount).toFixed(7));

  const handleWithdrawClick = () => {
    if (!isWithdrawEnabled) { toast.error(t('withdrawDisabledMsg')); return; }

    const requestedAmount = effectiveRequestAmount;

    if (isNaN(requestedAmount) || requestedAmount <= 0) { toast.error(t('errInvalidAmount')); return; }
    if (!withdrawAddress.trim() || withdrawAddress.length < 20) { toast.error(t('errInvalidAddress')); return; }
    if (requestedAmount <= withdrawalFee) { toast.error(t('errMinWithdraw').replace('{fee}', withdrawalFee.toString())); return; }
    if (requestedAmount > totalBalance) { toast.error(t('errInsufficientFunds')); return; }

    // ✅ التعديل الثاني: توليد وحفظ مفتاح منع التكرار عند فتح نافذة التأكيد
    withdrawIdempotencyKeyRef.current = `withdraw-${user?.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    setShowWithdrawConfirm(true);
  };

  const executeWithdraw = async () => {
    setIsProcessing(true);
    const requestedAmount = effectiveRequestAmount;
    const memoText = t('withdrawMemo').replace('{amount}', requestedAmount.toFixed(7));

    try {
      // ✅ التعديل الثالث: استخدام المفتاح المحفوظ لضمان عدم تكرار الخصم إذا انقطع الإنترنت
      const idempotencyKey = withdrawIdempotencyKeyRef.current || `withdraw-${user?.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const { data, error } = await supabase.functions.invoke('pi-withdraw', {
        body: {
          amount: requestedAmount,
          userId: user?.id,
          walletAddress: withdrawAddress,
          idempotencyKey,
          memo: memoText
        }
      });

      if (error) {
        let serverErrorMessage = error.message;
        
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errBody = await error.context.json();
            if (errBody && errBody.error) {
              serverErrorMessage = errBody.error;
            }
          } catch (_) {}
        } else if (data && data.error) {
           serverErrorMessage = data.error;
        } else {
           try {
             const parsedError = JSON.parse(error.message);
             serverErrorMessage = parsedError.error || error.message;
           } catch {}
        }
        
        throw new Error(serverErrorMessage);
      }

      await handleRefreshData(false);

      const actualReceived =
        (data as any)?.netAmount ??
        (data as any)?.amount ??
        (requestedAmount - withdrawalFee);

      setTransactionModalConfig({ isOpen: true, type: 'withdraw', status: 'success', amount: actualReceived });
      setWithdrawAmount('');
      setWithdrawAddress('');
      setShowWithdrawConfirm(false);
      setActiveTab('wallet');
      
      // ✅ مسح المفتاح بعد اكتمال العملية بنجاح
      withdrawIdempotencyKeyRef.current = null;
      
    } catch (error: any) {
      let baseMessage = parseWithdrawalError(error, language as 'ar' | 'en');
      
      if (error?.message) {
          baseMessage = error.message;
      }
      
      if (baseMessage.includes('non-2xx') || baseMessage.includes('Edge Function returned') || baseMessage.includes('FunctionsHttpError')) {
          baseMessage = language === 'ar' 
            ? 'حدث خطأ في الاتصال بالخادم، يرجى المحاولة لاحقاً.' 
            : 'Server connection error, please try again later.';
      }
      
      const reassurance = language === 'ar' 
        ? '\n\nلا تقلق! رصيدك الداخلي آمن تماماً ولم يتم خصمه.' 
        : '\n\nDon\'t worry! Your internal balance is completely safe and was not deducted.';

      setTransactionModalConfig({ 
        isOpen: true, 
        type: 'withdraw', 
        status: 'error', 
        errorMessage: baseMessage + reassurance 
      });
      setShowWithdrawConfirm(false);
      
      // ⚠️ هنا لا نمسح المفتاح (withdrawIdempotencyKeyRef.current) 
      // لكي يتمكن المستخدم من الإرسال بنفس المفتاح لو كانت المشكلة مجرد انقطاع شبكة.
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLogoutClick = () => {
    setLogoutStatus('confirm');
  };

  const executeLogout = async () => {
    setIsLoggingOut(true);
    setTimeout(() => {
      setIsLoggingOut(false);
      setLogoutStatus('success');
    }, 800);
  };

  const finalizeLogout = () => {
    logout();
    navigate('/');
  };

  /*
    ST CARDS TAB HIDDEN TEMPORARILY
    تم تعليق إعدادات ST لأنها كانت تتحكم في إظهار تاب بطاقات ST.

  const { data: stSettings } = useStTokenSettings();
  */

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Profile Header Card */}
        <Card className={cn(SOFT_CARD_CLASS, "mb-6 overflow-hidden")}>
          <div className="gradient-pi p-6 text-primary-foreground relative">

            {isElite && (
              <div 
                className={cn(
                  "absolute top-5 cursor-pointer hover:scale-105 transition-transform z-20",
                  language === 'ar' ? "left-5" : "right-5"
                )}
                onClick={() => navigate('/elite')}
                title={language === 'ar' ? "إدارة اشتراك إيليت" : "Manage Elite Subscription"}
              >
                <div className="relative group">
                  <div className="absolute inset-0 bg-yellow-400 blur-md opacity-50 rounded-full group-hover:opacity-100 transition-opacity duration-300"></div>
                  <div className="relative bg-gradient-to-r from-amber-300 via-yellow-500 to-orange-500 px-3 py-1.5 rounded-full border-0 shadow-lg shadow-amber-500/20 flex items-center gap-1.5">
                    <Crown className="h-3.5 w-3.5 text-yellow-950" strokeWidth={3} />
                    <span className="text-[10px] sm:text-xs font-black text-yellow-950 tracking-widest leading-none mt-0.5">
                      SALLA ELITE
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-5 mb-6 relative z-10">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.5rem] bg-white/20 shadow-sm border border-white/10">
                <UserIcon className="h-8 w-8" />
              </div>

              <div className="flex-1 min-w-0 pt-2">
                <p className="text-sm font-medium opacity-90 mb-1">{t('welcomeUser')}</p>
                <div className="flex flex-col items-start gap-1">
                  <h1 className={cn(
                    "text-xl font-black tracking-tight break-all drop-shadow-sm",
                    isElite ? "bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-500 bg-clip-text text-transparent" : ""
                  )}>
                    {user?.username}
                  </h1>

                  {isSandbox && (
                    <span className="inline-flex items-center rounded-xl bg-white/20 border border-white/20 px-2.5 py-1 text-[10px] font-bold mt-1">
                      {t('piTestnetTag')}
                    </span>
                  )}

                  {!isElite && (
                    <button
                      onClick={() => navigate('/elite')}
                      className="inline-flex items-center gap-1 mt-1 rounded-xl bg-white/20 px-3 py-1 text-[11px] font-bold hover:bg-white/30 transition-colors border border-white/10 shadow-sm"
                    >
                      <Crown className="h-3 w-3 text-amber-300" /> {language === 'ar' ? 'ترقية إلى Elite' : 'Upgrade to Elite'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="h-px w-full bg-white/10 mb-4 rounded-full" />

            <Button
              variant="ghost"
              className="w-full gap-2 rounded-2xl bg-white/10 text-white hover:bg-white/20 h-12 transition-colors hover:scale-[1.01] active:scale-[0.98] font-bold"
              onClick={handleLogoutClick}
            >
              <LogOut className="h-5 w-5" />
              <span className="text-base font-bold">{t('logout')}</span>
            </Button>
          </div>

          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="w-full sm:w-auto">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t('refundWalletLabel')}</p>
                <div className="mt-2 flex items-center gap-2">
                  {refundWalletAddress ? (
                    <>
                      <code className="rounded-2xl bg-muted/40 px-4 py-3 text-sm font-bold font-sans shadow-inner shadow-black/5 text-foreground/80 flex-1" dir="ltr">
                        {refundWalletAddress.slice(0, 10)}...{refundWalletAddress.slice(-10)}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-11 w-11 rounded-2xl bg-muted/30 hover:bg-muted/60 shrink-0"
                        onClick={() => handleCopy(refundWalletAddress)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-muted-foreground bg-muted/20 px-4 py-3 rounded-2xl w-full text-center">{t('noRefundWallet')}</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex flex-col gap-6">
          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              if (val === 'orders') navigate('/orders');
              else setActiveTab(val as Tab);
            }}
            className="w-full"
            dir={language === 'ar' ? 'rtl' : 'ltr'}
          >
            <div className="relative mb-5">
              <div className={cn(
                "absolute top-0 bottom-4 w-16 z-10 pointer-events-none",
                language === 'ar' 
                  ? "left-0 bg-gradient-to-r from-background to-transparent" 
                  : "right-0 bg-gradient-to-l from-background to-transparent"
              )}></div>

              <div className="overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                <TabsList className="inline-flex h-auto w-max gap-3 bg-transparent p-0 border-none justify-start px-1 after:content-[''] after:w-8 after:shrink-0">
                  {tabs.map((tab) => (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className={cn(
                        "relative flex items-center gap-3 rounded-[1.5rem] px-4 py-3 h-auto min-w-max transition-transform duration-150 outline-none border-0 shadow-sm",
                        "bg-card hover:bg-muted/50 text-muted-foreground",
                        "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:scale-[1.01]"
                      )}
                    >
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-inner", tab.bg)}>
                        <tab.icon className={cn("h-4 w-4", tab.color)} />
                      </div>
                      <span className="text-sm font-black whitespace-nowrap">{tab.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </div>

            <div ref={tabsContentRef}>
              
              {isEngagementEnabled && activeTab === 'engagement' && (
                <TabsContent value="engagement" className="mt-0 outline-none">
                  <div className="w-full animate-in fade-in duration-150">
                    <EngagementScoreWidget />
                  </div>
                </TabsContent>
              )}

              {/* Wallet Tab */}
              {activeTab === 'wallet' && (
              <TabsContent value="wallet" className="mt-0 outline-none">
                <Card className={cn(SOFT_CARD_CLASS, "mb-6 animate-in fade-in duration-150")}>
                  <CardHeader>
                    <CardTitle className="text-base font-black">{t('currentBalanceTitle')}</CardTitle>
                    <CardDescription className="text-xs font-medium">{t('currentBalanceDesc')}</CardDescription>
                  </CardHeader>

                  <CardContent>
                    <div className="relative mb-6 rounded-3xl gradient-pi p-7 text-primary-foreground shadow-lg shadow-primary/15 overflow-hidden">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRefreshData(true)}
                        disabled={isRefreshing}
                        className={cn(
                          "absolute top-4 h-10 w-10 rounded-2xl bg-white/15 text-white hover:bg-white/20 transition-colors",
                          language === 'ar' ? "left-4" : "right-4"
                        )}
                        title={t('refreshWallet')}
                      >
                        <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin opacity-60")} />
                      </Button>

                      <p className="mb-2 text-xs font-bold opacity-85 uppercase tracking-wider">{t('availableBalance')}</p>

                      <div
                        className="flex items-center justify-center gap-3 flex-wrap cursor-pointer select-none mt-2"
                        dir="ltr"
                        onClick={() => setShowFullBalance(!showFullBalance)}
                      >
                        <span className="text-4xl sm:text-5xl font-black font-sans break-all flex items-baseline justify-center tracking-tight">
                          {showFullBalance
                            ? <PriceFormatter value={user?.internalBalance || 0} />
                            : (user?.internalBalance || 0).toFixed(2)}
                        </span>
                        <span className="text-2xl sm:text-3xl font-bold opacity-90">Pi</span>

                        <div className="bg-white/15 p-2 rounded-2xl ml-2 shadow-inner">
                          {showFullBalance ? <ChevronsRightLeft className="h-4 w-4" /> : <ChevronsLeftRight className="h-4 w-4" />}
                        </div>
                      </div>
                    </div>

                    {/*
                      ST CARDS TAB HIDDEN TEMPORARILY
                      تم تعليق كارت رصيد كاش باك ST حتى لا يظهر أي عنصر ST في تبويب المحفظة.

                    {stBalanceData && stBalanceData.pending_balance > 0 && (
                      <div className="mb-6 flex flex-col items-center justify-center rounded-[2rem] bg-amber-50 dark:bg-amber-950/20 border-0 p-6 shadow-inner transition-colors group text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <Clock className="h-5 w-5 text-amber-500 shrink-0" strokeWidth={2.5} />
                          <span className="text-sm font-black text-amber-700 dark:text-amber-500 uppercase tracking-wider">
                            {language === 'ar' ? 'رصيد كاش باك ST' : 'ST Cashback Balance'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-center gap-1 text-amber-600 font-black font-sans mb-3" dir="ltr">
                          <span className="text-sm">+</span>
                          <PriceFormatter value={stBalanceData.pending_balance} className="text-3xl sm:text-4xl" />
                          <span className="text-sm opacity-80 font-bold ml-1">ST</span>
                        </div>
                        <p className="text-[11px] font-bold text-amber-700/80 bg-amber-100/50 dark:bg-amber-900/30 px-4 py-2 rounded-2xl border-0 shadow-sm">
                           {language === 'ar' ? 'سيتم الاضافة لرصيدك بمجرد اكتمال الطلب' : 'Will be added to your balance once the order is completed'}
                        </p>
                      </div>
                    )}
                    */}

                    <div className="grid grid-cols-3 gap-3 sm:gap-4">
                      {/* Deposit Card */}
                      <div
                        onClick={() => handleWalletTabChange('deposit')}
                        className={cn(
                          "flex flex-col items-center justify-center gap-3 h-28 rounded-[2rem] border-0 transition-transform duration-150 cursor-pointer shadow-sm",
                          activeWalletTab === 'deposit' ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 shadow-md scale-[1.02]" : "bg-card hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 hover:scale-[1.02]"
                        )}
                      >
                        <div className="p-3 rounded-2xl bg-emerald-100/50 dark:bg-emerald-900/30 shadow-inner">
                          <ArrowDownToLine className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider">{language === 'ar' ? 'إيداع' : 'Deposit'}</span>
                      </div>

                      {/* Withdraw Card */}
                      <div
                        onClick={() => handleWalletTabChange('withdraw')}
                        className={cn(
                          "flex flex-col items-center justify-center gap-3 h-28 rounded-[2rem] border-0 transition-transform duration-150 cursor-pointer shadow-sm",
                          activeWalletTab === 'withdraw' ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 shadow-md scale-[1.02]" : "bg-card hover:bg-orange-50/50 dark:hover:bg-orange-950/20 text-orange-600 dark:text-orange-400 hover:scale-[1.02]"
                        )}
                      >
                        <div className="p-3 rounded-2xl bg-orange-100/50 dark:bg-orange-900/30 shadow-inner">
                          <ArrowUpFromLine className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider">{language === 'ar' ? 'سحب' : 'Withdraw'}</span>
                      </div>

                      {/* Transfer Card */}
                      <div
                        onClick={() => handleWalletTabChange('transfer')}
                        className={cn(
                          "flex flex-col items-center justify-center gap-3 h-28 rounded-[2rem] border-0 transition-transform duration-150 cursor-pointer shadow-sm",
                          activeWalletTab === 'transfer' ? "bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 shadow-md scale-[1.02]" : "bg-card hover:bg-sky-50/50 dark:hover:bg-sky-950/20 text-sky-600 dark:text-sky-400 hover:scale-[1.02]"
                        )}
                      >
                        <div className="p-3 rounded-2xl bg-sky-100/50 dark:bg-sky-900/30 shadow-inner">
                          <Send className="h-6 w-6" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider">{language === 'ar' ? 'تحويل' : 'Transfer'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div ref={walletFormRef} className="scroll-mt-24 space-y-4">
                  {activeWalletTab === 'deposit' && (
                    <Card className={cn(SOFT_CARD_CLASS, "animate-in fade-in duration-150")}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base font-black">
                          <div className="p-2 bg-emerald-100/50 dark:bg-emerald-900/30 rounded-xl">
                            <ArrowDownToLine className="h-5 w-5 text-emerald-500" />
                          </div>
                          {t('depositTitle')}
                        </CardTitle>
                        <CardDescription className="text-xs font-medium ml-11">{t('depositDesc')}</CardDescription>
                      </CardHeader>

                      <CardContent className="space-y-6">
                        {!isDepositEnabled ? (
                          <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 rounded-[2rem] bg-muted/30 p-8 shadow-inner shadow-black/5">
                            <div className="bg-muted/50 p-4 rounded-2xl shadow-sm">
                              <Lock className="h-10 w-10 text-muted-foreground" />
                            </div>
                            <div className="space-y-2">
                              <h3 className="text-base font-bold">{t('depositDisabledTitle')}</h3>
                              <p className="text-xs font-medium text-muted-foreground max-w-sm mx-auto">{t('depositDisabledMsg')}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="deposit-amount" className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">{t('depositAmountLabel')}</Label>
                              <div className="relative">
                                <Input
                                  id="deposit-amount"
                                  type="number"
                                  placeholder="0.00"
                                  value={depositAmount}
                                  onChange={(e) => handleAmountChange(e, setDepositAmount)}
                                  className={cn("pl-12 text-lg font-black font-sans", FIELD_CLASS)}
                                  dir="ltr"
                                  step="0.0000001"
                                  min="0.0000001"
                                />
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-black">Pi</span>
                              </div>
                              <p className="text-[11px] font-bold text-muted-foreground ml-1">
                                {language === 'ar' ? `الحد الأدنى: ${MIN_DEPOSIT_AMOUNT} Pi` : `Minimum: ${MIN_DEPOSIT_AMOUNT} Pi`}
                              </p>
                            </div>

                            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                              {[1, 5, 10, 25].map(amount => (
                                <Button
                                  key={amount}
                                  variant="ghost"
                                  size="sm"
                                  className="rounded-xl bg-muted/40 shadow-sm hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20 font-bold h-10 px-4 transition-colors active:scale-95 transition-transform duration-150"
                                  onClick={() => setDepositAmount(amount.toString())}
                                >
                                  <span dir="ltr" className="text-sm flex items-center gap-1.5 font-sans">
                                    <span>{amount}</span>
                                    <span className="text-[10px] opacity-70">Pi</span>
                                  </span>
                                </Button>
                              ))}
                            </div>

                            <Button
                              className="w-full gap-2 gradient-pi h-14 rounded-2xl shadow-lg shadow-primary/20 font-black text-sm active:scale-[0.98] transition-transform border-0"
                              size="lg"
                              onClick={handleDeposit}
                              disabled={isProcessing || !depositAmount}
                            >
                              {isProcessing ? (
                                <><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">{language === 'ar' ? 'جاري تحضير الدفع...' : 'Processing...'}</span></>
                              ) : (
                                <>
                                  <ArrowDownToLine className="h-5 w-5" />
                                  <span className="text-sm">{t('depositNowBtn')}</span>
                                </>
                              )}
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {activeWalletTab === 'withdraw' && (
                    <Card className="rounded-[2rem] border-0 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] bg-card animate-in fade-in duration-150">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base font-black">
                          <div className="p-2 bg-orange-100/50 dark:bg-orange-900/30 rounded-xl">
                            <ArrowUpFromLine className="h-5 w-5 text-orange-500" />
                          </div>
                          {t('withdrawTitle')}
                        </CardTitle>
                        <CardDescription className="text-xs font-medium ml-11">{t('withdrawDesc')}</CardDescription>
                      </CardHeader>

                      <CardContent className="space-y-6">
                       {!isWithdrawEnabled ? (
                          <div className="flex flex-col items-center justify-center py-10 text-center space-y-4 rounded-[2rem] bg-muted/30 p-8 shadow-inner shadow-black/5">
                            <div className="bg-muted/50 p-4 rounded-2xl shadow-sm">
                              <Lock className="h-10 w-10 text-muted-foreground" />
                            </div>
                            <div className="space-y-2">
                              <h3 className="text-base font-bold">{t('withdrawDisabledTitle')}</h3>
                              <p className="text-xs font-medium text-muted-foreground max-w-sm mx-auto">{t('withdrawDisabledMsg')}</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <Label htmlFor="withdraw-amount" className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">{t('withdrawAmountLabel')}</Label>
                              <div className="relative">
                                <Input
                                  id="withdraw-amount"
                                  type="number"
                                  placeholder="0.00"
                                  value={withdrawAmount}
                                  onChange={(e) => handleAmountChange(e, setWithdrawAmount)}
                                  className={cn("pl-12 text-lg font-black font-sans", FIELD_CLASS)}
                                  dir="ltr"
                                  step="0.0000001"
                                  min={(withdrawalFee + 0.0000001).toFixed(7)}
                                  max={user?.internalBalance}
                                />
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-black">Pi</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                              {[1, 5, 10].map(amount => (
                                <Button
                                  key={amount}
                                  variant="ghost"
                                  size="sm"
                                  className="rounded-xl bg-muted/40 shadow-sm hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/20 font-bold h-10 px-4 transition-colors active:scale-95 transition-transform duration-150"
                                  onClick={() => handleQuickAmount(amount)}
                                  disabled={amount > (user?.internalBalance || 0)}
                                >
                                  <span dir="ltr" className="text-sm flex items-center gap-1.5 font-sans">
                                    <span>{amount}</span>
                                    <span className="text-[10px] opacity-70">Pi</span>
                                  </span>
                                </Button>
                              ))}
                              <Button
                                variant="secondary"
                                size="sm"
                                className="rounded-xl bg-orange-100/50 text-orange-700 hover:bg-orange-200/60 dark:bg-orange-900/30 dark:text-orange-400 font-black h-10 px-5 shadow-sm border-0"
                                onClick={handleWithdrawAll}
                                disabled={!user?.internalBalance}
                              >
                                <span className="text-sm uppercase tracking-wider">{t('withdrawAll')}</span>
                              </Button>
                            </div>

                            {withdrawAmountNum > 0 && (
                              <div className="rounded-[1.5rem] border-0 shadow-inner bg-muted/30 p-5 space-y-3 animate-in fade-in duration-150">
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground font-bold">{t('withdrawSummaryRequested')}</span><span className="font-black font-sans" dir="ltr">{effectiveRequestAmount.toFixed(7)} Pi</span></div>
                                <div className="flex justify-between text-sm"><span className="text-muted-foreground font-bold">{t('withdrawSummaryFee')}</span><span className="text-destructive font-black font-sans" dir="ltr">-{withdrawalFee.toFixed(7)} Pi</span></div>
                                <div className="border-t border-border/40 pt-3 flex justify-between items-center font-semibold">
                                    <span className="text-xs text-muted-foreground font-bold uppercase tracking-wider">{t('withdrawSummaryNet')}</span>
                                    <span className="text-orange-600 dark:text-orange-400 text-base font-black font-sans flex items-baseline gap-1" dir="ltr">
                                      <span>{netWithdrawAmount.toFixed(7)}</span>
                                      <span className="text-[10px] opacity-80">Pi</span>
                                    </span>
                                </div>
                              </div>
                            )}

                            {withdrawalFee > 0 && (
                              <div className="flex items-start gap-3 rounded-[1.5rem] bg-blue-50/50 dark:bg-blue-950/20 p-4 text-sm shadow-inner border-0">
                                <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-xl shrink-0 mt-0.5">
                                  <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="text-blue-800 dark:text-blue-300 space-y-1.5">
                                    <p className="font-black text-sm">{t('withdrawNoticeTitle')}</p>
                                    <p className="text-xs font-medium leading-relaxed">{t('withdrawNoticeDeducted').replace('{amount}', effectiveRequestAmount.toFixed(7))}</p>
                                    <p className="text-xs font-medium leading-relaxed">{t('withdrawNoticeReceived').replace('{net}', netWithdrawAmount.toFixed(7)).replace('{fee}', withdrawalFee.toFixed(7))}</p>
                                </div>
                              </div>
                            )}

                            <div className="space-y-2">
                              <Label htmlFor="withdraw-address" className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">{t('withdrawAddressLabel')}</Label>
                              <Input
                                id="withdraw-address"
                                type="text"
                                placeholder={t('withdrawAddressPlaceholder')}
                                value={withdrawAddress}
                                onChange={e => setWithdrawAddress(e.target.value)}
                                className={cn("text-xs font-sans tracking-widest", FIELD_CLASS)}
                                dir="ltr"
                              />
                              <p className="text-[10px] font-bold text-muted-foreground ml-1">{t('withdrawAddressHint')}</p>
                            </div>

                            <Button
                              className="w-full h-14 gap-2 rounded-2xl shadow-lg shadow-orange-600/20 font-black text-sm bg-orange-600 hover:bg-orange-700 text-white border-0 transition-transform active:scale-[0.98]"
                              size="lg"
                              onClick={handleWithdrawClick}
                              disabled={
                                isProcessing ||
                                !withdrawAmount ||
                                !withdrawAddress.trim() ||
                                withdrawAmountNum <= withdrawalFee ||
                                withdrawAmountNum > (user?.internalBalance || 0)
                              }
                            >
                              {isProcessing ? (
                                <><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">{language === 'ar' ? 'جارٍ التنفيذ...' : 'Processing...'}</span></>
                              ) : (
                                <>
                                  <ArrowUpFromLine className="h-5 w-5" />
                                  <span className="text-sm">{t('withdrawNowBtn')}</span>
                                </>
                              )}
                            </Button>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {activeWalletTab === 'transfer' && (
                    <div className="animate-in fade-in duration-150">
                      <InternalTransferSection currency="pi" />
                    </div>
                  )}
                </div>
              </TabsContent>
              )}

              {/* History Tab */}
              {activeTab === 'history' && (
              <TabsContent value="history" className="mt-0 outline-none">
                <Card className={SOFT_CARD_CLASS}>
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-base font-black">
                      <div className="p-2 bg-purple-100/50 dark:bg-purple-900/30 rounded-xl">
                        <History className="h-5 w-5 text-purple-500" />
                      </div>
                      {t('transactionHistory')}
                    </CardTitle>
                    <CardDescription className="text-xs font-medium ml-11">{t('transactionHistoryDesc')}</CardDescription>
                  </CardHeader>

                  <CardContent className="p-4 sm:p-6 space-y-5">
                    
                    {/* Filters Section (Soft UI) */}
                    <div className="bg-muted/30 p-4 rounded-[1.5rem] border-0 shadow-inner space-y-3">
                      <Tabs value={historyTypeFilter} onValueChange={(v) => setHistoryTypeFilter(v as any)} dir={language === 'ar' ? 'rtl' : 'ltr'}>
                        <TabsList className="w-full rounded-2xl bg-muted/40 dark:bg-white/5 border-0 shadow-sm h-auto p-1.5">
                          <TabsTrigger value="all" className="flex-1 rounded-xl text-xs py-2.5 font-bold data-[state=active]:bg-card data-[state=active]:shadow-sm">
                            {language === 'ar' ? 'الكل' : 'All'}
                          </TabsTrigger>
                          <TabsTrigger value="deposit" className="flex-1 rounded-xl text-xs py-2.5 font-bold data-[state=active]:bg-card data-[state=active]:shadow-sm">
                            {language === 'ar' ? 'إيداع' : 'Deposit'}
                          </TabsTrigger>
                          <TabsTrigger value="withdraw" className="flex-1 rounded-xl text-xs py-2.5 font-bold data-[state=active]:bg-card data-[state=active]:shadow-sm">
                            {language === 'ar' ? 'سحب' : 'Withdraw'}
                          </TabsTrigger>
                          {/*
                            ST CARDS TAB HIDDEN TEMPORARILY
                            تم تعليق فلتر ST في سجل المعاملات.

                          {stSettings?.enable_st_system && (
                            <TabsTrigger value="st" className="flex-1 rounded-xl text-xs py-2.5 font-bold data-[state=active]:bg-card data-[state=active]:shadow-sm">
                              {language === 'ar' ? 'ST' : 'ST'}
                            </TabsTrigger>
                          )}
                          */}
                        </TabsList>
                      </Tabs>

                      <div className="flex gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs gap-1.5 h-12 border-0 bg-background shadow-sm hover:bg-muted/50 font-bold">
                              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                              <span className={!dateFrom ? "text-muted-foreground" : ""}>
                                {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : (language === 'ar' ? 'من تاريخ' : 'From')}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 rounded-[1.5rem] border-0 shadow-xl" align="center" sideOffset={8}>
                            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className="p-3 pointer-events-auto" showOutsideDays fixedWeeks />
                          </PopoverContent>
                        </Popover>

                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs gap-1.5 h-12 border-0 bg-background shadow-sm hover:bg-muted/50 font-bold">
                              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                              <span className={!dateTo ? "text-muted-foreground" : ""}>
                                {dateTo ? format(dateTo, 'dd/MM/yyyy') : (language === 'ar' ? 'إلى تاريخ' : 'To')}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 rounded-[1.5rem] border-0 shadow-xl" align="center" sideOffset={8}>
                            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className="p-3 pointer-events-auto" showOutsideDays fixedWeeks />
                          </PopoverContent>
                        </Popover>

                        {(dateFrom || dateTo) && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="rounded-xl h-12 w-12 shrink-0 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive shadow-sm border-0" 
                            onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
                            title={language === 'ar' ? 'مسح الفلاتر' : 'Clear filters'}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between px-2 text-[11px] font-bold text-muted-foreground pt-1">
                        <span>
                          {transactions.length} {language === 'ar' ? 'معاملة معروضة' : 'transactions shown'}
                        </span>
                      </div>
                    </div>

                    {/* Transactions List */}
                    {(loadingTx && transactions.length === 0) ? (
                      <div className="space-y-4">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-[1.5rem]" />)}
                      </div>
                    ) : transactions.length > 0 ? (
                      <div className="space-y-4 w-full">
                        {transactions.map((tx, index) => {
                          const txType = tx.type;
                          const IconComponent = getUserTransactionIcon(txType);
                          const getTypeIcon = () => <IconComponent className="h-5 w-5" />;

                          const isPositive = isPositiveUserTransaction(txType);
                          const isLastElement = index === transactions.length - 1;

                          const rawStatus = String(tx.status || '').toLowerCase();
                          const uiStatus =
                            rawStatus === 'completed' ? 'completed'
                              : (rawStatus === 'pending' || rawStatus === 'processing' || rawStatus === 'pending_verification')
                                ? 'pending'
                                : 'failed';

                          const isStTransaction = stTypesList.includes(txType) || tx.asset_code === 'ST';

                          const stCode =
                            (tx.asset_code && tx.asset_code !== 'Pi')
                              ? tx.asset_code
                              : ((tx.metadata?.asset_code && tx.metadata?.asset_code !== 'Pi') ? tx.metadata.asset_code : 'ST');

                          const currencyLabel = isStTransaction ? stCode : (tx.asset_code ?? 'Pi');

                          const pickNonZero = (...vals: any[]) => {
                            for (const v of vals) {
                              const n = Number(v);
                              if (Number.isFinite(n) && n !== 0) return n;
                            }
                            return 0;
                          };

                          const isStWithdrawal = txType === 'st_withdrawal';
                          const displayAmountRaw = isStWithdrawal
                            ? pickNonZero(tx.amount, tx.net_amount, tx.metadata?.net_amount, tx.metadata?.st_amount)
                            : pickNonZero(tx.amount, tx.metadata?.st_amount, tx.net_amount, tx.metadata?.net_amount);

                          const displayAmount = Math.abs(displayAmountRaw);

                          const feeVal = tx.fee_amount ?? tx.metadata?.fee;
                          const feeUnit =
                            tx.fee_asset_code ??
                            tx.metadata?.fee_asset_code ??
                            (isStTransaction ? stCode : 'Pi');

                          const piId = getPiPaymentId(tx);
                          const txHash = getTxHash(tx);

                          const blockchainLink = txHash
                            ? (tx.metadata?.blockchain_link || `https://blockexplorer.minepi.com/tx/${txHash}`)
                            : null;
                          
                          return (
                            <div
                              key={getTxKey(tx)}
                              ref={isLastElement ? lastTransactionRef : null}
                              className={cn(
                                "relative rounded-[1.5rem] p-4 sm:p-5 transition-transform duration-150 overflow-hidden w-full",
                                "bg-background border-0 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-md group"
                              )}
                            >
                              <div className="flex items-center justify-between gap-3 relative z-10">
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                                  <div className={cn('flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-2xl shadow-inner shrink-0', getUserTransactionColor(txType))}>
                                    {getTypeIcon()}
                                  </div>

                                  <div className="min-w-0 flex-1 space-y-0.5 sm:space-y-1">
                                    <p className="font-bold text-xs sm:text-sm text-foreground leading-snug">
                                      {getTransactionLabel(txType, language)}
                                    </p>
                                    <p className="text-[10px] sm:text-[11px] font-medium text-muted-foreground opacity-90 mt-1">
                                      {new Date(tx.created_at).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
                                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                      })}
                                    </p>
                                  </div>
                                </div>

                                <div className="text-end shrink-0 pl-2">
                                  <div
                                    className={cn(
                                      'font-black font-sans text-sm sm:text-base flex items-baseline justify-end gap-1',
                                      isPositive ? 'text-emerald-600' : 'text-red-600',
                                      isStTransaction && (isPositive ? 'text-amber-600' : 'text-orange-600')
                                    )}
                                    dir="ltr"
                                  >
                                    <span>{isPositive ? '+' : '-'}</span>
                                    <PriceFormatter value={displayAmount} />
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">{currencyLabel}</span>
                                  </div>

                                  <p className={cn(
                                    'text-[9px] sm:text-[10px] font-bold mt-1 uppercase tracking-wider',
                                    uiStatus === 'completed' ? 'text-emerald-600' : uiStatus === 'pending' ? 'text-amber-600' : 'text-red-600'
                                  )}>
                                    {uiStatus === 'completed' ? t('statusCompletedTx') : uiStatus === 'pending' ? t('statusPendingTx') : t('statusFailedTx')}
                                  </p>
                                </div>
                              </div>

                              {(txHash || piId || tx.metadata?.merchant_name || tx.metadata?.merchant_orders_confirmed?.[0]?.merchant_name || feeVal != null) && (
                                <div className="mt-4 pt-4 border-t border-border/20 grid gap-3 w-full relative z-10 transition-colors">
                                  
                                  {(tx.metadata?.merchant_name || tx.metadata?.merchant_orders_confirmed?.[0]?.merchant_name) && (
                                    <div className="flex justify-between items-center bg-muted/30 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl border-0 shadow-inner">
                                      <span className="text-muted-foreground flex items-center gap-1.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                                        <Store className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary/70" />
                                        {language === 'ar' ? 'التاجر' : 'Merchant'}:
                                      </span>
                                      <span className="font-bold text-[11px] sm:text-xs text-foreground/90">
                                        {tx.metadata.merchant_name || 'Multiple Merchants'}
                                      </span>
                                    </div>
                                  )}

                                  {piId && (
                                    <div className="flex flex-col gap-1 w-full">
                                      <span className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                                        <FileText className="h-3 w-3" /> Pi Payment ID
                                      </span>
                                      <div className="w-full bg-muted/30 rounded-[1rem] p-2.5 sm:p-3 font-sans text-[10px] sm:text-xs font-bold shadow-inner text-muted-foreground/90 border-0 break-all whitespace-normal leading-relaxed">
                                        {piId}
                                      </div>
                                    </div>
                                  )}

                                  {txHash && (
                                    <div className="flex flex-col gap-1 w-full mt-1">
                                      <span className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
                                        <Hash className="h-3 w-3" /> Transaction Hash
                                      </span>
                                      <div className="flex items-center gap-2 bg-muted/30 rounded-[1rem] p-2 pl-3 sm:p-2.5 sm:pl-4 shadow-inner border-0 w-full">
                                        <span className="font-sans text-[10px] sm:text-[11px] font-bold text-foreground/80 break-all w-full tracking-wider leading-relaxed">
                                          {txHash}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl hover:bg-background shadow-sm text-muted-foreground" onClick={() => handleCopy(txHash!)}>
                                            <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                          </Button>
                                          {blockchainLink && (
                                            <a
                                              href={blockchainLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-xl bg-background shadow-sm hover:bg-muted text-muted-foreground transition-colors"
                                            >
                                              <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {(feeVal != null && Number(feeVal) > 0) && (
                                    <div className="flex justify-between items-center text-muted-foreground px-3 pt-1">
                                      <span className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider">
                                        <Coins className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                        {t('feeLabel')}
                                      </span>
                                      <span className="text-[10px] sm:text-xs font-black flex items-baseline gap-1" dir="ltr">
                                        <span className="font-sans">{Number(feeVal).toFixed(7)}</span>
                                        <span className="text-[9px] sm:text-[10px]">{feeUnit}</span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {loadingMore && (
                          <div className="space-y-4 pt-2">
                            <Skeleton className="h-28 w-full rounded-[1.5rem]" />
                            <Skeleton className="h-28 w-full rounded-[1.5rem]" />
                          </div>
                        )}

                        {!hasMore && transactions.length > 0 && (
                          <p className="text-center text-[11px] sm:text-xs font-bold text-muted-foreground py-6 opacity-60 uppercase tracking-widest">
                            {t('noMoreTransactions') || "End of history"}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-16 flex flex-col items-center justify-center bg-muted/20 rounded-[2rem] border-0 shadow-inner">
                         <div className="h-14 w-14 sm:h-16 sm:w-16 bg-muted/40 rounded-[1.5rem] flex items-center justify-center mb-4">
                           <Filter className="h-6 w-6 sm:h-8 sm:w-8 text-muted-foreground/50" />
                         </div>
                         <span className="text-xs sm:text-sm font-bold text-muted-foreground/70 uppercase tracking-wider">
                            {language === 'ar' ? 'لا توجد معاملات مطابقة' : 'No matching transactions'}
                         </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
              )}

              {activeTab === 'cards' && (
              <TabsContent value="cards" className="mt-0 outline-none">
                <PaymentCardsTab />
              </TabsContent>
              )}

              {/*
                ST CARDS TAB HIDDEN TEMPORARILY
                تم تعليق محتوى تاب بطاقات ST بالكامل حتى لا يظهر.

              {stSettings?.enable_st_system && (
                <TabsContent value="st-token" className="mt-0 outline-none">
                  <StTokenTab />
                </TabsContent>
              )}
              */}
  
              {activeTab === 'sallanet-pay' && (
              <TabsContent value="sallanet-pay" className="mt-0 outline-none">
                <div className="animate-in fade-in duration-150">
                   <ApiSubscribe isEmbedded={true} />
                </div>
              </TabsContent>
              )}

              {activeTab === 'settings' && (
              <TabsContent value="settings" className="mt-0 outline-none">
                <Card className="rounded-[2rem] border-0 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] bg-card animate-in fade-in duration-150">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base font-black">
                      <div className="p-2 bg-slate-100/50 dark:bg-slate-900/30 rounded-xl">
                        <Settings className="h-5 w-5 text-slate-500" />
                      </div>
                      {t('accountSettings')}
                    </CardTitle>
                    <CardDescription className="text-xs font-medium ml-11">{t('customizeSettings')}</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-6">
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="refund-wallet" className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">{t('refundWalletTitle')}</Label>
                        <Input
                          id="refund-wallet"
                          type="text"
                          placeholder="GXXXX...XXXX"
                          value={refundWalletAddress}
                          onChange={e => setRefundWalletAddress(e.target.value)}
                          className={cn("text-sm font-sans tracking-widest", FIELD_CLASS)}
                          dir="ltr"
                        />
                        <p className="text-[10px] font-bold text-muted-foreground ml-1">{t('refundWalletHint')}</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="whatsapp-number" className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">
                          <MessageCircle className="h-3.5 w-3.5 text-green-500" />
                          {language === 'ar' ? 'رقم واتساب للتواصل' : 'WhatsApp Number'}
                        </Label>
                        <Input
                          id="whatsapp-number"
                          type="tel"
                          placeholder="+201234567890"
                          value={whatsappNumber}
                          onChange={e => setWhatsappNumber(e.target.value)}
                          className={cn("text-sm font-sans tracking-widest", FIELD_CLASS)}
                          dir="ltr"
                        />
                        <p className="text-[10px] font-bold text-muted-foreground ml-1">
                          {language === 'ar'
                            ? 'يستخدم للتواصل معك من قبل التجار بخصوص طلباتك'
                            : 'Used by merchants to contact you about your orders'}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="user-country" className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">
                          <Globe className="h-3.5 w-3.5 text-primary/70" />
                          {language === 'ar' ? 'الدولة' : 'Country'}
                        </Label>
                        <Select value={userCountry} onValueChange={setUserCountry}>
                          <SelectTrigger id="user-country" className={cn("text-sm font-bold", FIELD_CLASS)}>
                            <SelectValue placeholder={language === 'ar' ? 'اختر دولتك' : 'Select your country'} />
                          </SelectTrigger>
                          <SelectContent className="max-h-60 border-0 shadow-xl rounded-2xl bg-card">
                            {countries.map(c => (
                              <SelectItem key={c.code} value={c.code} className="rounded-xl mx-1 my-0.5 cursor-pointer font-bold">
                                {language === 'ar' ? c.name : c.nameEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] font-bold text-muted-foreground ml-1">
                          {language === 'ar' 
                            ? 'يُستخدم لتحديد المنتجات المتاحة لك حسب بلدك' 
                            : 'Used to show products available in your country'}
                        </p>
                      </div>

                      <Button
                        onClick={handleSaveSettings}
                        disabled={isSavingSettings}
                        className="w-full gap-2 h-14 rounded-2xl gradient-pi shadow-lg shadow-primary/20 font-black text-sm transition-transform active:scale-[0.98] border-0"
                      >
                        {isSavingSettings ? (
                          <><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">{language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...'}</span></>
                        ) : (
                          <>
                            <CheckCircle className="h-5 w-5" />
                            <span className="text-sm uppercase tracking-wider">{t('saveSettings')}</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              )}

              {currentMerchant && currentMerchant.status === 'active' && activeTab === 'merchant' && (
                <TabsContent value="merchant" className="mt-0 outline-none">
                  <MerchantDashboard />
                </TabsContent>
              )}
            </div>
          </Tabs>
        </div>
      </main>

      <Footer />

      {/* مودال تأكيد السحب القديم بتصميم Soft */}
      {showWithdrawConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 p-4">
          <Card className="w-full max-w-md border-0 shadow-xl rounded-[2.5rem] overflow-hidden bg-card">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3 text-destructive">
                <div className="p-3 bg-destructive/10 rounded-2xl shadow-inner border-0">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <CardTitle className="text-lg font-black">
                  {language === 'ar' ? 'تأكيد عملية السحب' : 'Confirm Withdrawal'}
                </CardTitle>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              <p className="text-sm font-bold text-muted-foreground">
                {language === 'ar'
                  ? 'هل أنت متأكد من إتمام عملية السحب؟ لا يمكن التراجع عن هذا الإجراء بمجرد البدء.'
                  : 'Are you sure you want to proceed? This action cannot be undone once started.'}
              </p>

              <div className="rounded-[1.5rem] bg-muted/30 p-5 shadow-inner border-0 space-y-3">
                <div>
                  <span className="text-[11px] font-black uppercase text-muted-foreground tracking-widest flex items-center gap-1.5 mb-2">
                    <Wallet className="h-3.5 w-3.5" />
                    {language === 'ar' ? 'العنوان المستلم:' : 'Destination Address:'}
                  </span>
                  <p className="font-sans text-xs break-all font-bold text-foreground bg-background p-3.5 rounded-2xl shadow-sm border-0" dir="ltr">
                    {withdrawAddress}
                  </p>
                </div>

                <div className="pt-3 flex justify-between items-center border-t border-border/40 mt-3">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{language === 'ar' ? 'المبلغ المطلوب:' : 'Requested:'}</span>
                  <span className="font-black font-sans text-sm flex items-baseline gap-1" dir="ltr">
                    <span>{parseFloat(withdrawAmount || '0').toFixed(7)}</span>
                    <span className="text-[10px] opacity-80 text-muted-foreground">Pi</span>
                  </span>
                </div>

                <div className="flex justify-between items-center pb-1">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{language === 'ar' ? 'الواصل بعد الرسوم:' : 'Net after fee:'}</span>
                  <span className="font-black font-sans text-base text-emerald-600 flex items-baseline gap-1" dir="ltr">
                    <span>{netWithdrawAmount.toFixed(7)}</span>
                    <span className="text-[10px] opacity-80">Pi</span>
                  </span>
                </div>
              </div>

              <div className="flex gap-3 rounded-[1.5rem] bg-destructive/10 p-4 text-xs text-destructive shadow-inner border-0">
                <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                <p className="leading-relaxed font-bold">
                  {language === 'ar'
                    ? 'تحذير هام: إذا كان العنوان المدخل خطأ، ستفقد أصولك للأبد ولا يمكن استردادها.'
                    : 'Warning: If the address is incorrect, your assets will be lost forever and cannot be recovered.'}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="ghost"
                  className="flex-1 h-12 rounded-2xl bg-muted/40 shadow-sm font-bold border-0 hover:bg-muted"
                  onClick={() => {
                    setShowWithdrawConfirm(false);
                    // ✅ تنظيف المفتاح عند الإلغاء
                    withdrawIdempotencyKeyRef.current = null;
                  }}
                  disabled={isProcessing}
                >
                  <span className="text-sm">{language === 'ar' ? 'إلغاء' : 'Cancel'}</span>
                </Button>

                <Button
                  variant="destructive"
                  className="flex-1 gap-2 h-12 rounded-2xl shadow-lg font-bold border-0"
                  onClick={executeWithdraw}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" /><span className="text-sm">{language === 'ar' ? 'جارٍ التنفيذ...' : 'Processing...'}</span></>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-sm">{language === 'ar' ? 'تأكيد السحب' : 'Confirm Withdraw'}</span>
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* مودال حالة الإيداع والسحب الجديد */}
      <TransactionStatusModal 
        isOpen={transactionModalConfig.isOpen}
        type={transactionModalConfig.type}
        status={transactionModalConfig.status}
        amount={transactionModalConfig.amount}
        errorMessage={transactionModalConfig.errorMessage}
        onClose={() => setTransactionModalConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {/* مودال تسجيل الخروج */}
      {logoutStatus !== 'idle' && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 p-4">
            <div className="w-full max-w-md animate-in fade-in duration-150">
              <Card className="w-full border-0 shadow-xl rounded-[2.5rem] overflow-hidden bg-card">
                {logoutStatus === 'confirm' ? (
                  <CardContent className="p-8 text-center space-y-6">
                    <div className="mx-auto w-20 h-20 bg-red-50 dark:bg-red-950/30 rounded-[1.5rem] flex items-center justify-center mb-4 shadow-inner">
                      <LogOut className="w-10 h-10 text-red-500" strokeWidth={2.5} />
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black text-foreground uppercase tracking-widest">
                      {language === 'ar' ? 'تسجيل الخروج' : 'Log Out'}
                    </h2>
                    <p className="text-muted-foreground font-bold text-sm sm:text-base">
                      {language === 'ar' 
                        ? 'هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟' 
                        : 'Are you sure you want to log out of your account?'}
                    </p>
                    <div className="flex gap-3 pt-4">
                      <Button
                        variant="ghost"
                        className="flex-1 h-12 sm:h-14 rounded-2xl bg-muted/40 shadow-sm border-0 hover:bg-muted"
                        onClick={() => setLogoutStatus('idle')}
                        disabled={isLoggingOut}
                      >
                        <span className="text-xs sm:text-sm font-black uppercase tracking-wider">{language === 'ar' ? 'إلغاء' : 'Cancel'}</span>
                      </Button>
                      <Button
                        variant="destructive"
                        className="flex-1 h-12 sm:h-14 rounded-2xl shadow-lg gap-2 border-0"
                        onClick={executeLogout}
                        disabled={isLoggingOut}
                      >
                        {isLoggingOut ? (
                          <RefreshCw className="h-5 w-5 animate-spin" />
                        ) : (
                          <span className="text-xs sm:text-sm font-black uppercase tracking-wider">{language === 'ar' ? 'نعم، خروج' : 'Yes, Log Out'}</span>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                ) : (
                  <CardContent className="py-12 px-6 text-center">
                    <div className="mx-auto w-24 h-24 rounded-[2rem] bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-6 relative shadow-inner animate-in fade-in duration-150">
                      <div className="absolute inset-0 rounded-[2rem] bg-emerald-500/10 opacity-50"></div>
                      <div className="p-3 bg-emerald-100/50 dark:bg-emerald-900/40 rounded-2xl relative z-10 shadow-sm">
                        <CheckCircle className="w-10 h-10 text-emerald-500" strokeWidth={3} />
                      </div>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-foreground mb-3 tracking-tight">
                      {language === 'ar' ? 'تم تسجيل الخروج' : 'Logged Out Successfully'}
                    </h2>
                    <p className="text-muted-foreground font-bold mb-8 uppercase tracking-widest text-xs">
                      {language === 'ar' ? 'نأمل أن نراك قريبا!' : 'We hope to see you again soon!'}
                    </p>
                    <Button
                      onClick={finalizeLogout}
                      className="w-full h-14 gap-2 gradient-pi rounded-2xl text-base font-black shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-transform duration-150 border-0 uppercase tracking-widest"
                    >
                      <Home className="h-5 w-5" />
                      {language === 'ar' ? 'العودة للرئيسية' : 'Back to Home'}
                    </Button>
                  </CardContent>
                )}
              </Card>
            </div>
          </div>
        )}
    </div>
  );
};

export default Profile;