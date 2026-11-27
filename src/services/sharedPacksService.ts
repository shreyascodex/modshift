import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type { ModLoader, ModMigrationResult } from '../types/migration';
import { sanitizeDisplayName } from '../utils/format';

export interface SharedPackItem {
  projectId: string | null;
  projectTitle: string;
  projectSlug: string | null;
  versionNumber: string;
  filename: string;
  downloadUrl: string;
  fileSize: number;
  sha1: string | null;
  clientSide: string | null;
  serverSide: string | null;
}

export interface SharedPackRecord {
  id: string;
  ownerId: string;
  authorName: string;
  title: string;
  gameVersion: string;
  loader: ModLoader;
  modCount: number;
  items: SharedPackItem[];
  createdAt: Timestamp | null;
}

const MAX_SHARED_ITEMS = 300;

function makeShareId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return `pack-${out}`;
  }
  return `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampString(val: string | null | undefined, max: number): string {
  if (!val) return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function buildSharedPackPath(shareId: string): string {
  return `/pack/${encodeURIComponent(shareId)}`;
}

export async function publishSharedPack(
  user: User,
  params: {
    title: string;
    gameVersion: string;
    loader: ModLoader;
    results: ModMigrationResult[];
  },
): Promise<string> {
  const readyWithDownloads = params.results
    .filter(
      (r) =>
        r.category === 'ready' &&
        r.targetFile?.url &&
        r.targetFile.url.startsWith('https://') &&
        r.targetFile.filename,
    )
    .slice(0, MAX_SHARED_ITEMS);

  if (readyWithDownloads.length === 0) {
    throw new Error('No ready mods with verified download links are available to share.');
  }

  const shareId = makeShareId();
  const docPath = `sharedPacks/${shareId}`;

  const items: SharedPackItem[] = readyWithDownloads.map((r) => ({
    projectId: r.project?.id ? clampString(r.project.id, 64) : null,
    projectTitle:
      clampString(r.project?.title, 120) ||
      sanitizeDisplayName(r.localFile.name).slice(0, 120),
    projectSlug: r.project?.slug ? clampString(r.project.slug, 120) : null,
    versionNumber:
      clampString(r.targetVersion?.version_number, 80) || 'latest',
    filename: clampString(r.targetFile!.filename, 160) || 'mod.jar',
    downloadUrl: clampString(r.targetFile!.url, 512),
    fileSize: Math.max(0, Math.floor(r.targetFile!.size || 0)),
    sha1: r.targetFile!.hashes?.sha1 ? clampString(r.targetFile!.hashes.sha1, 64) : null,
    clientSide: r.project?.client_side ? clampString(r.project.client_side, 32) : null,
    serverSide: r.project?.server_side ? clampString(r.project.server_side, 32) : null,
  }));

  const safeTitle =
    clampString(params.title, 120) ||
    `ModShift ${clampString(params.gameVersion, 30)} (${params.loader})`;
  const authorName = clampString(user.displayName, 120) || 'Minecraft Player';

  const payload = {
    ownerId: user.uid,
    authorName,
    title: safeTitle,
    gameVersion: clampString(params.gameVersion, 40),
    loader: params.loader,
    modCount: items.length,
    items,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'sharedPacks', shareId), payload);
    return shareId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function getSharedPack(shareId: string): Promise<SharedPackRecord | null> {
  const cleanId = shareId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) {
    return null;
  }
  const docPath = `sharedPacks/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'sharedPacks', cleanId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      id: snap.id,
      ownerId: String(d.ownerId ?? ''),
      authorName: String(d.authorName ?? 'Minecraft Player'),
      title: String(d.title ?? 'Shared Modpack'),
      gameVersion: String(d.gameVersion ?? ''),
      loader: (d.loader as ModLoader) ?? 'fabric',
      modCount: Number(d.modCount ?? 0),
      items: Array.isArray(d.items) ? (d.items as SharedPackItem[]) : [],
      createdAt: (d.createdAt as Timestamp | null) ?? null,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

export function subscribeToUserSharedPacks(
  userId: string,
  onData: (packs: SharedPackRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = 'sharedPacks';
  const q = query(
    collection(db, 'sharedPacks'),
    where('ownerId', '==', userId),
    limit(50),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const packs: SharedPackRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId ?? userId),
          authorName: String(d.authorName ?? 'Minecraft Player'),
          title: String(d.title ?? 'Shared Modpack'),
          gameVersion: String(d.gameVersion ?? ''),
          loader: (d.loader as ModLoader) ?? 'fabric',
          modCount: Number(d.modCount ?? 0),
          items: Array.isArray(d.items) ? (d.items as SharedPackItem[]) : [],
          createdAt: (d.createdAt as Timestamp | null) ?? null,
        };
      });
      packs.sort((a, b) => {
        const ta = a.createdAt ? a.createdAt.toMillis() : Date.now();
        const tb = b.createdAt ? b.createdAt.toMillis() : Date.now();
        return tb - ta;
      });
      onData(packs);
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

export async function deleteSharedPack(shareId: string): Promise<void> {
  const docPath = `sharedPacks/${shareId}`;
  try {
    await deleteDoc(doc(db, 'sharedPacks', shareId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function hydrateSharedPackResults(pack: SharedPackRecord): ModMigrationResult[] {
  return pack.items.map((item, idx) => {
    const cleanFilename = sanitizeDisplayName(item.filename);
    const placeholderFile = new File([], cleanFilename, {
      type: 'application/java-archive',
    });

    return {
      id: `shared-${pack.id}-${idx}`,
      localFile: {
        id: `shared-file-${pack.id}-${idx}`,
        file: placeholderFile,
        name: cleanFilename,
        size: item.fileSize,
        sha1: item.sha1 ?? undefined,
        status: item.sha1 ? 'hashed' : 'queued',
      },
      category: 'ready',
      provider: 'Modrinth',
      project: item.projectId
        ? {
            id: item.projectId,
            slug: item.projectSlug ?? item.projectId,
            project_type: 'mod',
            title: item.projectTitle,
            description: '',
            client_side: item.clientSide ?? undefined,
            server_side: item.serverSide ?? undefined,
          }
        : undefined,
      targetVersion: {
        id: `shared-ver-${idx}`,
        project_id: item.projectId ?? '',
        name: item.versionNumber,
        version_number: item.versionNumber,
        date_published: '',
        downloads: 0,
        version_type: 'release',
        files: [],
        dependencies: [],
        game_versions: [pack.gameVersion],
        loaders: [pack.loader],
      },
      targetFile: {
        hashes: item.sha1 ? { sha1: item.sha1 } : {},
        url: item.downloadUrl,
        filename: cleanFilename,
        primary: true,
        size: item.fileSize,
      },
      explanation: `Shared modpack entry (${item.versionNumber})`,
    };
  });
}
