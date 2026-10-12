import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.ts";
import { clearAll, refreshKept } from "./offline.ts";
import { clearPlaylistData } from "./playlist.ts";
import type { Role, User } from "../shared/types.ts";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// The signed-in user is remembered on the phone, so game mode opens without a
// connection. The server still checks the session on every request it gets.
const USER_KEY = "bb.user";

function rememberedUser(): User | null {
  try {
    const v = localStorage.getItem(USER_KEY);
    return v ? (JSON.parse(v) as User) : null;
  } catch {
    return null;
  }
}

function remember(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Storage blocked: the phone just won't open signed in without a connection.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User }>("/auth/me", { timeoutMs: 5000 })
      .then((r) => {
        setUser(r.user);
        remember(r.user);
        void refreshKept();
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          remember(null);
          return;
        }
        // No connection: carry on as the user last signed in on this phone.
        const known = rememberedUser();
        if (known) setUser(known);
        else setError("Can't reach the server. Check your connection and reload.");
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api<{ user: User }>("/auth/login", { body: { username, password } });
    setUser(r.user);
    remember(r.user);
    setError(null);
  }, []);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { body: {} });
    remember(null);
    await clearAll();
    await clearPlaylistData();
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
