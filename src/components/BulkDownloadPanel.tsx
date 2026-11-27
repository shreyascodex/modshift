import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAndDownloadZipBundle,
  buildDownloadQueue,
  runSequentialDownloads,
  triggerDirectDownload,
  type ZipBundleOutcome,
  type ZipBundleProgress,
} from '../services/downloadService';
import type {
  BulkDownloadItem,
  MigrationTargetConfig,
  ModMigrationResult,
} from '../types/migration';
import { formatBytes } from '../utils/format';

interface BulkDownloadPanelProps {
  readyResults: ModMigrationResult[];
  config: MigrationTargetConfig;
  onExportMrpack?: () => Promise<void> | void;
  isExportingMrpack?: boolean;
  mrpackCreditCost?: number;
  creditsEnabled?: boolean;
  isAdmin?: boolean;
  userCredits?: number;
}

export function BulkDownloadPanel({
  readyResults,
  config,
  onExportMrpack,
  isExportingMrpack = false,
  mrpackCreditCost = 2,
  creditsEnabled = true,
  isAdmin = false,
  userCredits = 50,
}: BulkDownloadPanelProps) {
  const [queue, setQueue] = useState<BulkDownloadItem[]>([]);
  const [isSequentialRunning, setIsSequentialRunning] = useState(false);
  const [isZipBuilding, setIsZipBuilding] = useState(false);
  const [zipProgress, setZipProgress] = useState<ZipBundleProgress | null>(null);
  const [zipOutcome, setZipOutcome] = useState<ZipBundleOutcome | null>(null);
  const [showQueueDetails, setShowQueueDetails] = useState(false);

  const sequentialAbortRef = useRef<AbortController | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    sequentialAbortRef.current?.abort();
    zipAbortRef.current?.abort();
    setQueue(buildDownloadQueue(readyResults));
    setZipOutcome(null);
    setZipProgress(null);
  }, [readyResults]);

  useEffect(() => {
    return () => {
      sequentialAbortRef.current?.abort();
      zipAbortRef.current?.abort();
    };
  }, []);

  const hasCurseForgeItems = useMemo(
    () => readyResults.some((r) => r.provider === 'CurseForge'),
    [readyResults],
  );

  const totalSize = useMemo(
    () => queue.reduce((sum, item) => sum + item.size, 0),
    [queue],
  );
  const completedCount = useMemo(
    () => queue.filter((q) => q.status === 'completed').length,
    [queue],
  );
  const failedItems = useMemo(
    () => queue.filter((q) => q.status === 'failed'),
    [queue],
  );

  if (queue.length === 0) return null;

  const handleStartSequential = async (onlyFailed = false) => {
    if (isSequentialRunning || isZipBuilding) return;
    const controller = new AbortController();
    sequentialAbortRef.current = controller;
    setIsSequentialRunning(true);
    setShowQueueDetails(true);

    const workingQueue = queue.map((item) =>
      onlyFailed
        ? item.status === 'failed'
          ? { ...item, status: 'pending' as const, error: undefined }
          : item
        : { ...item, status: 'pending' as const, error: undefined },
    );
    setQueue(workingQueue);

    try {
      await runSequentialDownloads(workingQueue, {
        signal: controller.signal,
        onItemUpdate: (updated) => setQueue(updated),
      });
    } finally {
      setIsSequentialRunning(false);
      sequentialAbortRef.current = null;
    }
  };

  const handleCancelSequential = () => {
    sequentialAbortRef.current?.abort();
  };

  const handleBuildZip = async () => {
    if (isSequentialRunning || isZipBuilding) return;
    const controller = new AbortController();
    zipAbortRef.current = controller;
    setIsZipBuilding(true);
    setZipOutcome(null);
    setZipProgress({
      completed: 0,
      total: queue.length,
      currentFilename: queue[0]?.filename ?? '',
      failedItems: [],
    });

    try {
      const outcome = await buildAndDownloadZipBundle(queue, config, {
        signal: controller.signal,
        onProgress: (p) => setZipProgress(p),
      });
      setZipOutcome(outcome);
    } finally {
      setIsZipBuilding(false);
      zipAbortRef.current = null;
    }
  };

  const handleCancelZip = () => {
    zipAbortRef.current?.abort();
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Bulk Download Workflow
          </h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-mono tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
              {queue.length}
            </span>{' '}
            ready {queue.length === 1 ? 'mod' : 'mods'} ({formatBytes(totalSize)}) · Files download directly from{' '}
            {hasCurseForgeItems ? "official provider CDNs" : "Modrinth's official CDN"}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSequentialRunning ? (
            <button
              type="button"
              onClick={handleCancelSequential}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-medium text-red-700 whitespace-nowrap shrink-0 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-950 dark:text-red-300"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Stop Downloads ({completedCount}/{queue.length})</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isZipBuilding}
              onClick={() => void handleStartSequential(false)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Download All Ready Mods ({queue.length})</span>
            </button>
          )}

          {failedItems.length > 0 && !isSequentialRunning && (
            <button
              type="button"
              onClick={() => void handleStartSequential(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 whitespace-nowrap shrink-0 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry Failed ({failedItems.length})</span>
            </button>
          )}

          {isZipBuilding ? (
            <button
              type="button"
              onClick={handleCancelZip}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-700 whitespace-nowrap shrink-0 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-950 dark:text-red-300"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Cancel ZIP</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isSequentialRunning || isExportingMrpack}
              onClick={() => void handleBuildZip()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span>Bundle as .zip</span>
            </button>
          )}

          {onExportMrpack && (
            <button
              type="button"
              disabled={
                isSequentialRunning ||
                isZipBuilding ||
                isExportingMrpack ||
                (creditsEnabled && !isAdmin && mrpackCreditCost > 0 && userCredits < mrpackCreditCost)
              }
              onClick={() => void onExportMrpack()}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {isExportingMrpack ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Package className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                Export .mrpack
                {creditsEnabled && !isAdmin && mrpackCreditCost > 0
                  ? ` (${mrpackCreditCost} cr)`
                  : ''}
              </span>
            </button>
          )}

          {queue.length > 0 && (
            <button
              type="button"
              onClick={() => setShowQueueDetails((s) => !s)}
              className="inline-flex min-h-10 items-center rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-600 whitespace-nowrap hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {showQueueDetails ? 'Hide Queue' : 'Show Queue'}
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        Note: Sequential downloads trigger one file every ~0.5s. If your browser asks permission to download multiple files, click Allow. If a browser blocks bulk triggers, use &ldquo;Bundle as .zip&rdquo; or individual download buttons below.
      </p>

      {isZipBuilding && zipProgress && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-zinc-800 dark:text-zinc-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" aria-hidden="true" />
              <span className="truncate">
                Fetching from Modrinth CDN ({zipProgress.completed}/{zipProgress.total}): {zipProgress.currentFilename}
              </span>
            </span>
            <span className="font-mono tabular-nums text-zinc-500">
              {Math.round((zipProgress.completed / Math.max(1, zipProgress.total)) * 100)}%
            </span>
          </div>
        </div>
      )}

      {zipOutcome && !zipOutcome.cancelled && (
        <div
          role="status"
          className={`mt-3 rounded-lg border p-3 text-xs ${
            zipOutcome.failedItems.length > 0
              ? 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
              : 'border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {zipOutcome.failedItems.length === 0 ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>
                Created and downloaded ZIP bundle containing {zipOutcome.succeededCount} mod JARs.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {zipOutcome.succeededCount === 0
                    ? 'ZIP bundling could not fetch files directly in this browser (CORS or network restriction).'
                    : `ZIP bundle finished with ${zipOutcome.succeededCount} files, but ${zipOutcome.failedItems.length} could not be fetched directly.`}
                </p>
                <p className="mt-1">
                  Use &ldquo;Download All Ready Mods&rdquo; (direct browser links) or individual download buttons instead.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {showQueueDetails && (
        <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-3.5 py-2 font-medium">File</th>
                <th scope="col" className="px-3.5 py-2 font-medium text-right">Size</th>
                <th scope="col" className="px-3.5 py-2 font-medium">Status</th>
                <th scope="col" className="px-3.5 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {queue.map((item) => (
                <tr key={item.resultId}>
                  <td className="px-3.5 py-2 font-mono text-zinc-900 dark:text-zinc-100">
                    <span className="block max-w-[260px] truncate">{item.filename}</span>
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono tabular-nums text-zinc-500">
                    {formatBytes(item.size)}
                  </td>
                  <td className="px-3.5 py-2">
                    {item.status === 'completed' ? (
                      <span className="text-emerald-700 dark:text-emerald-400">Triggered</span>
                    ) : item.status === 'downloading' ? (
                      <span className="text-zinc-700 dark:text-zinc-300">Starting...</span>
                    ) : item.status === 'failed' ? (
                      <span className="text-red-700 dark:text-red-400">{item.error || 'Failed'}</span>
                    ) : (
                      <span className="text-zinc-500">Queued</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => triggerDirectDownload(item.url, item.filename)}
                      className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
