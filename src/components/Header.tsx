import { Coins, Loader2, LogIn, Moon, Sun, User as UserIcon } from 'lucide-react';
import { BRAND_CONFIG } from '../config/brand';
import { useAuth } from '../contexts/AuthContext';
import type { WorkspacePanelId } from './AuthGatePanel';

interface HeaderProps {
  theme: 'light' | 'dark';
  viewMode: 'landing' | 'workspace' | 'auth_gate' | 'maintenance';
  activePanel: WorkspacePanelId;
  creditsEnabled?: boolean;
  onToggleTheme: () => void;
  onGoLanding: () => void;
  onNavigatePanel: (panel: WorkspacePanelId) => void;
}

export function Header({
  theme,
  viewMode,
  activePanel,
  creditsEnabled = true,
  onToggleTheme,
  onGoLanding,
  onNavigatePanel,
}: HeaderProps) {
  const { user, credits, isAdmin, authReady, authBusy, signInWithGoogle } = useAuth();

  const isPanelActive = (panel: WorkspacePanelId) =>
    viewMode === 'workspace' && activePanel === panel;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onGoLanding}
          className="font-display text-lg font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded-sm dark:text-zinc-50"
        >
          {BRAND_CONFIG.name}
        </button>

        {viewMode !== 'maintenance' && (
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            <button
              type="button"
              onClick={onGoLanding}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 hover:underline underline-offset-4 dark:hover:text-zinc-100 ${
                viewMode === 'landing'
                  ? 'text-zinc-950 underline dark:text-zinc-50'
                  : ''
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => onNavigatePanel('update')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 hover:underline underline-offset-4 dark:hover:text-zinc-100 ${
                isPanelActive('update')
                  ? 'text-zinc-950 underline dark:text-zinc-50'
                  : ''
              }`}
            >
              Update Mods
            </button>
            <button
              type="button"
              onClick={() => onNavigatePanel('search')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 hover:underline underline-offset-4 dark:hover:text-zinc-100 ${
                isPanelActive('search')
                  ? 'text-zinc-950 underline dark:text-zinc-50'
                  : ''
              }`}
            >
              Search Mods
            </button>
            <button
              type="button"
              onClick={() => onNavigatePanel('manage')}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 hover:underline underline-offset-4 dark:hover:text-zinc-100 ${
                isPanelActive('manage')
                  ? 'text-zinc-950 underline dark:text-zinc-50'
                  : ''
              }`}
            >
              Manage Mods
            </button>
          </nav>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {authReady && (
            user ? (
              <>
                {creditsEnabled && viewMode !== 'maintenance' && (
                  <button
                    type="button"
                    onClick={() => onNavigatePanel('account')}
                    title={isAdmin ? 'Admin account (no credit deductions)' : 'View credits & history'}
                    aria-label={`Credits balance: ${credits}. Open account workspace`}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    <span className="font-mono tabular-nums">{credits}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onNavigatePanel('account')}
                  aria-label="Open account workspace"
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                    isPanelActive('account')
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
                  }`}
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-4 w-4 rounded-full object-cover"
                    />
                  ) : (
                    <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="max-w-[130px] truncate">
                    {user.displayName || user.email}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={() => void signInWithGoogle()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {authBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{authBusy ? 'Signing In...' : 'Sign In'}</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Dark</span>
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode !== 'maintenance' && (
        <nav
          aria-label="Mobile navigation"
          className="flex md:hidden items-center gap-4 overflow-x-auto border-t border-zinc-100 px-4 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-900 dark:text-zinc-400"
        >
          <button
            type="button"
            onClick={onGoLanding}
            className={`whitespace-nowrap shrink-0 ${
              viewMode === 'landing'
                ? 'text-zinc-950 underline underline-offset-4 dark:text-zinc-50'
                : ''
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => onNavigatePanel('update')}
            className={`whitespace-nowrap shrink-0 ${
              isPanelActive('update')
                ? 'text-zinc-950 underline underline-offset-4 dark:text-zinc-50'
                : ''
            }`}
          >
            Update Mods
          </button>
          <button
            type="button"
            onClick={() => onNavigatePanel('search')}
            className={`whitespace-nowrap shrink-0 ${
              isPanelActive('search')
                ? 'text-zinc-950 underline underline-offset-4 dark:text-zinc-50'
                : ''
            }`}
          >
            Search Mods
          </button>
          <button
            type="button"
            onClick={() => onNavigatePanel('manage')}
            className={`whitespace-nowrap shrink-0 ${
              isPanelActive('manage')
                ? 'text-zinc-950 underline underline-offset-4 dark:text-zinc-50'
                : ''
            }`}
          >
            Manage Mods
          </button>
        </nav>
      )}
    </header>
  );
}
