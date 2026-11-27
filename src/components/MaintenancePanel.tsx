import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  LogIn,
  LogOut,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { SiteConfig } from '../services/siteConfigService';

interface MaintenancePanelProps {
  siteConfig: SiteConfig;
}

export function MaintenancePanel({ siteConfig }: MaintenancePanelProps) {
  const { user, authReady, authBusy, authError, signInWithGoogle, signOutUser, clearAuthError } =
    useAuth();

  return (
    <section
      aria-labelledby="maintenance-panel-heading"
      className="mx-auto max-w-xl py-10 sm:py-16"
    >
      <div className="rounded-xl border border-amber-200 bg-white p-6 sm:p-8 dark:border-amber-900/60 dark:bg-zinc-900">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400">
          <Wrench className="h-5 w-5" aria-hidden="true" />
        </div>

        <p className="mt-5 text-xs font-medium text-amber-700 dark:text-amber-400">
          Maintenance Mode Active
        </p>
        <h1
          id="maintenance-panel-heading"
          className="mt-1 font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          ModShift is temporarily under maintenance
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {siteConfig.maintenanceMessage}
        </p>

        {siteConfig.newsEnabled && (siteConfig.newsTitle || siteConfig.newsBody) && (
          <div
            role="status"
            className={`mt-5 flex items-start gap-2.5 rounded-lg border p-3.5 text-xs ${
              siteConfig.newsLevel === 'warning'
                ? 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                : siteConfig.newsLevel === 'success'
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200'
            }`}
          >
            {siteConfig.newsLevel === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : siteConfig.newsLevel === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
            )}
            <div className="space-y-0.5">
              {siteConfig.newsTitle && <p className="font-semibold">{siteConfig.newsTitle}</p>}
              {siteConfig.newsBody && (
                <p className="leading-relaxed opacity-90">{siteConfig.newsBody}</p>
              )}
            </div>
          </div>
        )}

        {authError && (
          <div
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={clearAuthError}
              className="font-medium underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-800">
          {!authReady ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Checking session...</span>
            </div>
          ) : user ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Signed in as <span className="font-medium text-zinc-900 dark:text-zinc-100">{user.email}</span>. Access is paused while maintenance is underway.
              </p>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void signOutUser()}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Site administrator? Sign in with your verified Google account to manage maintenance controls.
              </p>
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void signInWithGoogle()}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign In with Google</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
