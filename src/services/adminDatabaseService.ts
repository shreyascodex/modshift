import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  type Timestamp,
} from 'firebase/firestore';
import { isAdminUser } from '../config/admins';
import { OperationType, db, handleFirestoreError } from '../firebase';
import type { ModLoader } from '../types/migration';
import type {
  SavedMigrationItemSnapshot,
  SavedMigrationRecord,
} from './savedMigrationsService';
import { writeAdminAuditLog } from './siteConfigService';
import type { TrackedModRecord } from './trackedModsService';

export interface AdminUserRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  credits: number;
  isBanned: boolean;
  banReason?: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AdminUserModData {
  mods: TrackedModRecord[];
  migrations: SavedMigrationRecord[];
}

export async function fetchAllUsers(adminUser: User): Promise<AdminUserRecord[]> {
  if (!isAdminUser(adminUser)) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const colPath = 'users';
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(200)));
    const users: AdminUserRecord[] = snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        uid: String(d.uid ?? docSnap.id),
        displayName: String(d.displayName ?? 'Minecraft Player'),
        email: String(d.email ?? ''),
        photoURL: typeof d.photoURL === 'string' ? d.photoURL : undefined,
        credits: typeof d.credits === 'number' ? d.credits : 50,
        isBanned: d.isBanned === true,
        banReason: typeof d.banReason === 'string' ? d.banReason : undefined,
        createdAt: (d.createdAt as Timestamp | null) ?? null,
        updatedAt: (d.updatedAt as Timestamp | null) ?? null,
      };
    });
    users.sort((a, b) => {
      const ta = a.updatedAt ? a.updatedAt.toMillis() : 0;
      const tb = b.updatedAt ? b.updatedAt.toMillis() : 0;
      return tb - ta;
    });
    return users;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function fetchUserModData(
  adminUser: User,
  targetUserId: string,
): Promise<AdminUserModData> {
  if (!isAdminUser(adminUser)) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const modsPath = `users/${targetUserId}/mods`;
  const migrationsPath = `users/${targetUserId}/migrations`;

  let modsSnap;
  try {
    modsSnap = await getDocs(
      query(collection(db, 'users', targetUserId, 'mods'), limit(150)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, modsPath);
  }

  let migrationsSnap;
  try {
    migrationsSnap = await getDocs(
      query(collection(db, 'users', targetUserId, 'migrations'), limit(50)),
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, migrationsPath);
  }

  const mods: TrackedModRecord[] = modsSnap.docs.map((docSnap) => {
    const d = docSnap.data();
    return {
      id: docSnap.id,
      ownerId: String(d.ownerId ?? targetUserId),
      projectId: String(d.projectId ?? ''),
      slug: String(d.slug ?? ''),
      title: String(d.title ?? 'Untitled Mod'),
      loader: (d.loader as ModLoader) ?? 'fabric',
      targetVersion: String(d.targetVersion ?? ''),
      latestVersionNumber: d.latestVersionNumber
        ? String(d.latestVersionNumber)
        : undefined,
      latestFilename: d.latestFilename ? String(d.latestFilename) : undefined,
      latestDownloadUrl: d.latestDownloadUrl
        ? String(d.latestDownloadUrl)
        : undefined,
      notes: d.notes ? String(d.notes) : undefined,
      createdAt: (d.createdAt as Timestamp | null) ?? null,
      updatedAt: (d.updatedAt as Timestamp | null) ?? null,
    };
  });

  mods.sort((a, b) => {
    const ta = a.updatedAt ? a.updatedAt.toMillis() : 0;
    const tb = b.updatedAt ? b.updatedAt.toMillis() : 0;
    return tb - ta;
  });

  const migrations: SavedMigrationRecord[] = migrationsSnap.docs.map(
    (docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ownerId: String(data.ownerId ?? targetUserId),
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
    },
  );

  migrations.sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });

  return { mods, migrations };
}

export async function adminDeleteUserMod(
  adminUser: User,
  targetUserId: string,
  modId: string,
  modTitle: string,
): Promise<void> {
  if (!isAdminUser(adminUser)) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const docPath = `users/${targetUserId}/mods/${modId}`;
  try {
    await deleteDoc(doc(db, 'users', targetUserId, 'mods', modId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }

  await writeAdminAuditLog(
    adminUser,
    'DELETE_USER_MOD',
    `Deleted tracked mod "${modTitle}" (${modId}) for user ${targetUserId}`,
  );
}

export async function adminDeleteUserMigration(
  adminUser: User,
  targetUserId: string,
  migrationId: string,
  migrationName: string,
): Promise<void> {
  if (!isAdminUser(adminUser)) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const docPath = `users/${targetUserId}/migrations/${migrationId}`;
  try {
    await deleteDoc(doc(db, 'users', targetUserId, 'migrations', migrationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }

  await writeAdminAuditLog(
    adminUser,
    'DELETE_USER_MIGRATION',
    `Deleted migration snapshot "${migrationName}" (${migrationId}) for user ${targetUserId}`,
  );
}
