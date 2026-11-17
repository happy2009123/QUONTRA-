/**
 * Vercel serverless function for QUANTORA API routes.
 * Wraps the existing Node.js backend to work on Vercel's serverless runtime.
 * Uses in-memory SQLite (data resets on cold start — acceptable for simulation).
 */

import { loadConfig } from '../server/src/config/env.ts';
import { openDatabase } from '../server/src/db/db.ts';
import { seedReferenceData } from '../server/src/seed.ts';
import { ProviderRegistry } from '../server/src/providers/registry.ts';
import { buildRouter } from '../server/src/api/routes.ts';
import { envelope, type Router, type RequestContext } from '../server/src/api/http.ts';
import { isAppError, AppError } from '../server/src/lib/errors.ts';

let cachedApp: {
  router: Router;
} | null = null;

async function getApp() {
  if (cachedApp) return cachedApp;

  const config = loadConfig();
  const db = openDatabase({ path: ':memory:' });
  seedReferenceData(db);

  const registry = new ProviderRegistry(config, db);
  const router = buildRouter({ db, registry, config });

  cachedApp = { router };
  return cachedApp;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const query = url.searchParams;

  try {
    const { router } = await getApp();

    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
    }

    const matched = router.match(req.method ?? 'GET', pathname);
    if (!matched) {
      return new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${pathname}` },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const mockReq = {
      headers: {
        authorization: req.headers.get('authorization') ?? '',
        origin: req.headers.get('origin') ?? '',
      },
    } as unknown as RequestContext['req'];

    const mockCtx: RequestContext = {
      req: mockReq,
      res: null as never,
      method: req.method ?? 'GET',
      pathname,
      query,
      params: matched.params,
      requestId: crypto.randomUUID(),
      body,
      ip: (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim(),
    };

    const result = await matched.handler(mockCtx);
    const status = result.status ?? 200;
    const payload = result.raw
      ? result.body
      : envelope(result.body, result.envelopeOptions ?? { isDemo: false });

    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    const appError = isAppError(err)
      ? err
      : new AppError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error');

    return new Response(
      JSON.stringify({
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.details !== undefined ? { details: appError.details } : {}),
        },
      }),
      { status: appError.status, headers: { 'Content-Type': 'application/json' } },
    );
  }
}