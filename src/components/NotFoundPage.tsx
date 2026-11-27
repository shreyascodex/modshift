import { ArrowLeft } from 'lucide-react';

interface NotFoundPageProps {
  onGoHome: () => void;
}

export function NotFoundPage({ onGoHome }: NotFoundPageProps) {
  return (
    <section
      aria-labelledby="not-found-heading"
      className="mx-auto max-w-lg py-14 sm:py-20"
    >
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-mono text-4xl font-bold tracking-tight tabular-nums text-zinc-950 dark:text-zinc-50">
          404
        </p>
        <h1
          id="not-found-heading"
          className="mt-3 font-display text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
        >
          Page not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          The page you are looking for does not exist or may have been moved.
        </p>
        <button
          type="button"
          onClick={onGoHome}
          className="mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Home</span>
        </button>
      </div>
    </section>
  );
}
