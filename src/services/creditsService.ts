import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { isAdminUser } from '../config/admins';
import { syncUserProfile } from '../contexts/AuthContext';
import { OperationType, db, handleFirestoreError } from '../firebase';
import { writeAdminAuditLog } from './siteConfigService';

export const DAILY_CLAIM_CREDITS = 10;
export const DAILY_CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface CreditTransactionRecord {
  id: string;
  ownerId: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  actorEmail?: string;
  promoCode?: string;
  createdAt: Timestamp | null;
}

export interface PromoCodeRecord {
  id: string;
  code: string;
  credits: number;
  maxUses: number;
  usedCount: number;
  active: boolean;
  note?: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
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

export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidPromoCodeFormat(code: string): boolean {
  return /^[A-Z0-9_-]{3,32}$/.test(code);
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
          promoCode: typeof d.promoCode === 'string' ? d.promoCode : undefined,
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

export async function claimDailyCredits(user: User): Promise<number> {
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

      const lastClaim = data.lastDailyClaimAt as Timestamp | undefined;
      if (lastClaim && typeof lastClaim.toMillis === 'function') {
        const elapsed = Date.now() - lastClaim.toMillis();
        if (elapsed < DAILY_CLAIM_COOLDOWN_MS) {
          const remainingMs = DAILY_CLAIM_COOLDOWN_MS - elapsed;
          const hours = Math.floor(remainingMs / (60 * 60 * 1000));
          const mins = Math.max(1, Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000)));
          throw new DomainValidationError(
            `Daily bonus already claimed. Next claim available in ${hours}h ${mins}m.`,
          );
        }
      }

      const current = typeof data.credits === 'number' ? data.credits : 0;
      if (current + DAILY_CLAIM_CREDITS > 1000000) {
        throw new DomainValidationError('Account credit balance limit reached.');
      }

      const updated = current + DAILY_CLAIM_CREDITS;
      tx.update(userRef, {
        credits: updated,
        lastDailyClaimAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        ownerId: user.uid,
        amount: DAILY_CLAIM_CREDITS,
        balanceAfter: updated,
        reason: 'Daily free credit claim',
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

export async function redeemPromoCode(
  user: User,
  rawCode: string,
): Promise<{ code: string; creditsGranted: number; balanceAfter: number }> {
  const code = normalizePromoCode(rawCode);
  if (!isValidPromoCodeFormat(code)) {
    throw new Error('Promo code must be 3–32 characters (letters, numbers, hyphens, or underscores).');
  }

  await syncUserProfile(user);

  const promoPath = `promoCodes/${code}`;
  const promoRef = doc(db, 'promoCodes', code);
  const redemptionRef = doc(db, 'promoCodes', code, 'redemptions', user.uid);
  const userRef = doc(db, 'users', user.uid);
  const txId = makeTxId();
  const txRef = doc(db, 'users', user.uid, 'creditTransactions', txId);

  let outcome = { code, creditsGranted: 0, balanceAfter: 0 };

  try {
    outcome = await runTransaction(db, async (tx) => {
      const [promoSnap, redemptionSnap, userSnap] = await Promise.all([
        tx.get(promoRef),
        tx.get(redemptionRef),
        tx.get(userRef),
      ]);

      if (!promoSnap.exists()) {
        throw new DomainValidationError(`Promo code "${code}" does not exist.`);
      }
      if (!userSnap.exists()) {
        throw new DomainValidationError('User profile record not found.');
      }

      const userData = userSnap.data();
      if (userData.isBanned === true) {
        throw new DomainValidationError('Your account is currently suspended.');
      }

      if (redemptionSnap.exists()) {
        throw new DomainValidationError(`You have already redeemed promo code "${code}".`);
      }

      const promoData = promoSnap.data();
      if (promoData.active !== true) {
        throw new DomainValidationError(`Promo code "${code}" is currently inactive.`);
      }

      const maxUses = Number(promoData.maxUses ?? 0);
      const usedCount = Number(promoData.usedCount ?? 0);
      if (usedCount >= maxUses) {
        throw new DomainValidationError(`Promo code "${code}" has reached its redemption limit.`);
      }

      const creditsGranted = Number(promoData.credits ?? 0);
      if (creditsGranted <= 0) {
        throw new DomainValidationError(`Promo code "${code}" has an invalid reward value.`);
      }

      const currentCredits = typeof userData.credits === 'number' ? userData.credits : 0;
      const balanceAfter = currentCredits + creditsGranted;
      if (balanceAfter > 1000000) {
        throw new DomainValidationError('Account credit balance limit exceeded.');
      }

      tx.update(promoRef, {
        usedCount: usedCount + 1,
        updatedAt: serverTimestamp(),
      });
      tx.set(redemptionRef, {
        ownerId: user.uid,
        code,
        creditsGranted,
        redeemedAt: serverTimestamp(),
      });
      tx.update(userRef, {
        credits: balanceAfter,
        lastPromoCode: code,
        updatedAt: serverTimestamp(),
      });
      tx.set(txRef, {
        ownerId: user.uid,
        amount: creditsGranted,
        balanceAfter,
        reason: clampReason(`Redeemed promo code ${code}`, 'Promo code'),
        promoCode: code,
        createdAt: serverTimestamp(),
      });

      return { code, creditsGranted, balanceAfter };
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, promoPath);
  }

  return outcome;
}

export function subscribeToPromoCodes(
  onData: (codes: PromoCodeRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const colPath = 'promoCodes';
  const q = query(collection(db, 'promoCodes'), limit(100));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: PromoCodeRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          code: String(d.code ?? docSnap.id),
          credits: Number(d.credits ?? 0),
          maxUses: Number(d.maxUses ?? 1),
          usedCount: Number(d.usedCount ?? 0),
          active: d.active !== false,
          note: typeof d.note === 'string' && d.note ? d.note : undefined,
          createdBy: String(d.createdBy ?? ''),
          createdAt: (d.createdAt as Timestamp | null) ?? null,
          updatedAt: (d.updatedAt as Timestamp | null) ?? null,
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

export async function createPromoCode(
  adminUser: User,
  params: {
    code: string;
    credits: number;
    maxUses: number;
    note?: string;
  },
): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }
  const code = normalizePromoCode(params.code);
  if (!isValidPromoCodeFormat(code)) {
    throw new Error('Code must be 3–32 characters using A-Z, 0-9, hyphens, or underscores.');
  }
  const credits = Math.floor(params.credits);
  const maxUses = Math.floor(params.maxUses);
  if (!Number.isFinite(credits) || credits < 1 || credits > 500) {
    throw new Error('Promo credits must be between 1 and 500.');
  }
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 10000) {
    throw new Error('Max uses must be between 1 and 10,000.');
  }

  const cleanNote = (params.note ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 160);
  const promoPath = `promoCodes/${code}`;

  const payload: Record<string, unknown> = {
    code,
    credits,
    maxUses,
    usedCount: 0,
    active: true,
    createdBy: adminUser.email.slice(0, 254),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (cleanNote) {
    payload.note = cleanNote;
  }

  try {
    await setDoc(doc(db, 'promoCodes', code), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, promoPath);
  }

  await writeAdminAuditLog(
    adminUser,
    'CREATE_PROMO_CODE',
    `Created promo code ${code} (+${credits} credits, max ${maxUses} uses)`,
  );
}

export async function togglePromoCodeActive(
  adminUser: User,
  code: string,
  active: boolean,
): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }
  const normalized = normalizePromoCode(code);
  const promoPath = `promoCodes/${normalized}`;
  try {
    await updateDoc(doc(db, 'promoCodes', normalized), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, promoPath);
  }

  await writeAdminAuditLog(
    adminUser,
    active ? 'ENABLE_PROMO_CODE' : 'PAUSE_PROMO_CODE',
    `${active ? 'Activated' : 'Paused'} promo code ${normalized}`,
  );
}

export async function deletePromoCode(adminUser: User, code: string): Promise<void> {
  if (!isAdminUser(adminUser) || !adminUser.email) {
    throw new Error('Unauthorized: Admin permissions required.');
  }
  const normalized = normalizePromoCode(code);
  const promoPath = `promoCodes/${normalized}`;
  try {
    await deleteDoc(doc(db, 'promoCodes', normalized));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, promoPath);
  }

  await writeAdminAuditLog(
    adminUser,
    'DELETE_PROMO_CODE',
    `Deleted promo code ${normalized}`,
  );
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
