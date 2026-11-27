import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isAdminUser } from '../config/admins';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../firebase';

export const STARTER_CREDITS = 50;
const VERIFIED_EMAIL_REQUIRED_ERROR =
  'A verified Google email address is required to sign in to ModShift.';

interface AuthContextValue {
  user: User | null;
  isAdmin: boolean;
  credits: number;
  isBanned: boolean;
  banReason: string | null;
  profileReady: boolean;
  authReady: boolean;
  authBusy: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sanitizeProfileText(
  value: string | null | undefined,
  maxLen: number,
  fallback: string,
): string {
  const clean = (value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!clean) return fallback;
  return clean.slice(0, maxLen);
}

const inFlightProfileSyncs = new Map<string, Promise<void>>();

export function syncUserProfile(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) {
    return Promise.resolve();
  }

  const existingPromise = inFlightProfileSyncs.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task = (async () => {
    const profilePath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);
    const displayName = sanitizeProfileText(
      user.displayName,
      120,
      'Minecraft Player',
    );
    const email = sanitizeProfileText(user.email, 254, '');
    const photoURL = user.photoURL ? user.photoURL.slice(0, 1024) : undefined;

    let existsSnap;
    try {
      existsSnap = await getDoc(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, profilePath);
    }

    if (!existsSnap.exists()) {
      const createPayload: Record<string, unknown> = {
        uid: user.uid,
        displayName,
        email,
        credits: STARTER_CREDITS,
        isBanned: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) {
        createPayload.photoURL = photoURL;
      }

      try {
        await setDoc(userRef, createPayload);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, profilePath);
      }
    } else {
      const existingData = existsSnap.data();
      const updatePayload: Record<string, unknown> = {
        displayName,
        email,
        updatedAt: serverTimestamp(),
      };
      if (photoURL) {
        updatePayload.photoURL = photoURL;
      }
      if (typeof existingData.credits !== 'number') {
        updatePayload.credits = STARTER_CREDITS;
      }
      if (typeof existingData.isBanned !== 'boolean') {
        updatePayload.isBanned = false;
      }

      try {
        await updateDoc(userRef, updatePayload);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, profilePath);
      }
    }
  })();

  inFlightProfileSyncs.set(user.uid, task);
  task.finally(() => {
    if (inFlightProfileSyncs.get(user.uid) === task) {
      inFlightProfileSyncs.delete(user.uid);
    }
  });

  return task;
}

function formatFirestoreJsonError(rawMessage: string): string | null {
  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown };
    if (typeof parsed.error !== 'string' || !parsed.error.trim()) return null;
    if (/permission|insufficient/i.test(parsed.error)) {
      return 'Signed in, but Firestore denied access to your profile. Please check Firestore security rules and try again.';
    }
    if (/offline|unavailable/i.test(parsed.error)) {
      return 'Unable to reach your account database right now. Check your connection and try again.';
    }
    if (/quota/i.test(parsed.error)) {
      return 'Daily database quota exceeded. Please try again later.';
    }
    return parsed.error;
  } catch {
    return null;
  }
}

function formatAuthErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code);
    if (code === 'auth/popup-closed-by-user') {
      return 'Sign-in window was closed before completing authentication.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Sign-in popup was blocked by your browser. Allow popups for this site and try again.';
    }
    if (code === 'auth/cancelled-popup-request') {
      return 'Sign-in request was cancelled.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Network error while signing in. Check your connection and try again.';
    }
    if (code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized for Google Sign-In in Firebase Authentication.';
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Google Sign-In is currently disabled in Firebase Authentication.';
    }
    if (code === 'auth/user-disabled') {
      return 'This Google account has been disabled in Firebase Authentication.';
    }
    if (code === 'auth/web-storage-unsupported') {
      return 'Browser cookies or storage are blocked. Enable storage for this site and try again.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'An account already exists for this email with a different sign-in provider.';
    }
  }
  if (err instanceof Error) {
    const friendlyFirestore = formatFirestoreJsonError(err.message);
    if (friendlyFirestore) return friendlyFirestore;
    return err.message;
  }
  return 'Unable to sign in with Google.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(STARTER_CREDITS);
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  const activeUidRef = useRef<string | null>(null);
  const signInInProgressRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser && (!nextUser.emailVerified || !nextUser.email)) {
        activeUidRef.current = null;
        setUser(null);
        setCredits(STARTER_CREDITS);
        setIsBanned(false);
        setBanReason(null);
        setProfileReady(false);
        setAuthError(VERIFIED_EMAIL_REQUIRED_ERROR);
        setAuthReady(true);
        void signOut(auth).catch((err) => {
          console.error('Failed to sign out unverified user:', err);
        });
        return;
      }

      if (nextUser) {
        const isUidSwitch = activeUidRef.current !== nextUser.uid;
        activeUidRef.current = nextUser.uid;
        if (isUidSwitch) {
          setProfileReady(false);
          setCredits(STARTER_CREDITS);
          setIsBanned(false);
          setBanReason(null);
        }
        setAuthError(null);
        setUser(nextUser);
        setAuthReady(true);

        void syncUserProfile(nextUser)
          .then(() => {
            if (activeUidRef.current === nextUser.uid) {
              setProfileReady(true);
            }
          })
          .catch((err) => {
            console.error('Failed to sync user profile:', err);
            if (activeUidRef.current === nextUser.uid) {
              setAuthError(formatAuthErrorMessage(err));
              setProfileReady(true);
            }
          });
      } else {
        activeUidRef.current = null;
        setUser(null);
        setCredits(STARTER_CREDITS);
        setIsBanned(false);
        setBanReason(null);
        setProfileReady(false);
        setAuthReady(true);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;
    const targetUid = user.uid;
    const profilePath = `users/${targetUid}`;
    const unsubProfile = onSnapshot(
      doc(db, 'users', targetUid),
      (snap) => {
        if (activeUidRef.current !== targetUid) return;
        if (snap.exists()) {
          const data = snap.data();
          setCredits(
            typeof data.credits === 'number' ? data.credits : STARTER_CREDITS,
          );
          setIsBanned(data.isBanned === true);
          setBanReason(
            typeof data.banReason === 'string' && data.banReason.trim()
              ? data.banReason
              : null,
          );
          setProfileReady(true);
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, profilePath);
        } catch (err) {
          console.error(err);
          if (activeUidRef.current === targetUid) {
            setAuthError(formatAuthErrorMessage(err));
          }
        }
        if (activeUidRef.current === targetUid) {
          setProfileReady(true);
        }
      },
    );
    return () => unsubProfile();
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    if (signInInProgressRef.current) return;
    signInInProgressRef.current = true;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        if (!cred.user.emailVerified || !cred.user.email) {
          await signOut(auth);
          setAuthError(VERIFIED_EMAIL_REQUIRED_ERROR);
          return;
        }
        await syncUserProfile(cred.user);
      }
    } catch (err) {
      setAuthError(formatAuthErrorMessage(err));
    } finally {
      signInInProgressRef.current = false;
      setAuthBusy(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setAuthError(formatAuthErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const isAdmin = useMemo(() => isAdminUser(user), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAdmin,
      credits,
      isBanned,
      banReason,
      profileReady,
      authReady,
      authBusy,
      authError,
      signInWithGoogle,
      signOutUser,
      clearAuthError,
    }),
    [
      user,
      isAdmin,
      credits,
      isBanned,
      banReason,
      profileReady,
      authReady,
      authBusy,
      authError,
      signInWithGoogle,
      signOutUser,
      clearAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
