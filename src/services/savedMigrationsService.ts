import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type {
  MigrationCategory,
  MigrationTargetConfig,
  ModLoader,
  ModMigrationResult,
} from '../types/migration';
import { sanitizeDisplayName } from '../utils/format';

export interface SavedMigrationItemSnapshot {
  originalFilename: string;
  originalSize: number;
  sha1: string | null;
  category: MigrationCategory;
  projectId: string | null;
  projectTitle: string | null;
  projectSlug: string | null;
  clientSide?: string | null;
  serverSide?: string | null;
  targetVersionId?: string | null;
  targetVersionNumber: string | null;
  targetFilename: string | null;
  targetUrl: string | null;
  targetFileSize: number | null;
  targetSha1?: string | null;
  explanation: string;
}

export interface SavedMigrationRecord {
  id: string;
  ownerId: string;
  name: string;
  gameVersion: string;
  loader: ModLoader;
  summary: {
    total: number;
    ready: number;
    noUpdate: number;
    notFound: number;
    needsReview: number;
    failed: number;
  };
  items: SavedMigrationItemSnapshot[];
  createdAt: Timestamp | null;
}

const MAX_SAVED_ITEMS = 300;

function makeSafeDocId(): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `mig-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function clampString(val: string | null | undefined, max: number): string {
  if (!val) return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function subscribeToUserMigrations(
  userId: string,
  onData: (records: SavedMigrationRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = `users/${userId}/migrations`;
  const q = query(
    collection(db, 'users', userId, 'migrations'),
    where('ownerId', '==', userId),
    limit(50),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const records: SavedMigrationRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(data.ownerId ?? userId),
          name: String(data.name ?? 'Untitled Migration'),
          gameVersion: String(data.gameVersion ?? ''),
          loader: (data.loader as ModLoader) ?? 'fabric',
          summary: {
            total: Number(data.summary?.total ?? 0),
            ready: Number(data.summary?.ready ?? 0),
            noUpdate: Number(data.summary?.noUpdate ?? 0),
            notFound: Number(data.summary?.notFound ?? 0),
            needsReview: Number(data.summary?.needsReview ?? 0),
            failed: Number(data.summary?.failed ?? 0),
          },
          items: Array.isArray(data.items)
            ? (data.items as SavedMigrationItemSnapshot[])
            : [],
          createdAt: (data.createdAt as Timestamp | null) ?? null,
        };
      });
      records.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.toMillis() : Date.now();
        const tb = b.createdAt ? b.createdAt.toMillis() : Date.now();
        return tb - ta;
      });
      onData(records);
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

export async function saveMigrationSnapshot(
  userId: string,
  label: string,
  config: MigrationTargetConfig,
  results: ModMigrationResult[],
): Promise<string> {
  if (results.length === 0) {
    throw new Error('Cannot save an empty migration result.');
  }

  const boundedResults = results.slice(0, MAX_SAVED_ITEMS);
  const docId = makeSafeDocId();
  const docPath = `users/${userId}/migrations/${docId}`;

  const summary = {
    total: boundedResults.length,
    ready: boundedResults.filter((r) => r.category === 'ready').length,
    noUpdate: boundedResults.filter((r) => r.category === 'no_update').length,
    notFound: boundedResults.filter((r) => r.category === 'not_found').length,
    needsReview: boundedResults.filter((r) => r.category === 'needs_review').length,
    failed: boundedResults.filter((r) => r.category === 'failed').length,
  };

  const items: SavedMigrationItemSnapshot[] = boundedResults.map((r) => ({
    originalFilename: clampString(r.localFile.name, 160) || 'mod.jar',
    originalSize: Math.max(0, Math.floor(r.localFile.size || 0)),
    sha1: r.localFile.sha1 ? clampString(r.localFile.sha1, 64) : null,
    category: r.category,
    projectId: r.project?.id ? clampString(r.project.id, 64) : null,
    projectTitle: r.project?.title ? clampString(r.project.title, 120) : null,
    projectSlug: r.project?.slug ? clampString(r.project.slug, 120) : null,
    clientSide: r.project?.client_side ? clampString(r.project.client_side, 32) : null,
    serverSide: r.project?.server_side ? clampString(r.project.server_side, 32) : null,
    targetVersionId: r.targetVersion?.id ? clampString(r.targetVersion.id, 64) : null,
    targetVersionNumber: r.targetVersion?.version_number
      ? clampString(r.targetVersion.version_number, 80)
      : null,
    targetFilename: r.targetFile?.filename
      ? clampString(r.targetFile.filename, 160)
      : null,
    targetUrl: r.targetFile?.url ? clampString(r.targetFile.url, 512) : null,
    targetFileSize: r.targetFile?.size ? Math.max(0, Math.floor(r.targetFile.size)) : null,
    targetSha1: r.targetFile?.hashes?.sha1
      ? clampString(r.targetFile.hashes.sha1, 64)
      : null,
    explanation: clampString(r.explanation, 320),
  }));

  const safeName =
    clampString(label, 120) ||
    `Minecraft ${clampString(config.gameVersion, 30)} (${config.loader})`;

  const payload = {
    ownerId: userId,
    name: safeName,
    gameVersion: clampString(config.gameVersion, 40),
    loader: config.loader,
    summary,
    items,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', userId, 'migrations', docId), payload);
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function deleteSavedMigration(
  userId: string,
  migrationId: string,
): Promise<void> {
  const docPath = `users/${userId}/migrations/${migrationId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'migrations', migrationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function hydrateSavedMigrationResults(
  record: SavedMigrationRecord,
): ModMigrationResult[] {
  return record.items.map((item, idx) => {
    const cleanName = sanitizeDisplayName(item.originalFilename);
    const placeholderFile = new File([], cleanName, {
      type: 'application/java-archive',
    });

    return {
      id: `saved-${record.id}-${idx}`,
      localFile: {
        id: `saved-file-${record.id}-${idx}`,
        file: placeholderFile,
        name: cleanName,
        size: item.originalSize,
        sha1: item.sha1 ?? undefined,
        status: item.sha1 ? 'hashed' : 'queued',
      },
      category: item.category,
      provider: 'Modrinth',
      project: item.projectId
        ? {
            id: item.projectId,
            slug: item.projectSlug ?? item.projectId,
            project_type: 'mod',
            title: item.projectTitle ?? cleanName,
            description: '',
            client_side: item.clientSide ?? undefined,
            server_side: item.serverSide ?? undefined,
          }
        : undefined,
      targetVersion: item.targetVersionNumber
        ? {
            id: item.targetVersionId ?? `saved-ver-${idx}`,
            project_id: item.projectId ?? '',
            name: item.targetVersionNumber,
            version_number: item.targetVersionNumber,
            date_published: '',
            downloads: 0,
            version_type: 'release',
            files: [],
            dependencies: [],
            game_versions: [record.gameVersion],
            loaders: [record.loader],
          }
        : undefined,
      targetFile:
        item.targetUrl && item.targetFilename
          ? {
              hashes: item.targetSha1 ? { sha1: item.targetSha1 } : {},
              url: item.targetUrl,
              filename: item.targetFilename,
              primary: true,
              size: item.targetFileSize ?? 0,
            }
          : undefined,
      explanation: item.explanation,
    };
  });
}
