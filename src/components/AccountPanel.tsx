import {
  ArrowRight,
  CheckCircle2,
  Coins,
  FolderCog,
  Gift,
  History,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  DAILY_CLAIM_COOLDOWN_MS,
  DAILY_CLAIM_CREDITS,
  claimDailyCredits,
  redeemPromoCode,
  subscribeToCreditTransactions,
  type CreditTransactionRecord,
} from '../services/creditsService';
import type { SiteConfig } from '../services/siteConfigService';
import type { WorkspacePanelId } from './AuthGatePanel';

interface AccountPanelProps {
  trackedModsCount: number;
  savedMigrationsCount: number;
  siteConfig: SiteConfig;
  onNavigatePanel: (panel: WorkspacePanelId) => void;
}

export function AccountPanel({
  trackedModsCount,
  savedMigrationsCount,
  siteConfig,
  onNavigatePanel,
}: AccountPanelProps) {
  const {
    user,
    credits,
    lastDailyClaimAt,
    isAdmin,
    profileReady,
    authBusy,
    signOutUser,
  } = useAuth();
  const [transactions, setTransactions] = useState<CreditTransactionRecord[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [dailyFeedback, setDailyFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [redeemingPromo, setRedeemingPromo] = useState(false);
  const [promoFeedback, setPromoFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setLoadingTxs(false);
      return;
    }
    if (!profileReady) {
      setLoadingTxs(true);
      return;
    }
    setLoadingTxs(true);
    const unsub = subscribeToCreditTransactions(
      user.uid,
      (list) => {
        setTransactions(list);
        setLoadingTxs(false);
      },
      () => {
        setLoadingTxs(false);
      },
    );
    return () => unsub();
  }, [user, profileReady]);

  if (!user) return null;

  return (
    <section aria-labelledby="account-panel-heading" className="space-y-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User avatar'}
                referrerPolicy="no-referrer"
                className="h-14 w-14 rounded-full border border-zinc-200 object-cover dark:border-zinc-700"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 font-display text-lg font-bold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {(user.displayName || user.email || 'M').slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h2
                id="account-panel-heading"
                className="truncate font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
              >
                {user.displayName || 'Minecraft Player'}
              </h2>
              <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                {user.email} · Verified Google account
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={authBusy}
            onClick={() => void signOutUser()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-800">
          <div className="bg-zinc-50 p-4 dark:bg-zinc-950">
            <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>Available Credits</span>
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {credits}
            </p>
          </div>
          <div className="bg-zinc-50 p-4 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Tracked Mods</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {trackedModsCount}
            </p>
          </div>
          <div className="bg-zinc-50 p-4 dark:bg-zinc-950">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Saved Migration Snapshots</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {savedMigrationsCount}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span>
            Credit Pricing:{' '}
            {!siteConfig.creditsEnabled || isAdmin ? (
              <strong className="font-medium text-emerald-700 dark:text-emerald-400">
                {isAdmin ? 'Free (Admin account)' : 'Currently free across ModShift'}
              </strong>
            ) : (
              <>
                <span className="font-mono tabular-nums">
                  {siteConfig.migrationCreditCost}
                </span>{' '}
                / migration ·{' '}
                <span className="font-mono tabular-nums">
                  {siteConfig.mrpackCreditCost}
                </span>{' '}
                / .mrpack export ·{' '}
                <span className="font-mono tabular-nums">
                  {siteConfig.libraryCheckCreditCost}
                </span>{' '}
                / library batch check
              </>
            )}
          </span>
        </div>
      </div>

      {/* Daily Free Credits & Promo Code Redemption */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <h3 className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Daily Free Credits (+{DAILY_CLAIM_CREDITS} cr)
                </h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Claim {DAILY_CLAIM_CREDITS} free credits once every 24 hours to run migrations and export .mrpack archives.
              </p>
            </div>
          </div>

          {(() => {
            const elapsed = lastDailyClaimAt ? nowMs - lastDailyClaimAt.getTime() : DAILY_CLAIM_COOLDOWN_MS;
            const cooldownActive = lastDailyClaimAt !== null && elapsed < DAILY_CLAIM_COOLDOWN_MS;
            const remainingMs = cooldownActive ? DAILY_CLAIM_COOLDOWN_MS - elapsed : 0;
            const remHours = Math.floor(remainingMs / (60 * 60 * 1000));
            const remMins = Math.max(
              1,
              Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000)),
            );

            return (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 tabular-nums">
                  {cooldownActive
                    ? `Next claim ready in ${remHours}h ${remMins}m`
                    : 'Ready to claim right now'}
                </span>
                <button
                  type="button"
                  disabled={claimingDaily || cooldownActive || !profileReady}
                  onClick={async () => {
                    if (!user || claimingDaily) return;
                    setClaimingDaily(true);
                    setDailyFeedback(null);
                    try {
                      const nextBal = await claimDailyCredits(user);
                      setDailyFeedback({
                        type: 'success',
                        message: `Added +${DAILY_CLAIM_CREDITS} daily credits. New balance: ${nextBal}.`,
                      });
                    } catch (err) {
                      setDailyFeedback({
                        type: 'error',
                        message:
                          err instanceof Error && !err.message.startsWith('{')
                            ? err.message
                            : 'Unable to claim daily credits right now.',
                      });
                    } finally {
                      setClaimingDaily(false);
                    }
                  }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-emerald-700 disabled:opacity-50"
                >
                  {claimingDaily ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{cooldownActive ? 'Claimed Today' : `Claim +${DAILY_CLAIM_CREDITS} Credits`}</span>
                </button>
              </div>
            );
          })()}

          {dailyFeedback && (
            <p
              className={`mt-3 text-xs font-medium ${
                dailyFeedback.type === 'success'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {dailyFeedback.message}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Redeem Promo Code
            </h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Have an event or creator promo code? Redeem it once per account for instant bonus credits.
          </p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!user || redeemingPromo || !promoInput.trim()) return;
              setRedeemingPromo(true);
              setPromoFeedback(null);
              try {
                const res = await redeemPromoCode(user, promoInput);
                setPromoInput('');
                setPromoFeedback({
                  type: 'success',
                  message: `Redeemed ${res.code} for +${res.creditsGranted} credits (balance: ${res.balanceAfter}).`,
                });
              } catch (err) {
                setPromoFeedback({
                  type: 'error',
                  message:
                    err instanceof Error && !err.message.startsWith('{')
                      ? err.message
                      : 'Could not redeem that promo code.',
                });
              } finally {
                setRedeemingPromo(false);
              }
            }}
            className="mt-4 flex items-center gap-2"
          >
            <input
              type="text"
              maxLength={32}
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              placeholder="ENTER-CODE"
              aria-label="Promo code"
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs uppercase text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={redeemingPromo || !promoInput.trim()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {redeemingPromo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Redeem</span>
            </button>
          </form>

          {promoFeedback && (
            <p
              className={`mt-3 text-xs font-medium ${
                promoFeedback.type === 'success'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {promoFeedback.message}
            </p>
          )}
        </div>
      </div>

      {/* Quick task launchers */}
      <div className="grid gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigatePanel('update')}
          className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
        >
          <div>
            <RefreshCw className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Update Modpack
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Drop local .jar or .mrpack files, verify hashes, and download target updates in bulk.
            </p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span>Open Update Panel</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigatePanel('search')}
          className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
        >
          <div>
            <Search className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Search Mods
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Browse Modrinth projects by loader and Minecraft version and save mods to your library.
            </p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span>Open Search Panel</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigatePanel('manage')}
          className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
        >
          <div>
            <FolderCog className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <h3 className="mt-3 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Manage My Mods
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Batch-check tracked mods for updates, download compatible JARs, and reopen snapshots.
            </p>
          </div>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span>Open Manage Panel</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>

      {/* Credit Transaction Ledger */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            Credit Activity History
          </h3>
        </div>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Recent credit usage and administrator adjustments recorded on your account.
        </p>

        {loadingTxs ? (
          <div className="flex items-center justify-center py-6 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading credit ledger...</span>
          </div>
        ) : transactions.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            No credit transactions yet. Your starter balance of 50 credits is ready to use.
          </p>
        ) : (
          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Action</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Change</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Balance</th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-2 font-medium text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {transactions.map((tx) => {
                  const dateStr = tx.createdAt
                    ? tx.createdAt.toDate().toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                    : 'Just now';
                  return (
                    <tr key={tx.id}>
                      <td className="px-4 py-2.5 text-zinc-800 dark:text-zinc-200">
                        {tx.reason}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono tabular-nums font-medium ${
                          tx.amount >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {tx.balanceAfter}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                        {dateStr}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <span>
          Your profile, credits ledger, tracked mods, and saved migrations are protected by Firebase Authentication and Firestore security rules.
        </span>
      </div>
    </section>
  );
}
