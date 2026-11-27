import {
  Archive,
  ArrowRight,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderUp,
  GitCompare,
  Loader2,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { spendUserCredits } from '../services/creditsService';
import {
  buildAndDownloadZipBundle,
  runSequentialDownloads,
  triggerDirectDownload,
} from '../services/downloadService';
import { pickTargetJarFile, selectPreferredVersion } from '../services/migrationEngine';
import { modrinthClient } from '../services/providers/modrinthClient';
import {
  deleteSavedMigration,
  hydrateSavedMigrationResults,
  type SavedMigrationRecord,
} from '../services/savedMigrationsService';
import {
  buildSharedPackPath,
  deleteSharedPack,
  publishSharedPack,
  type SharedPackRecord,
} from '../services/sharedPacksService';
import type { SiteConfig } from '../services/siteConfigService';
import {
  deleteTrackedMod,
  updateTrackedModMetadata,
  type TrackedModRecord,
} from '../services/trackedModsService';
import type {
  BulkDownloadItem,
  GameVersionTag,
  MigrationTargetConfig,
  ModMigrationResult,
} from '../types/migration';
import { formatLoaderName, getModrinthProjectUrl, sanitizeDisplayName } from '../utils/format';
import type { WorkspacePanelId } from './AuthGatePanel';
import { SnapshotDiffModal } from './SnapshotDiffModal';

interface ManageModsPanelProps {
  trackedMods: TrackedModRecord[];
  loadingTrackedMods: boolean;
  savedMigrations: SavedMigrationRecord[];
  loadingMigrations: boolean;
  sharedPacks: SharedPackRecord[];
  loadingSharedPacks: boolean;
  gameVersions: GameVersionTag[];
  defaultGameVersion: string;
  siteConfig: SiteConfig;
  onNavigatePanel: (panel: WorkspacePanelId) => void;
  onLoadSavedMigration: (
    results: ModMigrationResult[],
    config: MigrationTargetConfig,
    label: string,
  ) => void;
  onOpenSharedPack: (shareId: string) => void;
}

export function ManageModsPanel({
  trackedMods,
  loadingTrackedMods,
  savedMigrations,
  loadingMigrations,
  sharedPacks,
  loadingSharedPacks,
  gameVersions,
  defaultGameVersion,
  siteConfig,
  onNavigatePanel,
  onLoadSavedMigration,
  onOpenSharedPack,
}: ManageModsPanelProps) {
  const { user, credits, isAdmin } = useAuth();
  const [filterText, setFilterText] = useState('');
  const [batchTargetVersion, setBatchTargetVersion] = useState(defaultGameVersion);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [zipBundling, setZipBundling] = useState(false);
  const [checkingSingleId, setCheckingSingleId] = useState<string | null>(null);
  const [deletingModId, setDeletingModId] = useState<string | null>(null);
  const [deletingMigId, setDeletingMigId] = useState<string | null>(null);
  const [sharingMigId, setSharingMigId] = useState<string | null>(null);
  const [deletingShareId, setDeletingShareId] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const releaseVersions = useMemo(() => {
    const releases = gameVersions.filter((v) => v.version_type === 'release').slice(0, 100);
    const active = batchTargetVersion || defaultGameVersion;
    if (active && !releases.some((v) => v.version === active)) {
      return [
        { version: active, version_type: 'release' as const, date: '', major: false },
        ...releases,
      ];
    }
    return releases;
  }, [gameVersions, batchTargetVersion, defaultGameVersion]);

  const effectiveTargetVersion =
    batchTargetVersion || defaultGameVersion || releaseVersions[0]?.version || '';

  const filteredMods = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return trackedMods;
    return trackedMods.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.loader.toLowerCase().includes(q) ||
        m.targetVersion.toLowerCase().includes(q),
    );
  }, [trackedMods, filterText]);

  const downloadableMods = useMemo(
    () =>
      trackedMods.filter(
        (m) =>
          Boolean(m.latestDownloadUrl) &&
          Boolean(m.latestFilename) &&
          m.latestDownloadUrl!.startsWith('https://'),
      ),
    [trackedMods],
  );

  const checkModUpdate = async (mod: TrackedModRecord, mcVersion: string) => {
    if (!user) return;
    const versions = await modrinthClient.getProjectVersions(
      mod.projectId,
      [mod.loader],
      mcVersion ? [mcVersion] : undefined,
    );
    const preferred = selectPreferredVersion(versions, false);
    const picked = preferred.version ? pickTargetJarFile(preferred.version).file : undefined;

    await updateTrackedModMetadata(user.uid, mod.id, {
      targetVersion: mcVersion || mod.targetVersion,
      latestVersionNumber: preferred.version?.version_number ?? '',
      latestFilename: picked?.filename ?? '',
      latestDownloadUrl: picked?.url ?? '',
    });
  };

  const handleCheckAllUpdates = async () => {
    if (!user || trackedMods.length === 0 || checkingUpdates) return;
    const targetMc = effectiveTargetVersion;
    const cost = siteConfig.creditsEnabled && !isAdmin ? siteConfig.libraryCheckCreditCost : 0;

    if (cost > 0 && credits < cost) {
      setErrorMessage(
        `Insufficient credits (${credits} available, ${cost} required to run a library batch check).`,
      );
      return;
    }

    setCheckingUpdates(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setCheckProgress({ done: 0, total: trackedMods.length });

    try {
      if (cost > 0) {
        await spendUserCredits(
          user,
          cost,
          `Library batch update check (${trackedMods.length} mods for MC ${targetMc})`,
        );
      }

      let cursor = 0;
      let done = 0;
      let failed = 0;
      const concurrency = Math.min(3, trackedMods.length);

      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= trackedMods.length) break;
          const mod = trackedMods[idx];
          try {
            await checkModUpdate(mod, targetMc);
          } catch {
            failed++;
          } finally {
            done++;
            setCheckProgress({ done, total: trackedMods.length });
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (failed > 0) {
        setStatusMessage(
          `Checked ${done - failed}/${trackedMods.length} tracked mods against Minecraft ${targetMc} (${failed} failed).`,
        );
      } else {
        setStatusMessage(
          `Checked all ${trackedMods.length} tracked ${trackedMods.length === 1 ? 'mod' : 'mods'} against Minecraft ${targetMc}.`,
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to check updates for your library.',
      );
    } finally {
      setCheckingUpdates(false);
      setCheckProgress(null);
    }
  };

  const handleDownloadAllCompatible = async () => {
    if (downloadableMods.length === 0 || bulkDownloading || zipBundling) return;
    setBulkDownloading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const queue: BulkDownloadItem[] = downloadableMods.map((m) => ({
      resultId: m.id,
      filename: sanitizeDisplayName(m.latestFilename!),
      projectTitle: m.title,
      url: m.latestDownloadUrl!,
      size: 0,
      status: 'pending',
    }));

    try {
      const done = await runSequentialDownloads(queue, {
        onItemUpdate: () => {},
      });
      const okCount = done.filter((x) => x.status === 'completed').length;
      setStatusMessage(
        `Triggered ${okCount} of ${queue.length} compatible mod downloads.`,
      );
    } finally {
      setBulkDownloading(false);
    }
  };

  const handleBundleLibraryZip = async () => {
    if (downloadableMods.length === 0 || bulkDownloading || zipBundling) return;
    setZipBundling(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const targetMc = effectiveTargetVersion || 'library';
    const queue: BulkDownloadItem[] = downloadableMods.map((m) => ({
      resultId: m.id,
      filename: sanitizeDisplayName(m.latestFilename!),
      projectTitle: m.title,
      url: m.latestDownloadUrl!,
      size: 0,
      status: 'pending',
    }));

    try {
      const outcome = await buildAndDownloadZipBundle(queue, {
        gameVersion: targetMc,
        loader: downloadableMods[0]?.loader ?? 'fabric',
        includeSnapshots: false,
        allowPrereleasesDirectly: false,
      });
      if (outcome.succeededCount > 0) {
        setStatusMessage(
          `Created ZIP bundle with ${outcome.succeededCount} compatible library JARs${
            outcome.failedItems.length > 0
              ? ` (${outcome.failedItems.length} skipped)`
              : '.'
          }`,
        );
      } else {
        setErrorMessage('Could not bundle library JARs into a ZIP in this browser.');
      }
    } finally {
      setZipBundling(false);
    }
  };

  const handleCheckSingle = async (mod: TrackedModRecord) => {
    if (!user || checkingSingleId) return;
    setCheckingSingleId(mod.id);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const targetMc = batchTargetVersion || mod.targetVersion || effectiveTargetVersion;
      await checkModUpdate(mod, targetMc);
      setStatusMessage(`Updated compatibility check for "${mod.title}" (${targetMc}).`);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : `Failed to check "${mod.title}".`,
      );
    } finally {
      setCheckingSingleId(null);
    }
  };

  const handleDeleteMod = async (modId: string) => {
    if (!user || deletingModId) return;
    setDeletingModId(modId);
    setErrorMessage(null);
    try {
      await deleteTrackedMod(user.uid, modId);
    } catch (err) {
      setErrorMessage(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Could not remove mod from your library.',
      );
    } finally {
      setDeletingModId(null);
    }
  };

  const handleDeleteMigration = async (migId: string) => {
    if (!user || deletingMigId) return;
    setDeletingMigId(migId);
    setErrorMessage(null);
    try {
      await deleteSavedMigration(user.uid, migId);
    } catch (err) {
      setErrorMessage(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Could not delete saved migration.',
      );
    } finally {
      setDeletingMigId(null);
    }
  };

  const handleCopyShareUrl = async (shareId: string) => {
    const fullUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}${buildSharedPackPath(shareId)}`
        : buildSharedPackPath(shareId);
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedShareId(shareId);
      setTimeout(() => {
        setCopiedShareId((curr) => (curr === shareId ? null : curr));
      }, 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleShareMigration = async (rec: SavedMigrationRecord) => {
    if (!user || sharingMigId) return;
    setSharingMigId(rec.id);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const hydrated = hydrateSavedMigrationResults(rec);
      const shareId = await publishSharedPack(user, {
        title: rec.name,
        gameVersion: rec.gameVersion,
        loader: rec.loader,
        results: hydrated,
      });
      await handleCopyShareUrl(shareId);
      setStatusMessage(
        `Published shareable modpack link for "${rec.name}" and copied URL to clipboard.`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Could not publish shareable modpack link.',
      );
    } finally {
      setSharingMigId(null);
    }
  };

  const handleDeleteSharedPack = async (shareId: string) => {
    if (!user || deletingShareId) return;
    setDeletingShareId(shareId);
    setErrorMessage(null);
    try {
      await deleteSharedPack(shareId);
    } catch (err) {
      setErrorMessage(
        err instanceof Error && !err.message.startsWith('{')
          ? err.message
          : 'Could not revoke shared link.',
      );
    } finally {
      setDeletingShareId(null);
    }
  };

  return (
    <section aria-labelledby="manage-panel-heading" className="space-y-8">
      {/* Tracked Mods Library */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div>
            <h2
              id="manage-panel-heading"
              className="font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
            >
              Manage My Mods ({trackedMods.length})
            </h2>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Track individual mods, check for new Modrinth releases across Minecraft versions, and download verified JARs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Target Minecraft version for update check"
              value={effectiveTargetVersion}
              onChange={(e) => setBatchTargetVersion(e.target.value)}
              className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {releaseVersions.map((gv) => (
                <option key={gv.version} value={gv.version}>
                  Check for {gv.version}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={checkingUpdates || trackedMods.length === 0}
              onClick={() => void handleCheckAllUpdates()}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${checkingUpdates ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>
                {checkingUpdates && checkProgress
                  ? `Checking ${checkProgress.done}/${checkProgress.total}`
                  : siteConfig.creditsEnabled && !isAdmin && siteConfig.libraryCheckCreditCost > 0
                  ? `Check All Updates (${siteConfig.libraryCheckCreditCost} cr)`
                  : 'Check All Updates'}
              </span>
            </button>

            {downloadableMods.length > 0 && (
              <>
                <button
                  type="button"
                  disabled={bulkDownloading || zipBundling}
                  onClick={() => void handleDownloadAllCompatible()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Download All ({downloadableMods.length})</span>
                </button>
                <button
                  type="button"
                  disabled={bulkDownloading || zipBundling}
                  onClick={() => void handleBundleLibraryZip()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{zipBundling ? 'Bundling...' : 'Bundle .zip'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {(statusMessage || errorMessage) && (
          <div className="border-b border-zinc-100 px-5 py-3 text-xs dark:border-zinc-800">
            {statusMessage && (
              <p className="font-medium text-emerald-700 dark:text-emerald-400">
                {statusMessage}
              </p>
            )}
            {errorMessage && (
              <p className="font-medium text-red-700 dark:text-red-400">
                {errorMessage}
              </p>
            )}
          </div>
        )}

        {trackedMods.length > 4 && (
          <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <div className="relative max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter tracked mods..."
                aria-label="Filter tracked mods"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>
        )}

        {loadingTrackedMods ? (
          <div className="flex items-center justify-center py-10 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading your tracked mods...</span>
          </div>
        ) : trackedMods.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No mods saved in your library yet
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Search Modrinth or run an update check to save mods here for quick tracking.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={() => onNavigatePanel('search')}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Search Mods</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigatePanel('update')}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              >
                <span>Update Modpack</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {filteredMods.map((mod) => (
              <li
                key={mod.id}
                className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a
                      href={getModrinthProjectUrl(mod.slug || mod.projectId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-sm text-zinc-950 hover:text-emerald-700 hover:underline dark:text-zinc-100 dark:hover:text-emerald-400"
                    >
                      <span>{mod.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      · {formatLoaderName(mod.loader)}
                    </span>
                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      · Target: {mod.targetVersion}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {mod.latestVersionNumber ? (
                      <>
                        Latest compatible:{' '}
                        <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">
                          {mod.latestVersionNumber}
                        </span>
                        {mod.latestFilename ? ` (${mod.latestFilename})` : ''}
                      </>
                    ) : (
                      <span>
                        No compatible {formatLoaderName(mod.loader)} release recorded for {mod.targetVersion} yet.
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={checkingSingleId === mod.id}
                    onClick={() => void handleCheckSingle(mod)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 whitespace-nowrap hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${checkingSingleId === mod.id ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Check Update</span>
                  </button>

                  {mod.latestDownloadUrl && mod.latestFilename && (
                    <button
                      type="button"
                      onClick={() =>
                        triggerDirectDownload(mod.latestDownloadUrl!, mod.latestFilename!)
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={deletingModId === mod.id}
                    onClick={() => void handleDeleteMod(mod.id)}
                    aria-label={`Remove ${mod.title} from My Mods`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Saved Migration Snapshots */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div>
            <h3 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Saved Migration Snapshots ({savedMigrations.length})
            </h3>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Reopen previous modpack reports, compare two snapshots, or publish a shareable link.
            </p>
          </div>
          {savedMigrations.length >= 2 && (
            <button
              type="button"
              onClick={() => setDiffOpen(true)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Compare Snapshots</span>
            </button>
          )}
        </div>

        {loadingMigrations ? (
          <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading saved migrations...</span>
          </div>
        ) : savedMigrations.length === 0 ? (
          <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No saved migration snapshots yet. Run a migration in the Update Mods panel and click Save Snapshot.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {savedMigrations.map((rec) => {
              const createdStr = rec.createdAt
                ? rec.createdAt.toDate().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Just now';

              return (
                <li
                  key={rec.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-100">
                      {rec.name}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                      Minecraft {rec.gameVersion} · {formatLoaderName(rec.loader)} ·{' '}
                      {rec.summary.ready}/{rec.summary.total} ready · Saved {createdStr}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={sharingMigId === rec.id || rec.summary.ready === 0}
                      onClick={() => void handleShareMigration(rec)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {sharingMigId === rec.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Share Link</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onLoadSavedMigration(
                          hydrateSavedMigrationResults(rec),
                          {
                            gameVersion: rec.gameVersion,
                            loader: rec.loader,
                            includeSnapshots: false,
                            allowPrereleasesDirectly: false,
                          },
                          rec.name,
                        )
                      }
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      <FolderUp className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open in Update Panel</span>
                    </button>

                    <button
                      type="button"
                      disabled={deletingMigId === rec.id}
                      onClick={() => void handleDeleteMigration(rec.id)}
                      aria-label={`Delete saved migration ${rec.name}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* My Shared Modpack Links */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h3 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
            My Shared Modpack Links ({sharedPacks.length})
          </h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Anyone with a link can view and download these modpacks without signing in. Revoke any link anytime.
          </p>
        </div>

        {loadingSharedPacks ? (
          <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading shared links...</span>
          </div>
        ) : sharedPacks.length === 0 ? (
          <p className="p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
            No shared modpack links published yet. Use &ldquo;Share Link&rdquo; on any migration result or saved snapshot.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sharedPacks.map((pack) => {
              const createdStr = pack.createdAt
                ? pack.createdAt.toDate().toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'Just now';
              return (
                <li
                  key={pack.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-100">
                      {pack.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                      Minecraft {pack.gameVersion} · {formatLoaderName(pack.loader)} ·{' '}
                      {pack.modCount} ready mods · Shared {createdStr}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                      {buildSharedPackPath(pack.id)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyShareUrl(pack.id)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                      {copiedShareId === pack.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenSharedPack(pack.id)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open</span>
                    </button>

                    <button
                      type="button"
                      disabled={deletingShareId === pack.id}
                      onClick={() => void handleDeleteSharedPack(pack.id)}
                      aria-label={`Revoke shared link ${pack.title}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <SnapshotDiffModal
        open={diffOpen}
        snapshots={savedMigrations}
        onClose={() => setDiffOpen(false)}
      />
    </section>
  );
}
