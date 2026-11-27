import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import type { NewsBannerLevel } from '../services/siteConfigService';

interface AnnouncementModalProps {
  open: boolean;
  level: NewsBannerLevel;
  title: string;
  body: string;
  onDismiss: () => void;
}

export function AnnouncementModal({
  open,
  level,
  title,
  body,
  onDismiss,
}: AnnouncementModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onDismiss]);

  if (!open) return null;

  const isWarning = level === 'warning';
  const isSuccess = level === 'success';

  const toneBadge = isWarning
    ? 'Important Warning'
    : isSuccess
    ? 'Release Update'
    : 'Site Announcement';

  const iconContainerClass = isWarning
    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-400'
    : isSuccess
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-400'
    : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';

  const cardBorderClass = isWarning
    ? 'border-amber-300 dark:border-amber-800/80'
    : isSuccess
    ? 'border-emerald-300 dark:border-emerald-800/80'
    : 'border-zinc-200 dark:border-zinc-800';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onDismiss();
        }
      }}
    >
      <div
        className={`w-full max-w-md rounded-xl border bg-white p-6 shadow-xl dark:bg-zinc-900 ${cardBorderClass}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${iconContainerClass}`}
            >
              {isWarning ? (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              ) : isSuccess ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Info className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <p
                className={`text-[11px] font-semibold uppercase tracking-wide ${
                  isWarning
                    ? 'text-amber-700 dark:text-amber-400'
                    : isSuccess
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {toneBadge}
              </p>
              <h2
                id="announcement-modal-title"
                className="mt-0.5 font-display text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
              >
                {title.trim() || toneBadge}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close announcement"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {body.trim() && (
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {body}
          </p>
        )}

        <div className="mt-6 flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <button
            type="button"
            autoFocus
            onClick={onDismiss}
            className={`inline-flex min-h-9 items-center justify-center rounded-lg px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              isWarning
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
