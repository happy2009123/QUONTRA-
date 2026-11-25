import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import type { ReactNode } from 'react';

const LAYOUT_STORAGE_KEY = 'quantora.layout.v1';

interface LayoutState {
  sidebarCollapsed: boolean;
}

interface LayoutContextValue {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

function loadLayoutState(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { sidebarCollapsed: false };
    const parsed: Record<string, unknown> = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { sidebarCollapsed: false };
    return {
      sidebarCollapsed: 'sidebarCollapsed' in parsed && typeof parsed.sidebarCollapsed === 'boolean'
        ? parsed.sidebarCollapsed
        : false,
    };
  } catch {
    return { sidebarCollapsed: false };
  }
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LayoutState>(loadLayoutState);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — keep in-memory only for this session */
    }
  }, [state]);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => {
      const next = { ...prev, sidebarCollapsed: collapsed };
      try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      sidebarCollapsed: state.sidebarCollapsed,
      setSidebarCollapsed,
    }),
    [state, setSidebarCollapsed],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}