/** Retry, backoff and timeout helpers used by every HTTP provider adapter. */

import { AppError } from '../lib/errors.ts';

export interface RetryOptions {
  /** Additional attempts after the first try. */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return false to stop retrying immediately (e.g. 4xx client errors). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof AppError) {
    return err.code === 'TIMEOUT' || err.code === 'PROVIDER_UNAVAILABLE' || err.code === 'RATE_LIMITED';
  }
  return true;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` with exponential backoff and full jitter.
 * Attempt delays: base, 2x, 4x … capped at maxDelayMs.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const base = options.baseDelayMs ?? 200;
  const max = options.maxDelayMs ?? 4_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === options.retries || !shouldRetry(err, attempt)) break;
      const backoff = Math.min(max, base * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.4;
      await sleep(backoff + jitter);
    }
  }
  throw lastError;
}

/** Rejects with a TIMEOUT AppError when `promise` does not settle in time. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError('TIMEOUT', `${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fetch with an AbortController timeout; network failures map to PROVIDER_UNAVAILABLE. */
export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number; label: string }): Promise<Response> {
  const { timeoutMs, label, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('TIMEOUT', `${label} request timed out after ${timeoutMs}ms`);
    }
    throw new AppError('PROVIDER_UNAVAILABLE', `${label} request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
