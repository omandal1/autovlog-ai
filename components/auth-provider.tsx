"use client";

import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { firebaseConfigurationError, getFirebaseAuth } from "@/lib/firebase/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  configurationError: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!firebaseConfigurationError);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe: () => void = () => undefined;
    void setPersistence(auth, browserLocalPersistence)
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        unsubscribe = onIdTokenChanged(auth, (nextUser) => {
          setUser(nextUser);
          setLoading(false);
        });
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const getIdToken = useCallback(async (forceRefresh = false) => {
    const auth = getFirebaseAuth();
    return auth?.currentUser ? auth.currentUser.getIdToken(forceRefresh) : null;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error(firebaseConfigurationError || "Firebase Authentication is unavailable.");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error(firebaseConfigurationError || "Firebase Authentication is unavailable.");
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error(firebaseConfigurationError || "Firebase Authentication is unavailable.");
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configurationError: firebaseConfigurationError,
      getIdToken,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut
    }),
    [getIdToken, loading, signInWithEmail, signInWithGoogle, signOut, signUpWithEmail, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
