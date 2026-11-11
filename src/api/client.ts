import type { QuantoraApi } from './services';
import { httpApi } from './httpApi';

/**
 * Single injection point for the API layer.
 *
 * `httpApi` calls the QUANTORA backend at `/api/*` (proxied by Vite in dev)
 * and transparently falls back to `mockApi` when the backend is unreachable.
 * Fallback values are always labelled `DEMO` — the app never fabricates live prices.
 *
 * Page components only depend on the `QuantoraApi` interface.
 */
export const api: QuantoraApi = httpApi;

export type { ApiEnvelope, QuantoraApi } from './services';
