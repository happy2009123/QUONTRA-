import type { QuantoraApi } from './services';
import { mockApi } from './mockApi';

/**
 * Single injection point for the API layer.
 * Swap `mockApi` for an HTTP-backed implementation when the backend exists —
 * page components only depend on the `QuantoraApi` interface.
 */
export const api: QuantoraApi = mockApi;

export type { ApiEnvelope, QuantoraApi } from './services';
