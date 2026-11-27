import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Search,
  Share2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { triggerDirectDownload } from '../services/downloadService';
import { exportMrpackArchive } from '../services/mrpackService';
import {
  getSharedPack,
  hydrateSharedPackResults,
  type SharedPackRecord,
} from '../services/sharedPacksService';
import { formatBytes, formatLoaderName, getModrinthProjectUrl } from '../utils/format';
import {
  classifyModEnvironment,
  getModEnvironmentLabel,
  matchesEnvironmentFilter,
  type EnvironmentFilter,
} from '../utils/modEnvironment';
import { BulkDownloadPanel } from './BulkDownloadPanel';

interface SharedPackViewProps {
  shareId: string;
  onGoHome: () => void;
}

export function SharedPackView({ shareId, onGoHome }: SharedPackViewProps) {
  const [pack, setPack] = useState<SharedPackRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isExportingMrpack, setIsExportingMrpack] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const record = await getSharedPack(shareId);
        if (!active) return;
        if (!record) {
          setError('Shared modpack link not found or was removed by its author.');
          setPack(null);
        } else {
          setPack(record);
        }
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error && !err.message.startsWith('{')
            ? err.message
            : 'Unable to load shared modpack.',
        );
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [shareId]);

  const hydratedResults = useMemo(
    () => (pack ? hydrateSharedPackResults(pack) : []),
    [pack],
  );

  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return hydratedResults.filter((res) => {
      if (!matchesEnvironmentFilter(res.project, envFilter)) {
        return false;
      }
      if (!q) return true;
      const title = res.project?.title?.toLowerCase() ?? '';
      const file = res.targetFile?.filename.toLowerCase() ?? '';
      const ver = res.targetVersion?.version_number.toLowerCase() ?? '';
      return title.includes(q) || file.includes(q) || ver.includes(q);
    });
  }, [hydratedResults, envFilter, searchQuery]);

  const bulkReadyResults = useMemo(
    () => hydratedResults.filter((res) => matchesEnvironmentFilter(res.project, envFilter)),
    [hydratedResults, envFilter],
  );

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleExportSharedMrpack = async (options?: { serverOnly?: boolean }) => {
    if (!pack || isExportingMrpack) return;
    setIsExportingMrpack(true);
    setExportNote(null);
    try {
      const outcome = await exportMrpackArchive(
        hydratedResults,
        {
          gameVersion: pack.gameVersion,
          loader: pack.loader,
          includeSnapshots: false,
          allowPrereleasesDirectly: false,
        },
        pack.title,
        options,
      );
      setExportNote(
        `Exported ${outcome.exportedCount} mods to ${outcome.filename}${
          outcome.skippedClientOnly > 0
            ? ` (${outcome.skippedClientOnly} client-only mods excluded)`
            : ''
        }.`,
      );
    } catch (err) {
      setExportNote(
        err instanceof Error ? err.message : 'Unable to export .mrpack archive.',
      );
    } finally {
      setIsExportingMrpack(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-xs text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-600" aria-hidden="true" />
        <span>Loading shared modpack...</span>
      </div>
    );
  }

  if (error || !pack) {
    return (
      <section className="mx-auto max-w-lg py-10">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold text-zinc-950 dark:text-zinc-50">
            Shared Modpack Unavailable
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {error || 'This shared modpack could not be found.'}
          </p>
          <button
            type="button"
            onClick={onGoHome}
            className="mt-5 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to ModShift</span>
          </button>
        </div>
      </section>
    );
  }

  const createdStr = pack.createdAt
    ? pack.createdAt.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Just now';

  return (
    <section aria-labelledby="shared-pack-heading" className="space-y-6">
      <div>
        <button
          type="button"
          onClick={onGoHome}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to ModShift</span>
        </button>
      </div>

      {/* Pack header card */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Public Shared Modpack · Shared by {pack.authorName}</span>
            </p>
            <h1
              id="shared-pack-heading"
              className="mt-1.5 font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              {pack.title}
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
              Minecraft {pack.gameVersion} · {formatLoaderName(pack.loader)} ·{' '}
              {pack.modCount} {pack.modCount === 1 ? 'mod' : 'mods'} · Published {createdStr}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleCopyShareUrl()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {copiedLink ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                <span>Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy Share URL</span>
              </>
            )}
          </button>
        </div>

        {exportNote && (
          <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
            {exportNote}
          </p>
        )}
      </div>

      {/* Bulk Downloader & .mrpack exporter */}
      <BulkDownloadPanel
        readyResults={bulkReadyResults}
        config={{
          gameVersion: pack.gameVersion,
          loader: pack.loader,
          includeSnapshots: false,
          allowPrereleasesDirectly: false,
        }}
        serverOnlyExport={envFilter === 'server_compatible'}
        onExportMrpack={
          hydratedResults.some((r) => Boolean(r.targetFile?.hashes?.sha1))
            ? handleExportSharedMrpack
            : undefined
        }
        isExportingMrpack={isExportingMrpack}
        creditsEnabled={false}
      />

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filter mods by environment"
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {(
            [
              { id: 'all', label: 'All Mods' },
              { id: 'server_compatible', label: 'Server-Compatible' },
              { id: 'client_only', label: 'Client-Only' },
            ] as const
          ).map((opt) => {
            const active = envFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setEnvFilter(opt.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search mods in pack..."
            aria-label="Search shared modpack"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>

      {/* Mods Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <span className="inline-flex items-center gap-2 font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Package className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>Included Mods ({filteredResults.length})</span>
          </span>
        </div>

        {filteredResults.length === 0 ? (
          <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No mods match your current filter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Mod</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Environment</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Version</th>
                  <th scope="col" className="px-4 py-2.5 font-medium text-right">Size</th>
                  <th scope="col" className="px-5 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {filteredResults.map((res) => {
                  const envTag = classifyModEnvironment(res.project);
                  const envLabel = getModEnvironmentLabel(envTag);
                  const slugOrId = res.project?.slug || res.project?.id;
                  const url = slugOrId ? getModrinthProjectUrl(slugOrId) : null;
                  return (
                    <tr key={res.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
                      <td className="px-5 py-3">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                          >
                            <span>{res.project?.title ?? res.localFile.name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="text-sm font-medium text-zinc-950 dark:text-zinc-100">
                            {res.project?.title ?? res.localFile.name}
                          </span>
                        )}
                        <p className="mt-0.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {res.targetFile?.filename}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            envTag === 'client_only'
                              ? 'text-amber-700 dark:text-amber-400'
                              : envTag === 'server_only'
                              ? 'text-sky-700 dark:text-sky-400'
                              : 'text-zinc-600 dark:text-zinc-400'
                          }`}
                        >
                          {envLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-100">
                        {res.targetVersion?.version_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {res.targetFile?.size ? formatBytes(res.targetFile.size) : '—'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {res.targetFile?.url && (
                          <button
                            type="button"
                            onClick={() =>
                              triggerDirectDownload(res.targetFile!.url, res.targetFile!.filename)
                            }
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Download</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
