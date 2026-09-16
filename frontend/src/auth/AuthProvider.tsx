import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "@/api/client";
import { clearSession, getSessionToken, persistSession } from "@/auth/session";

export interface AuthUser {
  username: string;
  displayName: string;
}

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setUser(null);
    });
    const token = getSessionToken();
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((me) => setUser({ username: me.username, displayName: me.displayName }))
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setReady(true));
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login: async (username, password) => {
        const session = await api.login(username, password);
        persistSession(session.token, session.username);
        setUser({ username: session.username, displayName: session.displayName });
      },
      logout: () => {
        clearSession();
        setUser(null);
      },
    }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
