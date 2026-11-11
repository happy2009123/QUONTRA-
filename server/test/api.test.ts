/**
 * HTTP API integration tests: envelope contract, pagination, validation,
 * error codes, admin auth and rate limiting.
 *
 * Uses a real in-memory database with the demo provider — no network.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, type QuantoraApp } from '../src/app.ts';
import { loadConfig } from '../src/config/env.ts';

interface Started {
  app: QuantoraApp;
  base: string;
}

async function startApp(env: Record<string, string> = {}): Promise<Started> {
  const config = loadConfig({
    QUANTORA_PROVIDERS: 'demo',
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    QUANTORA_DB: ':memory:',
    ADMIN_TOKEN: 'test-admin-token',
    RATE_LIMIT_MAX: '100000',
    ...env,
  } as NodeJS.ProcessEnv);
  const app = await createApp({ config, probe: false, generateOpportunities: false });
  const port = await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${port}` };
}

async function get(base: string, path: string): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(base + path);
  return { status: res.status, json: await res.json(), headers: res.headers };
}

async function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json(), headers: res.headers };
}

function assertEnvelope(payload: any): void {
  assert.ok(payload && typeof payload === 'object', 'payload must be an object');
  assert.ok('data' in payload, 'envelope must expose data');
  assert.ok(typeof payload.fetchedAt === 'string' && Number.isFinite(Date.parse(payload.fetchedAt)), 'fetchedAt must be ISO');
  assert.equal(typeof payload.isDemo, 'boolean', 'isDemo must be a boolean');
}

let started: Started;

before(async () => {
  started = await startApp();
});

after(async () => {
  await started.app.close();
});

test('GET /api/health reports service, schema and provider checks', async () => {
  const { status, json } = await get(started.base, '/api/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.equal(json.service, 'quantora-backend');
  assert.ok(json.schemaVersion >= 1);
  assert.ok(Array.isArray(json.checks.providers));
  assert.ok(json.checks.instruments > 0, 'seeded instruments are visible');
});

test('GET /api/markets returns the envelope with session metadata', async () => {
  const { status, json } = await get(started.base, '/api/markets');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.ok(Array.isArray(json.data) && json.data.length >= 5);
  const crypto = json.data.find((m: any) => m.id === 'mkt-crypto');
  assert.ok(crypto, 'crypto market is seeded');
  assert.ok(crypto.status === 'OPEN' || crypto.status === 'CLOSED');
});

test('GET /api/instruments paginates and filters', async () => {
  const page1 = await get(started.base, '/api/instruments?limit=5&offset=0');
  assert.equal(page1.status, 200);
  assertEnvelope(page1.json);
  assert.equal(page1.json.data.items.length, 5);
  assert.ok(page1.json.data.total > 20);
  assert.equal(page1.json.meta.limit, 5);

  const page2 = await get(started.base, '/api/instruments?limit=5&offset=5');
  const ids1 = page1.json.data.items.map((i: any) => i.id);
  const ids2 = page2.json.data.items.map((i: any) => i.id);
  assert.equal(ids1.filter((id: string) => ids2.includes(id)).length, 0, 'pages must not overlap');

  const search = await get(started.base, '/api/instruments?search=RELIANCE');
  assert.ok(search.json.data.items.some((i: any) => i.symbol === 'RELIANCE'));

  const sector = await get(started.base, '/api/instruments?sector=Information%20Technology&limit=50');
  assert.ok(sector.json.data.items.every((i: any) => i.sector === 'Information Technology'));
});

test('validation failures return 400 with structured issues', async () => {
  const badLimit = await get(started.base, '/api/instruments?limit=9999');
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.json.error.code, 'VALIDATION_ERROR');
  assert.ok(badLimit.json.error.requestId, 'errors carry a requestId');
  assert.equal(badLimit.json.error.details.issues[0].field, 'limit');

  const badTimeframe = await get(started.base, '/api/candles?instrumentId=eq-reliance&timeframe=2X');
  assert.equal(badTimeframe.status, 400);
  assert.equal(badTimeframe.json.error.details.issues[0].field, 'timeframe');

  const missingParam = await get(started.base, '/api/candles?timeframe=1D');
  assert.equal(missingParam.status, 400);
  assert.equal(missingParam.json.error.details.issues[0].field, 'instrumentId');
});

test('unknown routes and resources return 404 NOT_FOUND', async () => {
  const route = await get(started.base, '/api/nope');
  assert.equal(route.status, 404);
  assert.equal(route.json.error.code, 'NOT_FOUND');
  assert.ok(Array.isArray(route.json.error.details.routes), '404 lists available routes');

  const instrument = await get(started.base, '/api/candles?instrumentId=does-not-exist&timeframe=1D');
  assert.equal(instrument.status, 404);
  assert.equal(instrument.json.error.code, 'NOT_FOUND');
});

test('GET /api/candles returns provenance, demo labelling and a disclaimer', async () => {
  const { status, json } = await get(started.base, '/api/candles?instrumentId=eq-reliance&timeframe=1D&limit=5');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.equal(json.data.candles.length, 5);
  assert.equal(json.data.meta.instrumentId, 'eq-reliance');
  assert.equal(json.data.meta.isDemo, true, 'demo adapter output is labelled');
  assert.equal(json.data.meta.source.isDemo, true);
  assert.ok(json.meta.disclaimer.includes('DEMO'));
  for (const candle of json.data.candles) {
    assert.ok(Number.isFinite(candle.time) && Number.isFinite(candle.close));
    assert.ok(candle.high >= candle.low);
  }
});

test('GET /api/indicators computes on completed candles only', async () => {
  const { status, json } = await get(started.base, '/api/indicators?instrumentId=eq-reliance&timeframe=1D&indicators=RSI,MACD,ATR');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.ok(json.data.indicators.RSI.length > 0, 'RSI needs warm-up history, which the route ingests');
  assert.ok(json.data.indicators.MACD.length > 0);
  assert.ok(json.data.note.includes('completed candles'));
  assert.equal(json.data.isDemo, true);
});

test('GET /api/scanner returns scored rows with a transparent breakdown', async () => {
  const { status, json } = await get(started.base, '/api/scanner?minScore=0&limit=10');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.ok(json.data.rows.length > 0);
  const row = json.data.rows[0];
  assert.ok(row.score >= 0 && row.score <= 100);
  const breakdown = row.scoreBreakdown;
  const sum = breakdown.trend + breakdown.momentum + breakdown.volume + breakdown.volatility + breakdown.structure;
  assert.equal(sum, row.score, 'score is the sum of its labelled parts');
  assert.ok(['BUY', 'SELL', 'WATCH', 'NO_TRADE'].includes(row.signal));
  assert.ok(json.data.timeframe === '1h');
});

test('GET /api/opportunities is empty-safe and carries the score disclaimer', async () => {
  const { status, json } = await get(started.base, '/api/opportunities?limit=5');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.ok(Array.isArray(json.data.items));
  assert.ok(json.meta.disclaimer.includes('NOT a win probability'));
});

test('GET /api/reports produces a dated report', async () => {
  const { status, json } = await get(started.base, '/api/reports');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.match(json.data.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof json.data.noQualifiedSetups, 'boolean');
  assert.ok(Array.isArray(json.data.opportunities));
  assert.ok(typeof json.data.regimeSummary === 'string' && json.data.regimeSummary.length > 0);

  const history = await get(started.base, '/api/reports?history=true&limit=5');
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.json.data.items));
});

test('GET /api/strategies exposes entry/exit conditions', async () => {
  const { status, json } = await get(started.base, '/api/strategies');
  assert.equal(status, 200);
  assertEnvelope(json);
  assert.ok(json.data.length >= 5);
  for (const strategy of json.data) {
    assert.ok(strategy.id && strategy.name && strategy.family);
    assert.ok(Array.isArray(strategy.entryConditions) && strategy.entryConditions.length > 0);
    assert.ok(strategy.disclaimer.includes('not trade recommendations'));
  }
});

test('GET /api/backtests and /api/data-health return their documented shapes', async () => {
  const backtests = await get(started.base, '/api/backtests');
  assert.equal(backtests.status, 200);
  assertEnvelope(backtests.json);
  assert.ok(Array.isArray(backtests.json.data.items));
  assert.equal(backtests.json.meta.simulated, true);

  const health = await get(started.base, '/api/data-health');
  assert.equal(health.status, 200);
  assertEnvelope(health.json);
  assert.ok(Array.isArray(health.json.data.providers));
  assert.ok(health.json.data.providers.some((p: any) => p.id === 'demo'));
  assert.ok(Array.isArray(health.json.data.issues));
});

test('admin endpoints require the bearer token', async () => {
  const noToken = await post(started.base, '/api/admin/probe', {});
  assert.equal(noToken.status, 401);
  assert.equal(noToken.json.error.code, 'UNAUTHORIZED');

  const badToken = await post(started.base, '/api/admin/probe', {}, { Authorization: 'Bearer nope' });
  assert.equal(badToken.status, 401);

  const good = await post(started.base, '/api/admin/probe', {}, { Authorization: 'Bearer test-admin-token' });
  assert.equal(good.status, 201);
  assertEnvelope(good.json);
  assert.ok(good.json.data.some((p: any) => p.id === 'demo'));
});

test('POST /api/risk/position-size computes and validates', async () => {
  const ok = await post(started.base, '/api/risk/position-size', {
    accountBalance: 1_000_000,
    riskPerTradePct: 1,
    entryPrice: 2_500,
    stopPrice: 2_450,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.riskAmount, 10_000);
  assert.equal(ok.json.data.riskPerUnit, 50);
  assert.equal(ok.json.data.positionSize, 200);
  assert.equal(ok.json.data.validation, 'OK');

  const missing = await post(started.base, '/api/risk/position-size', { entryPrice: 2_500 });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error.code, 'VALIDATION_ERROR');
  const fields = missing.json.error.details.issues.map((i: any) => i.field);
  assert.ok(fields.includes('accountBalance'));
  assert.ok(fields.includes('stopPrice'));
});

test('POST /api/backtests runs a simulated backtest and stores it', async () => {
  const created = await post(
    started.base,
    '/api/backtests',
    { strategyId: 'str-ema-pullback', instrumentIds: ['eq-reliance'], from: '2026-06-01', to: '2026-11-01' },
    { Authorization: 'Bearer test-admin-token' },
  );
  assert.equal(created.status, 201);
  assert.equal(created.json.data.stored, true);
  assert.equal(created.json.data.isSimulated, true);
  assert.ok(created.json.data.metrics.tradeCount >= 0);
  assert.ok(created.json.data.warnings.some((w: string) => w.includes('Simulated')));

  const list = await get(started.base, '/api/backtests');
  assert.ok(list.json.data.total >= 1);
  const detail = await get(started.base, `/api/backtests/${created.json.data.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.id, created.json.data.id);

  const missing = await get(started.base, '/api/backtests/unknown-id');
  assert.equal(missing.status, 404);
});

test('CORS preflight honours configured origins', async () => {
  const res = await fetch(started.base + '/api/markets', {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
  assert.ok(res.headers.get('access-control-allow-methods')?.includes('GET'));

  const disallowed = await fetch(started.base + '/api/markets', {
    method: 'OPTIONS',
    headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(disallowed.headers.get('access-control-allow-origin'), null, 'unknown origins get no CORS grant');
});

test('rate limiting returns 429 with reset headers', async () => {
  const limited = await startApp({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(limited.base + '/api/markets');
      statuses.push(res.status);
      if (i === 0) {
        assert.equal(res.headers.get('x-ratelimit-limit'), '3');
        assert.equal(res.headers.get('x-ratelimit-remaining'), '2');
      }
      const body = (await res.json()) as any;
      if (res.status === 429) {
        assert.equal(body.error.code, 'RATE_LIMITED');
        assert.ok(body.error.message.includes('Rate limit exceeded'));
      }
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  } finally {
    await limited.app.close();
  }
});

test('admin endpoints are disabled when no ADMIN_TOKEN is configured', async () => {
  const noAdmin = await startApp({ ADMIN_TOKEN: '' });
  try {
    const res = await post(noAdmin.base, '/api/admin/probe', {});
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'FORBIDDEN');
    assert.ok(res.json.error.message.includes('ADMIN_TOKEN'));
  } finally {
    await noAdmin.app.close();
  }
});
