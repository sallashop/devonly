import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, format, isPast, isToday } from 'date-fns';
import { ar, enUS } from 'date-fns/locale';
import {
  Package,
  ShoppingBag,
  BarChart3,
  Settings,
  ArrowDownToLine,
  AlertTriangle,
  Clock,
  XCircle,
  Ticket,
  Undo2,
  History,
  Store,
  Wallet,
  TrendingUp,
  Box,
  Megaphone,
  ShieldAlert,
  FileText,
  Coins,
  Truck,
  MessageCircle,
  CheckCircle,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  useCurrentMerchant,
  useMerchantShippingRates,
  useWithdrawMerchantBalance,
} from '@/hooks/useMerchant';
import { useMerchantProducts } from '@/hooks/useMerchantProducts';
import {
  useMerchantOrders,
  useMerchantReturnRequests,
} from '@/hooks/useMerchantOrders';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import MerchantProductsPanel from './MerchantProductsPanel';
import MerchantOrdersPanel from './MerchantOrdersPanel';
import MerchantSettingsPanel from './MerchantSettingsPanel';
import MerchantStatsPanel from './MerchantStatsPanel';
import MerchantCouponsPanel from './MerchantCouponsPanel';
import MerchantReturnsPanel from './MerchantReturnsPanel';
import MerchantTransactionsPanel from './MerchantTransactionsPanel';
import MerchantStatusAlert from './MerchantStatusAlert';
import MerchantNotificationBell from './MerchantNotificationBell';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PiAmountDisplay } from '@/components/common/PiAmountDisplay';
import { cn } from '@/lib/utils';

type MerchantTab =
  | 'stats'
  | 'products'
  | 'orders'
  | 'returns'
  | 'transactions'
  | 'coupons'
  | 'settings';

type SubscriptionStatus =
  | {
      status: 'expired' | 'expires_today' | 'expiring_soon' | 'expiring' | 'active';
      daysRemaining: number;
      formattedDate?: string;
    }
  | null;

type DashboardStatCardProps = {
  icon: LucideIcon;
  value: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  colorClass?: string;
  iconBoxClass?: string;
  className?: string;
};

type SubscriptionAlertProps = {
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: string | null;
  t: (key: string) => string;
  onRenew: () => void;
};

type WithdrawDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: string;
  t: (key: string) => string;
  language: string;
  balance: number;
  withdrawAmount: string;
  isPending: boolean;
  onAmountChange: (value: string) => void;
  onWithdraw: () => Promise<void>;
};

type GuidelinesItemProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  variant?: 'default' | 'red' | 'orange' | 'amber';
};

const VIEWED_GUIDELINES_KEY = 'merchantViewedGuidelines';
const DEFAULT_TAB: MerchantTab = 'stats';

const TAB_CLASS =
  'gap-2 rounded-xl border-0 data-[state=active]:bg-background data-[state=active]:shadow-sm';

const DASHBOARD_CARD_CLASS =
  'rounded-[1.35rem] border-0 bg-card p-3 shadow-sm transition-transform duration-150 hover:-translate-y-0.5 sm:p-4 dark:shadow-none';

const DIALOG_CONTENT_CLASS =
  'rounded-[2rem] border-0 bg-card shadow-2xl [&>button]:hidden';

const toNumber = (value: unknown, fallback = 0) => {
  const numberValue = Number(value ?? fallback);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const normalizeStatus = (status: unknown) => {
  return String(status || '').toLowerCase();
};

const getSubscriptionStatus = (
  subscriptionExpiresAt?: string | null,
  language = 'en'
): SubscriptionStatus => {
  if (!subscriptionExpiresAt) return null;

  const expiryDate = new Date(subscriptionExpiresAt);
  if (Number.isNaN(expiryDate.getTime())) return null;

  const now = new Date();
  const daysRemaining = differenceInDays(expiryDate, now);
  const formattedDate = format(expiryDate, 'dd MMMM yyyy', {
    locale: language === 'ar' ? ar : enUS,
  });

  if (isPast(expiryDate) && !isToday(expiryDate)) {
    return { status: 'expired', daysRemaining: 0, formattedDate };
  }

  if (isToday(expiryDate)) {
    return { status: 'expires_today', daysRemaining: 0, formattedDate };
  }

  if (daysRemaining <= 7) {
    return { status: 'expiring_soon', daysRemaining, formattedDate };
  }

  if (daysRemaining <= 30) {
    return { status: 'expiring', daysRemaining, formattedDate };
  }

  return { status: 'active', daysRemaining, formattedDate };
};

const PROCESSING_STATUSES = new Set(['confirmed', 'processing', 'shipped']);

const getOrderCounters = (orders: any[] = []) => {
  let pendingOrders = 0;
  let processingOrders = 0;

  for (const order of orders) {
    const status = normalizeStatus(order?.status);

    if (status === 'pending') {
      pendingOrders += 1;
      continue;
    }

    if (PROCESSING_STATUSES.has(status)) {
      processingOrders += 1;
    }
  }

  return {
    pendingOrders,
    processingOrders,
  };
};

const getPendingReturnsCount = (returnRequests: any[] = []) => {
  return returnRequests.filter(
    (request) => normalizeStatus(request?.status) === 'pending'
  ).length;
};

const SubscriptionAlert = memo(function SubscriptionAlert({
  subscriptionStatus,
  subscriptionExpiresAt,
  t,
  onRenew,
}: SubscriptionAlertProps) {
  if (!subscriptionStatus || subscriptionStatus.status === 'active') return null;

  if (subscriptionStatus.status === 'expired') {
    return (
      <Alert className="rounded-2xl border-0 bg-destructive/10 shadow-sm" variant="destructive">
        <XCircle className="h-5 w-5" strokeWidth={2.5} />
        <AlertTitle className="font-black">{t('subscriptionExpiredTitle')}</AlertTitle>

        <AlertDescription className="flex flex-col gap-3 font-semibold sm:flex-row sm:items-center">
          <span>{t('subscriptionExpiredMsg')}</span>

          <Button
            size="sm"
            variant="destructive"
            onClick={onRenew}
            className="w-fit rounded-xl border-0 font-black"
          >
            {t('renewSubscription')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (subscriptionStatus.status === 'expires_today') {
    return (
      <Alert className="rounded-2xl border-0 bg-yellow-500/10 shadow-sm">
        <AlertTriangle className="h-5 w-5 text-yellow-600" strokeWidth={2.5} />
        <AlertTitle className="font-black text-yellow-700 dark:text-yellow-400">
          {t('subscriptionExpiringTitle')}
        </AlertTitle>

        <AlertDescription className="flex flex-col gap-3 font-semibold text-yellow-700 dark:text-yellow-400 sm:flex-row sm:items-center">
          <span>{t('subscriptionExpiresToday')}</span>

          <Button
            size="sm"
            variant="outline"
            onClick={onRenew}
            className="w-fit rounded-xl border-0 bg-yellow-500/10 font-black text-yellow-700 hover:bg-yellow-500/20 dark:text-yellow-300"
          >
            {t('renewSubscription')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (subscriptionStatus.status === 'expiring_soon') {
    return (
      <Alert className="rounded-2xl border-0 bg-orange-500/10 shadow-sm">
        <Clock className="h-5 w-5 text-orange-600" strokeWidth={2.5} />
        <AlertTitle className="font-black text-orange-700 dark:text-orange-400">
          {t('subscriptionExpiringTitle')}
        </AlertTitle>

        <AlertDescription className="flex flex-col gap-3 font-semibold text-orange-700 dark:text-orange-400 sm:flex-row sm:items-center">
          <span>
            {t('subscriptionExpiringDays').replace(
              '{days}',
              subscriptionStatus.daysRemaining.toString()
            )}
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={onRenew}
            className="w-fit rounded-xl border-0 bg-orange-500/10 font-black text-orange-700 hover:bg-orange-500/20 dark:text-orange-300"
          >
            {t('renewSubscription')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (subscriptionStatus.status === 'expiring') {
    return (
      <Alert className="rounded-2xl border-0 bg-blue-500/10 shadow-sm">
        <Clock className="h-5 w-5 text-blue-600" strokeWidth={2.5} />
        <AlertTitle className="font-black text-blue-700 dark:text-blue-400">
          {t('subscriptionValidUntil')}
        </AlertTitle>

        <AlertDescription className="font-semibold text-blue-700 dark:text-blue-400">
          {subscriptionExpiresAt && subscriptionStatus.formattedDate}{' '}
          (
          {t('subscriptionExpiringDays').replace(
            '{days}',
            subscriptionStatus.daysRemaining.toString()
          )}
          )
        </AlertDescription>
      </Alert>
    );
  }

  return null;
});

const WithdrawDialog = memo(function WithdrawDialog({
  open,
  onOpenChange,
  direction,
  t,
  language,
  balance,
  withdrawAmount,
  isPending,
  onAmountChange,
  onWithdraw,
}: WithdrawDialogProps) {
  const handleUseAllBalance = useCallback(() => {
    const safeAmount = Math.max(0, balance - 0.0001);
    onAmountChange(safeAmount > 0 ? safeAmount.toFixed(4) : '0');
  }, [balance, onAmountChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4 w-full gap-2 rounded-2xl border-0 bg-white/20 font-black text-primary-foreground shadow-none hover:bg-white/30"
        >
          <ArrowDownToLine className="h-4 w-4" strokeWidth={2.5} />
          {t('withdrawToBalance')}
        </Button>
      </DialogTrigger>

      <DialogContent
        dir={direction}
        className={cn(DIALOG_CONTENT_CLASS, 'max-w-xs p-5 sm:max-w-sm')}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-black">
            {t('transferToInternalBalance')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-2xl border-0 bg-muted/40 p-4 text-center shadow-inner">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              {t('availableStoreBalance')}
            </p>

            <PiAmountDisplay
              amount={balance}
              className="text-xl font-black text-primary"
            />
          </div>

          <Input
            type="number"
            step="0.0000001"
            value={withdrawAmount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder={t('amountLabel')}
            dir="ltr"
            className="h-11 rounded-xl border-0 bg-muted/40 font-mono text-base font-bold shadow-inner focus-visible:ring-2 focus-visible:ring-primary/20"
          />

          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-xl border-0 bg-muted font-black hover:bg-muted/80"
            onClick={handleUseAllBalance}
          >
            {t('allBalance')}
          </Button>

          <Button
            className="h-11 w-full rounded-xl border-0 font-black"
            onClick={onWithdraw}
            disabled={isPending || !withdrawAmount}
          >
            {isPending ? (
              <span className="animate-pulse">
                {language === 'ar' ? 'جاري التحويل...' : 'Processing...'}
              </span>
            ) : (
              t('confirmTransfer')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

const DashboardStatCard = memo(function DashboardStatCard({
  icon: Icon,
  value,
  label,
  onClick,
  active,
  colorClass = 'text-muted-foreground',
  iconBoxClass = 'bg-muted',
  className,
}: DashboardStatCardProps) {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        DASHBOARD_CARD_CLASS,
        'w-full text-start',
        onClick && 'cursor-pointer active:scale-[0.98]',
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl shadow-inner',
            iconBoxClass
          )}
        >
          <Icon className={cn('h-4 w-4', colorClass)} strokeWidth={2.5} />
        </div>

        <span className={cn('text-2xl font-black', active && colorClass)}>
          {value}
        </span>
      </div>

      <p className="truncate text-xs font-bold text-muted-foreground sm:text-sm">
        {label}
      </p>
    </Component>
  );
});

const DashboardHeader = memo(function DashboardHeader({
  merchant,
  language,
  t,
  pendingOrders,
  processingOrders,
  pendingReturns,
  productsCount,
  hasViewedGuidelines,
  withdrawAmount,
  showWithdrawDialog,
  direction,
  withdrawPending,
  onWithdrawDialogChange,
  onWithdrawAmountChange,
  onWithdraw,
  onOpenGuidelines,
  onRequestAd,
  onProductsClick,
  onPendingOrdersClick,
  onProcessingOrdersClick,
  onReturnsClick,
}: {
  merchant: any;
  language: string;
  t: (key: string) => string;
  pendingOrders: number;
  processingOrders: number;
  pendingReturns: number;
  productsCount: number;
  hasViewedGuidelines: boolean;
  withdrawAmount: string;
  showWithdrawDialog: boolean;
  direction: string;
  withdrawPending: boolean;
  onWithdrawDialogChange: (open: boolean) => void;
  onWithdrawAmountChange: (value: string) => void;
  onWithdraw: () => Promise<void>;
  onOpenGuidelines: () => void;
  onRequestAd: () => void;
  onProductsClick: () => void;
  onPendingOrdersClick: () => void;
  onProcessingOrdersClick: () => void;
  onReturnsClick: () => void;
}) {
  const isAr = language === 'ar';

  return (
    <div className="relative overflow-hidden rounded-[2rem] border-0 bg-gradient-to-br from-primary/15 via-primary/5 to-background shadow-lg">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute right-0 top-0 h-40 w-40 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10" />
        <div className="absolute bottom-0 left-0 h-32 w-32 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary/5" />
      </div>

      <div className="relative p-4 sm:p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="relative shrink-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/25 sm:h-16 sm:w-16">
                <Store className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" strokeWidth={2.5} />
              </div>

              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-green-500">
                <span className="h-2 w-2 rounded-full bg-white" />
              </div>
            </div>

            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-foreground sm:text-2xl">
                {merchant.name}
              </h1>

              <p className="text-sm font-semibold text-muted-foreground sm:text-base">
                {t('welcomeMerchant')} 👋
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MerchantNotificationBell />

            <Button
              variant="outline"
              size="icon"
              onClick={onOpenGuidelines}
              className="relative h-10 w-10 rounded-xl border-0 bg-primary/5 hover:bg-primary/10"
            >
              <BookOpen className="h-5 w-5 text-primary" strokeWidth={2.5} />

              {!hasViewedGuidelines && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background bg-red-500" />
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onRequestAd}
              className="h-10 gap-2 rounded-xl border-0 bg-primary/5 font-black hover:bg-primary/10"
            >
              <Megaphone className="h-4 w-4" strokeWidth={2.5} />
              <span className="hidden sm:inline">
                {isAr ? 'طلب إعلان' : 'Request Ad'}
              </span>
            </Button>

            <div className="hidden items-center gap-2 rounded-full border-0 bg-primary/10 px-4 py-2 sm:flex">
              <BarChart3 className="h-4 w-4 text-primary" strokeWidth={2.5} />
              <span className="text-sm font-black text-primary">
                {t('merchantDashboard')}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <div className="col-span-2 rounded-[1.35rem] border-0 bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground shadow-lg shadow-primary/20 sm:col-span-1 sm:row-span-2">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-5 w-5 opacity-80" strokeWidth={2.5} />
              <span className="text-sm font-bold opacity-90">
                {t('storeBalance')}
              </span>
            </div>

            <PiAmountDisplay
              amount={toNumber(merchant.merchant_balance)}
              className="text-2xl font-black sm:text-3xl"
            />

            <WithdrawDialog
              open={showWithdrawDialog}
              onOpenChange={onWithdrawDialogChange}
              direction={direction}
              t={t}
              language={language}
              balance={toNumber(merchant.merchant_balance)}
              withdrawAmount={withdrawAmount}
              isPending={withdrawPending}
              onAmountChange={onWithdrawAmountChange}
              onWithdraw={onWithdraw}
            />
          </div>

          <DashboardStatCard
            icon={Box}
            value={productsCount}
            label={t('productsCount')}
            onClick={onProductsClick}
            iconBoxClass="bg-blue-100 dark:bg-blue-900/30"
            colorClass="text-blue-600 dark:text-blue-400"
          />

          <DashboardStatCard
            icon={Clock}
            value={pendingOrders}
            label={t('pendingOrders')}
            onClick={onPendingOrdersClick}
            active={pendingOrders > 0}
            className={pendingOrders > 0 ? 'bg-yellow-50/50 dark:bg-yellow-900/10' : undefined}
            iconBoxClass={pendingOrders > 0 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-muted'}
            colorClass={
              pendingOrders > 0
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground'
            }
          />

          <DashboardStatCard
            icon={TrendingUp}
            value={processingOrders}
            label={t('processingOrders')}
            onClick={onProcessingOrdersClick}
            active={processingOrders > 0}
            className={processingOrders > 0 ? 'bg-blue-50/50 dark:bg-blue-900/10' : undefined}
            iconBoxClass={processingOrders > 0 ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-muted'}
            colorClass={
              processingOrders > 0
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-muted-foreground'
            }
          />

          {pendingReturns > 0 && (
            <DashboardStatCard
              icon={Undo2}
              value={pendingReturns}
              label={isAr ? 'طلبات إرجاع' : 'Return Requests'}
              onClick={onReturnsClick}
              active
              className="bg-indigo-50/50 dark:bg-indigo-900/10"
              iconBoxClass="bg-indigo-100 dark:bg-indigo-900/30"
              colorClass="text-indigo-600 dark:text-indigo-400"
            />
          )}
        </div>
      </div>
    </div>
  );
});

const MerchantTabsNav = memo(function MerchantTabsNav({
  activeTab,
  direction,
  language,
  t,
  pendingOrders,
  pendingReturns,
  onTabChange,
}: {
  activeTab: MerchantTab;
  direction: string;
  language: string;
  t: (key: string) => string;
  pendingOrders: number;
  pendingReturns: number;
  onTabChange: (value: string) => void;
}) {
  const isAr = language === 'ar';

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} dir={direction}>
      <TabsList className="grid h-12 w-full grid-cols-7 rounded-2xl bg-muted/50 p-1">
        <TabsTrigger value="stats" className={TAB_CLASS}>
          <BarChart3 className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">{t('statsTab')}</span>
        </TabsTrigger>

        <TabsTrigger value="products" className={TAB_CLASS}>
          <Package className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">{t('productsTab')}</span>
        </TabsTrigger>

        <TabsTrigger value="orders" className={cn(TAB_CLASS, 'relative')}>
          <ShoppingBag className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">{t('ordersTab')}</span>

          {pendingOrders > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 ring-2 ring-background" />
            </span>
          )}
        </TabsTrigger>

        <TabsTrigger value="returns" className={cn(TAB_CLASS, 'relative')}>
          <Undo2 className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">
            {isAr ? 'الإرجاع' : 'Returns'}
          </span>

          {pendingReturns > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-500 ring-2 ring-background" />
            </span>
          )}
        </TabsTrigger>

        <TabsTrigger value="transactions" className={TAB_CLASS}>
          <History className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">
            {isAr ? 'السجل' : 'History'}
          </span>
        </TabsTrigger>

        <TabsTrigger value="coupons" className={TAB_CLASS}>
          <Ticket className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">
            {isAr ? 'كوبونات' : 'Coupons'}
          </span>
        </TabsTrigger>

        <TabsTrigger value="settings" className={TAB_CLASS}>
          <Settings className="h-4 w-4" strokeWidth={2.5} />
          <span className="hidden sm:inline">{t('settingsTab')}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
});

const GuidelinesItem = memo(function GuidelinesItem({
  icon: Icon,
  title,
  description,
  variant = 'default',
}: GuidelinesItemProps) {
  const variantClasses = {
    default: 'bg-background dark:bg-card border border-border/60 dark:border-white/5 text-muted-foreground',
    red: 'bg-red-50 dark:bg-red-950/40 border-0 dark:border dark:border-red-900/50 text-red-600/90 dark:text-red-300/80',
    orange:
      'bg-orange-50 dark:bg-orange-950/40 border-0 dark:border dark:border-orange-900/50 text-orange-600/90 dark:text-orange-300/80',
    amber:
      'bg-amber-50 dark:bg-amber-950/40 border-0 dark:border dark:border-amber-900/50 text-amber-600/90 dark:text-amber-300/80',
  }[variant];

  const titleClasses = {
    default: 'text-foreground',
    red: 'text-red-700 dark:text-red-400',
    orange: 'text-orange-700 dark:text-orange-400',
    amber: 'text-amber-700 dark:text-amber-400',
  }[variant];

  const iconClasses = {
    default: 'text-primary',
    red: 'text-red-500',
    orange: 'text-orange-500',
    amber: 'text-amber-500',
  }[variant];

  return (
    <div className={cn('flex gap-3 rounded-xl p-3 shadow-sm', variantClasses)}>
      <div className="mt-1">
        <Icon className={cn('h-5 w-5', iconClasses)} strokeWidth={2.5} />
      </div>

      <div>
        <h4 className={cn('mb-1 text-sm font-black', titleClasses)}>
          {title}
        </h4>

        <p className="text-xs font-semibold leading-relaxed">{description}</p>
      </div>
    </div>
  );
});

const GuidelinesDialog = memo(function GuidelinesDialog({
  open,
  onOpenChange,
  direction,
  language,
  merchantName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: string;
  language: string;
  merchantName: string;
}) {
  const isAr = language === 'ar';

  const items = useMemo(
    () => [
      {
        icon: CheckCircle,
        title: isAr ? 'الجودة هي الضمان' : 'Quality is Key',
        description: isAr
          ? 'الجودة التي تقدمها هي سر استمراريتك معنا. المنتجات الأصلية والمطابقة للوصف تبني ثقة العملاء.'
          : 'The quality you provide is your guarantee of continuity. Authentic items build trust.',
        variant: 'default' as const,
      },
      {
        icon: Truck,
        title: isAr ? 'سياسة الإرجاع والشحن الصارمة' : 'Strict Return & Shipping Policy',
        description: isAr
          ? 'نظامنا صارم: في حال الإرجاع بسبب رداءة المنتج أو مخالفته، ستتحمل أنت التاجر تكلفة الشحن كاملة ومصاريف استعادة المنتج.'
          : 'Our system is strict: For returns due to bad quality, you bear the full shipping costs.',
        variant: 'red' as const,
      },
      {
        icon: ShieldAlert,
        title: isAr ? 'حماية النظام (Pi Username)' : 'System Protection',
        description: isAr
          ? 'أنت مسجل معنا بـ Pi Username. أي تلاعب أو مخالفة جسيمة للنظام قد تعرضك للحظر النهائي وعدم إمكانية استخدام خدماتنا مستقبلا.'
          : 'Violation of rules may lead to a permanent ban on your Pi Username.',
        variant: 'orange' as const,
      },
      {
        icon: Box,
        title: isAr ? 'متى تبدأ التجهيز؟' : 'When to Process?',
        description: isAr
          ? 'لا تبدأ في تجهيز أو شحن أي طلب إلا إذا كانت حالته مؤكد وبعد التواصل المباشر مع المشتري للتأكيد.'
          : 'Do not start processing unless the order status is Confirmed and you contacted the buyer.',
        variant: 'default' as const,
      },
      {
        icon: FileText,
        title: isAr ? 'اتفاقية الاسترداد (سعر Pi)' : 'Refund Policy (Pi Rate)',
        description: isAr
          ? 'عملية الاسترداد للمشتري تكون بما يقابل قيمة المنتج بـ Pi وقت الشراء، بغض النظر عن ارتفاع سعر العملة لاحقا أثناء دورة الطلب.'
          : 'Refunds are based on the Pi value at the time of purchase, regardless of price fluctuations.',
        variant: 'default' as const,
      },
      {
        icon: Coins,
        title: isAr ? 'عملة المول (ST Token)' : 'Mall Token (ST)',
        description: isAr
          ? 'لك الحرية في قبول ST أو رفضه من الإعدادات، لكن تذكر أنها عملة المول واستخدامك لها يزيد من تنوع عملائك وفرص نجاح متجرك.'
          : 'Accepting ST is optional but recommended to increase your sales opportunities.',
        variant: 'amber' as const,
      },
      {
        icon: MessageCircle,
        title: isAr ? 'التواصل الفعال' : 'Effective Communication',
        description: isAr
          ? 'الرد السريع والمهذب على استفسارات العملاء يقلل من احتمالية النزاعات والمرتجعات بشكل كبير.'
          : 'Quick and polite communication reduces disputes significantly.',
        variant: 'default' as const,
      },
    ],
    [isAr]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={direction}
        className={cn(
          DIALOG_CONTENT_CLASS,
          'max-h-[85vh] max-w-sm overflow-y-auto p-5 shadow-xl [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-primary">
            <BookOpen className="h-6 w-6" strokeWidth={2.5} />
            {isAr ? 'تنبيهات وإرشادات هامة' : 'Important Guidelines'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-xl border-0 bg-primary/5 p-3 text-sm font-semibold text-muted-foreground dark:bg-primary/10">
            {isAr
              ? `مرحبا ${merchantName}. لضمان نجاحك واستمراريتك معنا، يرجى قراءة هذه القواعد بتمعن.`
              : `Hello ${merchantName}. To ensure your success, please read these rules carefully.`}
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <GuidelinesItem
                key={item.title}
                icon={item.icon}
                title={item.title}
                description={item.description}
                variant={item.variant}
              />
            ))}
          </div>

          <Button
            className="mt-4 w-full rounded-xl border-0 font-black"
            onClick={() => onOpenChange(false)}
          >
            {isAr ? 'فهمت، سألتزم بالقواعد' : 'Understood, I will comply'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

const MerchantDashboard = () => {
  const { t, direction, language } = useLanguage();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();

  const { data: merchant } = useCurrentMerchant();
  const { data: products = [] } = useMerchantProducts(merchant?.id);
  const { data: orders = [] } = useMerchantOrders(merchant?.id);
  const { data: shippingRates } = useMerchantShippingRates(merchant?.id);
  const { data: returnRequests = [] } = useMerchantReturnRequests(merchant?.id);
  const withdrawMutation = useWithdrawMerchantBalance();

  const [activeTab, setActiveTab] = useState<MerchantTab>(DEFAULT_TAB);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [ordersFilter, setOrdersFilter] = useState<string>('all');
  const [showGuidelinesDialog, setShowGuidelinesDialog] = useState(false);
  const [hasViewedGuidelines, setHasViewedGuidelines] = useState(false);

  useEffect(() => {
    try {
      setHasViewedGuidelines(
        sessionStorage.getItem(VIEWED_GUIDELINES_KEY) === 'true'
      );
    } catch {
      setHasViewedGuidelines(false);
    }
  }, []);

  const safeProducts = useMemo(
    () => (Array.isArray(products) ? products : []),
    [products]
  );

  const safeOrders = useMemo(
    () => (Array.isArray(orders) ? orders : []),
    [orders]
  );

  const safeReturns = useMemo(
    () => (Array.isArray(returnRequests) ? returnRequests : []),
    [returnRequests]
  );

  const subscriptionStatus = useMemo(
    () => getSubscriptionStatus(merchant?.subscription_expires_at, language),
    [language, merchant?.subscription_expires_at]
  );

  const { pendingOrders, processingOrders } = useMemo(
    () => getOrderCounters(safeOrders),
    [safeOrders]
  );

  const pendingReturns = useMemo(
    () => getPendingReturnsCount(safeReturns),
    [safeReturns]
  );

  const handleOpenGuidelines = useCallback(() => {
    setShowGuidelinesDialog(true);
    setHasViewedGuidelines(true);

    try {
      sessionStorage.setItem(VIEWED_GUIDELINES_KEY, 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleWithdraw = useCallback(async () => {
    if (!merchant) return;

    const amount = parseFloat(withdrawAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('enterValidAmount'));
      return;
    }

    if (amount > toNumber(merchant.merchant_balance)) {
      toast.error(t('insufficientBalance'));
      return;
    }

    try {
      await withdrawMutation.mutateAsync({ merchantId: merchant.id, amount });
      await refreshProfile();

      setWithdrawAmount('');
      setShowWithdrawDialog(false);
      toast.success(t('transferSuccessful'));
    } catch (error: any) {
      toast.error(error?.message || t('enterValidAmount'));
    }
  }, [merchant, refreshProfile, t, withdrawAmount, withdrawMutation]);

  const handlePendingOrdersClick = useCallback(() => {
    setOrdersFilter('pending');
    setActiveTab('orders');
  }, []);

  const handleProcessingOrdersClick = useCallback(() => {
    setOrdersFilter('confirmed');
    setActiveTab('orders');
  }, []);

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value as MerchantTab);

    if (value === 'orders') {
      setOrdersFilter('all');
    }
  }, []);

  const handleProductsClick = useCallback(() => {
    setActiveTab('products');
  }, []);

  const handleReturnsClick = useCallback(() => {
    setActiveTab('returns');
  }, []);

  const handleRenewSubscription = useCallback(() => {
    navigate('/renew-subscription');
  }, [navigate]);

  const handleRequestAd = useCallback(() => {
    navigate('/request-ad');
  }, [navigate]);


  const activePanel = useMemo(() => {
    if (!merchant) return null;

    switch (activeTab) {
      case 'stats':
        return (
          <MerchantStatsPanel
            merchant={merchant}
            orders={safeOrders}
            products={safeProducts}
          />
        );

      case 'products':
        return (
          <MerchantProductsPanel
            merchant={merchant}
            products={safeProducts}
          />
        );

      case 'orders':
        return (
          <MerchantOrdersPanel
            merchant={merchant}
            orders={safeOrders}
            defaultFilter={ordersFilter}
          />
        );

      case 'returns':
        return <MerchantReturnsPanel merchant={merchant} />;

      case 'transactions':
        return <MerchantTransactionsPanel merchantId={merchant.id} />;

      case 'coupons':
        return <MerchantCouponsPanel merchantId={merchant.id} />;

      case 'settings':
        return (
          <MerchantSettingsPanel
            merchant={merchant}
            shippingRates={shippingRates}
          />
        );

      default:
        return null;
    }
  }, [
    activeTab,
    merchant,
    ordersFilter,
    safeOrders,
    safeProducts,
    shippingRates,
  ]);

  if (merchant?.status === 'suspended') {
    return (
      <div className="mx-auto max-w-md" dir={direction}>
        <MerchantStatusAlert
          status="suspended"
          reason={merchant.suspension_reason}
        />
      </div>
    );
  }

  if (!merchant || merchant.status !== 'active') {
    return null;
  }

  return (
    <div className="space-y-6" dir={direction}>
      <SubscriptionAlert
        subscriptionStatus={subscriptionStatus}
        subscriptionExpiresAt={merchant.subscription_expires_at}
        t={t}
        onRenew={handleRenewSubscription}
      />

      <DashboardHeader
        merchant={merchant}
        language={language}
        t={t}
        pendingOrders={pendingOrders}
        processingOrders={processingOrders}
        pendingReturns={pendingReturns}
        productsCount={safeProducts.length}
        hasViewedGuidelines={hasViewedGuidelines}
        withdrawAmount={withdrawAmount}
        showWithdrawDialog={showWithdrawDialog}
        direction={direction}
        withdrawPending={withdrawMutation.isPending}
        onWithdrawDialogChange={setShowWithdrawDialog}
        onWithdrawAmountChange={setWithdrawAmount}
        onWithdraw={handleWithdraw}
        onOpenGuidelines={handleOpenGuidelines}
        onRequestAd={handleRequestAd}
        onProductsClick={handleProductsClick}
        onPendingOrdersClick={handlePendingOrdersClick}
        onProcessingOrdersClick={handleProcessingOrdersClick}
        onReturnsClick={handleReturnsClick}
      />

      <MerchantTabsNav
        activeTab={activeTab}
        direction={direction}
        language={language}
        t={t}
        pendingOrders={pendingOrders}
        pendingReturns={pendingReturns}
        onTabChange={handleTabChange}
      />

      <div className="mt-6 [content-visibility:auto] [contain-intrinsic-size:800px]">
        {activePanel}
      </div>

      <GuidelinesDialog
        open={showGuidelinesDialog}
        onOpenChange={setShowGuidelinesDialog}
        direction={direction}
        language={language}
        merchantName={merchant.name}
      />
    </div>
  );
};

export default memo(MerchantDashboard);