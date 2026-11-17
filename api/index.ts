/**
 * Vercel serverless function for QUANTORA API routes.
 * Wraps the existing Node.js backend to work on Vercel's serverless runtime.
 * Uses in-memory SQLite (data resets on cold start — acceptable for simulation).
 *
 * Backend modules are imported dynamically inside a try/catch so any load
 * failure (e.g. missing runtime support) surfaces as a JSON error response
 * instead of FUNCTION_INVOCATION_FAILED.
 */

import type { Router, RequestContext, HandlerResult } from '../server/src/api/http.ts';
import type { AppConfig } from '../server/src/config/env.ts';

interface AppErrorLike extends Error {
  code: string;
  status: number;
  details?: unknown;
}

interface App {
  router: Router;
  envelope: <T>(
    data: T,
    options?: { isDemo?: boolean; meta?: unknown; fetchedAt?: string },
  ) => { data: T; fetchedAt: string; isDemo: boolean; meta?: unknown };
  isAppError: (err: unknown) => err is AppErrorLike;
}

let cachedApp: App | null = null;

async function getApp(): Promise<App> {
  if (cachedApp) return cachedApp;

  const { loadConfig } = await import('../server/src/config/env.ts');
  const { openDatabase } = await import('../server/src/db/db.ts');
  const { seedReferenceData } = await import('../server/src/seed.ts');
  const { ProviderRegistry } = await import('../server/src/providers/registry.ts');
  const { buildRouter } = await import('../server/src/api/routes.ts');
  const { envelope } = await import('../server/src/api/http.ts');
  const { isAppError } = await import('../server/src/lib/errors.ts');

  const config: AppConfig = loadConfig();
  const db = openDatabase({ path: ':memory:' });
  seedReferenceData(db);

  const registry = new ProviderRegistry(config, db);
  const router = buildRouter({ db, registry, config });

  cachedApp = { router, envelope, isAppError };
  return cachedApp;
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({
      error: { code, message, ...(details !== undefined ? { details } : {}) },
    }),
    { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const query = url.searchParams;
  const requestId = crypto.randomUUID();
  let app: App | null = null;

  try {
    app = await getApp();

    let body: unknown;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
    }

    const matched = app.router.match(req.method ?? 'GET', pathname);
    if (!matched) {
      return errorResponse(404, 'NOT_FOUND', `No route for ${req.method} ${pathname}`);
    }

    const ctx: RequestContext = {
      req: {
        headers: {
          authorization: req.headers.get('authorization') ?? undefined,
          origin: req.headers.get('origin') ?? undefined,
        },
      },
      res: null as never,
      method: req.method ?? 'GET',
      pathname,
      query,
      params: matched.params,
      requestId,
      body,
      ip: (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim(),
    } as unknown as RequestContext;

    const result: HandlerResult = await matched.handler(ctx);
    const status = result.status ?? 200;
    const payload = result.raw
      ? result.body
      : app.envelope(result.body, result.envelopeOptions ?? { isDemo: false });

    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    if (app?.isAppError(err)) {
      return errorResponse(err.status, err.code, err.message, err.details);
    }
    // Fall back to structural check when getApp() itself failed.
    if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
      const e = err as AppErrorLike;
      return errorResponse(e.status, e.code, e.message, e.details);
    }
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack =
      err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 8).join(' | ') : undefined;
    return errorResponse(500, 'INTERNAL_ERROR', message, stack ? { stack } : undefined);
  }
}
