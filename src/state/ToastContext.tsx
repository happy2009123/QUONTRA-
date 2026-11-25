import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface ToastContextValue {
  toasts: readonly ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<ToastTone, { bar: string; label: string }> = {
  success: { bar: 'bg-pos', label: 'text-pos' },
  error: { bar: 'bg-neg', label: 'text-neg' },
  info: { bar: 'bg-info', label: 'text-info' },
};

const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-3 top-[68px] z-[60] flex w-[min(360px,calc(100vw-24px))] flex-col gap-2"
        aria-live="polite"
        aria-label="Action feedback"
      >
        {toasts.map((t) => (
          <div key={t.id} role="status" className="toast-in pointer-events-auto panel flex overflow-hidden">
            <span className={cn('w-1 shrink-0', TONE_CLASS[t.tone].bar)} aria-hidden />
            <div className="min-w-0 flex-1 px-3 py-2.5">
              <p className={cn('text-[12.5px] font-semibold', TONE_CLASS[t.tone].label)}>{t.title}</p>
              {t.message && <p className="mt-0.5 text-[11.5px] leading-snug text-mut">{t.message}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 px-2 text-mut-2 transition-[color,scale] duration-150 ease-out hover:text-fg motion-safe:active:scale-90 focus-visible:outline-2 focus-visible:outline-gold/70"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}
