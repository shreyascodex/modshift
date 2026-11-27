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
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { syncUserProfile } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type { ModLoader } from '../types/migration';

export interface TrackedModRecord {
  id: string;
  ownerId: string;
  projectId: string;
  slug: string;
  title: string;
  loader: ModLoader;
  targetVersion: string;
  latestVersionNumber?: string;
  latestFilename?: string;
  latestDownloadUrl?: string;
  notes?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface SaveTrackedModInput {
  projectId: string;
  slug: string;
  title: string;
  loader: ModLoader;
  targetVersion: string;
  latestVersionNumber?: string;
  latestFilename?: string;
  latestDownloadUrl?: string;
  notes?: string;
}

function clampString(val: string | null | undefined, max: number): string {
  if (!val) return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

function makeTrackedModDocId(projectId: string, loader: ModLoader): string {
  const cleanProject = projectId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return `${cleanProject}_${loader}`.slice(0, 128);
}

export function subscribeToTrackedMods(
  userId: string,
  onData: (mods: TrackedModRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = `users/${userId}/mods`;
  const q = query(
    collection(db, 'users', userId, 'mods'),
    where('ownerId', '==', userId),
    limit(150),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: TrackedModRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId ?? userId),
          projectId: String(d.projectId ?? ''),
          slug: String(d.slug ?? ''),
          title: String(d.title ?? 'Untitled Mod'),
          loader: (d.loader as ModLoader) ?? 'fabric',
          targetVersion: String(d.targetVersion ?? ''),
          latestVersionNumber: d.latestVersionNumber ? String(d.latestVersionNumber) : undefined,
          latestFilename: d.latestFilename ? String(d.latestFilename) : undefined,
          latestDownloadUrl: d.latestDownloadUrl ? String(d.latestDownloadUrl) : undefined,
          notes: d.notes ? String(d.notes) : undefined,
          createdAt: (d.createdAt as Timestamp | null) ?? null,
          updatedAt: (d.updatedAt as Timestamp | null) ?? null,
        };
      });
      list.sort((a, b) => {
        const ta = a.updatedAt ? a.updatedAt.toMillis() : Date.now();
        const tb = b.updatedAt ? b.updatedAt.toMillis() : Date.now();
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

export async function saveTrackedMod(
  user: User,
  input: SaveTrackedModInput,
): Promise<string> {
  await syncUserProfile(user);

  const projectId = input.projectId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!projectId) {
    throw new Error('Invalid Modrinth project ID.');
  }

  const docId = makeTrackedModDocId(projectId, input.loader);
  const docPath = `users/${user.uid}/mods/${docId}`;
  const modRef = doc(db, 'users', user.uid, 'mods', docId);

  let existingSnap;
  try {
    existingSnap = await getDoc(modRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  const slug = clampString(input.slug, 120) || projectId;
  const title = clampString(input.title, 120) || slug;
  const targetVersion = clampString(input.targetVersion, 40) || '1.21.4';
  const latestVersionNumber = clampString(input.latestVersionNumber, 80);
  const latestFilename = clampString(input.latestFilename, 160);
  const latestDownloadUrl = clampString(input.latestDownloadUrl, 512);
  const notes = clampString(input.notes, 240);

  if (!existingSnap.exists()) {
    const createPayload: Record<string, unknown> = {
      ownerId: user.uid,
      projectId,
      slug,
      title,
      loader: input.loader,
      targetVersion,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (latestVersionNumber) createPayload.latestVersionNumber = latestVersionNumber;
    if (latestFilename) createPayload.latestFilename = latestFilename;
    if (latestDownloadUrl) createPayload.latestDownloadUrl = latestDownloadUrl;
    if (notes) createPayload.notes = notes;

    try {
      await setDoc(modRef, createPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }
  } else {
    const updatePayload: Record<string, unknown> = {
      targetVersion,
      loader: input.loader,
      updatedAt: serverTimestamp(),
    };
    if (latestVersionNumber) updatePayload.latestVersionNumber = latestVersionNumber;
    if (latestFilename) updatePayload.latestFilename = latestFilename;
    if (latestDownloadUrl) updatePayload.latestDownloadUrl = latestDownloadUrl;
    if (notes) updatePayload.notes = notes;

    try {
      await updateDoc(modRef, updatePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
  }

  return docId;
}

export async function updateTrackedModMetadata(
  userId: string,
  modId: string,
  patch: {
    targetVersion?: string;
    loader?: ModLoader;
    latestVersionNumber?: string;
    latestFilename?: string;
    latestDownloadUrl?: string;
    notes?: string;
  },
): Promise<void> {
  const docPath = `users/${userId}/mods/${modId}`;
  const modRef = doc(db, 'users', userId, 'mods', modId);

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (patch.targetVersion !== undefined) {
    payload.targetVersion = clampString(patch.targetVersion, 40) || '1.21.4';
  }
  if (patch.loader !== undefined) {
    payload.loader = patch.loader;
  }
  if (patch.latestVersionNumber !== undefined) {
    payload.latestVersionNumber = clampString(patch.latestVersionNumber, 80);
  }
  if (patch.latestFilename !== undefined) {
    payload.latestFilename = clampString(patch.latestFilename, 160);
  }
  if (patch.latestDownloadUrl !== undefined) {
    payload.latestDownloadUrl = clampString(patch.latestDownloadUrl, 512);
  }
  if (patch.notes !== undefined) {
    payload.notes = clampString(patch.notes, 240);
  }

  try {
    await updateDoc(modRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteTrackedMod(
  userId: string,
  modId: string,
): Promise<void> {
  const docPath = `users/${userId}/mods/${modId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'mods', modId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
