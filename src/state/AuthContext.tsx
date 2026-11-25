import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** Signed-in platform user (paper-trading identity — never a broker account). */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface AuthContextValue {
  /** Signed-in user, or null when signed out. */
  user: AuthUser | null;
  /** True while the initial session probe is in flight. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Envelope<T> {
  data?: T;
  error?: { message?: string };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed — please try again');
  }
  return payload.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const payload = (await response.json()) as Envelope<{ user: AuthUser }>;
          if (!cancelled && payload.data?.user) setUser(payload.data.user);
        }
      } catch {
        /* network unreachable — treat as signed out; login will surface errors */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await postJson<AuthUser>('/api/auth/login', { email, password });
    setUser(data);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const data = await postJson<AuthUser>('/api/auth/register', {
      email,
      password,
      ...(displayName ? { displayName } : {}),
    });
    setUser(data);
  }, []);

  const logout = useCallback(async () => {
    await postJson<{ signedOut: boolean }>('/api/auth/logout', {});
    setUser(null);
  }, []);

  const value = { user, loading, login, register, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
