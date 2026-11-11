/**
 * API route table — the documented QUANTORA HTTP surface.
 *
 * GET  /api/markets        market reference data + session status
 * GET  /api/instruments    paginated instrument catalogue
 * GET  /api/quotes         latest quotes (cached, provider-backed)
 * GET  /api/candles        historical OHLCV with provenance
 * GET  /api/indicators     computed indicators on completed candles
 * GET  /api/scanner        ranked scan with transparent scoring
 * GET  /api/opportunities  generated opportunities with source + timestamp
 * GET  /api/reports        daily opportunity report (stored or generated)
 * GET  /api/strategies     strategy catalogue with conditions
 * GET  /api/backtests      stored backtests (+ POST to run one)
 * GET  /api/data-health    provider health, issues and coverage
 *
 * Admin operations (require Authorization: Bearer ADMIN_TOKEN):
 * POST /api/admin/opportunities/generate
 * POST /api/admin/reports/generate
 * POST /api/admin/backtests
 * POST /api/admin/probe
 *
 * Every response uses the { data, fetchedAt, isDemo } envelope.
 */

import type { AppConfig } from '../config/env.ts';
import type { Db } from '../db/db.ts';
import { listStrategies, listConditions, listBacktests, getStrategy } from '../db/repoOps.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { Router, envelope, requireAdmin, type HandlerResult, type RequestContext } from './http.ts';
import { AppError } from '../lib/errors.ts';
import { SUPPORTED_TIMEFRAMES, type Timeframe } from '../lib/time.ts';
import { queryValidator } from '../lib/validate.ts';
import {
  getDataHealthApi,
  getCandlesApi,
  getIndicatorsApi,
  getQuotesApi,
  listInstrumentsApi,
  listMarketsApi,
} from '../services/marketDataService.ts';
import { scan } from '../services/scanner.ts';
import { generateOpportunities, listOpportunitiesApi, SCORE_DISCLAIMER } from '../services/opportunities.ts';
import { generateDailyReport, listReportHistory } from '../services/reports.ts';
import { runBacktest, listStoredBacktests, getStoredBacktest, compareStrategies, type CostModel } from '../services/backtest.ts';
import { sizePosition, riskReward, portfolioMetrics, recordCalculation } from '../services/risk.ts';
import { insertSystemLog } from '../db/repoOps.ts';
import type { IndicatorName } from '../services/indicators.ts';

export interface RouterDeps {
  db: Db;
  registry: ProviderRegistry;
  config: AppConfig;
}

const INDICATOR_NAMES: IndicatorName[] = ['RSI', 'MACD', 'EMA', 'SMA', 'VWAP', 'ATR', 'ADX', 'BOLLINGER', 'VOLUME', 'SUPPORT_RESISTANCE'];

function ok(body: unknown, envelopeOptions?: { isDemo?: boolean; meta?: unknown }): HandlerResult {
  return { body, envelopeOptions };
}

export function buildRouter(deps: RouterDeps): Router {
  const { db, registry, config } = deps;
  const router = new Router();

  // ── Markets ────────────────────────────────────────────────────────────
  router.get('/api/markets', () => {
    const markets = listMarketsApi(db);
    return ok(markets, { isDemo: false, meta: { count: markets.length } });
  });

  // ── Instruments ────────────────────────────────────────────────────────
  router.get('/api/instruments', (ctx) => {
    const v = queryValidator(ctx.query);
    const search = v.string('search', { maxLength: 120 });
    const market = v.enum('market', ['ALL', 'INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER', 'CRYPTO'] as const);
    const sector = v.string('sector', { maxLength: 80 });
    const exchange = v.string('exchange', { maxLength: 20 });
    const limit = v.int('limit', { min: 1, max: 200, fallback: 50 });
    const offset = v.int('offset', { min: 0, max: 100_000, fallback: 0 });
    v.throwIfInvalid();

    const page = listInstrumentsApi(db, { search, market, sector, exchange, limit, offset });
    return ok(page, { meta: { limit: page.limit, offset: page.offset, total: page.total } });
  });

  // ── Quotes ─────────────────────────────────────────────────────────────
  router.get('/api/quotes', async (ctx) => {
    const v = queryValidator(ctx.query);
    const ids = v.list('ids', { maxItems: 200, itemPattern: /^[a-zA-Z0-9._-]+$/ });
    v.throwIfInvalid();

    const quotes = await getQuotesApi(db, registry, config, ids);
    const allDemo = quotes.length > 0 && quotes.every((q) => q.quote.source.isDemo);
    return ok(quotes, {
      isDemo: allDemo,
      meta: { count: quotes.length, missing: ids ? ids.length - quotes.length : 0, staleAfterSeconds: Math.round(config.quoteCacheTtlMs / 1000) },
    });
  });

  // ── Candles ────────────────────────────────────────────────────────────
  router.get('/api/candles', async (ctx) => {
    const v = queryValidator(ctx.query);
    const instrumentId = v.string('instrumentId', { required: true, maxLength: 64, pattern: /^[a-zA-Z0-9._-]+$/, patternMessage: 'must be a valid instrument id' });
    const timeframe = v.enum('timeframe', SUPPORTED_TIMEFRAMES, { required: true });
    const limit = v.int('limit', { min: 1, max: 2000, fallback: 500 });
    const from = v.int('from', { min: 0, max: 4_102_444_800 });
    const to = v.int('to', { min: 0, max: 4_102_444_800 });
    const refresh = v.boolean('refresh', { fallback: false });
    v.throwIfInvalid();
    if (from !== undefined && to !== undefined && from > to) {
      throw new AppError('VALIDATION_ERROR', 'from must be <= to');
    }

    const result = await getCandlesApi(db, registry, instrumentId!, timeframe as Timeframe, { limit, from, to, refresh });
    return ok(result, {
      isDemo: result.meta.isDemo,
      meta: { ...result.meta, disclaimer: 'Prices carry source and freshness labels. Demo values are marked DEMO and are not market data.' },
    });
  });

  // ── Indicators ─────────────────────────────────────────────────────────
  router.get('/api/indicators', async (ctx) => {
    const v = queryValidator(ctx.query);
    const instrumentId = v.string('instrumentId', { required: true, maxLength: 64, pattern: /^[a-zA-Z0-9._-]+$/ });
    const timeframe = v.enum('timeframe', SUPPORTED_TIMEFRAMES, { required: true });
    const requested = v.list('indicators', { maxItems: 10, itemPattern: /^[A-Z_]+$/ });
    v.throwIfInvalid();

    const names = (requested && requested.length > 0 ? requested : ['RSI', 'MACD', 'EMA', 'ATR'] as string[]).map((n) => {
      if (!(INDICATOR_NAMES as string[]).includes(n)) {
        throw new AppError('VALIDATION_ERROR', `Unknown indicator "${n}"`, {
          issues: [{ field: 'indicators', message: `must be one of: ${INDICATOR_NAMES.join(', ')}` }],
        });
      }
      return n as IndicatorName;
    });

    // Indicators need warm-up history — ingest if the store is too thin.
    const stored = db
      .prepare('SELECT COUNT(*) AS c FROM candles WHERE instrument_id = ? AND timeframe = ?')
      .get(instrumentId!, timeframe!) as { c: number };
    if (stored.c < 60) {
      await getCandlesApi(db, registry, instrumentId!, timeframe as Timeframe, { limit: 400 });
    }

    const result = getIndicatorsApi(db, instrumentId!, timeframe as Timeframe, names);
    return ok(result, { isDemo: result.isDemo, meta: { note: result.note, computedAt: result.computedAt } });
  });

  // ── Scanner ────────────────────────────────────────────────────────────
  router.get('/api/scanner', async (ctx) => {
    const v = queryValidator(ctx.query);
    const market = v.enum('market', ['ALL', 'INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER'] as const);
    const sector = v.string('sector', { maxLength: 80 });
    const search = v.string('search', { maxLength: 120 });
    const minScore = v.int('minScore', { min: 0, max: 100 });
    const signal = v.enum('signal', ['ALL', 'BUY', 'SELL', 'WATCH'] as const, { fallback: 'ALL' });
    const volatility = v.enum('volatility', ['ALL', 'LOW', 'NORMAL', 'ELEVATED', 'EXTREME'] as const, { fallback: 'ALL' });
    const liquidity = v.enum('liquidity', ['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const, { fallback: 'ALL' });
    const limit = v.int('limit', { min: 1, max: 200, fallback: 50 });
    const offset = v.int('offset', { min: 0, max: 10_000, fallback: 0 });
    v.throwIfInvalid();

    const result = await scan(db, registry, {
      market: market === 'ALL' ? undefined : market,
      sector,
      search,
      minScore,
      signal,
      volatility,
      liquidity,
      limit,
      offset,
    });

    const allDemo = result.rows.length > 0 && result.rows.every((r) => r.source.isDemo);
    return ok(result, {
      isDemo: allDemo,
      meta: { total: result.total, scanned: result.scanned, ingested: result.ingested, timeframe: result.timeframe },
    });
  });

  // ── Opportunities ──────────────────────────────────────────────────────
  router.get('/api/opportunities', (ctx) => {
    const v = queryValidator(ctx.query);
    const market = v.enum('market', ['ALL', 'INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER'] as const);
    const minScore = v.int('minScore', { min: 0, max: 100 });
    const signal = v.enum('signal', ['BUY', 'SELL', 'WATCH'] as const);
    const limit = v.int('limit', { min: 1, max: 100, fallback: 20 });
    const offset = v.int('offset', { min: 0, max: 10_000, fallback: 0 });
    v.throwIfInvalid();

    const result = listOpportunitiesApi(db, {
      market: market === 'ALL' ? undefined : market,
      minScore,
      signal,
      limit,
      offset,
    });
    const allDemo = result.items.length > 0 && result.items.every((i) => i.source.isDemo);
    return ok(result, {
      isDemo: allDemo,
      meta: { total: result.total, limit: result.limit, offset: result.offset, disclaimer: SCORE_DISCLAIMER },
    });
  });

  // ── Reports ────────────────────────────────────────────────────────────
  router.get('/api/reports', (ctx) => {
    const v = queryValidator(ctx.query);
    const date = v.date('date');
    const market = v.enum('market', ['ALL', 'INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER'] as const, { fallback: 'ALL' });
    const history = v.boolean('history', { fallback: false });
    const limit = v.int('limit', { min: 1, max: 100, fallback: 30 });
    const offset = v.int('offset', { min: 0, max: 10_000, fallback: 0 });
    v.throwIfInvalid();

    if (history) {
      const page = listReportHistory(db, limit, offset);
      return ok(page, { meta: { total: page.total, limit, offset } });
    }

    const report = generateDailyReport(db, { date: date ?? new Date().toISOString().slice(0, 10), market });
    return ok(report, {
      isDemo: report.source.isDemo,
      meta: { noQualifiedSetups: report.noQualifiedSetups, generatedAt: report.generatedAt },
    });
  });

  // ── Strategies ─────────────────────────────────────────────────────────
  router.get('/api/strategies', () => {
    const rows = listStrategies(db);
    const strategies = rows.map((row) => {
      const configJson = JSON.parse(row.config_json) as Record<string, unknown>;
      const conditions = listConditions(db, row.id);
      return {
        id: row.id,
        name: row.name,
        family: row.family,
        description: row.description,
        timeframe: row.timeframe,
        indicators: (configJson.indicators as unknown[]) ?? [],
        entryConditions: conditions.ENTRY,
        exitConditions: conditions.EXIT,
        stopLoss: configJson.stopLoss ?? { mode: 'FIXED_PCT', value: 1 },
        targets: configJson.targets ?? { target1Pct: 1, target2Pct: 2 },
        exitMode: configJson.exitMode ?? 'TARGET_STOP',
        disclaimer: 'Backtest and signal outputs are simulated and are not trade recommendations.',
      };
    });
    return ok(strategies, { meta: { count: strategies.length } });
  });

  // ── Backtests ──────────────────────────────────────────────────────────
  router.get('/api/backtests', (ctx) => {
    const v = queryValidator(ctx.query);
    const strategyId = v.string('strategyId', { maxLength: 64 });
    const limit = v.int('limit', { min: 1, max: 100, fallback: 20 });
    const offset = v.int('offset', { min: 0, max: 10_000, fallback: 0 });
    v.throwIfInvalid();

    const page = listStoredBacktests(db, strategyId, limit, offset);
    return ok(page, { isDemo: true, meta: { total: page.total, simulated: true } });
  });

  router.get('/api/backtests/:id', (ctx) => {
    const result = getStoredBacktest(db, ctx.params.id);
    if (!result) throw new AppError('NOT_FOUND', `Unknown backtest "${ctx.params.id}"`);
    return ok(result, { isDemo: true, meta: { simulated: true } });
  });

  router.post('/api/backtests', async (ctx) => {
    requireAdmin(ctx, config);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const v = validatorFromBody(body);
    const strategyId = v.string('strategyId', { required: true, maxLength: 64 });
    const instrumentIds = v.listFromBody('instrumentIds', 50);
    v.throwIfInvalid();
    if (!instrumentIds || instrumentIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'instrumentIds must be a non-empty array', {
        issues: [{ field: 'instrumentIds', message: 'must contain at least one instrument id' }],
      });
    }

    const outcome = await runBacktest(db, {
      strategyId: strategyId!,
      instrumentIds,
      from: typeof body.from === 'string' ? body.from : undefined,
      to: typeof body.to === 'string' ? body.to : undefined,
      costs: (body.costs as CostModel | undefined) ?? undefined,
      initialCapital: typeof body.initialCapital === 'number' ? body.initialCapital : undefined,
      riskPerTradePct: typeof body.riskPerTradePct === 'number' ? body.riskPerTradePct : undefined,
      outOfSamplePct: typeof body.outOfSamplePct === 'number' ? body.outOfSamplePct : undefined,
      registry,
    });
    insertSystemLog(db, { level: 'info', source: 'backtest', message: `backtest ${outcome.id} completed`, context: { strategyId: outcome.strategyId, trades: outcome.trades.length } });
    return { status: 201, body: outcome, envelopeOptions: { isDemo: true, meta: { simulated: true } } };
  });

  router.post('/api/backtests/compare', async (ctx) => {
    requireAdmin(ctx, config);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const strategyIds = Array.isArray(body.strategyIds) ? (body.strategyIds as unknown[]).map(String) : [];
    const instrumentIds = Array.isArray(body.instrumentIds) ? (body.instrumentIds as unknown[]).map(String) : [];
    if (strategyIds.length === 0 || instrumentIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'strategyIds and instrumentIds are required arrays');
    }
    const result = await compareStrategies(db, strategyIds, instrumentIds, registry);
    return ok(result, { isDemo: true, meta: { simulated: true, warnings: result.warnings } });
  });

  // ── Data health ────────────────────────────────────────────────────────
  router.get('/api/data-health', async (ctx) => {
    const v = queryValidator(ctx.query);
    const refresh = v.boolean('refresh', { fallback: false });
    v.throwIfInvalid();

    const snapshot = await getDataHealthApi(db, registry, refresh);
    return ok(snapshot, {
      isDemo: snapshot.globalFreshness === 'DEMO',
      meta: { globalFreshness: snapshot.globalFreshness, issues: snapshot.issues.length, providers: snapshot.providers.length },
    });
  });

  // ── Risk (calculation endpoints used by the Risk Center) ───────────────
  router.post('/api/risk/position-size', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const v = validatorFromBody(body);
    const accountBalance = v.number('accountBalance', { required: true, min: 1 });
    const riskPerTradePct = v.number('riskPerTradePct', { required: true, min: 0.01, max: 10 });
    const entryPrice = v.number('entryPrice', { required: true, min: 0.000001 });
    const stopPrice = v.number('stopPrice', { required: true, min: 0.000001 });
    v.throwIfInvalid();

    const result = sizePosition({
      accountBalance: accountBalance!,
      riskPerTradePct: riskPerTradePct!,
      entryPrice: entryPrice!,
      stopPrice: stopPrice!,
      instrumentCurrency: typeof body.instrumentCurrency === 'string' ? body.instrumentCurrency : undefined,
    });
    const record = recordCalculation(db, 'POSITION_SIZE', body, result);
    return { status: 201, body: { ...result, id: record.id, createdAt: record.createdAt }, envelopeOptions: { isDemo: false } };
  });

  router.post('/api/risk/risk-reward', (ctx) => {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const v = validatorFromBody(body);
    const entryPrice = v.number('entryPrice', { required: true, min: 0.000001 });
    const stopPrice = v.number('stopPrice', { required: true, min: 0.000001 });
    const targetPrice = v.number('targetPrice', { required: true, min: 0.000001 });
    const direction = v.enumFromBody('direction', ['LONG', 'SHORT'] as const, 'LONG');
    v.throwIfInvalid();

    const result = riskReward({ entryPrice: entryPrice!, stopPrice: stopPrice!, targetPrice: targetPrice!, direction });
    const record = recordCalculation(db, 'RISK_REWARD', body, result);
    return { status: 201, body: { ...result, id: record.id, createdAt: record.createdAt }, envelopeOptions: { isDemo: false } };
  });

  router.get('/api/risk/portfolio', () => {
    const metrics = portfolioMetrics(db);
    return ok(metrics, { isDemo: metrics.simulated, meta: { simulated: true } });
  });

  // ── Admin: generation + provider probes ────────────────────────────────
  router.post('/api/admin/opportunities/generate', async (ctx) => {
    requireAdmin(ctx, config);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const v = validatorFromBody(body);
    const market = v.enumFromBody('market', ['ALL', 'INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER'] as const, 'ALL');
    const minScore = v.number('minScore', { min: 0, max: 100, fallback: 60 });
    const limit = v.intFromBody('limit', 1, 100, 20);
    v.throwIfInvalid();

    const result = await generateOpportunities(db, registry, {
      market: market === 'ALL' ? undefined : market,
      minScore,
      limit,
    });
    insertSystemLog(db, { level: 'info', source: 'opportunities', message: `admin generated ${result.stored} opportunities` });
    return { status: 201, body: result, envelopeOptions: { isDemo: result.opportunities.some((o) => o.isDemo) } };
  });

  router.post('/api/admin/reports/generate', (ctx) => {
    requireAdmin(ctx, config);
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const report = generateDailyReport(db, {
      date: typeof body.date === 'string' ? body.date : undefined,
      market: typeof body.market === 'string' ? body.market : 'ALL',
      force: body.force === true,
    });
    return { status: 201, body: report, envelopeOptions: { isDemo: report.source.isDemo } };
  });

  router.post('/api/admin/probe', async (ctx) => {
    requireAdmin(ctx, config);
    const health = await registry.probeAll();
    return { status: 201, body: health, envelopeOptions: { isDemo: health.every((h) => h.isDemo) } };
  });

  router.get('/api/admin/strategies/:id', (ctx) => {
    requireAdmin(ctx, config);
    const row = getStrategy(db, ctx.params.id);
    if (!row) throw new AppError('NOT_FOUND', `Unknown strategy "${ctx.params.id}"`);
    const conditions = listConditions(db, row.id);
    const stored = listBacktests(db, row.id, 10, 0);
    return ok({ ...JSON.parse(row.config_json), id: row.id, name: row.name, conditions, recentBacktests: stored.items.length });
  });

  // Expose the envelope helper for tests.
  router.get('/api/_meta/routes', () => ok({ routes: router.patterns, generatedAt: new Date().toISOString() }));

  return router;
}

/** Minimal validator for JSON request bodies. */
function validatorFromBody(body: Record<string, unknown>): BodyValidator {
  return new BodyValidator(body);
}

class BodyValidator {
  private readonly issues: Array<{ field: string; message: string }> = [];
  private readonly source: Record<string, unknown>;
  constructor(source: Record<string, unknown>) {
    this.source = source;
  }

  private value(field: string): unknown {
    return this.source[field];
  }

  string(field: string, opts: { required?: boolean; maxLength?: number } = {}): string | undefined {
    const raw = this.value(field);
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.issues.push({ field, message: 'is required' });
      return undefined;
    }
    if (typeof raw !== 'string') {
      this.issues.push({ field, message: 'must be a string' });
      return undefined;
    }
    if (opts.maxLength && raw.length > opts.maxLength) {
      this.issues.push({ field, message: `must be at most ${opts.maxLength} characters` });
      return undefined;
    }
    return raw;
  }

  number(field: string, opts: { required?: boolean; min?: number; max?: number; fallback?: number } = {}): number | undefined {
    const raw = this.value(field);
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.issues.push({ field, message: 'is required' });
      return opts.fallback;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      this.issues.push({ field, message: 'must be a number' });
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      this.issues.push({ field, message: `must be >= ${opts.min}` });
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      this.issues.push({ field, message: `must be <= ${opts.max}` });
      return undefined;
    }
    return value;
  }

  int(field: string, opts: { required?: boolean; min?: number; max?: number; fallback?: number } = {}): number | undefined {
    const value = this.number(field, opts);
    if (value === undefined) return opts.fallback;
    if (!Number.isInteger(value)) {
      this.issues.push({ field, message: 'must be an integer' });
      return opts.fallback;
    }
    return value;
  }

  enumFromBody<T extends string>(field: string, allowed: readonly T[], fallback: T): T {
    const raw = this.value(field);
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
      this.issues.push({ field, message: `must be one of: ${allowed.join(', ')}` });
      return fallback;
    }
    return raw as T;
  }

  intFromBody(field: string, min: number, max: number, fallback: number): number {
    const raw = this.value(field);
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.issues.push({ field, message: `must be an integer between ${min} and ${max}` });
      return fallback;
    }
    return value;
  }

  /** Accepts either a JSON array or a comma-separated string. */
  listFromBody(field: string, maxItems: number): string[] | undefined {
    const raw = this.value(field);
    if (raw === undefined || raw === null) return undefined;
    let items: string[];
    if (Array.isArray(raw)) items = raw.map(String);
    else if (typeof raw === 'string') items = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else {
      this.issues.push({ field, message: 'must be an array or comma-separated string' });
      return undefined;
    }
    if (items.length === 0) return undefined;
    if (items.length > maxItems) {
      this.issues.push({ field, message: `must contain at most ${maxItems} items` });
      return undefined;
    }
    for (const item of items) {
      if (!/^[a-zA-Z0-9._-]+$/.test(item)) {
        this.issues.push({ field, message: `contains an invalid id "${item}"` });
        return undefined;
      }
    }
    return items;
  }

  throwIfInvalid(): void {
    if (this.issues.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed', { issues: this.issues });
    }
  }
}

export type { RequestContext };
export { envelope };
