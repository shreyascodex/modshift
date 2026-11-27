import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  HelpCircle,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  XCircle,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { analyzeModConflicts } from '../services/conflictChecker';
import {
  exportDownloadUrlsTxt,
  exportMigrationJson,
  exportMigrationMarkdown,
  triggerDirectDownload,
} from '../services/downloadService';
import { getResultProjectLink } from '../services/migrationEngine';
import { modrinthClient } from '../services/providers/modrinthClient';
import type {
  MigrationTargetConfig,
  ModMigrationResult,
  ResolvedDependency,
} from '../types/migration';
import { formatBytes, formatLoaderName } from '../utils/format';
import {
  classifyModEnvironment,
  getModEnvironmentLabel,
  matchesEnvironmentFilter,
  type EnvironmentFilter,
} from '../utils/modEnvironment';
import { BulkDownloadPanel } from './BulkDownloadPanel';
import { DependencyPanel } from './DependencyPanel';

type DashboardTab =
  | 'all'
  | 'ready'
  | 'dependencies'
  | 'needs_review'
  | 'no_update'
  | 'not_found'
  | 'failed';

interface ResultsDashboardProps {
  results: ModMigrationResult[];
  dependencies: ResolvedDependency[];
  config: MigrationTargetConfig;
  isRetryingFailed: boolean;
  onRetryFailedAll: () => void;
  onRetrySingleFailed: (result: ModMigrationResult) => void;
  onApproveNeedsReview: (resultId: string) => void;
  onOpenManualSearch: (result: ModMigrationResult) => void;
  onAddDependency: (dep: ResolvedDependency) => void;
  onClearResults: () => void;
  onExportMrpack?: (options?: { serverOnly?: boolean }) => Promise<void> | void;
  isExportingMrpack?: boolean;
  mrpackCreditCost?: number;
  creditsEnabled?: boolean;
  isAdmin?: boolean;
  userCredits?: number;
}

export function ResultsDashboard({
  results,
  dependencies,
  config,
  isRetryingFailed,
  onRetryFailedAll,
  onRetrySingleFailed,
  onApproveNeedsReview,
  onOpenManualSearch,
  onAddDependency,
  onClearResults,
  onExportMrpack,
  isExportingMrpack = false,
  mrpackCreditCost = 2,
  creditsEnabled = true,
  isAdmin = false,
  userCredits = 50,
}: ResultsDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('all');
  const [envFilter, setEnvFilter] = useState<EnvironmentFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedHashId, setCopiedHashId] = useState<string | null>(null);
  const [expandedChangelogs, setExpandedChangelogs] = useState<Record<string, boolean>>({});
  const [changelogCache, setChangelogCache] = useState<Record<string, string>>({});
  const [loadingChangelogs, setLoadingChangelogs] = useState<Record<string, boolean>>({});

  const conflicts = useMemo(
    () => analyzeModConflicts(results, dependencies, config),
    [results, dependencies, config],
  );

  const getChangelogText = (res: ModMigrationResult): string | undefined => {
    const inline = res.targetVersion?.changelog?.trim();
    if (inline) return inline;
    return changelogCache[res.id];
  };

  const canFetchChangelog = (res: ModMigrationResult): boolean => {
    if (getChangelogText(res)) return true;
    return (
      res.provider === 'Modrinth' &&
      Boolean(res.targetVersion?.id) &&
      !res.targetVersion!.id.startsWith('saved-ver-')
    );
  };

  const toggleChangelog = async (res: ModMigrationResult) => {
    const nextOpen = !expandedChangelogs[res.id];
    setExpandedChangelogs((prev) => ({ ...prev, [res.id]: nextOpen }));

    if (
      nextOpen &&
      !getChangelogText(res) &&
      res.provider === 'Modrinth' &&
      res.targetVersion?.id &&
      !res.targetVersion.id.startsWith('saved-ver-') &&
      !loadingChangelogs[res.id]
    ) {
      const versionId = res.targetVersion.id;
      setLoadingChangelogs((prev) => ({ ...prev, [res.id]: true }));
      try {
        const version = await modrinthClient.getVersion(versionId);
        const notes =
          version.changelog?.trim() ||
          'No release changelog notes were provided for this version.';
        setChangelogCache((prev) => ({ ...prev, [res.id]: notes }));
      } catch {
        setChangelogCache((prev) => ({
          ...prev,
          [res.id]: 'Unable to load release changelog from Modrinth right now.',
        }));
      } finally {
        setLoadingChangelogs((prev) => ({ ...prev, [res.id]: false }));
      }
    }
  };

  const counts = useMemo(() => {
    let ready = 0;
    let noUpdate = 0;
    let notFound = 0;
    let needsReview = 0;
    let failed = 0;
    for (const r of results) {
      if (r.category === 'ready') ready++;
      else if (r.category === 'no_update') noUpdate++;
      else if (r.category === 'not_found') notFound++;
      else if (r.category === 'needs_review') needsReview++;
      else if (r.category === 'failed') failed++;
    }
    return {
      total: results.length,
      ready,
      noUpdate,
      notFound,
      needsReview,
      failed,
    };
  }, [results]);

  const filteredResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return results.filter((r) => {
      if (!matchesEnvironmentFilter(r.project, envFilter)) return false;
      if (!q) return true;
      const modName = r.project?.title?.toLowerCase() ?? '';
      const fileName = r.localFile.name.toLowerCase();
      const targetName = r.targetFile?.filename.toLowerCase() ?? '';
      const sha1 = r.localFile.sha1?.toLowerCase() ?? '';
      return (
        modName.includes(q) ||
        fileName.includes(q) ||
        targetName.includes(q) ||
        sha1.includes(q)
      );
    });
  }, [results, envFilter, searchQuery]);

  const readyList = useMemo(
    () => filteredResults.filter((r) => r.category === 'ready'),
    [filteredResults],
  );
  const needsReviewList = useMemo(
    () => filteredResults.filter((r) => r.category === 'needs_review'),
    [filteredResults],
  );
  const noUpdateList = useMemo(
    () => filteredResults.filter((r) => r.category === 'no_update'),
    [filteredResults],
  );
  const notFoundList = useMemo(
    () => filteredResults.filter((r) => r.category === 'not_found'),
    [filteredResults],
  );
  const failedList = useMemo(
    () => filteredResults.filter((r) => r.category === 'failed'),
    [filteredResults],
  );

  const allReadyUnfiltered = useMemo(
    () => results.filter((r) => r.category === 'ready'),
    [results],
  );

  const bulkReadyFiltered = useMemo(
    () =>
      allReadyUnfiltered.filter((r) =>
        matchesEnvironmentFilter(r.project, envFilter),
      ),
    [allReadyUnfiltered, envFilter],
  );

  const handleCopyHash = async (id: string, sha1: string) => {
    try {
      await navigator.clipboard.writeText(sha1);
      setCopiedHashId(id);
      setTimeout(() => {
        setCopiedHashId((curr) => (curr === id ? null : curr));
      }, 1800);
    } catch {
      // Clipboard API unavailable; user can still select monospace text
    }
  };

  if (results.length === 0) return null;

  const showSection = (tab: DashboardTab) =>
    activeTab === 'all' || activeTab === tab;

  return (
    <section
      aria-labelledby="results-dashboard-heading"
      className="space-y-6"
    >
      {/* Top header & export toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="results-dashboard-heading"
            className="font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
          >
            Migration Results
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Target: Minecraft {config.gameVersion} · {formatLoaderName(config.loader)} · Provider:{' '}
            {results.some((r) => r.provider === 'CurseForge')
              ? 'Modrinth + CurseForge'
              : 'Modrinth'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {counts.failed > 0 && (
            <button
              type="button"
              disabled={isRetryingFailed}
              onClick={onRetryFailedAll}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 whitespace-nowrap shrink-0 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRetryingFailed ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Retry Failed ({counts.failed})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => exportMigrationJson(results, dependencies, config)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            onClick={() => exportMigrationMarkdown(results, dependencies, config)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Markdown</span>
          </button>

          {allReadyUnfiltered.length > 0 && (
            <button
              type="button"
              onClick={() => exportDownloadUrlsTxt(results, config)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>URLs (.txt)</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClearResults}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 whitespace-nowrap shrink-0 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Start New Migration</span>
          </button>
        </div>
      </div>

      {/* Summary Statistics Grid */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-3 lg:grid-cols-6 dark:border-zinc-800 dark:bg-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Total Mods</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
            {counts.total}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ready')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Ready to Download</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {counts.ready}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('no_update')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-zinc-600 dark:text-zinc-400">No Compatible Update</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {counts.noUpdate}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('not_found')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Not Found</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {counts.notFound}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('needs_review')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-amber-700 dark:text-amber-400">Needs Review</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400">
            {counts.needsReview}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('failed')}
          className="flex flex-col items-start bg-white p-4 text-left transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/70"
        >
          <span className="text-xs text-red-700 dark:text-red-400">Failed Requests</span>
          <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-700 dark:text-red-400">
            {counts.failed}
          </span>
        </button>
      </div>

      {/* Bulk Download Bar */}
      <BulkDownloadPanel
        readyResults={bulkReadyFiltered}
        config={config}
        serverOnlyExport={envFilter === 'server_compatible'}
        onExportMrpack={onExportMrpack}
        isExportingMrpack={isExportingMrpack}
        mrpackCreditCost={mrpackCreditCost}
        creditsEnabled={creditsEnabled}
        isAdmin={isAdmin}
        userCredits={userCredits}
      />

      {/* Conflict & Compatibility Warnings */}
      {conflicts.length > 0 && (
        <section
          aria-label="Modpack compatibility advisories"
          className="space-y-2.5"
        >
          {conflicts.map((warn) => (
            <div
              key={warn.id}
              role="status"
              className={`flex items-start gap-3 rounded-xl border p-4 text-xs ${
                warn.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                  : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
              }`}
            >
              {warn.severity === 'warning' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
              )}
              <div className="min-w-0 space-y-1">
                <p className="font-semibold">{warn.title}</p>
                <p className="leading-relaxed opacity-90">{warn.description}</p>
                {warn.affectedMods.length > 0 && (
                  <p className="font-mono text-[11px] opacity-80">
                    Affected: {warn.affectedMods.join(', ')}
                  </p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Filter Tabs, Environment Split & Search */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="tablist"
            aria-label="Filter migration results"
            className="flex items-center gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
          >
            {(
              [
                { id: 'all', label: `All (${counts.total})` },
                { id: 'ready', label: `Ready (${counts.ready})` },
                { id: 'dependencies', label: `Dependencies (${dependencies.length})` },
                { id: 'needs_review', label: `Needs Review (${counts.needsReview})` },
                { id: 'no_update', label: `No Update (${counts.noUpdate})` },
                { id: 'not_found', label: `Not Found (${counts.notFound})` },
                { id: 'failed', label: `Failed (${counts.failed})` },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mod name, file, or hash..."
              aria-label="Search migration results"
              className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div
            role="group"
            aria-label="Client vs server compatibility filter"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
          >
            {(
              [
                { id: 'all', label: 'All Environments' },
                { id: 'server_compatible', label: 'Server-Compatible Only' },
                { id: 'client_only', label: 'Client-Only' },
              ] as const
            ).map((opt) => {
              const active = envFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setEnvFilter(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
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
          {envFilter === 'server_compatible' && (
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Client-only mods are hidden and excluded from bulk downloads &amp; server .mrpack export.
            </span>
          )}
        </div>
      </div>

      {/* A. Ready to Download */}
      {showSection('ready') && (readyList.length > 0 || activeTab === 'ready') && (
        <section
          aria-labelledby="section-ready-heading"
          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <h3
                id="section-ready-heading"
                className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
              >
                Ready to Download ({readyList.length})
              </h3>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Verified compatible releases
            </span>
          </div>

          {readyList.length === 0 ? (
            <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No ready mods match your current filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Mod / Original File</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Target</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">New Version</th>
                    <th scope="col" className="px-4 py-2.5 font-medium text-right">Size</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Provider</th>
                    <th scope="col" className="px-5 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {readyList.map((res) => {
                    const projectUrl = getResultProjectLink(res);
                    const changelogText = getChangelogText(res);
                    const hasNotesButton = canFetchChangelog(res);
                    const isChangelogLoading = Boolean(loadingChangelogs[res.id]);
                    const isChangelogOpen = Boolean(expandedChangelogs[res.id]);
                    const envTag = classifyModEnvironment(res.project);
                    return (
                      <Fragment key={res.id}>
                        <tr className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <CheckCircle2
                                className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                                aria-label="Verified compatible"
                              />
                              {projectUrl ? (
                                <a
                                  href={projectUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                                >
                                  <span>{res.project?.title ?? res.localFile.name}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                </a>
                              ) : (
                                <span className="font-medium text-sm text-zinc-950 dark:text-zinc-100">
                                  {res.project?.title ?? res.localFile.name}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 pl-5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                              {res.isDependencyAddition
                                ? `Added dependency · ${res.targetFile?.filename ?? ''}`
                                : res.localFile.name}
                              {envTag !== 'unknown' && (
                                <span
                                  className={`ml-2 font-sans font-medium ${
                                    envTag === 'client_only'
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : envTag === 'server_only'
                                      ? 'text-sky-700 dark:text-sky-400'
                                      : 'text-zinc-500 dark:text-zinc-400'
                                  }`}
                                >
                                  · {getModEnvironmentLabel(envTag)}
                                </span>
                              )}
                            </p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                            <span className="font-mono tabular-nums">{config.gameVersion}</span>
                            <span> · {formatLoaderName(config.loader)}</span>
                          </td>
                          <td className="px-4 py-3 font-mono text-zinc-900 dark:text-zinc-100">
                            <span className="block max-w-[180px] truncate" title={res.targetVersion?.version_number}>
                              {res.targetVersion?.version_number ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {res.targetFile?.size ? formatBytes(res.targetFile.size) : '—'}
                          </td>
                          <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                            {res.provider}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {hasNotesButton && (
                                <button
                                  type="button"
                                  onClick={() => void toggleChangelog(res)}
                                  aria-expanded={isChangelogOpen}
                                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                >
                                  {isChangelogLoading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                  <span>Notes</span>
                                  {isChangelogOpen ? (
                                    <ChevronUp className="h-3 w-3" aria-hidden="true" />
                                  ) : (
                                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                                  )}
                                </button>
                              )}
                              {res.targetFile?.url ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerDirectDownload(res.targetFile!.url, res.targetFile!.filename)
                                  }
                                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40"
                                >
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Download</span>
                                </button>
                              ) : (
                                <span className="text-zinc-400">No URL</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isChangelogOpen && (
                          <tr className="bg-zinc-50/70 dark:bg-zinc-950/50">
                            <td colSpan={6} className="px-5 py-3">
                              <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                                Release Changelog ({res.targetVersion?.version_number})
                              </p>
                              {isChangelogLoading && !changelogText ? (
                                <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  <span>Fetching release notes from Modrinth...</span>
                                </p>
                              ) : (
                                <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                  {changelogText || 'No release changelog available.'}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* B. Dependencies */}
      {showSection('dependencies') && (dependencies.length > 0 || activeTab === 'dependencies') && (
        <DependencyPanel
          dependencies={dependencies}
          targetVersion={config.gameVersion}
          targetLoader={config.loader}
          onAddDependency={onAddDependency}
        />
      )}

      {/* C. Needs Review */}
      {showSection('needs_review') && (needsReviewList.length > 0 || activeTab === 'needs_review') && (
        <section
          aria-labelledby="section-review-heading"
          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h3
                id="section-review-heading"
                className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
              >
                Needs Review ({needsReviewList.length})
              </h3>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Pre-releases, manual matches, or ambiguous artifacts
            </span>
          </div>

          {needsReviewList.length === 0 ? (
            <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No mods require manual review.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {needsReviewList.map((res) => {
                const projectUrl = getResultProjectLink(res);
                const changelogText = getChangelogText(res);
                const hasNotesButton = canFetchChangelog(res);
                const isChangelogLoading = Boolean(loadingChangelogs[res.id]);
                const isChangelogOpen = Boolean(expandedChangelogs[res.id]);
                const envTag = classifyModEnvironment(res.project);
                return (
                  <li
                    key={res.id}
                    className="space-y-3 px-5 py-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {projectUrl ? (
                            <a
                              href={projectUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                            >
                              <span>{res.project?.title ?? res.localFile.name}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="font-medium text-sm text-zinc-950 dark:text-zinc-100">
                              {res.project?.title ?? res.localFile.name}
                            </span>
                          )}
                          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            · {res.localFile.name}
                          </span>
                          {envTag !== 'unknown' && (
                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              · {getModEnvironmentLabel(envTag)}
                            </span>
                          )}
                          {res.targetVersion && (
                            <span className="font-mono text-xs text-amber-700 dark:text-amber-400">
                              · {res.targetVersion.version_number} ({res.targetVersion.version_type})
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {res.explanation}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {hasNotesButton && (
                          <button
                            type="button"
                            onClick={() => void toggleChangelog(res)}
                            aria-expanded={isChangelogOpen}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            {isChangelogLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>Notes</span>
                          </button>
                        )}
                        {res.targetFile?.url ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onApproveNeedsReview(res.id)}
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Move to Ready</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                triggerDirectDownload(res.targetFile!.url, res.targetFile!.filename)
                              }
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Download</span>
                            </button>
                          </>
                        ) : (
                          projectUrl && (
                            <a
                              href={projectUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              <span>Open {res.provider}</span>
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          )
                        )}
                      </div>
                    </div>

                    {isChangelogOpen && (
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
                        <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                          Release Changelog ({res.targetVersion?.version_number})
                        </p>
                        {isChangelogLoading && !changelogText ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            <span>Fetching release notes from Modrinth...</span>
                          </p>
                        ) : (
                          <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                            {changelogText || 'No release changelog available.'}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* D. No Compatible Update */}
      {showSection('no_update') && (noUpdateList.length > 0 || activeTab === 'no_update') && (
        <section
          aria-labelledby="section-noupdate-heading"
          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
              <h3
                id="section-noupdate-heading"
                className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
              >
                No Compatible Update ({noUpdateList.length})
              </h3>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Identified mod, not yet tagged for target
            </span>
          </div>

          {noUpdateList.length === 0 ? (
            <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              All identified mods have compatible target updates.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {noUpdateList.map((res) => {
                const projectUrl = getResultProjectLink(res);
                const knownMc = res.sourceVersion?.game_versions?.slice(0, 4).join(', ');
                return (
                  <li
                    key={res.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-sm text-zinc-950 dark:text-zinc-100">
                          {res.project?.title ?? res.sourceVersion?.name ?? res.localFile.name}
                        </span>
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          · {res.localFile.name}
                        </span>
                        {knownMc && (
                          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                            · Current file MC: {knownMc}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        {res.explanation}
                      </p>
                    </div>

                    {projectUrl && (
                      <a
                        href={projectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <span>View on {res.provider}</span>
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* E. Not Found */}
      {showSection('not_found') && (notFoundList.length > 0 || activeTab === 'not_found') && (
        <section
          aria-labelledby="section-notfound-heading"
          className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
              <h3
                id="section-notfound-heading"
                className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
              >
                Not Found ({notFoundList.length})
              </h3>
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              No reliable hash match on Modrinth
            </span>
          </div>

          {notFoundList.length === 0 ? (
            <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No unmatched mod files.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {notFoundList.map((res) => (
                <li
                  key={res.id}
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium text-zinc-950 break-all dark:text-zinc-100">
                      {res.localFile.name}
                    </p>
                    {res.localFile.sha1 && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono break-all">
                          SHA-1: {res.localFile.sha1}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyHash(res.id, res.localFile.sha1!)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          {copiedHashId === res.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" aria-hidden="true" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {res.explanation}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenManualSearch(res)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <Search className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Search Manually</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* F. Failed Requests */}
      {showSection('failed') && (failedList.length > 0 || activeTab === 'failed') && (
        <section
          aria-labelledby="section-failed-heading"
          className="rounded-xl border border-red-200 bg-white dark:border-red-900/60 dark:bg-zinc-900"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/40">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <h3
                id="section-failed-heading"
                className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
              >
                Failed Requests ({failedList.length})
              </h3>
            </div>
            {failedList.length > 0 && (
              <button
                type="button"
                disabled={isRetryingFailed}
                onClick={onRetryFailedAll}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-zinc-950 dark:text-red-300"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isRetryingFailed ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Retry All Failed</span>
              </button>
            )}
          </div>

          {failedList.length === 0 ? (
            <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              No failed API or file read requests.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {failedList.map((res) => (
                <li
                  key={res.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-sm font-medium text-zinc-950 dark:text-zinc-100">
                        {res.localFile.name}
                      </span>
                      {res.errorKind && (
                        <span className="text-xs font-medium text-red-700 dark:text-red-400">
                          · {res.errorKind.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {res.errorMessage || res.explanation}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isRetryingFailed}
                    onClick={() => onRetrySingleFailed(res)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Retry</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
