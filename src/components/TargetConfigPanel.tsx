import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SUPPORTED_LOADERS } from '../config/brand';
import { isLoaderSupportedForVersion } from '../services/migrationEngine';
import type {
  GameVersionTag,
  MigrationProgress,
  MigrationTargetConfig,
  ModLoader,
} from '../types/migration';

interface TargetConfigPanelProps {
  config: MigrationTargetConfig;
  gameVersions: GameVersionTag[];
  versionsLoading: boolean;
  versionsError: string | null;
  fileCount: number;
  isProcessing: boolean;
  progress: MigrationProgress;
  disabledLoaders?: ModLoader[];
  creditsEnabled?: boolean;
  creditCost?: number;
  userCredits?: number;
  isAdmin?: boolean;
  onConfigChange: (next: MigrationTargetConfig) => void;
  onRetryLoadVersions: () => void;
  onStartMigration: () => void;
  onCancelMigration: () => void;
}

export function TargetConfigPanel({
  config,
  gameVersions,
  versionsLoading,
  versionsError,
  fileCount,
  isProcessing,
  progress,
  disabledLoaders = [],
  creditsEnabled = true,
  creditCost = 1,
  userCredits = 50,
  isAdmin = false,
  onConfigChange,
  onRetryLoadVersions,
  onStartMigration,
  onCancelMigration,
}: TargetConfigPanelProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [versionSearch, setVersionSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const filteredVersions = useMemo(() => {
    const q = versionSearch.trim().toLowerCase();
    return gameVersions.filter((gv) => {
      if (!config.includeSnapshots && gv.version_type !== 'release') {
        return false;
      }
      if (!q) return true;
      return gv.version.toLowerCase().includes(q);
    });
  }, [gameVersions, config.includeSnapshots, versionSearch]);

  const loaderValidation = useMemo(
    () => isLoaderSupportedForVersion(config.loader, config.gameVersion),
    [config.loader, config.gameVersion],
  );

  const selectedVersionObj = useMemo(
    () => gameVersions.find((v) => v.version === config.gameVersion),
    [gameVersions, config.gameVersion],
  );

  const selectedLoaderMaintDisabled = disabledLoaders.includes(config.loader);
  const needsCredits = creditsEnabled && !isAdmin && creditCost > 0;
  const insufficientCredits = needsCredits && userCredits < creditCost;

  const canRun =
    !isProcessing &&
    fileCount > 0 &&
    Boolean(config.gameVersion) &&
    loaderValidation.supported &&
    !selectedLoaderMaintDisabled &&
    !insufficientCredits;

  const progressPct = useMemo(() => {
    if (progress.phase === 'hashing' && progress.totalCount > 0) {
      return Math.round((progress.hashedCount / progress.totalCount) * 45);
    }
    if (progress.phase === 'querying' && progress.totalBatches > 0) {
      return 45 + Math.round((progress.queriedBatches / progress.totalBatches) * 35);
    }
    if (progress.phase === 'resolving_dependencies') {
      const depRatio =
        progress.dependencyCount > 0
          ? progress.resolvedDependencies / progress.dependencyCount
          : 1;
      return 80 + Math.round(depRatio * 20);
    }
    if (progress.phase === 'completed') return 100;
    return 0;
  }, [progress]);

  return (
    <section
      aria-labelledby="config-step-heading"
      className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          Step 2 of 2
        </p>
        <h2
          id="config-step-heading"
          className="mt-1 font-display text-lg font-semibold text-zinc-950 dark:text-zinc-50"
        >
          Choose target Minecraft version and loader
        </h2>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-12">
        {/* Minecraft version selector */}
        <div className="lg:col-span-5" ref={dropdownRef}>
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="mc-version-trigger"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Target Minecraft Version
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer dark:text-zinc-400">
              <input
                type="checkbox"
                checked={config.includeSnapshots}
                disabled={isProcessing}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    includeSnapshots: e.target.checked,
                  })
                }
                className="h-3.5 w-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
              />
              <span>Snapshots</span>
            </label>
          </div>

          {versionsError ? (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <p className="font-medium">Could not load Minecraft versions from Modrinth.</p>
              <p className="mt-1 text-red-800/90 dark:text-red-300/90">{versionsError}</p>
              <button
                type="button"
                onClick={onRetryLoadVersions}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-200"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <div className="relative mt-2">
              <button
                id="mc-version-trigger"
                type="button"
                disabled={versionsLoading || isProcessing}
                aria-expanded={dropdownOpen}
                aria-haspopup="listbox"
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-left text-sm text-zinc-950 transition-colors hover:border-zinc-400 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-600"
              >
                {versionsLoading ? (
                  <span className="inline-flex items-center gap-2 text-zinc-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Loading Modrinth versions...</span>
                  </span>
                ) : config.gameVersion ? (
                  <span className="flex items-center gap-2 truncate">
                    <span className="font-mono font-medium tabular-nums">
                      {config.gameVersion}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      · {selectedVersionObj?.version_type === 'release' ? 'Release' : 'Snapshot'}
                    </span>
                  </span>
                ) : (
                  <span className="text-zinc-400">Select Minecraft version...</span>
                )}
                <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              </button>

              {dropdownOpen && !versionsLoading && (
                <div className="absolute left-0 right-0 z-20 mt-1.5 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        autoFocus
                        value={versionSearch}
                        onChange={(e) => setVersionSearch(e.target.value)}
                        placeholder="Search e.g. 1.21.4, 1.20.1..."
                        aria-label="Search Minecraft versions"
                        className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </div>
                  </div>
                  <ul
                    role="listbox"
                    aria-label="Minecraft versions"
                    className="max-h-60 overflow-y-auto p-1 text-xs"
                  >
                    {filteredVersions.length === 0 ? (
                      <li className="px-3 py-4 text-center text-zinc-500 dark:text-zinc-400">
                        No matching versions found.
                      </li>
                    ) : (
                      filteredVersions.slice(0, 120).map((gv) => {
                        const isSelected = gv.version === config.gameVersion;
                        return (
                          <li key={gv.version}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                onConfigChange({ ...config, gameVersion: gv.version });
                                setDropdownOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors ${
                                isSelected
                                  ? 'bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200'
                                  : 'text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono tabular-nums">{gv.version}</span>
                                <span className="text-zinc-500 dark:text-zinc-400">
                                  · {gv.version_type === 'release' ? 'Release' : gv.version_type}
                                </span>
                              </span>
                              {isSelected && (
                                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                              )}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          <label className="mt-3 inline-flex items-start gap-2 text-xs text-zinc-600 cursor-pointer dark:text-zinc-400">
            <input
              type="checkbox"
              checked={config.allowPrereleasesDirectly}
              disabled={isProcessing}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  allowPrereleasesDirectly: e.target.checked,
                })
              }
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
            />
            <span>
              Include beta and alpha releases in Ready to Download (otherwise held in Needs Review)
            </span>
          </label>
        </div>

        {/* Mod loader cards */}
        <div className="lg:col-span-7">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Target Mod Loader (one active)
          </span>
          <div
            role="radiogroup"
            aria-label="Target Mod Loader"
            className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4"
          >
            {SUPPORTED_LOADERS.map((loader) => {
              const selected = config.loader === loader.id;
              const isMaintDisabled = disabledLoaders.includes(loader.id);
              return (
                <button
                  key={loader.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isProcessing || isMaintDisabled}
                  onClick={() =>
                    onConfigChange({ ...config, loader: loader.id as ModLoader })
                  }
                  className={`flex flex-col items-start rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-60 ${
                    selected
                      ? 'border-emerald-600 bg-emerald-50/70 text-zinc-950 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-zinc-50'
                      : 'border-zinc-200 bg-zinc-50/50 text-zinc-800 hover:border-zinc-300 hover:bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="text-sm font-semibold whitespace-nowrap">
                    {loader.label}
                  </span>
                  <span className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                    {isMaintDisabled
                      ? 'Disabled for maintenance'
                      : loader.description}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedLoaderMaintDisabled ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>
                {SUPPORTED_LOADERS.find((l) => l.id === config.loader)?.label ?? config.loader} is temporarily disabled by site administrators. Choose another active loader.
              </span>
            </div>
          ) : (
            !loaderValidation.supported && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                <span>{loaderValidation.reason}</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* Action & Progress bar */}
      <div className="mt-6 flex flex-col gap-4 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {fileCount === 0 ? (
            <span>Add at least one .jar file in Step 1 to begin.</span>
          ) : (
            <span>
              Ready to check{' '}
              <strong className="font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                {fileCount}
              </strong>{' '}
              {fileCount === 1 ? 'mod' : 'mods'} for{' '}
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                Minecraft {config.gameVersion || '—'}
              </strong>{' '}
              on{' '}
              <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                {SUPPORTED_LOADERS.find((l) => l.id === config.loader)?.label}
              </strong>
              .
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {creditsEnabled && fileCount > 0 && (
            <span
              className={`text-xs font-mono tabular-nums ${
                insufficientCredits
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {isAdmin || creditCost === 0
                ? 'Free (Admin / 0 credits)'
                : insufficientCredits
                ? `Need ${creditCost} credit${creditCost === 1 ? '' : 's'} (${userCredits} left)`
                : `Cost: ${creditCost} credit${creditCost === 1 ? '' : 's'} (${userCredits} available)`}
            </span>
          )}
          {isProcessing ? (
            <button
              type="button"
              onClick={onCancelMigration}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-medium text-red-700 whitespace-nowrap shrink-0 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:border-red-800 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>Cancel Analysis</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!canRun}
              onClick={onStartMigration}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              <span>Find Compatible Mods</span>
            </button>
          )}
        </div>
      </div>

      {isProcessing && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>{progress.message || 'Analyzing mod collection...'}</span>
            </span>
            <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
              {progressPct}%
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full bg-emerald-600 transition-[width] duration-200 dark:bg-emerald-500"
              style={{ width: `${Math.max(4, progressPct)}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
