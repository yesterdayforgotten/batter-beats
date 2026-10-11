import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.ts";
import type { Role, User } from "../shared/types.ts";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setError("Can't reach the server. Check your connection and reload.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api<{ user: User }>("/auth/login", { body: { username, password } });
    setUser(r.user);
    setError(null);
  }, []);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { body: {} });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

const RANK: Record<Role, number> = { user: 0, editor: 1, admin: 2 };

export function hasRole(user: User | null, minimum: Role): boolean {
  return !!user && RANK[user.role] >= RANK[minimum];
}
