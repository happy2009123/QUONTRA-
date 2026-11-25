/**
 * Read-only system overview for the admin console.
 * Never returns secret values — only whether they are configured.
 */

import { DEV_SESSION_SECRET, type AppConfig } from '../config/env.ts';
import type { Db } from '../db/db.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderHealth } from '../providers/types.ts';
import { SCHEMA_VERSION } from '../db/schema.ts';
import { SESSION_COOKIE, SESSION_TTL_SEC } from '../auth/auth.ts';

const SERVICE_NAME = 'quantora-backend';
const SERVICE_VERSION = '0.2.0';

export interface AdminOverview {
  service: {
    name: string;
    version: string;
    env: string;
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    startedAt: string;
  };
  schema: {
    version: number;
    applied: Array<{ version: number; appliedAt: string }>;
  };
  database: {
    path: string;
    counts: Record<string, number>;
  };
  security: {
    cookieName: string;
    sessionTtlDays: number;
    sessionSecret: 'SET' | 'DEV_DEFAULT';
    adminTokenConfigured: boolean;
    corsOrigins: string[];
    rateLimit: { windowMs: number; max: number };
  };
  config: {
    logLevel: string;
    quoteCacheTtlMs: number;
    providers: {
      enabled: string[];
      demoEnabled: boolean;
      yahoo: { enabled: boolean; ratePerMinute: number; apiKeyConfigured: boolean };
      binance: { enabled: boolean; ratePerMinute: number; apiKeyConfigured: boolean };
    };
  };
  providers: ProviderHealth[];
  routes: string[];
  users: Array<{ email: string; displayName: string | null; createdAt: string; lastLoginAt: string | null }>;
  recentLogs: Array<{ id: number; ts: string; level: string; source: string; message: string }>;
}

interface DbCounts {
  instruments: number;
  candles: number;
  quotes: number;
  strategies: number;
  opportunities: number;
  backtests: number;
  users: number;
  paperAccounts: number;
  paperOrders: number;
  paperPositions: number;
  paperTrades: number;
  paperTransactions: number;
  systemLogs: number;
}

export function getAdminOverview(deps: { db: Db; registry: ProviderRegistry; config: AppConfig; routes: string[] }): AdminOverview {
  const { db, registry, config, routes } = deps;

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM instruments) AS instruments,
         (SELECT COUNT(*) FROM candles) AS candles,
         (SELECT COUNT(*) FROM quotes) AS quotes,
         (SELECT COUNT(*) FROM strategies) AS strategies,
         (SELECT COUNT(*) FROM opportunities) AS opportunities,
         (SELECT COUNT(*) FROM backtest_results) AS backtests,
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM paper_accounts) AS paperAccounts,
         (SELECT COUNT(*) FROM paper_orders) AS paperOrders,
         (SELECT COUNT(*) FROM paper_positions) AS paperPositions,
         (SELECT COUNT(*) FROM paper_trades) AS paperTrades,
         (SELECT COUNT(*) FROM paper_transactions) AS paperTransactions,
         (SELECT COUNT(*) FROM system_logs) AS systemLogs`,
    )
    .get() as unknown as DbCounts;

  const migrations = db
    .prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version')
    .all() as unknown as Array<{ version: number; applied_at: string }>;

  const users = db
    .prepare('SELECT id, display_name, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT 200')
    .all() as unknown as Array<{ id: string; display_name: string | null; created_at: string; last_login_at: string | null }>;

  const recentLogs = db
    .prepare('SELECT id, ts, level, source, message FROM system_logs ORDER BY id DESC LIMIT 25')
    .all() as unknown as Array<{ id: number; ts: string; level: string; source: string; message: string }>;

  return {
    service: {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      env: config.env,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptimeSeconds: Math.max(0, Math.round(process.uptime())),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    },
    schema: {
      version: SCHEMA_VERSION,
      applied: migrations.map((m) => ({ version: m.version, appliedAt: m.applied_at })),
    },
    database: {
      path: config.dbPath,
      counts: { ...counts },
    },
    security: {
      cookieName: SESSION_COOKIE,
      sessionTtlDays: Math.round(SESSION_TTL_SEC / 86_400),
      sessionSecret: config.sessionSecret === DEV_SESSION_SECRET ? 'DEV_DEFAULT' : 'SET',
      adminTokenConfigured: Boolean(config.adminToken),
      corsOrigins: config.corsOrigins,
      rateLimit: { windowMs: config.rateLimit.windowMs, max: config.rateLimit.max },
    },
    config: {
      logLevel: config.logLevel,
      quoteCacheTtlMs: config.quoteCacheTtlMs,
      providers: {
        enabled: config.providers.enabled,
        demoEnabled: config.providers.demo.enabled,
        yahoo: {
          enabled: config.providers.yahoo.enabled,
          ratePerMinute: config.providers.yahoo.ratePerMinute,
          apiKeyConfigured: Boolean(config.providers.yahoo.apiKey),
        },
        binance: {
          enabled: config.providers.binance.enabled,
          ratePerMinute: config.providers.binance.ratePerMinute,
          apiKeyConfigured: Boolean(config.providers.binance.apiKey),
        },
      },
    },
    providers: registry.healthSnapshot(),
    routes,
    users: users.map((u) => ({
      email: u.id,
      displayName: u.display_name,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
    })),
    recentLogs: recentLogs.map((l) => ({
      id: l.id,
      ts: l.ts,
      level: l.level,
      source: l.source,
      message: l.message,
    })),
  };
}
