import { ArrowLeft, Loader2, Lock, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export type WorkspacePanelId = 'update' | 'search' | 'manage' | 'account';

const PANEL_LABELS: Record<WorkspacePanelId, string> = {
  update: 'Update & Migrate Mods',
  search: 'Search Modrinth Mods',
  manage: 'Manage My Mods',
  account: 'Account Workspace',
};

interface AuthGatePanelProps {
  requestedPanel: WorkspacePanelId;
  onBackToLanding: () => void;
}

export function AuthGatePanel({
  requestedPanel,
  onBackToLanding,
}: AuthGatePanelProps) {
  const { authBusy, authError, signInWithGoogle, clearAuthError } = useAuth();

  return (
    <section
      aria-labelledby="auth-gate-heading"
      className="mx-auto max-w-lg py-8 sm:py-12"
    >
      <div className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-emerald-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-emerald-400">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </div>

        <h1
          id="auth-gate-heading"
          className="mt-4 font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          Sign in to open {PANEL_LABELS[requestedPanel]}
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Create or access your ModShift account with Google to manage your tracked mods, search and save releases, and update modpacks across sessions.
        </p>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <span>
            Your local .jar files still stay on your device — only saved mod lists and migration reports sync to your private account.
          </span>
        </div>

        {authError && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
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

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void signInWithGoogle()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            {authBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="h-4 w-4" aria-hidden="true" />
            )}
            <span>Continue with Google</span>
          </button>

          <button
            type="button"
            onClick={onBackToLanding}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Overview</span>
          </button>
        </div>
      </div>
    </section>
  );
}
