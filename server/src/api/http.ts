/**
 * HTTP foundation: server, router, middleware (CORS, rate limiting, request
 * logging, JSON body parsing, admin auth) and error handling.
 *
 * Zero external dependencies — node:http plus the typed router below.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/env.ts';
import { AppError, isAppError } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  requestId: string;
  body: unknown;
  ip: string;
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult> | HandlerResult;

export interface HandlerResult {
  status?: number;
  /** Response payload — wrapped in the standard envelope unless `raw` is set. */
  body: unknown;
  raw?: boolean;
  headers?: Record<string, string>;
  envelopeOptions?: { isDemo?: boolean; meta?: unknown; fetchedAt?: string };
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  pattern: string;
}

/** Response envelope shared with the frontend API layer. */
export function envelope<T>(data: T, options: { isDemo?: boolean; meta?: unknown; fetchedAt?: string } = {}): {
  data: T;
  fetchedAt: string;
  isDemo: boolean;
  meta?: unknown;
} {
  return {
    data,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    isDemo: options.isDemo ?? false,
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
  };
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      handler,
      pattern,
    });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }

  get patterns(): string[] {
    return this.routes.map((r) => `${r.method} ${r.pattern}`);
  }
}

/** Sliding-window rate limiter keyed by client IP. */
class RateLimitStore {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.hits.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: this.max - 1, resetAt };
    }
    entry.count += 1;
    if (entry.count > this.max) return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    return { allowed: true, remaining: this.max - entry.count, resetAt: entry.resetAt };
  }
}

const MAX_BODY_BYTES = 256 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 'Request body too large (max 256KB)');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON');
  }
}

export interface HttpServerOptions {
  config: AppConfig;
  router: Router;
  /** Extra paths (e.g. /health) handled before the router. */
  healthHandler?: (ctx: Omit<RequestContext, 'params' | 'body'>) => Promise<HandlerResult> | HandlerResult;
}

export function createHttpServer(options: HttpServerOptions): Server {
  const { config, router, healthHandler } = options;
  const rateLimiter = new RateLimitStore(config.rateLimit.max, config.rateLimit.windowMs);
  const allowedOrigins = new Set(config.corsOrigins);

  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const started = Date.now();
    const ip = (req.socket.remoteAddress ?? 'unknown').split('::ffff:').join('');
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    res.setHeader('X-Request-Id', requestId);

    // CORS
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const respond = (result: HandlerResult): void => {
      const status = result.status ?? 200;
      const payload = result.raw ? result.body : envelope(result.body, result.envelopeOptions ?? { isDemo: false });
      const text = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        ...(result.headers ?? {}),
      });
      res.end(text);
      log.info('request', {
        requestId,
        method: req.method,
        path: pathname,
        status,
        durationMs: Date.now() - started,
        ip,
      });
    };

    try {
      if (pathname === '/health' || pathname === '/healthz' || pathname === '/api/health' || pathname === '/api/healthz') {
        const result = healthHandler
          ? await healthHandler({ req, res, method: req.method ?? 'GET', pathname, query: url.searchParams, requestId, ip })
          : { body: { status: 'ok' } };
        respond(result);
        return;
      }

      const limited = rateLimiter.check(ip);
      res.setHeader('X-RateLimit-Limit', String(config.rateLimit.max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limited.remaining)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(limited.resetAt / 1000)));
      if (!limited.allowed) {
        throw new AppError('RATE_LIMITED', `Rate limit exceeded — retry after ${Math.ceil((limited.resetAt - Date.now()) / 1000)}s`);
      }

      const matched = router.match(req.method ?? 'GET', pathname);
      if (!matched) {
        throw new AppError('NOT_FOUND', `No route for ${req.method} ${pathname}`, { routes: router.patterns });
      }

      const body = req.method === 'POST' ? await readBody(req) : undefined;
      const result = await matched.handler({
        req,
        res,
        method: req.method ?? 'GET',
        pathname,
        query: url.searchParams,
        params: matched.params,
        requestId,
        body,
        ip,
      });
      respond(result);
    } catch (err) {
      const appError = isAppError(err)
        ? err
        : new AppError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected server error');
      if (!isAppError(err)) {
        log.error('unhandled error', { requestId, path: pathname, error: err instanceof Error ? err.stack : String(err) });
      }
      const text = JSON.stringify({
        error: {
          code: appError.code,
          message: appError.message,
          requestId,
          ...(appError.details !== undefined ? { details: appError.details } : {}),
        },
      });
      res.writeHead(appError.status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
      log.warn('request failed', { requestId, method: req.method, path: pathname, status: appError.status, code: appError.code });
    }
  });
}

/** Asserts the admin bearer token when one is configured. */
export function requireAdmin(ctx: RequestContext, config: AppConfig): void {
  if (!config.adminToken) {
    throw new AppError('FORBIDDEN', 'Administrative endpoint is disabled — set ADMIN_TOKEN to enable it');
  }
  const header = ctx.req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== config.adminToken) {
    throw new AppError('UNAUTHORIZED', 'Missing or invalid admin token');
  }
}
