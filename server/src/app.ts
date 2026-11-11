/** Application composition root: config → database → providers → HTTP. */

import { loadConfig, type AppConfig } from './config/env.ts';
import { openDatabase, type Db } from './db/db.ts';
import { seedReferenceData } from './seed.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { buildRouter } from './api/routes.ts';
import { createHttpServer, type Router } from './api/http.ts';
import { setLogLevel, log } from './lib/logger.ts';
import { generateOpportunities } from './services/opportunities.ts';
import type { Server } from 'node:http';

export interface CreateAppOptions {
  /** Pre-loaded configuration (defaults to process.env). */
  config?: AppConfig;
  /** Reuse an existing database (tests). */
  db?: Db;
  /** Run provider probes during startup (default true). */
  probe?: boolean;
  /** Seed reference data (default true). */
  seed?: boolean;
  /** Generate the first opportunity set on boot (default true). */
  generateOpportunities?: boolean;
}

export interface QuantoraApp {
  config: AppConfig;
  db: Db;
  registry: ProviderRegistry;
  router: Router;
  server: Server;
  /** Starts listening; resolves with the bound port. */
  listen(port?: number, host?: string): Promise<number>;
  /** Closes the HTTP server and database connection. */
  close(): Promise<void>;
}

export async function createApp(options: CreateAppOptions = {}): Promise<QuantoraApp> {
  const config = options.config ?? loadConfig();
  setLogLevel(config.logLevel);

  const db = options.db ?? openDatabase({ path: config.dbPath });
  if (options.seed !== false) seedReferenceData(db);

  const registry = new ProviderRegistry(config, db);
  const router = buildRouter({ db, registry, config });
  const server = createHttpServer({
    config,
    router,
    healthHandler: async () => {
      const health = registry.healthSnapshot();
      const migrations = (db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
      const instruments = (db.prepare('SELECT COUNT(*) AS c FROM instruments WHERE is_active = 1').get() as { c: number }).c;
      const candles = (db.prepare('SELECT COUNT(*) AS c FROM candles').get() as { c: number }).c;
      const degraded = health.some((h) => h.status === 'DISCONNECTED');
      return {
        status: degraded ? 200 : 200,
        body: {
          status: degraded ? 'degraded' : 'ok',
          service: 'quantora-backend',
          version: '0.2.0',
          schemaVersion: migrations,
          uptimeSeconds: Math.round(process.uptime()),
          checks: {
            database: 'ok',
            instruments,
            candles,
            providers: health.map((h) => ({ id: h.id, status: h.status, isDemo: h.isDemo })),
          },
          generatedAt: new Date().toISOString(),
        },
        raw: true,
      };
    },
  });

  if (options.probe !== false) {
    // Health probes run in the background so startup stays fast; the first
    // /api/data-health call can also force a synchronous refresh.
    void registry
      .probeAll()
      .then((results) => log.info('provider probe complete', { providers: results.map((r) => ({ id: r.id, status: r.status })) }))
      .catch((err: unknown) => log.warn('provider probe failed', { error: err instanceof Error ? err.message : String(err) }));
  }

  // First-boot opportunity generation so /api/opportunities and the daily
  // report have real rows without an admin call. Demo providers are local and
  // fast → awaited before listen; live providers are rate-limited → background.
  if (options.generateOpportunities !== false) {
    const job = generateOpportunities(db, registry, { minScore: 60, limit: 50, ingestLimit: 60 })
      .then((result) => {
        log.info('startup opportunity generation complete', { scanned: result.scanned, stored: result.stored });
        return result;
      })
      .catch((err: unknown) => {
        log.warn('startup opportunity generation failed', { error: err instanceof Error ? err.message : String(err) });
        return null;
      });
    if (config.providers.enabled.every((id) => id === 'demo')) await job;
    else void job;
  }

  return {
    config,
    db,
    registry,
    router,
    server,
    listen(port = config.port, host = config.host): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          const boundPort = typeof address === 'object' && address ? address.port : port;
          log.info('server listening', { url: `http://${host}:${boundPort}`, env: config.env });
          resolve(boundPort);
        });
      });
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}
