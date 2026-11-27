import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { isAdminUser } from '../config/admins';
import { BRAND_CONFIG } from '../config/brand';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type { ModLoader } from '../types/migration';

export type NewsBannerLevel = 'info' | 'warning' | 'success';

export interface SiteConfig {
  maintenanceMode: boolean;
  maintenanceMessage: string;
  newsEnabled: boolean;
  newsTitle: string;
  newsBody: string;
  newsLevel: NewsBannerLevel;
  heroHeadline: string;
  heroSubheadline: string;
  workspaceEnabled: boolean;
  disabledLoaders: ModLoader[];
  creditsEnabled: boolean;
  migrationCreditCost: number;
  mrpackCreditCost: number;
  libraryCheckCreditCost: number;
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export type SiteConfigDraft = Omit<SiteConfig, 'updatedBy' | 'updatedAt'>;

export interface AdminAuditLogRecord {
  id: string;
  actorEmail: string;
  action: string;
  details: string;
  createdAt: Timestamp | null;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  maintenanceMode: false,
  maintenanceMessage:
    'ModShift is temporarily undergoing scheduled maintenance. Please check back shortly.',
  newsEnabled: false,
  newsTitle: '',
  newsBody: '',
  newsLevel: 'info',
  heroHeadline: BRAND_CONFIG.headline,
  heroSubheadline: BRAND_CONFIG.subheadline,
  workspaceEnabled: true,
  disabledLoaders: [],
  creditsEnabled: true,
  migrationCreditCost: 1,
  mrpackCreditCost: 2,
  libraryCheckCreditCost: 1,
  updatedBy: '',
  updatedAt: null,
};

const VALID_LOADERS: readonly ModLoader[] = ['fabric', 'forge', 'neoforge', 'quilt'];
const VALID_NEWS_LEVELS: readonly NewsBannerLevel[] = ['info', 'warning', 'success'];

function clampText(val: string | null | undefined, max: number): string {
  if (!val) return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function clampCreditCost(val: unknown, fallback: number): number {
  const n = typeof val === 'number' ? Math.floor(val) : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(50, n));
}

function sanitizeLoaders(loaders: unknown): ModLoader[] {
  if (!Array.isArray(loaders)) return [];
  const unique = new Set<ModLoader>();
  for (const item of loaders) {
    if (typeof item === 'string' && (VALID_LOADERS as readonly string[]).includes(item)) {
      unique.add(item as ModLoader);
    }
    if (unique.size >= 4) break;
  }
  return Array.from(unique);
}

function sanitizeNewsLevel(level: unknown): NewsBannerLevel {
  if (typeof level === 'string' && (VALID_NEWS_LEVELS as readonly string[]).includes(level)) {
    return level as NewsBannerLevel;
  }
  return 'info';
}

export function makeSafeAuditId(): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `audit-${crypto.randomUUID()}`
      : `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

export function subscribeToSiteConfig(
  onData: (config: SiteConfig) => void,
  onError?: (err: Error) => void,
): () => void {
  const docPath = 'siteConfig/global';
  const ref = doc(db, 'siteConfig', 'global');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_SITE_CONFIG);
        return;
      }
      const d = snap.data();
      onData({
        maintenanceMode: Boolean(d.maintenanceMode),
        maintenanceMessage:
          typeof d.maintenanceMessage === 'string'
            ? d.maintenanceMessage
            : DEFAULT_SITE_CONFIG.maintenanceMessage,
        newsEnabled: Boolean(d.newsEnabled),
        newsTitle: typeof d.newsTitle === 'string' ? d.newsTitle : '',
        newsBody: typeof d.newsBody === 'string' ? d.newsBody : '',
        newsLevel: sanitizeNewsLevel(d.newsLevel),
        heroHeadline:
          typeof d.heroHeadline === 'string' && d.heroHeadline.trim()
            ? d.heroHeadline
            : DEFAULT_SITE_CONFIG.heroHeadline,
        heroSubheadline:
          typeof d.heroSubheadline === 'string' && d.heroSubheadline.trim()
            ? d.heroSubheadline
            : DEFAULT_SITE_CONFIG.heroSubheadline,
        workspaceEnabled:
          typeof d.workspaceEnabled === 'boolean' ? d.workspaceEnabled : true,
        disabledLoaders: sanitizeLoaders(d.disabledLoaders),
        creditsEnabled:
          typeof d.creditsEnabled === 'boolean'
            ? d.creditsEnabled
            : DEFAULT_SITE_CONFIG.creditsEnabled,
        migrationCreditCost: clampCreditCost(
          d.migrationCreditCost,
          DEFAULT_SITE_CONFIG.migrationCreditCost,
        ),
        mrpackCreditCost: clampCreditCost(
          d.mrpackCreditCost,
          DEFAULT_SITE_CONFIG.mrpackCreditCost,
        ),
        libraryCheckCreditCost: clampCreditCost(
          d.libraryCheckCreditCost,
          DEFAULT_SITE_CONFIG.libraryCheckCreditCost,
        ),
        updatedBy: typeof d.updatedBy === 'string' ? d.updatedBy : '',
        updatedAt: (d.updatedAt as Timestamp | null) ?? null,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, docPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function writeAdminAuditLog(
  adminUser: User,
  action: string,
  details: string,
): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const logId = makeSafeAuditId();
  const logPath = `siteConfig/global/auditLogs/${logId}`;
  const payload = {
    actorEmail: adminUser.email.slice(0, 254),
    action: clampText(action, 80) || 'ADMIN_ACTION',
    details: clampText(details, 320) || 'Updated site settings.',
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'siteConfig', 'global', 'auditLogs', logId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, logPath);
  }
}

export async function saveSiteConfig(
  adminUser: User,
  draft: SiteConfigDraft,
  auditDetails: string,
): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Only approved admins can modify site configuration.');
  }

  const docPath = 'siteConfig/global';
  const payload = {
    maintenanceMode: Boolean(draft.maintenanceMode),
    maintenanceMessage:
      clampText(draft.maintenanceMessage, 500) ||
      DEFAULT_SITE_CONFIG.maintenanceMessage,
    newsEnabled: Boolean(draft.newsEnabled),
    newsTitle: clampText(draft.newsTitle, 120),
    newsBody: clampText(draft.newsBody, 600),
    newsLevel: sanitizeNewsLevel(draft.newsLevel),
    heroHeadline:
      clampText(draft.heroHeadline, 140) || DEFAULT_SITE_CONFIG.heroHeadline,
    heroSubheadline:
      clampText(draft.heroSubheadline, 320) || DEFAULT_SITE_CONFIG.heroSubheadline,
    workspaceEnabled: Boolean(draft.workspaceEnabled),
    disabledLoaders: sanitizeLoaders(draft.disabledLoaders),
    creditsEnabled: Boolean(draft.creditsEnabled),
    migrationCreditCost: clampCreditCost(
      draft.migrationCreditCost,
      DEFAULT_SITE_CONFIG.migrationCreditCost,
    ),
    mrpackCreditCost: clampCreditCost(
      draft.mrpackCreditCost,
      DEFAULT_SITE_CONFIG.mrpackCreditCost,
    ),
    libraryCheckCreditCost: clampCreditCost(
      draft.libraryCheckCreditCost,
      DEFAULT_SITE_CONFIG.libraryCheckCreditCost,
    ),
    updatedBy: adminUser.email.slice(0, 254),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'siteConfig', 'global'), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }

  await writeAdminAuditLog(adminUser, 'UPDATE_SITE_CONFIG', auditDetails);
}

export function subscribeToAuditLogs(
  onData: (logs: AdminAuditLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = 'siteConfig/global/auditLogs';
  const q = query(collection(db, 'siteConfig', 'global', 'auditLogs'), limit(50));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: AdminAuditLogRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          actorEmail: String(d.actorEmail ?? ''),
          action: String(d.action ?? ''),
          details: String(d.details ?? ''),
          createdAt: (d.createdAt as Timestamp | null) ?? null,
        };
      });
      list.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.toMillis() : Date.now();
        const tb = b.createdAt ? b.createdAt.toMillis() : Date.now();
        return tb - ta;
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}
