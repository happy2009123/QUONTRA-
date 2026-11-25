import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'quantora.watchlist.v1';

export interface WatchlistContextValue {
  ids: readonly string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

function loadInitial(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable — keep the in-memory list for this session */
    }
  }, [ids]);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }, []);

  const value = useMemo(() => ({ ids, has, toggle }), [ids, has, toggle]);

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used within WatchlistProvider');
  return ctx;
}
