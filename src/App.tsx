import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  BookmarkCheck,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderCog,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Share2,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountPanel } from './components/AccountPanel';
import { AdminPanel } from './components/AdminPanel';
import { AnnouncementModal } from './components/AnnouncementModal';
import { AuthGatePanel, type WorkspacePanelId } from './components/AuthGatePanel';
import { Header } from './components/Header';
import { InfoSections } from './components/InfoSections';
import { ManageModsPanel } from './components/ManageModsPanel';
import { MaintenancePanel } from './components/MaintenancePanel';
import { ManualSearchModal } from './components/ManualSearchModal';
import { ModDropzone } from './components/ModDropzone';
import { NotFoundPage } from './components/NotFoundPage';
import { ResultsDashboard } from './components/ResultsDashboard';
import { SearchModsPanel } from './components/SearchModsPanel';
import { SharedPackView } from './components/SharedPackView';
import { TargetConfigPanel } from './components/TargetConfigPanel';
import { BRAND_CONFIG, SUPPORTED_LOADERS } from './config/brand';
import { syncUserProfile, useAuth } from './contexts/AuthContext';
import { spendUserCredits } from './services/creditsService';
import { resolveMigrationDependencies } from './services/dependencyResolver';
import { hashModCollection, intakeModFiles } from './services/hashService';
import {
  analyzeModCollection,
  buildManualMatchResult,
  isLoaderSupportedForVersion,
} from './services/migrationEngine';
import { exportMrpackArchive, parseMrpackArchive } from './services/mrpackService';
import { ModrinthApiError, modrinthClient } from './services/providers/modrinthClient';
import {
  saveMigrationSnapshot,
  subscribeToUserMigrations,
  type SavedMigrationRecord,
} from './services/savedMigrationsService';
import {
  buildSharedPackPath,
  publishSharedPack,
  subscribeToUserSharedPacks,
  type SharedPackRecord,
} from './services/sharedPacksService';
import {
  DEFAULT_SITE_CONFIG,
  subscribeToSiteConfig,
  type SiteConfig,
} from './services/siteConfigService';
import {
  saveTrackedMod,
  subscribeToTrackedMods,
  type TrackedModRecord,
} from './services/trackedModsService';
import type {
  GameVersionTag,
  LocalModFile,
  MigrationProgress,
  MigrationTargetConfig,
  ModMigrationResult,
  ModrinthProject,
  ModrinthVersion,
  RejectedFileNotice,
  ResolvedDependency,
} from './types/migration';
import { formatLoaderName } from './utils/format';

const INITIAL_PROGRESS: MigrationProgress = {
  phase: 'idle',
  hashedCount: 0,
  totalCount: 0,
  queriedBatches: 0,
  totalBatches: 0,
  dependencyCount: 0,
  resolvedDependencies: 0,
  message: '',
};

function normalizePathname(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '');
  return clean || '/';
}

export default function App() {
  const {
    user,
    isAdmin,
    credits,
    isBanned,
    banReason,
    profileReady,
    authReady,
    authError,
    signOutUser,
    clearAuthError,
  } = useAuth();
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [currentPath, setCurrentPath] = useState<string>(() =>
    typeof window !== 'undefined'
      ? normalizePathname(window.location.pathname)
      : '/',
  );

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePathname(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigatePath = useCallback((path: string) => {
    const next = normalizePathname(path);
    if (typeof window !== 'undefined' && normalizePathname(window.location.pathname) !== next) {
      window.history.pushState({}, '', next);
    }
    setCurrentPath(next);
  }, []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const stored = window.localStorage.getItem('modshift-theme-v2');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      // Ignore storage failures in restricted contexts
    }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem('modshift-theme-v2', next);
      } catch {
        // Ignore storage failures in restricted contexts
      }
      return next;
    });
  }, []);

  // Public subscription to global site configuration (maintenance, news, hero copy, disabled loaders)
  useEffect(() => {
    const unsub = subscribeToSiteConfig(
      (nextConfig) => setSiteConfig(nextConfig),
      (err) => {
        console.error('Failed to subscribe to siteConfig/global:', err);
      },
    );
    return () => unsub();
  }, []);

  const [dismissedNewsKey, setDismissedNewsKey] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage.getItem('modshift-dismissed-announcement');
    } catch {
      return null;
    }
  });

  const handleDismissAnnouncement = useCallback((signature: string) => {
    setDismissedNewsKey(signature);
    try {
      window.sessionStorage.setItem('modshift-dismissed-announcement', signature);
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }, []);

  // Multi-panel navigation state
  const [viewMode, setViewMode] = useState<'landing' | 'workspace' | 'auth_gate'>('landing');
  const [activePanel, setActivePanel] = useState<WorkspacePanelId>('update');
  const [pendingPanel, setPendingPanel] = useState<WorkspacePanelId>('update');

  // If user finishes signing in while on the auth gate, send them straight to their requested panel
  useEffect(() => {
    if (authReady && user && viewMode === 'auth_gate') {
      setActivePanel(pendingPanel);
      setViewMode('workspace');
    }
  }, [authReady, user, viewMode, pendingPanel]);

  // Automatic /maintenance panel routing when maintenance mode is enabled
  useEffect(() => {
    if (!authReady) return;
    if (
      siteConfig.maintenanceMode &&
      !isAdmin &&
      currentPath !== '/admin' &&
      currentPath !== '/maintenance'
    ) {
      navigatePath('/maintenance');
      return;
    }
    if (
      currentPath === '/maintenance' &&
      (!siteConfig.maintenanceMode || isAdmin)
    ) {
      navigatePath('/');
    }
  }, [authReady, siteConfig.maintenanceMode, isAdmin, currentPath, navigatePath]);

  const handleNavigatePanel = useCallback(
    (panel: WorkspacePanelId) => {
      if (siteConfig.maintenanceMode && !isAdmin) {
        navigatePath('/maintenance');
        return;
      }
      navigatePath('/');
      if (!user) {
        setPendingPanel(panel);
        setViewMode('auth_gate');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      setActivePanel(panel);
      setViewMode('workspace');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [user, isAdmin, siteConfig.maintenanceMode, navigatePath],
  );

  const handleGoLanding = useCallback(() => {
    if (siteConfig.maintenanceMode && !isAdmin) {
      navigatePath('/maintenance');
      return;
    }
    navigatePath('/');
    setViewMode('landing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [siteConfig.maintenanceMode, isAdmin, navigatePath]);

  // Firestore user data subscriptions (attached only when authenticated and profile synced)
  const [trackedMods, setTrackedMods] = useState<TrackedModRecord[]>([]);
  const [loadingTrackedMods, setLoadingTrackedMods] = useState(false);
  const [savedMigrations, setSavedMigrations] = useState<SavedMigrationRecord[]>([]);
  const [loadingMigrations, setLoadingMigrations] = useState(false);
  const [sharedPacks, setSharedPacks] = useState<SharedPackRecord[]>([]);
  const [loadingSharedPacks, setLoadingSharedPacks] = useState(false);

  useEffect(() => {
    if (!authReady || !user) {
      setTrackedMods([]);
      setSavedMigrations([]);
      setSharedPacks([]);
      setLoadingTrackedMods(false);
      setLoadingMigrations(false);
      setLoadingSharedPacks(false);
      return;
    }

    if (!profileReady) {
      setLoadingTrackedMods(true);
      setLoadingMigrations(true);
      setLoadingSharedPacks(true);
      return;
    }

    setLoadingTrackedMods(true);
    setLoadingMigrations(true);
    setLoadingSharedPacks(true);

    const unsubMods = subscribeToTrackedMods(
      user.uid,
      (list) => {
        setTrackedMods(list);
        setLoadingTrackedMods(false);
      },
      () => {
        setLoadingTrackedMods(false);
      },
    );

    const unsubMigrations = subscribeToUserMigrations(
      user.uid,
      (list) => {
        setSavedMigrations(list);
        setLoadingMigrations(false);
      },
      () => {
        setLoadingMigrations(false);
      },
    );

    const unsubSharedPacks = subscribeToUserSharedPacks(
      user.uid,
      (list) => {
        setSharedPacks(list);
        setLoadingSharedPacks(false);
      },
      () => {
        setLoadingSharedPacks(false);
      },
    );

    return () => {
      unsubMods();
      unsubMigrations();
      unsubSharedPacks();
    };
  }, [authReady, user, profileReady]);

  // Minecraft versions from Modrinth
  const [gameVersions, setGameVersions] = useState<GameVersionTag[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [config, setConfig] = useState<MigrationTargetConfig>({
    gameVersion: '',
    loader: 'fabric',
    includeSnapshots: false,
    allowPrereleasesDirectly: false,
  });

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const list = await modrinthClient.getGameVersions();
      setGameVersions(list);
      const latestRelease = list.find((v) => v.version_type === 'release');
      setConfig((prev) => ({
        ...prev,
        gameVersion:
          prev.gameVersion || latestRelease?.version || list[0]?.version || '',
      }));
    } catch (err) {
      setVersionsError(
        err instanceof Error
          ? err.message
          : 'Unable to fetch Minecraft versions from Modrinth.',
      );
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  // Local mod files, .mrpack & migration state (Update Mods panel)
  const [files, setFiles] = useState<LocalModFile[]>([]);
  const [rejectedNotices, setRejectedNotices] = useState<RejectedFileNotice[]>([]);
  const [mrpackBanner, setMrpackBanner] = useState<{
    packName: string;
    count: number;
    skippedCount: number;
  } | null>(null);
  const [isImportingMrpack, setIsImportingMrpack] = useState(false);
  const [isExportingMrpack, setIsExportingMrpack] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRetryingFailed, setIsRetryingFailed] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress>(INITIAL_PROGRESS);
  const [results, setResults] = useState<ModMigrationResult[]>([]);
  const [dependencies, setDependencies] = useState<ResolvedDependency[]>([]);
  const [analyzedConfig, setAnalyzedConfig] = useState<MigrationTargetConfig | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'info' | 'error';
    message: string;
  } | null>(null);

  // Saving snapshot / mods / shared link to Firestore from Update panel
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [publishingShare, setPublishingShare] = useState(false);
  const [lastShareId, setLastShareId] = useState<string | null>(null);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (analyzedConfig && results.length > 0) {
      setSnapshotLabel(
        `Minecraft ${analyzedConfig.gameVersion} · ${formatLoaderName(analyzedConfig.loader)}`,
      );
    }
  }, [analyzedConfig, results.length]);

  const [manualSearchTarget, setManualSearchTarget] =
    useState<ModMigrationResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const resultsAnchorRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<LocalModFile[]>(files);
  const prevAuthUidRef = useRef<string | null>(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Reset local workspace state on sign-out or account switch to prevent cross-account data bleed
  useEffect(() => {
    if (!authReady) return;
    const nextUid = user?.uid ?? null;
    const prevUid = prevAuthUidRef.current;

    if (prevUid && prevUid !== nextUid) {
      abortControllerRef.current?.abort();
      filesRef.current = [];
      setFiles([]);
      setRejectedNotices([]);
      setMrpackBanner(null);
      setResults([]);
      setDependencies([]);
      setAnalyzedConfig(null);
      setStatusBanner(null);
      setSaveSuccessMsg(null);
      setLastShareId(null);
      setManualSearchTarget(null);
      setProgress(INITIAL_PROGRESS);

      if (!nextUid) {
        setViewMode('landing');
      }
    }

    prevAuthUidRef.current = nextUid;
  }, [authReady, user]);

  // Automatically switch to an enabled loader if the currently selected loader is disabled by admins
  useEffect(() => {
    if (isProcessing) return;
    if (siteConfig.disabledLoaders.includes(config.loader)) {
      const nextAvailable = SUPPORTED_LOADERS.find(
        (l) => !siteConfig.disabledLoaders.includes(l.id),
      );
      if (nextAvailable) {
        setConfig((prev) => ({ ...prev, loader: nextAvailable.id }));
      }
    }
  }, [siteConfig.disabledLoaders, config.loader, isProcessing]);

  const handleFilesAdded = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const mrpackFiles = list.filter((f) => f.name.toLowerCase().endsWith('.mrpack'));
      const otherFiles = list.filter((f) => !f.name.toLowerCase().endsWith('.mrpack'));

      if (otherFiles.length > 0) {
        const { accepted, rejected } = intakeModFiles(otherFiles, filesRef.current);
        if (accepted.length > 0) {
          const updated = [...filesRef.current, ...accepted];
          filesRef.current = updated;
          setFiles(updated);
        }
        if (rejected.length > 0) {
          setRejectedNotices((prev) => [...prev, ...rejected]);
        }
      }

      setStatusBanner(null);

      if (mrpackFiles.length > 0) {
        setIsImportingMrpack(true);
        void (async () => {
          try {
            let lastPackName = '';
            let totalImported = 0;
            let totalSkipped = 0;

            for (const packFile of mrpackFiles) {
              const outcome = await parseMrpackArchive(packFile);
              lastPackName = outcome.packName;
              totalSkipped += outcome.skippedCount;

              const currentFiles = filesRef.current;
              const existingHashes = new Set(
                currentFiles.map((f) => f.sha1?.toLowerCase()).filter(Boolean),
              );
              const existingKeys = new Set(
                currentFiles.map((f) => `${f.name.toLowerCase()}::${f.size}`),
              );
              const uniqueNew = outcome.files.filter((f) => {
                const hashKey = f.sha1?.toLowerCase();
                const fileKey = `${f.name.toLowerCase()}::${f.size}`;
                if (hashKey && existingHashes.has(hashKey)) return false;
                if (existingKeys.has(fileKey)) return false;
                if (hashKey) existingHashes.add(hashKey);
                existingKeys.add(fileKey);
                return true;
              });

              if (uniqueNew.length > 0) {
                const merged = [...currentFiles, ...uniqueNew];
                filesRef.current = merged;
                setFiles(merged);
                totalImported += uniqueNew.length;
              }

              if (outcome.detectedMinecraftVersion || outcome.detectedLoader) {
                setConfig((prev) => ({
                  ...prev,
                  gameVersion: outcome.detectedMinecraftVersion || prev.gameVersion,
                  loader:
                    outcome.detectedLoader &&
                    !siteConfig.disabledLoaders.includes(outcome.detectedLoader)
                      ? outcome.detectedLoader
                      : prev.loader,
                }));
              }
            }

            setMrpackBanner({
              packName: lastPackName || 'Modpack archive',
              count: totalImported,
              skippedCount: totalSkipped,
            });
          } catch (err) {
            setStatusBanner({
              type: 'error',
              message:
                err instanceof Error
                  ? err.message
                  : 'Could not import .mrpack archive.',
            });
          } finally {
            setIsImportingMrpack(false);
          }
        })();
      }
    },
    [siteConfig.disabledLoaders],
  );

  const handleRemoveFile = useCallback((id: string) => {
    const next = filesRef.current.filter((f) => f.id !== id);
    filesRef.current = next;
    setFiles(next);
  }, []);

  const handleClearAllFiles = useCallback(() => {
    filesRef.current = [];
    setFiles([]);
    setRejectedNotices([]);
    setMrpackBanner(null);
    setResults([]);
    setDependencies([]);
    setAnalyzedConfig(null);
    setStatusBanner(null);
    setSaveSuccessMsg(null);
    setLastShareId(null);
    setProgress(INITIAL_PROGRESS);
  }, []);

  const handleCancelMigration = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleStartMigration = useCallback(async () => {
    if (!user) {
      setPendingPanel('update');
      setViewMode('auth_gate');
      return;
    }
    if (isBanned && !isAdmin) {
      setStatusBanner({
        type: 'error',
        message: banReason || 'Your account is currently suspended.',
      });
      return;
    }
    if (files.length === 0 || !config.gameVersion) return;
    if (siteConfig.disabledLoaders.includes(config.loader)) {
      setStatusBanner({
        type: 'error',
        message: `${formatLoaderName(config.loader)} is temporarily disabled by site administrators.`,
      });
      return;
    }
    const loaderCheck = isLoaderSupportedForVersion(config.loader, config.gameVersion);
    if (!loaderCheck.supported) {
      setStatusBanner({
        type: 'error',
        message: loaderCheck.reason || 'Unsupported loader and version combination.',
      });
      return;
    }

    const migrationCost =
      siteConfig.creditsEnabled && !isAdmin
        ? Math.max(0, siteConfig.migrationCreditCost)
        : 0;
    if (migrationCost > 0 && credits < migrationCost) {
      setStatusBanner({
        type: 'error',
        message: `Insufficient credits (${credits} available, ${migrationCost} required to run migration analysis).`,
      });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsProcessing(true);
    setStatusBanner(null);
    setSaveSuccessMsg(null);
    setLastShareId(null);
    setResults([]);
    setDependencies([]);
    const snapshotConfig = { ...config };
    setAnalyzedConfig(snapshotConfig);

    try {
      setProgress({
        ...INITIAL_PROGRESS,
        phase: 'hashing',
        totalCount: files.length,
        message: `Calculating local SHA-1 hashes (0/${files.length})...`,
      });

      const hashOutcome = await hashModCollection(files, {
        signal: controller.signal,
        onFileProgress: (updatedFile, completedCount, totalCount) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === updatedFile.id ? updatedFile : f)),
          );
          setProgress((p) => ({
            ...p,
            phase: 'hashing',
            hashedCount: completedCount,
            totalCount,
            message: `Calculating local SHA-1 hashes (${completedCount}/${totalCount})...`,
          }));
        },
      });

      if (hashOutcome.cancelled || controller.signal.aborted) {
        setProgress({ ...INITIAL_PROGRESS, phase: 'cancelled' });
        setStatusBanner({
          type: 'info',
          message: 'Migration was cancelled before completion.',
        });
        return;
      }

      if (hashOutcome.duplicateNotices.length > 0) {
        setRejectedNotices((prev) => [...prev, ...hashOutcome.duplicateNotices]);
      }

      setFiles(hashOutcome.hashedFiles);

      if (hashOutcome.hashedFiles.length === 0) {
        setProgress(INITIAL_PROGRESS);
        return;
      }

      if (migrationCost > 0) {
        await spendUserCredits(
          user,
          migrationCost,
          `Modpack migration (${hashOutcome.hashedFiles.length} mods -> ${snapshotConfig.gameVersion} ${snapshotConfig.loader})`,
        );
      }

      const migrationResults = await analyzeModCollection(
        hashOutcome.hashedFiles,
        snapshotConfig,
        {
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
          onPartialResults: (partial) => setResults(partial),
        },
      );

      if (controller.signal.aborted) {
        setProgress({ ...INITIAL_PROGRESS, phase: 'cancelled' });
        setStatusBanner({
          type: 'info',
          message: 'Migration was cancelled.',
        });
        return;
      }

      setResults(migrationResults);

      setProgress((p) => ({
        ...p,
        phase: 'resolving_dependencies',
        message: 'Checking Modrinth dependency compatibility...',
      }));

      const resolvedDeps = await resolveMigrationDependencies(
        migrationResults,
        snapshotConfig,
        {
          signal: controller.signal,
          onProgress: (p) => setProgress(p),
        },
      );

      if (controller.signal.aborted) {
        setProgress({ ...INITIAL_PROGRESS, phase: 'cancelled' });
        setStatusBanner({
          type: 'info',
          message: 'Migration was cancelled during dependency verification.',
        });
        return;
      }

      setDependencies(resolvedDeps);
      setProgress({
        ...INITIAL_PROGRESS,
        phase: 'completed',
        hashedCount: hashOutcome.hashedFiles.length,
        totalCount: hashOutcome.hashedFiles.length,
        message: 'Migration analysis complete.',
      });

      requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) {
      if (
        (err instanceof ModrinthApiError && err.kind === 'cancelled') ||
        controller.signal.aborted
      ) {
        setProgress({ ...INITIAL_PROGRESS, phase: 'cancelled' });
        setStatusBanner({
          type: 'info',
          message: 'Migration analysis cancelled.',
        });
      } else {
        setProgress({ ...INITIAL_PROGRESS, phase: 'error' });
        setStatusBanner({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'An unexpected error occurred while analyzing mods.',
        });
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }, [
    user,
    isAdmin,
    isBanned,
    banReason,
    credits,
    files,
    config,
    siteConfig.disabledLoaders,
    siteConfig.creditsEnabled,
    siteConfig.migrationCreditCost,
  ]);

  const retryFailedSubset = useCallback(
    async (failedTargets: ModMigrationResult[]) => {
      if (!analyzedConfig || failedTargets.length === 0 || isRetryingFailed) return;
      setIsRetryingFailed(true);
      setStatusBanner(null);

      try {
        const needsRehash = failedTargets
          .filter((r) => !r.localFile.sha1 || r.localFile.status === 'error')
          .map((r) => ({ ...r.localFile, status: 'queued' as const }));

        let filesToQuery = failedTargets.map((r) => r.localFile);
        if (needsRehash.length > 0) {
          const rehashOutcome = await hashModCollection(needsRehash);
          const rehashedMap = new Map(
            rehashOutcome.hashedFiles.map((f) => [f.id, f]),
          );
          filesToQuery = filesToQuery.map((f) => rehashedMap.get(f.id) ?? f);
          setFiles((prev) => prev.map((f) => rehashedMap.get(f.id) ?? f));
        }

        const retriedResults = await analyzeModCollection(filesToQuery, analyzedConfig);
        const retriedMap = new Map(retriedResults.map((r) => [r.id, r]));

        const mergedResults = results.map((r) => retriedMap.get(r.id) ?? r);
        setResults(mergedResults);

        const refreshedDeps = await resolveMigrationDependencies(
          mergedResults,
          analyzedConfig,
        );
        setDependencies(refreshedDeps);
      } catch (err) {
        setStatusBanner({
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Retry failed. Please check your connection and try again.',
        });
      } finally {
        setIsRetryingFailed(false);
      }
    },
    [analyzedConfig, isRetryingFailed, results],
  );

  const handleRetryFailedAll = useCallback(() => {
    const failed = results.filter((r) => r.category === 'failed');
    void retryFailedSubset(failed);
  }, [results, retryFailedSubset]);

  const handleRetrySingleFailed = useCallback(
    (item: ModMigrationResult) => {
      void retryFailedSubset([item]);
    },
    [retryFailedSubset],
  );

  const handleApproveNeedsReview = useCallback((resultId: string) => {
    setResults((prev) =>
      prev.map((r) =>
        r.id === resultId && r.targetFile?.url
          ? {
              ...r,
              category: 'ready',
              explanation: `Approved by user (${r.targetVersion?.version_number ?? 'selected version'}).`,
            }
          : r,
      ),
    );
  }, []);

  const handleManualMatch = useCallback(
    async (
      originalResult: ModMigrationResult,
      project: ModrinthProject,
      version: ModrinthVersion,
    ) => {
      if (!analyzedConfig) return;
      const updated = buildManualMatchResult(
        originalResult,
        project,
        version,
        analyzedConfig,
      );
      const nextResults = results.map((r) => (r.id === updated.id ? updated : r));
      setResults(nextResults);

      try {
        const refreshedDeps = await resolveMigrationDependencies(
          nextResults,
          analyzedConfig,
        );
        setDependencies(refreshedDeps);
      } catch {
        // Keep current dependency list if refresh fails transiently
      }
    },
    [analyzedConfig, results],
  );

  const handleAddDependency = useCallback(
    (dep: ResolvedDependency) => {
      if (!dep.targetVersion || !dep.targetFile || !analyzedConfig) return;

      const alreadyAdded = results.some(
        (r) =>
          r.isDependencyAddition &&
          (r.project?.id === dep.projectId ||
            r.targetVersion?.id === dep.targetVersion?.id),
      );
      if (alreadyAdded) return;

      const syntheticFile = new File([], dep.targetFile.filename, {
        type: 'application/java-archive',
      });

      const newResult: ModMigrationResult = {
        id: `dep-add-${dep.projectId ?? dep.key}`,
        localFile: {
          id: `dep-local-${dep.projectId ?? dep.key}`,
          file: syntheticFile,
          name: dep.targetFile.filename,
          size: dep.targetFile.size,
          status: 'hashed',
        },
        category: 'ready',
        provider: 'Modrinth',
        project: {
          id: dep.projectId ?? dep.targetVersion.project_id,
          slug: dep.projectSlug ?? dep.projectId ?? dep.targetVersion.project_id,
          project_type: 'mod',
          title: dep.projectTitle,
          description: '',
          icon_url: dep.iconUrl,
        },
        targetVersion: dep.targetVersion,
        targetFile: dep.targetFile,
        explanation: `Added required/recommended dependency for ${dep.requiredBy
          .map((x) => x.modName)
          .join(', ')}.`,
        isDependencyAddition: true,
      };

      setResults((prev) => [...prev, newResult]);
      setDependencies((prev) =>
        prev.map((d) =>
          d.key === dep.key
            ? {
                ...d,
                status: 'added_to_migration',
                explanation: 'Added to your Ready migration list.',
              }
            : d,
        ),
      );
    },
    [analyzedConfig, results],
  );

  const handleClearResults = useCallback(() => {
    setResults([]);
    setDependencies([]);
    setAnalyzedConfig(null);
    setStatusBanner(null);
    setSaveSuccessMsg(null);
    setLastShareId(null);
    setProgress(INITIAL_PROGRESS);
  }, []);

  const handleLoadSavedMigration = useCallback(
    (
      loadedResults: ModMigrationResult[],
      loadedConfig: MigrationTargetConfig,
      label: string,
    ) => {
      setResults(loadedResults);
      setDependencies([]);
      setAnalyzedConfig(loadedConfig);
      setConfig((prev) => ({
        ...prev,
        gameVersion: loadedConfig.gameVersion,
        loader: loadedConfig.loader,
      }));
      setStatusBanner({
        type: 'info',
        message: `Loaded saved migration "${label}".`,
      });
      setActivePanel('update');
      setViewMode('workspace');
      requestAnimationFrame(() => {
        resultsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [],
  );

  const handleSaveSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !analyzedConfig || results.length === 0 || savingSnapshot) return;
    if (isBanned && !isAdmin) {
      setStatusBanner({
        type: 'error',
        message: banReason || 'Your account is currently suspended.',
      });
      return;
    }
    setSavingSnapshot(true);
    setSaveSuccessMsg(null);
    setStatusBanner(null);
    try {
      await saveMigrationSnapshot(user.uid, snapshotLabel, analyzedConfig, results);
      setSaveSuccessMsg('Saved migration snapshot to Manage Mods.');
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Could not save migration snapshot.',
      });
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handleSaveMatchedModsToLibrary = async () => {
    if (!user || !analyzedConfig || savingToLibrary) return;
    if (isBanned && !isAdmin) {
      setStatusBanner({
        type: 'error',
        message: banReason || 'Your account is currently suspended.',
      });
      return;
    }

    const seenProjects = new Set<string>();
    const matchable: ModMigrationResult[] = [];
    for (const r of results) {
      if (
        r.provider === 'Modrinth' &&
        r.project?.id &&
        !r.project.id.startsWith('cf-') &&
        (r.category === 'ready' || r.category === 'no_update')
      ) {
        const key = `${r.project.id}:${analyzedConfig.loader}`;
        if (!seenProjects.has(key)) {
          seenProjects.add(key);
          matchable.push(r);
        }
      }
      if (matchable.length >= 50) break;
    }

    if (matchable.length === 0) {
      setStatusBanner({
        type: 'info',
        message:
          'No Modrinth-hosted matches are available in this result set to save to your Manage Mods library.',
      });
      return;
    }

    setSavingToLibrary(true);
    setSaveSuccessMsg(null);
    setStatusBanner(null);
    try {
      await syncUserProfile(user);

      let cursor = 0;
      let saved = 0;
      const concurrency = Math.min(5, matchable.length);

      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= matchable.length) break;
          const r = matchable[idx];
          await saveTrackedMod(user, {
            projectId: r.project!.id,
            slug: r.project!.slug || r.project!.id,
            title: r.project!.title,
            loader: analyzedConfig.loader,
            targetVersion: analyzedConfig.gameVersion,
            latestVersionNumber: r.targetVersion?.version_number,
            latestFilename: r.targetFile?.filename,
            latestDownloadUrl: r.targetFile?.url,
          });
          saved++;
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      setSaveSuccessMsg(
        `Saved ${saved} identified Modrinth ${saved === 1 ? 'mod' : 'mods'} to your Manage Mods library.`,
      );
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to save mods to your library.',
      });
    } finally {
      setSavingToLibrary(false);
    }
  };

  const handlePublishShareLink = async () => {
    if (!user || !analyzedConfig || results.length === 0 || publishingShare) return;
    if (isBanned && !isAdmin) {
      setStatusBanner({
        type: 'error',
        message: banReason || 'Your account is currently suspended.',
      });
      return;
    }

    setPublishingShare(true);
    setSaveSuccessMsg(null);
    setStatusBanner(null);
    try {
      const shareId = await publishSharedPack(user, {
        title:
          snapshotLabel.trim() ||
          `ModShift ${analyzedConfig.gameVersion} (${formatLoaderName(analyzedConfig.loader)})`,
        gameVersion: analyzedConfig.gameVersion,
        loader: analyzedConfig.loader,
        results,
      });
      setLastShareId(shareId);
      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${buildSharedPackPath(shareId)}`
          : buildSharedPackPath(shareId);
      try {
        await navigator.clipboard.writeText(fullUrl);
        setCopiedShareLink(true);
        setTimeout(() => setCopiedShareLink(false), 2000);
      } catch {
        // Clipboard blocked
      }
      setSaveSuccessMsg('Published public share link (ready mods only, no personal data included).');
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error && !err.message.startsWith('{')
            ? err.message
            : 'Could not create shareable modpack link.',
      });
    } finally {
      setPublishingShare(false);
    }
  };

  const handleExportMrpack = useCallback(async (options?: { serverOnly?: boolean }) => {
    if (!user || !analyzedConfig || results.length === 0 || isExportingMrpack) return;
    if (isBanned && !isAdmin) {
      setStatusBanner({
        type: 'error',
        message: banReason || 'Your account is currently suspended.',
      });
      return;
    }

    const serverOnly = options?.serverOnly === true;
    const hasReadyFiles = results.some(
      (r) =>
        r.category === 'ready' &&
        r.targetFile?.url &&
        r.targetFile.url.startsWith('https://') &&
        r.targetFile.hashes?.sha1 &&
        (!serverOnly || r.project?.server_side !== 'unsupported'),
    );
    if (!hasReadyFiles) {
      setStatusBanner({
        type: 'error',
        message: serverOnly
          ? 'No server-compatible Modrinth mods with verified hashes are available to export.'
          : 'No ready Modrinth mods with verified hashes and download URLs are available to export as .mrpack.',
      });
      return;
    }

    const exportCost =
      siteConfig.creditsEnabled && !isAdmin
        ? Math.max(0, siteConfig.mrpackCreditCost)
        : 0;
    if (exportCost > 0 && credits < exportCost) {
      setStatusBanner({
        type: 'error',
        message: `Insufficient credits (${credits} available, ${exportCost} required to export .mrpack).`,
      });
      return;
    }

    setIsExportingMrpack(true);
    setStatusBanner(null);
    try {
      if (exportCost > 0) {
        await spendUserCredits(
          user,
          exportCost,
          `Exported ${serverOnly ? 'server ' : ''}.mrpack (${analyzedConfig.gameVersion} ${analyzedConfig.loader})`,
        );
      }
      const outcome = await exportMrpackArchive(
        results,
        analyzedConfig,
        snapshotLabel,
        options,
      );
      setStatusBanner({
        type: 'info',
        message: `Exported ${outcome.exportedCount} mods to ${outcome.filename}${
          outcome.skippedClientOnly > 0
            ? ` (${outcome.skippedClientOnly} client-only mods excluded)`
            : ''
        }.`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to export .mrpack archive.',
      });
    } finally {
      setIsExportingMrpack(false);
    }
  }, [
    user,
    isAdmin,
    isBanned,
    banReason,
    credits,
    analyzedConfig,
    results,
    snapshotLabel,
    isExportingMrpack,
    siteConfig.creditsEnabled,
    siteConfig.mrpackCreditCost,
  ]);

  const sharedPackMatch = currentPath.match(/^\/pack\/([a-zA-Z0-9_-]+)$/);
  const sharedPackId = sharedPackMatch ? sharedPackMatch[1] : null;
  const isAdminRoute = currentPath === '/admin';
  const isMaintenanceRoute = currentPath === '/maintenance';
  const isUnknownRoute =
    currentPath !== '/' && !isAdminRoute && !isMaintenanceRoute && !sharedPackId;

  const effectiveView =
    viewMode === 'workspace' && authReady && !user ? 'auth_gate' : viewMode;

  const isMaintenanceBlocked =
    (siteConfig.maintenanceMode || !siteConfig.workspaceEnabled) && !isAdmin;

  const showNotFound =
    isUnknownRoute || (isAdminRoute && authReady && (!user || !isAdmin));

  const showMaintenancePage =
    !showNotFound &&
    !isAdminRoute &&
    (isMaintenanceRoute || (authReady && siteConfig.maintenanceMode && !isAdmin));

  const showBannedBlock =
    Boolean(user && isBanned && !isAdmin) &&
    !isAdminRoute &&
    !showNotFound &&
    !showMaintenancePage;

  const activeAnnouncementSignature =
    siteConfig.newsEnabled &&
    (siteConfig.newsTitle.trim().length > 0 || siteConfig.newsBody.trim().length > 0)
      ? `${siteConfig.newsLevel}::${siteConfig.newsTitle.trim()}::${siteConfig.newsBody.trim()}`
      : null;

  const showAnnouncementPopup =
    Boolean(activeAnnouncementSignature) &&
    dismissedNewsKey !== activeAnnouncementSignature &&
    !isAdminRoute &&
    !showNotFound &&
    !showMaintenancePage;

  return (
    <div id="top" className="min-h-screen flex flex-col">
      <Header
        theme={theme}
        viewMode={
          showMaintenancePage
            ? 'maintenance'
            : isAdminRoute || showNotFound
            ? 'landing'
            : effectiveView
        }
        activePanel={activePanel}
        creditsEnabled={siteConfig.creditsEnabled}
        onToggleTheme={handleToggleTheme}
        onGoLanding={handleGoLanding}
        onNavigatePanel={handleNavigatePanel}
      />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {authError && !showMaintenancePage && effectiveView !== 'auth_gate' && (
          <div
            role="alert"
            className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
              <span className="leading-relaxed">{authError}</span>
            </div>
            <button
              type="button"
              onClick={clearAuthError}
              className="font-medium underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {isAdminRoute && !authReady ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" aria-hidden="true" />
          </div>
        ) : showNotFound ? (
          <NotFoundPage onGoHome={handleGoLanding} />
        ) : showMaintenancePage ? (
          <MaintenancePanel siteConfig={siteConfig} />
        ) : showBannedBlock ? (
          <section
            aria-labelledby="banned-account-heading"
            className="mx-auto max-w-lg py-10 sm:py-16"
          >
            <div className="rounded-xl border border-red-200 bg-white p-6 sm:p-8 dark:border-red-900/60 dark:bg-zinc-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
                <Ban className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-5 text-xs font-medium text-red-700 dark:text-red-400">
                Account Suspended
              </p>
              <h1
                id="banned-account-heading"
                className="mt-1 font-display text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
              >
                Access restricted
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {banReason || 'Your account has been suspended by a site administrator.'}
              </p>
              <div className="mt-6 flex items-center justify-between border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <span className="text-xs text-zinc-500">{user?.email}</span>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </section>
        ) : isAdminRoute && user && isAdmin ? (
          <div className="space-y-4">
            <div>
              <button
                type="button"
                onClick={handleGoLanding}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to ModShift</span>
              </button>
            </div>
            <AdminPanel siteConfig={siteConfig} />
          </div>
        ) : sharedPackId ? (
          <SharedPackView shareId={sharedPackId} onGoHome={handleGoLanding} />
        ) : (
          <>
            {siteConfig.newsEnabled && (siteConfig.newsTitle || siteConfig.newsBody) && (
              <div
                role="status"
                className={`mb-6 flex items-start gap-3 rounded-xl border p-4 text-xs ${
                  siteConfig.newsLevel === 'warning'
                    ? 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                    : siteConfig.newsLevel === 'success'
                    ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                    : 'border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
                }`}
              >
                {siteConfig.newsLevel === 'warning' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : siteConfig.newsLevel === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
                )}
                <div className="space-y-0.5">
                  {siteConfig.newsTitle && (
                    <p className="font-semibold">{siteConfig.newsTitle}</p>
                  )}
                  {siteConfig.newsBody && (
                    <p className="leading-relaxed opacity-90">{siteConfig.newsBody}</p>
                  )}
                </div>
              </div>
            )}

            {effectiveView === 'landing' && (
          <>
            {isMaintenanceBlocked && (
              <div
                role="status"
                className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
              >
                <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    {siteConfig.maintenanceMode
                      ? 'Scheduled Maintenance Active'
                      : 'Workspace Temporarily Paused'}
                  </p>
                  <p className="mt-0.5 leading-relaxed opacity-90">
                    {siteConfig.maintenanceMessage}
                  </p>
                </div>
              </div>
            )}

            {/* Public Landing Page */}
            <section id="migrate" className="max-w-3xl">
              <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl [text-wrap:balance] dark:text-zinc-50">
                {siteConfig.heroHeadline || BRAND_CONFIG.headline}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
                {siteConfig.heroSubheadline || BRAND_CONFIG.subheadline}
              </p>
              <p className="mt-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                Powered by Modrinth v2 · Local SHA-1 hashing · Zero JAR uploads
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleNavigatePanel('update')}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  <span>{user ? 'Open Update Panel' : 'Sign In & Update Mods'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleNavigatePanel('search')}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>Search Mods</span>
                </button>
              </div>
            </section>

            {/* Task Panels Preview / Entry Cards */}
            <section
              aria-label="Workspace tools"
              className="mt-10 grid gap-5 md:grid-cols-3"
            >
              <button
                type="button"
                onClick={() => handleNavigatePanel('update')}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
              >
                <div>
                  <RefreshCw className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="mt-3 font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Update &amp; Migrate Mods
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Drag in your existing .jar folder, compute SHA-1 hashes locally, verify required dependencies, and download updated releases.
                  </p>
                </div>
                <span className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <span>{user ? 'Go to Update Panel' : 'Sign in to Update'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavigatePanel('search')}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
              >
                <div>
                  <Search className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="mt-3 font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Search Modrinth
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Browse compatible mods by Minecraft version and loader, download direct JARs, and save favorites into your library.
                  </p>
                </div>
                <span className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <span>{user ? 'Go to Search Panel' : 'Sign in to Search'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleNavigatePanel('manage')}
                className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-6 text-left transition-colors hover:border-emerald-600 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-500"
              >
                <div>
                  <FolderCog className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <h2 className="mt-3 font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Manage My Mods
                  </h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Check your saved mod library for newer releases across versions and reopen past migration snapshots anytime.
                  </p>
                </div>
                <span className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <span>{user ? 'Go to Manage Panel' : 'Sign in to Manage'}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </button>
            </section>

            <InfoSections />
          </>
        )}

        {effectiveView === 'auth_gate' && (
          <AuthGatePanel
            requestedPanel={pendingPanel}
            onBackToLanding={handleGoLanding}
          />
        )}

        {effectiveView === 'workspace' && user && isMaintenanceBlocked && (
          <section
            aria-labelledby="maintenance-heading"
            className="mx-auto max-w-lg py-8 sm:py-12"
          >
            <div className="rounded-xl border border-amber-200 bg-white p-6 sm:p-8 dark:border-amber-900/60 dark:bg-zinc-900">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400">
                <Wrench className="h-5 w-5" aria-hidden="true" />
              </div>
              <h1
                id="maintenance-heading"
                className="mt-4 font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
              >
                {siteConfig.maintenanceMode
                  ? 'ModShift is under maintenance'
                  : 'Workspace access is paused'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {siteConfig.maintenanceMessage}
              </p>
              <button
                type="button"
                onClick={handleGoLanding}
                className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Back to Overview
              </button>
            </div>
          </section>
        )}

        {effectiveView === 'workspace' && user && !isMaintenanceBlocked && (
          <div className="space-y-6">
            {isAdmin && (siteConfig.maintenanceMode || !siteConfig.workspaceEnabled) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {siteConfig.maintenanceMode
                  ? 'Maintenance Mode is active — non-admin visitors are blocked from workspace tools.'
                  : 'Workspace Access is paused for non-admin visitors.'}
              </div>
            )}

            {/* Dedicated Panel Switcher Bar */}
            <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
              <div
                role="tablist"
                aria-label="Workspace panels"
                className="flex items-center gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activePanel === 'update'}
                  onClick={() => setActivePanel('update')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    activePanel === 'update'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Update Mods</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activePanel === 'search'}
                  onClick={() => setActivePanel('search')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    activePanel === 'search'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <Search className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Search Mods</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activePanel === 'manage'}
                  onClick={() => setActivePanel('manage')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    activePanel === 'manage'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <FolderCog className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="tabular-nums">Manage Mods ({trackedMods.length})</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activePanel === 'account'}
                  onClick={() => setActivePanel('account')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    activePanel === 'account'
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Account</span>
                </button>
              </div>
            </div>

            {statusBanner && (
              <div
                role={statusBanner.type === 'error' ? 'alert' : 'status'}
                className={`flex items-start gap-2.5 rounded-xl border p-4 text-xs ${
                  statusBanner.type === 'error'
                    ? 'border-red-200 bg-red-50/70 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
                    : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                }`}
              >
                {statusBanner.type === 'error' ? (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                )}
                <span>{statusBanner.message}</span>
              </div>
            )}

            {/* PANEL 1: Update & Migrate Mods */}
            {activePanel === 'update' && (
              <div className="space-y-6">
                <ModDropzone
                  files={files}
                  rejectedNotices={rejectedNotices}
                  mrpackBanner={mrpackBanner}
                  isImportingMrpack={isImportingMrpack}
                  disabled={isProcessing}
                  onFilesAdded={handleFilesAdded}
                  onRemoveFile={handleRemoveFile}
                  onClearAll={handleClearAllFiles}
                  onDismissRejected={() => setRejectedNotices([])}
                />

                <TargetConfigPanel
                  config={config}
                  gameVersions={gameVersions}
                  versionsLoading={versionsLoading}
                  versionsError={versionsError}
                  fileCount={files.length}
                  isProcessing={isProcessing}
                  progress={progress}
                  disabledLoaders={siteConfig.disabledLoaders}
                  creditsEnabled={siteConfig.creditsEnabled}
                  creditCost={siteConfig.migrationCreditCost}
                  userCredits={credits}
                  isAdmin={isAdmin}
                  onConfigChange={setConfig}
                  onRetryLoadVersions={() => void loadVersions()}
                  onStartMigration={() => void handleStartMigration()}
                  onCancelMigration={handleCancelMigration}
                />

                <div ref={resultsAnchorRef} className="scroll-mt-20 space-y-6">
                  {results.length > 0 && analyzedConfig && (
                    <>
                      {/* Save results & publish shareable link bar */}
                      <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <form
                            onSubmit={(e) => void handleSaveSnapshot(e)}
                            className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
                          >
                            <input
                              type="text"
                              maxLength={120}
                              value={snapshotLabel}
                              onChange={(e) => setSnapshotLabel(e.target.value)}
                              placeholder="Name this migration snapshot..."
                              aria-label="Migration snapshot name"
                              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            />
                            <button
                              type="submit"
                              disabled={savingSnapshot}
                              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {savingSnapshot ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>Save Snapshot</span>
                            </button>
                          </form>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={savingToLibrary}
                              onClick={() => void handleSaveMatchedModsToLibrary()}
                              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              {savingToLibrary ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <FolderCog className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>Save Matched Mods to Library</span>
                            </button>

                            <button
                              type="button"
                              disabled={
                                publishingShare ||
                                !results.some(
                                  (r) => r.category === 'ready' && Boolean(r.targetFile?.url),
                                )
                              }
                              onClick={() => void handlePublishShareLink()}
                              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                              {publishingShare ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>Share Pack Link</span>
                            </button>
                          </div>
                        </div>

                        {lastShareId && (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-xs text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                            <span className="font-mono truncate">
                              {typeof window !== 'undefined'
                                ? `${window.location.origin}${buildSharedPackPath(lastShareId)}`
                                : buildSharedPackPath(lastShareId)}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={async () => {
                                  const fullUrl =
                                    typeof window !== 'undefined'
                                      ? `${window.location.origin}${buildSharedPackPath(lastShareId)}`
                                      : buildSharedPackPath(lastShareId);
                                  try {
                                    await navigator.clipboard.writeText(fullUrl);
                                    setCopiedShareLink(true);
                                    setTimeout(() => setCopiedShareLink(false), 1800);
                                  } catch {
                                    // Clipboard blocked
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-200"
                              >
                                {copiedShareLink ? (
                                  <>
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigatePath(buildSharedPackPath(lastShareId))}
                                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                              >
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                <span>Open</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {saveSuccessMsg && (
                          <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{saveSuccessMsg}</span>
                          </p>
                        )}
                      </div>

                      <ResultsDashboard
                        results={results}
                        dependencies={dependencies}
                        config={analyzedConfig}
                        isRetryingFailed={isRetryingFailed}
                        onRetryFailedAll={handleRetryFailedAll}
                        onRetrySingleFailed={handleRetrySingleFailed}
                        onApproveNeedsReview={handleApproveNeedsReview}
                        onOpenManualSearch={(res) => setManualSearchTarget(res)}
                        onAddDependency={handleAddDependency}
                        onClearResults={handleClearResults}
                        onExportMrpack={handleExportMrpack}
                        isExportingMrpack={isExportingMrpack}
                        mrpackCreditCost={siteConfig.mrpackCreditCost}
                        creditsEnabled={siteConfig.creditsEnabled}
                        isAdmin={isAdmin}
                        userCredits={credits}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {/* PANEL 2: Search Modrinth Mods */}
            {activePanel === 'search' && (
              <SearchModsPanel
                gameVersions={gameVersions}
                defaultGameVersion={config.gameVersion}
                defaultLoader={config.loader}
                trackedMods={trackedMods}
              />
            )}

            {/* PANEL 3: Manage My Mods & Saved Migrations */}
            {activePanel === 'manage' && (
              <ManageModsPanel
                trackedMods={trackedMods}
                loadingTrackedMods={loadingTrackedMods}
                savedMigrations={savedMigrations}
                loadingMigrations={loadingMigrations}
                sharedPacks={sharedPacks}
                loadingSharedPacks={loadingSharedPacks}
                gameVersions={gameVersions}
                defaultGameVersion={config.gameVersion}
                siteConfig={siteConfig}
                onNavigatePanel={handleNavigatePanel}
                onLoadSavedMigration={handleLoadSavedMigration}
                onOpenSharedPack={(shareId) =>
                  navigatePath(buildSharedPackPath(shareId))
                }
              />
            )}

            {/* PANEL 4: Account Overview */}
            {activePanel === 'account' && (
              <AccountPanel
                trackedModsCount={trackedMods.length}
                savedMigrationsCount={savedMigrations.length}
                siteConfig={siteConfig}
                onNavigatePanel={handleNavigatePanel}
              />
            )}
          </div>
        )}
          </>
        )}
      </main>

      <footer className="border-t border-zinc-200 bg-white py-6 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {BRAND_CONFIG.name} · {BRAND_CONFIG.tagline}
          </p>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={handleGoLanding}
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              Overview &amp; Privacy
            </button>
            <a
              href="https://docs.modrinth.com/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              Modrinth API
            </a>
            <button
              type="button"
              onClick={handleToggleTheme}
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </button>
          </div>
        </div>
      </footer>

      {analyzedConfig && (
        <ManualSearchModal
          result={manualSearchTarget}
          config={analyzedConfig}
          onClose={() => setManualSearchTarget(null)}
          onSelectMatch={(orig, proj, ver) => void handleManualMatch(orig, proj, ver)}
        />
      )}

      <AnnouncementModal
        open={showAnnouncementPopup}
        level={siteConfig.newsLevel}
        title={siteConfig.newsTitle}
        body={siteConfig.newsBody}
        onDismiss={() => {
          if (activeAnnouncementSignature) {
            handleDismissAnnouncement(activeAnnouncementSignature);
          }
        }}
      />
    </div>
  );
}
