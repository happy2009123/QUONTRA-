/**
 * Provider registry: routing, failover, timeout handling, demo labelling and
 * configuration validation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config/env.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';
import { openDatabase } from '../src/db/db.ts';
import { RateLimiter } from '../src/providers/rateLimit.ts';
import { withRetry, withTimeout } from '../src/providers/retry.ts';
import type {
  HistoricalRequest,
  MarketDataProvider,
  ProviderBars,
  ProviderHealth,
  ProviderQuote,
  QuoteRequest,
} from '../src/providers/types.ts';

function demoConfig() {
  return loadConfig({ QUANTORA_PROVIDERS: 'demo' } as NodeJS.ProcessEnv);
}

/** Failing adapter used to prove failover. */
class FailingProvider implements MarketDataProvider {
  readonly id: string = 'failing';
  readonly name: string = 'Failing Adapter';
  readonly vendor = 'TEST';
  readonly isDemo = false;
  readonly capabilities = { historical: true, realtime: false, bidAsk: false, intervals: ['1D' as const] };
  readonly supportedMarkets = ['INDIAN_EQUITIES'];
  public calls = 0;

  async probe(): Promise<ProviderHealth> {
    return this.health();
  }

  health(): ProviderHealth {
    return {
      id: this.id,
      name: this.name,
      vendor: this.vendor,
      status: 'DISCONNECTED',
      latencyMs: 0,
      freshnessSeconds: 0,
      reliabilityPct: 0,
      isDemo: false,
      rateLimit: { used: 0, limit: 60, resetsAt: new Date().toISOString() },
      apiUsage: { requestsToday: 0, requestsMonth: 0, quotaPct: 0 },
      supportedMarkets: this.supportedMarkets,
    };
  }

  async getHistorical(_request: HistoricalRequest): Promise<ProviderBars> {
    this.calls += 1;
    throw new Error('upstream timeout');
  }

  async getQuotes(_requests: QuoteRequest[]): Promise<ProviderQuote[]> {
    throw new Error('upstream timeout');
  }
}

/** Adapter that reports success but returns no bars. */
class EmptyProvider extends FailingProvider {
  override readonly id = 'empty';
  override readonly name = 'Empty Adapter';

  override async getHistorical(): Promise<ProviderBars> {
    this.calls += 1;
    return { bars: [], source: { provider: this.name, origin: 'TEST', isDemo: false, reliability: 'VERIFIED' } };
  }
}

const instrument = { id: 'eq-reliance', market: 'INDIAN_EQUITIES', providerId: 'failing', providerSymbol: 'RELIANCE.NS' };

test('live adapter failure falls back to the next candidate (demo) and labels the source', async () => {
  const db = openDatabase({ path: ':memory:' });
  const registry = new ProviderRegistry(demoConfig(), db);
  const failing = new FailingProvider();
  registry.register(failing);

  const result = await registry.fetchHistorical(instrument, '1D', { limit: 10 });

  assert.ok(result.bars.length > 0, 'failover must return data from the demo adapter');
  assert.equal(result.source.isDemo, true, 'fallback data is labelled as demo');
  assert.equal(result.source.reliability, 'PROVISIONAL');
  assert.equal(failing.calls, 1, 'the failing adapter was attempted first');
  db.close();
});

test('an empty series from a live adapter is treated as failure, not data', async () => {
  const db = openDatabase({ path: ':memory:' });
  const registry = new ProviderRegistry(demoConfig(), db);
  const empty = new EmptyProvider();
  registry.register(empty);

  const result = await registry.fetchHistorical(instrument, '1D', { limit: 10 });
  assert.ok(result.bars.length > 0);
  assert.equal(result.source.isDemo, true);
  assert.equal(empty.calls, 1);
  db.close();
});

test('when every adapter fails the registry reports PROVIDER_UNAVAILABLE with per-provider errors', async () => {
  const db = openDatabase({ path: ':memory:' });
  // All built-in adapters disabled so only the two fakes below are candidates.
  const config = loadConfig({ QUANTORA_PROVIDERS: 'demo', DEMO_PROVIDER_ENABLED: 'false' } as NodeJS.ProcessEnv);
  const registry = new ProviderRegistry(config, db);
  registry.register(new FailingProvider());
  registry.register(new EmptyProvider());

  await assert.rejects(
    () => registry.fetchHistorical(instrument, '1D', { limit: 10 }),
    (err: unknown) => {
      const e = err as { code?: string; message?: string; details?: { errors?: string[] } };
      assert.equal(e.code, 'PROVIDER_UNAVAILABLE');
      assert.ok(e.message?.includes('eq-reliance'));
      assert.ok((e.details?.errors ?? []).some((x) => x.includes('timeout')), 'errors must name the failure');
      return true;
    },
  );
  db.close();
});

test('withTimeout rejects a hung adapter and withRetry retries before succeeding', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20, 'historical fetch'),
    /timed out after 20ms/,
  );

  let attempts = 0;
  const value = await withRetry(
    async (attempt) => {
      attempts += 1;
      if (attempt < 3) throw new Error('transient');
      return 'ok';
    },
    { retries: 3, baseDelayMs: 1 },
  );
  assert.equal(value, 'ok');
  assert.equal(attempts, 4, 'initial try plus three retries');
});

test('rate limiter hands out capacity then reports usage', async () => {
  let now = Date.now();
  const limiter = new RateLimiter(60, () => now);
  assert.equal(limiter.limit, 60);
  assert.equal(limiter.used, 0);
  await limiter.acquire();
  await limiter.acquire();
  assert.equal(limiter.used, 2);
  assert.ok(new Date(limiter.resetsAt).getTime() > now);
  now += 60_000; // window rolls over
  await limiter.acquire();
  assert.equal(limiter.used, 1, 'window counter resets after 60s');
});

test('configuration validation rejects malformed environment input', () => {
  assert.throws(() => loadConfig({ QUANTORA_PROVIDERS: 'not-a-provider' } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => loadConfig({ RATE_LIMIT_MAX: '0' } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => loadConfig({ PORT: 'abc' } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' } as NodeJS.ProcessEnv), ConfigError);

  const ok = loadConfig({ QUANTORA_PROVIDERS: 'demo,yahoo' } as NodeJS.ProcessEnv);
  assert.deepEqual(ok.providers.enabled, ['demo', 'yahoo']);
});
