import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import firebaseConfig from '../../firebase-applet-config.json';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    isQuotaError: false,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const rawMsg = error?.message || 'An unexpected application error occurred.';
    const isQuotaError =
      rawMsg.includes('Quota exceeded') ||
      rawMsg.includes('Free daily read units');

    let displayMessage = rawMsg;
    try {
      const parsed = JSON.parse(rawMsg) as { error?: string; operationType?: string };
      if (parsed && typeof parsed.error === 'string') {
        displayMessage = parsed.error;
      }
    } catch {
      // Non-JSON error message
    }

    return {
      hasError: true,
      errorMessage: displayMessage,
      isQuotaError,
    };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Uncaught application error:', error, info);
  }

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const upgradeUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;

    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
              aria-hidden="true"
            />
            <div>
              <h1 className="font-display text-base font-semibold">
                Something went wrong
              </h1>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {this.state.errorMessage}
              </p>

              {this.state.isQuotaError && (
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                  Firestore free-tier daily quota was reached. Quota resets tomorrow, or you can review usage in the{' '}
                  <a
                    href={upgradeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-emerald-700 underline dark:text-emerald-400"
                  >
                    Firebase Console
                  </a>
                  .
                </p>
              )}

              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Reload Application</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
