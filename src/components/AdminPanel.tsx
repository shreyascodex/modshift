import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Database,
  FileText,
  History,
  Info,
  Loader2,
  Megaphone,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Ticket,
  Trash2,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ADMIN_EMAILS, isAdminEmail, isAdminUser } from '../config/admins';
import { SUPPORTED_LOADERS } from '../config/brand';
import { useAuth } from '../contexts/AuthContext';
import {
  adminDeleteUserMigration,
  adminDeleteUserMod,
  fetchAllUsers,
  fetchUserModData,
  type AdminUserModData,
  type AdminUserRecord,
} from '../services/adminDatabaseService';
import {
  adminAdjustUserCredits,
  adminSetUserBanStatus,
  createPromoCode,
  deletePromoCode,
  subscribeToPromoCodes,
  togglePromoCodeActive,
  type PromoCodeRecord,
} from '../services/creditsService';
import { getCurseForgeStatus } from '../services/providers/curseforgeClient';
import {
  DEFAULT_SITE_CONFIG,
  saveSiteConfig,
  subscribeToAuditLogs,
  type AdminAuditLogRecord,
  type NewsBannerLevel,
  type SiteConfig,
  type SiteConfigDraft,
} from '../services/siteConfigService';
import type { ModLoader } from '../types/migration';
import { formatLoaderName } from '../utils/format';

type AdminTab = 'controls' | 'news' | 'database' | 'promos' | 'audit';

interface AdminPanelProps {
  siteConfig: SiteConfig;
}

function formatTimestamp(
  ts: { toDate: () => Date } | null | undefined,
): string {
  if (!ts) return 'Just now';
  try {
    return ts.toDate().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

export function AdminPanel({ siteConfig }: AdminPanelProps) {
  const { user } = useAuth();
  const authorized = isAdminUser(user);

  const [tab, setTab] = useState<AdminTab>('controls');

  // Site config draft state
  const [draft, setDraft] = useState<SiteConfigDraft>(() => ({
    maintenanceMode: siteConfig.maintenanceMode,
    maintenanceMessage: siteConfig.maintenanceMessage,
    newsEnabled: siteConfig.newsEnabled,
    newsTitle: siteConfig.newsTitle,
    newsBody: siteConfig.newsBody,
    newsLevel: siteConfig.newsLevel,
    heroHeadline: siteConfig.heroHeadline,
    heroSubheadline: siteConfig.heroSubheadline,
    workspaceEnabled: siteConfig.workspaceEnabled,
    disabledLoaders: [...siteConfig.disabledLoaders],
    creditsEnabled: siteConfig.creditsEnabled,
    migrationCreditCost: siteConfig.migrationCreditCost,
    mrpackCreditCost: siteConfig.mrpackCreditCost,
    libraryCheckCreditCost: siteConfig.libraryCheckCreditCost,
  }));
  const [savingConfig, setSavingConfig] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const prevSiteConfigRef = useRef<SiteConfig>(siteConfig);

  useEffect(() => {
    const prev = prevSiteConfigRef.current;
    prevSiteConfigRef.current = siteConfig;

    setDraft((currentDraft) => {
      const wasClean =
        currentDraft.maintenanceMode === prev.maintenanceMode &&
        currentDraft.maintenanceMessage === prev.maintenanceMessage &&
        currentDraft.newsEnabled === prev.newsEnabled &&
        currentDraft.newsTitle === prev.newsTitle &&
        currentDraft.newsBody === prev.newsBody &&
        currentDraft.newsLevel === prev.newsLevel &&
        currentDraft.heroHeadline === prev.heroHeadline &&
        currentDraft.heroSubheadline === prev.heroSubheadline &&
        currentDraft.workspaceEnabled === prev.workspaceEnabled &&
        currentDraft.disabledLoaders.join(',') === prev.disabledLoaders.join(',') &&
        currentDraft.creditsEnabled === prev.creditsEnabled &&
        currentDraft.migrationCreditCost === prev.migrationCreditCost &&
        currentDraft.mrpackCreditCost === prev.mrpackCreditCost &&
        currentDraft.libraryCheckCreditCost === prev.libraryCheckCreditCost;

      if (!wasClean) {
        return currentDraft;
      }

      return {
        maintenanceMode: siteConfig.maintenanceMode,
        maintenanceMessage: siteConfig.maintenanceMessage,
        newsEnabled: siteConfig.newsEnabled,
        newsTitle: siteConfig.newsTitle,
        newsBody: siteConfig.newsBody,
        newsLevel: siteConfig.newsLevel,
        heroHeadline: siteConfig.heroHeadline,
        heroSubheadline: siteConfig.heroSubheadline,
        workspaceEnabled: siteConfig.workspaceEnabled,
        disabledLoaders: [...siteConfig.disabledLoaders],
        creditsEnabled: siteConfig.creditsEnabled,
        migrationCreditCost: siteConfig.migrationCreditCost,
        mrpackCreditCost: siteConfig.mrpackCreditCost,
        libraryCheckCreditCost: siteConfig.libraryCheckCreditCost,
      };
    });
  }, [siteConfig]);

  const hasUnsavedChanges = useMemo(() => {
    return (
      draft.maintenanceMode !== siteConfig.maintenanceMode ||
      draft.maintenanceMessage !== siteConfig.maintenanceMessage ||
      draft.newsEnabled !== siteConfig.newsEnabled ||
      draft.newsTitle !== siteConfig.newsTitle ||
      draft.newsBody !== siteConfig.newsBody ||
      draft.newsLevel !== siteConfig.newsLevel ||
      draft.heroHeadline !== siteConfig.heroHeadline ||
      draft.heroSubheadline !== siteConfig.heroSubheadline ||
      draft.workspaceEnabled !== siteConfig.workspaceEnabled ||
      draft.disabledLoaders.join(',') !== siteConfig.disabledLoaders.join(',') ||
      draft.creditsEnabled !== siteConfig.creditsEnabled ||
      draft.migrationCreditCost !== siteConfig.migrationCreditCost ||
      draft.mrpackCreditCost !== siteConfig.mrpackCreditCost ||
      draft.libraryCheckCreditCost !== siteConfig.libraryCheckCreditCost
    );
  }, [draft, siteConfig]);

  // Integrations & user moderation state
  const [curseforgeConfigured, setCurseforgeConfigured] = useState<boolean | null>(null);
  const [creditDeltaInput, setCreditDeltaInput] = useState('25');
  const [creditReasonInput, setCreditReasonInput] = useState('Admin credit grant');
  const [banReasonInput, setBanReasonInput] = useState('');
  const [moderatingUser, setModeratingUser] = useState(false);

  // Database explorer state
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<AdminUserRecord | null>(null);
  const [selectedUserData, setSelectedUserData] =
    useState<AdminUserModData | null>(null);
  const [loadingUserData, setLoadingUserData] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Promo codes state
  const [promoCodes, setPromoCodes] = useState<PromoCodeRecord[]>([]);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoCredits, setNewPromoCredits] = useState('25');
  const [newPromoMaxUses, setNewPromoMaxUses] = useState('50');
  const [newPromoNote, setNewPromoNote] = useState('');
  const [creatingPromo, setCreatingPromo] = useState(false);
  const [copiedPromoCode, setCopiedPromoCode] = useState<string | null>(null);
  const [busyPromoCode, setBusyPromoCode] = useState<string | null>(null);

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadDatabaseUsers = useCallback(async () => {
    if (!user || !authorized) return;
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const list = await fetchAllUsers(user);
      setUsers(list);
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Unable to load users from Firestore.',
      );
    } finally {
      setLoadingUsers(false);
    }
  }, [user, authorized]);

  const loadSelectedUserDetails = useCallback(
    async (target: AdminUserRecord) => {
      if (!user || !authorized) return;
      setSelectedUser(target);
      setBanReasonInput(target.banReason || '');
      setLoadingUserData(true);
      setConfirmDeleteKey(null);
      setUsersError(null);
      try {
        const data = await fetchUserModData(user, target.uid);
        setSelectedUserData(data);
      } catch (err) {
        setUsersError(
          err instanceof Error
            ? err.message
            : 'Unable to load mod data for this user.',
        );
      } finally {
        setLoadingUserData(false);
      }
    },
    [user, authorized],
  );

  useEffect(() => {
    if (!authorized || !user) return;
    void loadDatabaseUsers();
    void getCurseForgeStatus().then((s) => setCurseforgeConfigured(s.configured));
  }, [authorized, user, loadDatabaseUsers]);

  useEffect(() => {
    if (!authorized || !user) {
      setAuditLogs([]);
      setPromoCodes([]);
      return;
    }
    const unsubAudit = subscribeToAuditLogs(
      (logs) => {
        setAuditLogs(logs);
        setAuditError(null);
      },
      (err) => {
        setAuditError(err.message);
      },
    );
    const unsubPromos = subscribeToPromoCodes(
      (list) => {
        setPromoCodes(list);
        setPromoError(null);
      },
      (err) => {
        setPromoError(err.message);
      },
    );
    return () => {
      unsubAudit();
      unsubPromos();
    };
  }, [authorized, user]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q),
    );
  }, [users, userSearch]);

  const analytics = useMemo(() => {
    let totalCredits = 0;
    let bannedCount = 0;
    for (const u of users) {
      totalCredits += u.credits;
      if (u.isBanned) bannedCount++;
    }
    return { totalCredits, bannedCount };
  }, [users]);

  if (!user || !authorized) {
    return (
      <section
        aria-labelledby="admin-denied-heading"
        className="mx-auto max-w-lg py-10"
      >
        <div className="rounded-xl border border-red-200 bg-white p-6 dark:border-red-900/60 dark:bg-zinc-900">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1
            id="admin-denied-heading"
            className="mt-4 font-display text-lg font-bold text-zinc-950 dark:text-zinc-50"
          >
            Admin Access Restricted
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            Only approved verified administrator accounts can access the ModShift Admin Console and site-wide Firestore controls.
          </p>
        </div>
      </section>
    );
  }

  const handleToggleDisabledLoader = (loader: ModLoader) => {
    setDraft((prev) => {
      const exists = prev.disabledLoaders.includes(loader);
      return {
        ...prev,
        disabledLoaders: exists
          ? prev.disabledLoaders.filter((l) => l !== loader)
          : [...prev.disabledLoaders, loader],
      };
    });
  };

  const handlePublishSiteConfig = async (summaryNote: string) => {
    if (!user || savingConfig) return;
    setSavingConfig(true);
    setConfigFeedback(null);
    try {
      await saveSiteConfig(user, draft, summaryNote);
      setConfigFeedback({
        type: 'success',
        message: 'Site configuration published to Firestore.',
      });
    } catch (err) {
      setConfigFeedback({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to publish site configuration.',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetDefaults = () => {
    setDraft({
      maintenanceMode: DEFAULT_SITE_CONFIG.maintenanceMode,
      maintenanceMessage: DEFAULT_SITE_CONFIG.maintenanceMessage,
      newsEnabled: DEFAULT_SITE_CONFIG.newsEnabled,
      newsTitle: DEFAULT_SITE_CONFIG.newsTitle,
      newsBody: DEFAULT_SITE_CONFIG.newsBody,
      newsLevel: DEFAULT_SITE_CONFIG.newsLevel,
      heroHeadline: DEFAULT_SITE_CONFIG.heroHeadline,
      heroSubheadline: DEFAULT_SITE_CONFIG.heroSubheadline,
      workspaceEnabled: DEFAULT_SITE_CONFIG.workspaceEnabled,
      disabledLoaders: [...DEFAULT_SITE_CONFIG.disabledLoaders],
      creditsEnabled: DEFAULT_SITE_CONFIG.creditsEnabled,
      migrationCreditCost: DEFAULT_SITE_CONFIG.migrationCreditCost,
      mrpackCreditCost: DEFAULT_SITE_CONFIG.mrpackCreditCost,
      libraryCheckCreditCost: DEFAULT_SITE_CONFIG.libraryCheckCreditCost,
    });
    setConfigFeedback(null);
  };

  const handleAdjustSelectedUserCredits = async (delta: number, reason: string) => {
    if (!user || !selectedUser || moderatingUser) return;
    setModeratingUser(true);
    setUsersError(null);
    try {
      const nextBalance = await adminAdjustUserCredits(
        user,
        selectedUser.uid,
        delta,
        reason,
      );
      setSelectedUser((prev) => (prev ? { ...prev, credits: nextBalance } : prev));
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === selectedUser.uid ? { ...u, credits: nextBalance } : u,
        ),
      );
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Failed to update user credits.',
      );
    } finally {
      setModeratingUser(false);
    }
  };

  const handleToggleSelectedUserBan = async (ban: boolean) => {
    if (!user || !selectedUser || moderatingUser) return;
    if (selectedUser.uid === user.uid) {
      setUsersError('You cannot suspend your own active admin account.');
      return;
    }
    setModeratingUser(true);
    setUsersError(null);
    try {
      const cleanReason = banReasonInput.trim() || 'Suspended by site administrator.';
      await adminSetUserBanStatus(user, selectedUser.uid, ban, cleanReason);
      setSelectedUser((prev) =>
        prev
          ? {
              ...prev,
              isBanned: ban,
              banReason: ban ? cleanReason : '',
            }
          : prev,
      );
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === selectedUser.uid
            ? { ...u, isBanned: ban, banReason: ban ? cleanReason : '' }
            : u,
        ),
      );
      if (!ban) setBanReasonInput('');
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Failed to update user suspension status.',
      );
    } finally {
      setModeratingUser(false);
    }
  };

  const handleDeleteUserMod = async (
    targetUid: string,
    modId: string,
    title: string,
  ) => {
    if (!user) return;
    const key = `mod:${modId}`;
    setDeletingKey(key);
    setUsersError(null);
    try {
      await adminDeleteUserMod(user, targetUid, modId, title);
      setSelectedUserData((prev) =>
        prev
          ? { ...prev, mods: prev.mods.filter((m) => m.id !== modId) }
          : prev,
      );
      setConfirmDeleteKey(null);
    } catch (err) {
      setUsersError(
        err instanceof Error ? err.message : 'Failed to delete user mod.',
      );
    } finally {
      setDeletingKey(null);
    }
  };

  const handleDeleteUserMigration = async (
    targetUid: string,
    migrationId: string,
    name: string,
  ) => {
    if (!user) return;
    const key = `mig:${migrationId}`;
    setDeletingKey(key);
    setUsersError(null);
    try {
      await adminDeleteUserMigration(user, targetUid, migrationId, name);
      setSelectedUserData((prev) =>
        prev
          ? {
              ...prev,
              migrations: prev.migrations.filter((m) => m.id !== migrationId),
            }
          : prev,
      );
      setConfirmDeleteKey(null);
    } catch (err) {
      setUsersError(
        err instanceof Error
          ? err.message
          : 'Failed to delete saved migration.',
      );
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <section aria-labelledby="admin-console-heading" className="space-y-6">
      {/* Admin Header Summary */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Verified Admin Console · {user.email}</span>
            </div>
            <h1
              id="admin-console-heading"
              className="mt-1 font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              Website Control &amp; Database Explorer
            </h1>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Manage maintenance mode, global news banners, landing copy, loader switches, and inspect user records across Firestore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {hasUnsavedChanges && (
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Unsaved site edits
              </span>
            )}
            <button
              type="button"
              disabled={savingConfig}
              onClick={() =>
                void handlePublishSiteConfig(
                  `Published site config (maintenance=${draft.maintenanceMode}, news=${draft.newsEnabled}, workspace=${draft.workspaceEnabled})`,
                )
              }
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {savingConfig ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>Publish Site Changes</span>
            </button>
          </div>
        </div>

        {/* Live Status & Analytics Strip */}
        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-800">
          <div className="bg-zinc-50 p-3.5 dark:bg-zinc-950">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Site Status
            </p>
            <p
              className={`mt-1 text-xs font-semibold ${
                siteConfig.maintenanceMode
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {siteConfig.maintenanceMode ? 'Maintenance Mode' : 'Operational'}
            </p>
          </div>
          <div className="bg-zinc-50 p-3.5 dark:bg-zinc-950">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Credits &amp; Pricing
            </p>
            <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {siteConfig.creditsEnabled
                ? `Active (${siteConfig.migrationCreditCost}/${siteConfig.mrpackCreditCost}/${siteConfig.libraryCheckCreditCost} cr)`
                : 'Disabled (Free)'}
            </p>
          </div>
          <div className="bg-zinc-50 p-3.5 dark:bg-zinc-950">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              CurseForge Proxy
            </p>
            <p
              className={`mt-1 text-xs font-semibold ${
                curseforgeConfigured
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {curseforgeConfigured === null
                ? 'Checking...'
                : curseforgeConfigured
                ? 'API Key Active'
                : 'Not Configured'}
            </p>
          </div>
          <div className="bg-zinc-50 p-3.5 dark:bg-zinc-950">
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Users / Credits / Banned
            </p>
            <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
              {users.length} · {analytics.totalCredits} cr · {analytics.bannedCount} banned
            </p>
          </div>
        </div>

        {/* Sub-navigation Tabs */}
        <div
          role="tablist"
          aria-label="Admin console sections"
          className="mt-5 flex items-center gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'controls'}
            onClick={() => setTab('controls')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === 'controls'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Maintenance &amp; Controls</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'news'}
            onClick={() => setTab('news')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === 'news'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
            <span>News &amp; Hero Copy</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'database'}
            onClick={() => setTab('database')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === 'database'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">Database Data ({users.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'promos'}
            onClick={() => setTab('promos')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === 'promos'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">Promo Codes ({promoCodes.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'audit'}
            onClick={() => setTab('audit')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === 'audit'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">Audit Log ({auditLogs.length})</span>
          </button>
        </div>
      </div>

      {configFeedback && (
        <div
          role={configFeedback.type === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2.5 rounded-xl border p-4 text-xs ${
            configFeedback.type === 'error'
              ? 'border-red-200 bg-red-50/70 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
              : 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          {configFeedback.type === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{configFeedback.message}</span>
        </div>
      )}

      {/* TAB 1: Maintenance & Site Controls */}
      {tab === 'controls' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Maintenance Mode
                  </h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    When enabled, non-admin visitors see your maintenance notice instead of mod panels. Admins keep full access.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 shrink-0">
                  <input
                    type="checkbox"
                    checked={draft.maintenanceMode}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, maintenanceMode: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span>{draft.maintenanceMode ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="admin-maintenance-msg"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Maintenance Notice Message
                </label>
                <textarea
                  id="admin-maintenance-msg"
                  rows={3}
                  maxLength={500}
                  value={draft.maintenanceMessage}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, maintenanceMessage: e.target.value }))
                  }
                  placeholder="Explain why ModShift is paused and when it will return..."
                  className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <p className="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {draft.maintenanceMessage.length} / 500 characters
                </p>
              </div>

              <div className="mt-5 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">
                      Workspace Access Enabled
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                      Turn off to pause signed-in mod migrations, search, and library writes while keeping the landing page public.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 shrink-0">
                    <input
                      type="checkbox"
                      checked={draft.workspaceEnabled}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          workspaceEnabled: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                    />
                    <span>{draft.workspaceEnabled ? 'Open' : 'Paused'}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Mod Loader Controls
              </h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Temporarily disable any mod loader across the migration tool if upstream compatibility issues occur.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {SUPPORTED_LOADERS.map((loader) => {
                  const isDisabled = draft.disabledLoaders.includes(loader.id);
                  return (
                    <label
                      key={loader.id}
                      className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3.5 transition-colors ${
                        isDisabled
                          ? 'border-red-300 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20'
                          : 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-950/40'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">
                          {loader.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {isDisabled
                            ? 'Disabled for non-admin users'
                            : 'Active for migrations'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={!isDisabled}
                        onChange={() => handleToggleDisabledLoader(loader.id)}
                        aria-label={`Enable ${loader.label}`}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Credit System &amp; Action Pricing
                  </h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Configure per-action credit costs. New users start with 50 credits; admin accounts bypass credit charges.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 shrink-0">
                  <input
                    type="checkbox"
                    checked={draft.creditsEnabled}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, creditsEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span>{draft.creditsEnabled ? 'Enabled' : 'Free Mode'}</span>
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="admin-cost-migration"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Modpack Migration Cost
                  </label>
                  <input
                    id="admin-cost-migration"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.migrationCreditCost}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        migrationCreditCost: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                      }))
                    }
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="admin-cost-mrpack"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    .mrpack Export Cost
                  </label>
                  <input
                    id="admin-cost-mrpack"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.mrpackCreditCost}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        mrpackCreditCost: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                      }))
                    }
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="admin-cost-library"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Library Batch Check Cost
                  </label>
                  <input
                    id="admin-cost-library"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.libraryCheckCreditCost}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        libraryCheckCreditCost: Math.max(0, Math.min(50, Number(e.target.value) || 0)),
                      }))
                    }
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-5">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Authorized Admin Accounts
              </h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Admin access is enforced both in UI routing and Firestore security rules via verified Google token emails:
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                {ADMIN_EMAILS.map((email) => (
                  <li
                    key={email}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <span className="truncate">{email}</span>
                    {user.email?.toLowerCase() === email.toLowerCase() && (
                      <span className="text-[11px] font-sans font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
                        You
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-zinc-100 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <p>
                  Last published by:{' '}
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">
                    {siteConfig.updatedBy || 'Default config (not yet saved)'}
                  </span>
                </p>
                <p className="mt-1 tabular-nums">
                  Updated at: {formatTimestamp(siteConfig.updatedAt)}
                </p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={savingConfig}
                  onClick={() =>
                    void handlePublishSiteConfig(
                      `Updated maintenance/loader controls (maintenance=${draft.maintenanceMode}, workspace=${draft.workspaceEnabled}, disabledLoaders=${draft.disabledLoaders.join(',') || 'none'})`,
                    )
                  }
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save Controls</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset Defaults</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: News & Hero Content */}
      {tab === 'news' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                    Global News &amp; Announcement Banner
                  </h2>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    Show an announcement or warning banner and automatic startup popup when visitors open the website.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 shrink-0">
                  <input
                    type="checkbox"
                    checked={draft.newsEnabled}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, newsEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span>{draft.newsEnabled ? 'Visible' : 'Hidden'}</span>
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="admin-news-level"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Banner Tone
                  </label>
                  <select
                    id="admin-news-level"
                    value={draft.newsLevel}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        newsLevel: e.target.value as NewsBannerLevel,
                      }))
                    }
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-900 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    <option value="info">Info (Neutral)</option>
                    <option value="success">Success / Release Update (Green)</option>
                    <option value="warning">Warning / Advisory (Amber)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="admin-news-title"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Announcement Title
                  </label>
                  <input
                    id="admin-news-title"
                    type="text"
                    maxLength={120}
                    value={draft.newsTitle}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, newsTitle: e.target.value }))
                    }
                    placeholder="e.g. Minecraft 1.21.5 support live"
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="admin-news-body"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Announcement Message
                </label>
                <textarea
                  id="admin-news-body"
                  rows={3}
                  maxLength={600}
                  value={draft.newsBody}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, newsBody: e.target.value }))
                  }
                  placeholder="Share updates, modpack notes, or Modrinth API notices..."
                  className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <p className="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                  {draft.newsBody.length} / 600 characters
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Landing Page Hero Copy
              </h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Customize the public headline and subheadline shown on the ModShift overview page.
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <label
                    htmlFor="admin-hero-headline"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Hero Headline
                  </label>
                  <input
                    id="admin-hero-headline"
                    type="text"
                    maxLength={140}
                    value={draft.heroHeadline}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, heroHeadline: e.target.value }))
                    }
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-hero-subheadline"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Hero Subheadline
                  </label>
                  <textarea
                    id="admin-hero-subheadline"
                    rows={3}
                    maxLength={320}
                    value={draft.heroSubheadline}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, heroSubheadline: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={savingConfig}
                  onClick={() =>
                    void handlePublishSiteConfig(
                      `Updated news banner (enabled=${draft.newsEnabled}) and landing copy`,
                    )
                  }
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap shrink-0 hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Publish News &amp; Copy</span>
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Banner &amp; Startup Popup Preview
              </h2>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Preview how your announcement renders above the main content area and pops up automatically when users open the website.
              </p>

              <div className="mt-4">
                {draft.newsEnabled && (draft.newsTitle || draft.newsBody) ? (
                  <div
                    className={`flex items-start gap-2.5 rounded-xl border p-4 text-xs ${
                      draft.newsLevel === 'warning'
                        ? 'border-amber-200 bg-amber-50/80 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
                        : draft.newsLevel === 'success'
                        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200'
                    }`}
                  >
                    {draft.newsLevel === 'warning' ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : draft.newsLevel === 'success' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <div className="space-y-0.5">
                      {draft.newsTitle && (
                        <p className="font-semibold">{draft.newsTitle}</p>
                      )}
                      {draft.newsBody && (
                        <p className="leading-relaxed opacity-90">{draft.newsBody}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    Enable the news banner and enter a title or message to preview it here.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Database Explorer */}
      {tab === 'database' && (
        <div className="space-y-4">
          {usersError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/70 p-4 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{usersError}</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Users list */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 lg:col-span-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Firestore Users ({filteredUsers.length})
                </h2>
                <button
                  type="button"
                  disabled={loadingUsers}
                  onClick={() => void loadDatabaseUsers()}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${loadingUsers ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="relative mt-3">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter by email, name, or UID..."
                  aria-label="Filter users"
                  className="min-h-9 w-full rounded-lg border border-zinc-300 bg-zinc-50 pl-8 pr-3 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div className="mt-3 max-h-[480px] space-y-1.5 overflow-y-auto pr-1">
                {loadingUsers && users.length === 0 ? (
                  <div className="py-10 text-center text-xs text-zinc-500">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" aria-hidden="true" />
                    <p className="mt-2">Loading user profiles...</p>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <p className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    No matching users found.
                  </p>
                ) : (
                  filteredUsers.map((u) => {
                    const isSelected = selectedUser?.uid === u.uid;
                    const userIsAdmin = isAdminEmail(u.email);
                    return (
                      <button
                        key={u.uid}
                        type="button"
                        onClick={() => void loadSelectedUserDetails(u)}
                        className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-950/30'
                            : 'border-zinc-200 bg-zinc-50/50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:bg-zinc-800/50'
                        }`}
                      >
                        {u.photoURL ? (
                          <img
                            src={u.photoURL}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 shrink-0 dark:border-zinc-700 dark:bg-zinc-900">
                            <UserIcon className="h-4 w-4" aria-hidden="true" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-semibold text-zinc-950 dark:text-zinc-50">
                              {u.displayName}
                              {userIsAdmin && (
                                <span className="ml-1.5 font-normal text-emerald-700 dark:text-emerald-400">
                                  · Admin
                                </span>
                              )}
                              {u.isBanned && (
                                <span className="ml-1.5 font-normal text-red-700 dark:text-red-400">
                                  · Suspended
                                </span>
                              )}
                            </p>
                            <span className="font-mono text-[11px] tabular-nums text-amber-700 dark:text-amber-400 shrink-0">
                              {u.credits} cr
                            </span>
                          </div>
                          <p className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                            {u.email}
                          </p>
                          <p className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                            {u.uid}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Selected User Data Inspector */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 lg:col-span-7 dark:border-zinc-800 dark:bg-zinc-900">
              {!selectedUser ? (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center text-xs text-zinc-500 dark:text-zinc-400">
                  <Database className="h-7 w-7 opacity-40" aria-hidden="true" />
                  <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-300">
                    Select a user on the left to inspect their database records
                  </p>
                  <p className="mt-1 max-w-sm">
                    View tracked mods (`/mods`) and saved migration snapshots (`/migrations`), adjust credits, or manage suspension status.
                  </p>
                </div>
              ) : loadingUserData ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center text-xs text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" aria-hidden="true" />
                  <p className="mt-2">Loading records for {selectedUser.email}...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex flex-col gap-2 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
                        {selectedUser.displayName}
                      </h3>
                      <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {selectedUser.email} · Last active {formatTimestamp(selectedUser.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSelectedUserDetails(selectedUser)}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 whitespace-nowrap shrink-0 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden="true" />
                      <span>Reload User Data</span>
                    </button>
                  </div>

                  {/* Credits & Account Moderation Controls */}
                  <div className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                          <span>Credits: {selectedUser.credits}</span>
                        </span>
                        <div className="flex items-center gap-1">
                          {[10, 50, 200].map((amt) => (
                            <button
                              key={amt}
                              type="button"
                              disabled={moderatingUser}
                              onClick={() =>
                                void handleAdjustSelectedUserCredits(
                                  amt,
                                  `Admin quick grant (+${amt})`,
                                )
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                            >
                              +{amt}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step={1}
                          value={creditDeltaInput}
                          onChange={(e) => setCreditDeltaInput(e.target.value)}
                          aria-label="Custom credit adjustment amount"
                          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <input
                          type="text"
                          maxLength={120}
                          value={creditReasonInput}
                          onChange={(e) => setCreditReasonInput(e.target.value)}
                          placeholder="Reason..."
                          aria-label="Credit adjustment reason"
                          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                        />
                        <button
                          type="button"
                          disabled={
                            moderatingUser ||
                            !Number.isInteger(Number(creditDeltaInput)) ||
                            Number(creditDeltaInput) === 0
                          }
                          onClick={() =>
                            void handleAdjustSelectedUserCredits(
                              Math.trunc(Number(creditDeltaInput)),
                              creditReasonInput || 'Admin credit adjustment',
                            )
                          }
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white whitespace-nowrap hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Apply
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2.5 border-t border-zinc-200 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          <Ban className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                          <span>
                            Status: {selectedUser.isBanned ? 'Suspended' : 'Active'}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!selectedUser.isBanned ? (
                          <>
                            <input
                              type="text"
                              maxLength={200}
                              value={banReasonInput}
                              onChange={(e) => setBanReasonInput(e.target.value)}
                              placeholder="Suspension reason..."
                              aria-label="Suspension reason"
                              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                            />
                            <button
                              type="button"
                              disabled={moderatingUser || selectedUser.uid === user.uid}
                              onClick={() => void handleToggleSelectedUserBan(true)}
                              className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white whitespace-nowrap hover:bg-red-700 disabled:opacity-50"
                            >
                              Suspend
                            </button>
                          </>
                        ) : (
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="truncate text-[11px] text-red-700 dark:text-red-400">
                              {selectedUser.banReason || 'Suspended by admin'}
                            </span>
                            <button
                              type="button"
                              disabled={moderatingUser}
                              onClick={() => void handleToggleSelectedUserBan(false)}
                              className="rounded-md border border-emerald-600 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 whitespace-nowrap hover:bg-emerald-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-emerald-400"
                            >
                              Restore Access
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* User Tracked Mods */}
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      Tracked Mods ({selectedUserData?.mods.length ?? 0})
                    </h4>
                    {!selectedUserData || selectedUserData.mods.length === 0 ? (
                      <p className="mt-2 rounded-lg border border-dashed border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        This user has no tracked mods.
                      </p>
                    ) : (
                      <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                        {selectedUserData.mods.map((mod) => {
                          const key = `mod:${mod.id}`;
                          const confirming = confirmDeleteKey === key;
                          const busy = deletingKey === key;
                          return (
                            <div
                              key={mod.id}
                              className="flex items-center justify-between gap-3 p-3 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-zinc-950 dark:text-zinc-50">
                                  {mod.title}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                  {formatLoaderName(mod.loader)} · MC {mod.targetVersion}
                                  {mod.latestVersionNumber
                                    ? ` · ${mod.latestVersionNumber}`
                                    : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {confirming ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleDeleteUserMod(
                                          selectedUser.uid,
                                          mod.id,
                                          mod.title,
                                        )
                                      }
                                      className="inline-flex min-h-7 items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white whitespace-nowrap shrink-0 hover:bg-red-700 disabled:opacity-50"
                                    >
                                      {busy ? 'Deleting...' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteKey(null)}
                                      className="inline-flex min-h-7 items-center rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 whitespace-nowrap shrink-0 dark:border-zinc-700 dark:text-zinc-300"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteKey(key)}
                                    aria-label={`Delete ${mod.title}`}
                                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 whitespace-nowrap shrink-0 hover:bg-red-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/30"
                                  >
                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* User Saved Migrations */}
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                      Saved Migration Snapshots ({selectedUserData?.migrations.length ?? 0})
                    </h4>
                    {!selectedUserData || selectedUserData.migrations.length === 0 ? (
                      <p className="mt-2 rounded-lg border border-dashed border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                        This user has no saved migration snapshots.
                      </p>
                    ) : (
                      <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                        {selectedUserData.migrations.map((mig) => {
                          const key = `mig:${mig.id}`;
                          const confirming = confirmDeleteKey === key;
                          const busy = deletingKey === key;
                          return (
                            <div
                              key={mig.id}
                              className="flex items-center justify-between gap-3 p-3 text-xs"
                            >
                              <div className="min-w-0">
                                <p className="inline-flex items-center gap-1.5 truncate font-medium text-zinc-950 dark:text-zinc-50">
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                                  <span className="truncate">{mig.name}</span>
                                </p>
                                <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                                  {formatLoaderName(mig.loader)} · MC {mig.gameVersion} ·{' '}
                                  {mig.summary.total} mods ({mig.summary.ready} ready) ·{' '}
                                  {formatTimestamp(mig.createdAt)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {confirming ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void handleDeleteUserMigration(
                                          selectedUser.uid,
                                          mig.id,
                                          mig.name,
                                        )
                                      }
                                      className="inline-flex min-h-7 items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white whitespace-nowrap shrink-0 hover:bg-red-700 disabled:opacity-50"
                                    >
                                      {busy ? 'Deleting...' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteKey(null)}
                                      className="inline-flex min-h-7 items-center rounded-md border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 whitespace-nowrap shrink-0 dark:border-zinc-700 dark:text-zinc-300"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteKey(key)}
                                    aria-label={`Delete snapshot ${mig.name}`}
                                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 whitespace-nowrap shrink-0 hover:bg-red-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950/30"
                                  >
                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Promo Codes */}
      {tab === 'promos' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 lg:col-span-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Create Promo Code
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Issue single-use-per-account bonus credit codes for community events or tester rewards.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!user || creatingPromo) return;
                setCreatingPromo(true);
                setPromoError(null);
                try {
                  await createPromoCode(user, {
                    code: newPromoCode,
                    credits: Number(newPromoCredits),
                    maxUses: Number(newPromoMaxUses),
                    note: newPromoNote,
                  });
                  setNewPromoCode('');
                  setNewPromoNote('');
                } catch (err) {
                  setPromoError(
                    err instanceof Error && !err.message.startsWith('{')
                      ? err.message
                      : 'Unable to create promo code.',
                  );
                } finally {
                  setCreatingPromo(false);
                }
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="admin-promo-code"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Promo Code (3–32 chars, A-Z / 0-9 / - / _)
                </label>
                <input
                  id="admin-promo-code"
                  type="text"
                  required
                  maxLength={32}
                  value={newPromoCode}
                  onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
                  placeholder="MODSHIFT-LAUNCH"
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs uppercase text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="admin-promo-credits"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Credits (1–500)
                  </label>
                  <input
                    id="admin-promo-credits"
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={newPromoCredits}
                    onChange={(e) => setNewPromoCredits(e.target.value)}
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor="admin-promo-maxuses"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Max Uses (1–10,000)
                  </label>
                  <input
                    id="admin-promo-maxuses"
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={newPromoMaxUses}
                    onChange={(e) => setNewPromoMaxUses(e.target.value)}
                    className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="admin-promo-note"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Internal Note (Optional)
                </label>
                <input
                  id="admin-promo-note"
                  type="text"
                  maxLength={160}
                  value={newPromoNote}
                  onChange={(e) => setNewPromoNote(e.target.value)}
                  placeholder="Discord launch reward..."
                  className="mt-1.5 min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-xs text-zinc-950 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              {promoError && (
                <p className="text-xs font-medium text-red-700 dark:text-red-400">
                  {promoError}
                </p>
              )}

              <button
                type="submit"
                disabled={creatingPromo || !newPromoCode.trim()}
                className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {creatingPromo ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Create Promo Code</span>
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 lg:col-span-7 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Active &amp; Past Promo Codes ({promoCodes.length})
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              Redemptions are atomically tracked per user ID in Firestore so each user can claim a code at most once.
            </p>

            {promoCodes.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                No promo codes created yet.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {promoCodes.map((promo) => {
                  const busy = busyPromoCode === promo.code;
                  return (
                    <div
                      key={promo.code}
                      className="flex flex-col gap-3 p-4 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-zinc-950 dark:text-zinc-50">
                            {promo.code}
                          </span>
                          <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                            +{promo.credits} cr
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              promo.active
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                          >
                            · {promo.active ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          Used {promo.usedCount} / {promo.maxUses} times
                          {promo.note ? ` · ${promo.note}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(promo.code);
                            setCopiedPromoCode(promo.code);
                            setTimeout(() => {
                              setCopiedPromoCode((curr) =>
                                curr === promo.code ? null : curr,
                              );
                            }, 1800);
                          }}
                          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                        >
                          {copiedPromoCode === promo.code ? (
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

                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            if (!user) return;
                            setBusyPromoCode(promo.code);
                            setPromoError(null);
                            try {
                              await togglePromoCodeActive(
                                user,
                                promo.code,
                                !promo.active,
                              );
                            } catch (err) {
                              setPromoError(
                                err instanceof Error
                                  ? err.message
                                  : 'Could not update promo status.',
                              );
                            } finally {
                              setBusyPromoCode(null);
                            }
                          }}
                          className="inline-flex min-h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                        >
                          {promo.active ? (
                            <>
                              <PauseCircle className="h-3 w-3" aria-hidden="true" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="h-3 w-3" aria-hidden="true" />
                              <span>Resume</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            if (!user) return;
                            setBusyPromoCode(promo.code);
                            setPromoError(null);
                            try {
                              await deletePromoCode(user, promo.code);
                            } catch (err) {
                              setPromoError(
                                err instanceof Error
                                  ? err.message
                                  : 'Could not delete promo code.',
                              );
                            } finally {
                              setBusyPromoCode(null);
                            }
                          }}
                          aria-label={`Delete promo code ${promo.code}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: Audit Log */}
      {tab === 'audit' && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Admin Audit Log
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Immutable history of site configuration updates and database moderation actions.
          </p>

          {auditError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
            >
              {auditError}
            </div>
          )}

          {auditLogs.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-zinc-200 p-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No admin actions recorded yet.
            </p>
          ) : (
            <div className="mt-4 divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-col gap-1 p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-950 dark:text-zinc-50">
                      <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                        {log.action}
                      </span>{' '}
                      · {log.details}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      By {log.actorEmail}
                    </p>
                  </div>
                  <span className="text-[11px] tabular-nums text-zinc-500 shrink-0 dark:text-zinc-400">
                    {formatTimestamp(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
