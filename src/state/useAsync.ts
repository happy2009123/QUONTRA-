import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope } from '@/api';

export interface AsyncState<T> {
  data: T | null;
  fetchedAt: string | null;
  isDemo: boolean | null;
  loading: boolean;
  error: string | null;
}

const INITIAL: AsyncState<never> = {
  data: null,
  fetchedAt: null,
  isDemo: null,
  loading: true,
  error: null,
};

/**
 * Small fetch-state primitive used by every page so loading / error / empty
 * states are handled uniformly across the application.
 */
export function useAsync<T>(
  fetcher: () => Promise<ApiEnvelope<T>>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): AsyncState<T> & { reload: () => void } {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<AsyncState<T>>(INITIAL as AsyncState<T>);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetcherRef
      .current()
      .then((envelope) => {
        if (cancelled) return;
        setState({
          data: envelope.data,
          fetchedAt: envelope.fetchedAt,
          isDemo: envelope.isDemo,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unable to load data.',
        }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { ...state, reload };
}
