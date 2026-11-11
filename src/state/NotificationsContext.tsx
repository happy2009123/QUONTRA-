import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { NotificationItem, NotificationPreference } from '@/models';
import { api } from '@/api/client';

interface NotificationsContextValue {
  items: NotificationItem[];
  preferences: NotificationPreference[];
  loading: boolean;
  error: string | null;
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  savePreferences: (prefs: NotificationPreference[]) => Promise<void>;
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.notifications.list(), api.notifications.getPreferences()])
      .then(([list, prefs]) => {
        if (cancelled) return;
        setItems(list.data);
        setPreferences(prefs.data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load notifications.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await api.notifications.markRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await api.notifications.markAllRead();
  }, []);

  const savePreferences = useCallback(async (prefs: NotificationPreference[]) => {
    const res = await api.notifications.savePreferences(prefs);
    setPreferences(res.data);
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const unreadCount = items.filter((n) => !n.read).length;

  const value = useMemo(
    () => ({
      items,
      preferences,
      loading,
      error,
      unreadCount,
      markRead,
      markAllRead,
      savePreferences,
      refresh,
    }),
    [items, preferences, loading, error, unreadCount, markRead, markAllRead, savePreferences, refresh],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
