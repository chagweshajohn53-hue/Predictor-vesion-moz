import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, signInWithGooglePopup, signOutFirebase } from '../lib/firebase';
import { ensureUserProfile } from '../lib/firebaseStore';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setAuthError(null);
      if (nextUser) {
        try {
          await ensureUserProfile(nextUser);
          setUser(nextUser);
        } catch (err) {
          setAuthError((err as Error).message);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      const cred = await signInWithGooglePopup();
      if (cred.user) {
        await ensureUserProfile(cred.user);
      }
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError(null);
    try {
      localStorage.removeItem('mirofish_user_vault_v1');
      localStorage.removeItem('mirofish_saved_workspaces_v1');
    } catch {
      // ignore storage errors
    }
    try {
      await signOutFirebase();
    } catch (err) {
      setAuthError((err as Error).message);
    }
  }, []);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        signingIn,
        authError,
        signIn,
        signOut,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider.');
  }
  return ctx;
}
