/**
 * Vercel serverless function for QUANTORA API routes.
 * Wraps the existing Node.js backend to work on Vercel's serverless runtime.
 * Uses in-memory SQLite (data resets on cold start — acceptable for simulation).
 *
 * Design notes:
 * - Node-style (req, res) handler — the most compatible Vercel signature.
 * - Zero static imports: the module can always load; backend modules are
 *   imported dynamically inside try/catch so failures surface as JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Router, HandlerResult, RequestContext } from '../server/src/api/http.ts';

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

  const config = loadConfig();
  const db = openDatabase({ path: ':memory:' });
  seedReferenceData(db);

  const registry = new ProviderRegistry(config, db);
  const router = buildRouter({ db, registry, config });

  cachedApp = { router, envelope, isAppError };
  return cachedApp;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Quantora-Fn': 'api-index-v3',
  });
  res.end(text);
}

const MAX_BODY_BYTES = 256 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large (max 256KB)');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;
  let app: App | null = null;

  try {
    app = await getApp();

    const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH'
      ? await readBody(req)
      : undefined;

    const matched = app.router.match(req.method ?? 'GET', pathname);
    if (!matched) {
      sendJson(res, 404, {
        error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${pathname}` },
      });
      return;
    }

    const ctx: RequestContext = {
      req,
      res,
      method: req.method ?? 'GET',
      pathname,
      query: url.searchParams,
      params: matched.params,
      requestId,
      body,
      ip: (req.socket.remoteAddress ?? 'unknown').split('::ffff:').join(''),
    };

    const result: HandlerResult = await matched.handler(ctx);
    const status = result.status ?? 200;
    const payload = result.raw
      ? result.body
      : app.envelope(result.body, result.envelopeOptions ?? { isDemo: false });
    sendJson(res, status, payload);
  } catch (err) {
    try {
      if (app?.isAppError(err)) {
        sendJson(res, err.status, {
          error: {
            code: err.code,
            message: err.message,
            requestId,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        });
        return;
      }
      if (err && typeof err === 'object' && 'code' in err && 'status' in err) {
        const e = err as AppErrorLike;
        sendJson(res, e.status, {
          error: { code: e.code, message: e.message, requestId, ...(e.details !== undefined ? { details: e.details } : {}) },
        });
        return;
      }
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const stack =
        err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 8).join(' | ') : undefined;
      sendJson(res, 500, {
        error: { code: 'INTERNAL_ERROR', message, requestId, ...(stack ? { details: { stack } } : {}) },
      });
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('INTERNAL_ERROR');
      }
    }
  }
}
