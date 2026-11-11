/**
 * Environment configuration for the QUANTORA backend.
 * All secrets and tunables come from process.env — nothing is hardcoded here.
 */

export type EnvName = 'development' | 'production' | 'test';

export interface ProviderHttpConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  /** Requests permitted per minute (rate-limit handling for the adapter). */
  ratePerMinute: number;
  maxRetries: number;
}

export interface AppConfig {
  env: EnvName;
  host: string;
  port: number;
  dbPath: string;
  adminToken?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  corsOrigins: string[];
  rateLimit: { windowMs: number; max: number };
  quoteCacheTtlMs: number;
  providers: {
    /** Ordered preference list of provider ids used for routing. */
    enabled: string[];
    demo: { enabled: boolean };
    yahoo: ProviderHttpConfig;
    binance: ProviderHttpConfig;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const raw = env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max} (received ${raw})`);
  }
  return value;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new ConfigError(`${key} must be a boolean (received ${raw})`);
}

function oneOf<T extends string>(env: NodeJS.ProcessEnv, key: string, allowed: readonly T[], fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ConfigError(`${key} must be one of ${allowed.join(', ')} (received ${raw})`);
  }
  return raw as T;
}

function providerHttp(
  env: NodeJS.ProcessEnv,
  id: 'yahoo' | 'binance',
  defaults: { baseUrl: string; timeoutMs: number; ratePerMinute: number; maxRetries: number },
): ProviderHttpConfig {
  const prefix = id.toUpperCase();
  return {
    enabled: bool(env, `${prefix}_ENABLED`, true),
    baseUrl: str(env, `${prefix}_BASE_URL`, defaults.baseUrl),
    apiKey: env[`${prefix}_API_KEY`] || undefined,
    timeoutMs: int(env, `${prefix}_TIMEOUT_MS`, defaults.timeoutMs, 500, 60_000),
    ratePerMinute: int(env, `${prefix}_RATE_PER_MIN`, defaults.ratePerMinute, 1, 12_000),
    maxRetries: int(env, `${prefix}_MAX_RETRIES`, defaults.maxRetries, 0, 8),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawProviders = str(env, 'QUANTORA_PROVIDERS', 'demo,yahoo,binance');
  const enabled = rawProviders
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const known = ['demo', 'yahoo', 'binance'];
  for (const p of enabled) {
    if (!known.includes(p)) throw new ConfigError(`QUANTORA_PROVIDERS contains unknown provider "${p}"`);
  }

  const rawOrigins = str(env, 'CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173');
  const corsOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

  const envName = oneOf(env, 'NODE_ENV', ['development', 'production', 'test'] as const, 'development');

  return {
    env: envName,
    host: str(env, 'HOST', '127.0.0.1'),
    port: int(env, 'PORT', 8080, 1, 65_535),
    dbPath: str(env, 'QUANTORA_DB', envName === 'test' ? ':memory:' : 'data/quantora.db'),
    adminToken: env.ADMIN_TOKEN || undefined,
    logLevel: oneOf(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    corsOrigins,
    rateLimit: {
      windowMs: int(env, 'RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
      max: int(env, 'RATE_LIMIT_MAX', 300, 1, 100_000),
    },
    quoteCacheTtlMs: int(env, 'QUOTE_CACHE_TTL_MS', 60_000, 1_000, 3_600_000),
    providers: {
      enabled,
      demo: { enabled: bool(env, 'DEMO_PROVIDER_ENABLED', true) },
      yahoo: providerHttp(env, 'yahoo', {
        baseUrl: 'https://query1.finance.yahoo.com',
        timeoutMs: 8_000,
        ratePerMinute: 120,
        maxRetries: 2,
      }),
      binance: providerHttp(env, 'binance', {
        baseUrl: 'https://api.binance.com',
        timeoutMs: 6_000,
        ratePerMinute: 600,
        maxRetries: 2,
      }),
    },
  };
}

let cached: AppConfig | undefined;

/** Process-wide configuration singleton. */
export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper — forces the next `config()` call to re-read env. */
export function resetConfigCache(): void {
  cached = undefined;
}
