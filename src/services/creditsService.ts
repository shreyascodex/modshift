import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { isAdminUser } from '../config/admins';
import { syncUserProfile } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../firebase';
import { writeAdminAuditLog } from './siteConfigService';

export interface CreditTransactionRecord {
  id: string;
  ownerId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  actorEmail?: string;
  createdAt: Timestamp | null;
}

function makeTxId(): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `tx-${crypto.randomUUID()}`
      : `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

function clampReason(val: string, fallback: string): string {
  const clean = val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 160);
  return clean || fallback;
}

export function subscribeToCreditTransactions(
  userId: string,
  onData: (txs: CreditTransactionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = `users/${userId}/creditTransactions`;
  const q = query(
    collection(db, 'users', userId, 'creditTransactions'),
    where('ownerId', '==', userId),
    limit(40),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CreditTransactionRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId ?? userId),
          amount: Number(d.amount ?? 0),
          balanceAfter: Number(d.balanceAfter ?? 0),
          reason: String(d.reason ?? ''),
          actorEmail: typeof d.actorEmail === 'string' ? d.actorEmail : undefined,
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

export async function spendUserCredits(
  user: User,
  cost: number,
  reason: string,
): Promise<number> {
  const safeCost = Math.floor(cost);
  if (safeCost <= 0) return 0;
  if (safeCost > 200) {
    throw new Error('Single credit deduction cannot exceed 200 credits.');
  }

  await syncUserProfile(user);

  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const txId = makeTxId();
  const txRef = doc(db, 'users', user.uid, 'creditTransactions', txId);

  let nextBalance = 0;
  try {
    nextBalance = await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new DomainValidationError('User profile record not found.');
      }
      const data = userSnap.data();
      if (data.isBanned === true) {
        throw new DomainValidationError('Your account is currently suspended.');
      }
      const current = typeof data.credits === 'number' ? data.credits : 0;
      if (current < safeCost) {
        throw new DomainValidationError(
          `Insufficient credits (${current} available, ${safeCost} required).`,
        );
      }
      const updated = current - safeCost;
      tx.update(userRef, {
        credits: updated,
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        ownerId: user.uid,
        amount: -safeCost,
        balanceAfter: updated,
        reason: clampReason(reason, 'ModShift action'),
        createdAt: serverTimestamp(),
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  return nextBalance;
}

export async function adminAdjustUserCredits(
  adminUser: User,
  targetUserId: string,
  delta: number,
  reason: string,
): Promise<number> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }
  const safeDelta = Math.floor(delta);
  if (!Number.isFinite(safeDelta) || safeDelta === 0) {
    throw new Error('Credit adjustment must be a non-zero integer.');
  }
  if (Math.abs(safeDelta) > 100000) {
    throw new Error('Credit adjustment cannot exceed 100,000 per transaction.');
  }

  const userPath = `users/${targetUserId}`;
  const userRef = doc(db, 'users', targetUserId);
  const txId = makeTxId();
  const txRef = doc(db, 'users', targetUserId, 'creditTransactions', txId);

  let nextBalance = 0;
  try {
    nextBalance = await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) {
        throw new DomainValidationError('Target user profile does not exist.');
      }
      const current = typeof snap.data().credits === 'number' ? snap.data().credits : 50;
      const computed = Math.max(0, Math.min(1000000, current + safeDelta));
      const actualDelta = computed - current;
      if (actualDelta === 0) {
        return current;
      }
      tx.update(userRef, {
        credits: computed,
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        ownerId: targetUserId,
        amount: actualDelta,
        balanceAfter: computed,
        reason: clampReason(reason, 'Admin credit adjustment'),
        actorEmail: adminUser.email!.slice(0, 254),
        createdAt: serverTimestamp(),
      });
      return computed;
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  await writeAdminAuditLog(
    adminUser,
    'ADJUST_USER_CREDITS',
    `Adjusted credits by ${safeDelta > 0 ? `+${safeDelta}` : safeDelta} (balance ${nextBalance}) for user ${targetUserId}: ${reason}`,
  );

  return nextBalance;
}

export async function adminSetUserBanStatus(
  adminUser: User,
  targetUserId: string,
  isBanned: boolean,
  banReason: string,
): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }

  const userPath = `users/${targetUserId}`;
  const cleanReason = banReason.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 240);

  try {
    await updateDoc(doc(db, 'users', targetUserId), {
      isBanned,
      banReason: isBanned ? cleanReason || 'Suspended by administrator.' : '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  await writeAdminAuditLog(
    adminUser,
    isBanned ? 'BAN_USER' : 'UNBAN_USER',
    `${isBanned ? 'Suspended' : 'Restored'} user ${targetUserId}${isBanned && cleanReason ? ` (${cleanReason})` : ''}`,
  );
}
