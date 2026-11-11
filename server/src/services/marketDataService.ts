/**
 * Market data service: instruments, markets, quotes, candles, indicators and
 * the data-health view consumed by the Data Center page.
 *
 * Quote reads are cached in the `quotes` table and refreshed from the
 * provider registry when older than QUOTE_CACHE_TTL_MS — never on every call.
 */

import type { AppConfig } from '../config/env.ts';
import type { Db } from '../db/db.ts';
import { getInstrument, getInstrumentsByIds, listInstruments as repoListInstruments, listMarkets, type Page } from '../db/repoReference.ts';
import { candleStats, getCandles as repoGetCandles, getQuotes as repoGetQuotes, type CandleRow, type QuoteRow } from '../db/repoSeries.ts';
import { listProviderStatus, listSystemLogs } from '../db/repoOps.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { Interval, SourceRef } from '../providers/types.ts';
import { AppError } from '../lib/errors.ts';
import { formatInZone, withinSession } from '../lib/time.ts';
import { ingestCandles, ingestQuotes } from './ingestion.ts';
import { computeIndicator, type IndicatorName, type IndicatorPoint } from './indicators.ts';
import type { QualityIssue } from './dataQuality.ts';

export interface ApiSource {
  provider: string;
  origin: string;
  isDemo: boolean;
  reliability: 'VERIFIED' | 'PROVISIONAL' | 'UNAVAILABLE';
}

export interface ApiInstrument {
  id: string;
  symbol: string;
  name: string;
  market: string;
  exchange: string;
  region: string;
  type: string;
  currency: string;
  sector?: string;
  restriction?: { code: string; summary: string; detail: string };
}

export interface ApiQuote {
  instrumentId: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  averageVolume: number;
  bid?: number;
  ask?: number;
  marketStatus: 'OPEN' | 'PRE_OPEN' | 'CLOSED' | 'AFTER_HOURS' | 'UNKNOWN';
  freshness: string;
  updatedAt: string;
  quality: string;
  source: ApiSource;
}

export type ApiInstrumentQuote = ApiInstrument & { quote: ApiQuote };

export interface ApiCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function toApiInstrument(row: {
  id: string;
  symbol: string;
  name: string;
  market_category: string;
  exchange: string;
  region: string;
  type: string;
  currency: string;
  sector: string | null;
  restriction_code: string | null;
  restriction_summary: string | null;
  restriction_detail: string | null;
}): ApiInstrument {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    market: row.market_category,
    exchange: row.exchange,
    region: row.region,
    type: row.type,
    currency: row.currency,
    ...(row.sector ? { sector: row.sector } : {}),
    ...(row.restriction_code && row.restriction_summary && row.restriction_detail
      ? { restriction: { code: row.restriction_code, summary: row.restriction_summary, detail: row.restriction_detail } }
      : {}),
  };
}

export function listMarketsApi(db: Db): Array<{
  id: string;
  category: string;
  name: string;
  region: string;
  timezone: string;
  currency: string;
  status: 'OPEN' | 'CLOSED';
  session: { openLocal: string; closeLocal: string };
  instrumentCount: number;
}> {
  const markets = listMarkets(db);
  const now = Date.now();
  return markets.map((m) => {
    const weekdays = JSON.parse(m.weekdays) as number[];
    const open = withinSession(now, m.timezone, {
      openMinutes: m.weekday_open_min,
      closeMinutes: m.weekday_close_min,
      weekdays,
    });
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM instruments WHERE market_category = ? AND is_active = 1').get(m.category) as { c: number }
    ).c;
    const fmt = (minutes: number): string =>
      formatInZone(now, m.timezone, { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\d{2}:\d{2}/, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
    return {
      id: m.id,
      category: m.category,
      name: m.name,
      region: m.region,
      timezone: m.timezone,
      currency: m.currency,
      status: open ? 'OPEN' : 'CLOSED',
      session: { openLocal: fmt(m.weekday_open_min), closeLocal: fmt(m.weekday_close_min) },
      instrumentCount: count,
    };
  });
}

export interface InstrumentQueryApi {
  search?: string;
  market?: string;
  sector?: string;
  exchange?: string;
  limit?: number;
  offset?: number;
}

export function listInstrumentsApi(db: Db, query: InstrumentQueryApi): Page<ApiInstrument> {
  const page = repoListInstruments(db, {
    search: query.search,
    market: query.market,
    sector: query.sector,
    exchange: query.exchange,
    limit: query.limit,
    offset: query.offset,
  });
  return { ...page, items: page.items.map(toApiInstrument) };
}

function sourceFromRow(row: Pick<QuoteRow, 'source_provider' | 'source_origin' | 'is_demo' | 'quality_status'>): ApiSource {
  return {
    provider: row.source_provider,
    origin: row.source_origin,
    isDemo: row.is_demo === 1,
    reliability: row.is_demo === 1 ? 'PROVISIONAL' : row.quality_status === 'VERIFIED' ? 'VERIFIED' : 'PROVISIONAL',
  };
}

function toApiQuote(row: QuoteRow): ApiQuote {
  return {
    instrumentId: row.instrument_id,
    lastPrice: row.last_price,
    change: row.change,
    changePercent: row.change_percent,
    open: row.open,
    high: row.high,
    low: row.low,
    previousClose: row.previous_close,
    volume: row.volume,
    averageVolume: row.average_volume,
    ...(row.bid !== null ? { bid: row.bid } : {}),
    ...(row.ask !== null ? { ask: row.ask } : {}),
    marketStatus: row.market_status as ApiQuote['marketStatus'],
    freshness: row.freshness,
    updatedAt: row.updated_at,
    quality: row.quality_status,
    source: sourceFromRow(row),
  };
}

/**
 * Returns quotes, refreshing from providers when the cache is older than the
 * configured TTL. Instruments without a quote after refresh are omitted
 * (callers render an explicit MISSING state rather than a fabricated price).
 */
export async function getQuotesApi(
  db: Db,
  registry: ProviderRegistry,
  cfg: AppConfig,
  instrumentIds?: string[],
): Promise<ApiInstrumentQuote[]> {
  const rows = instrumentIds && instrumentIds.length > 0 ? getInstrumentsByIds(db, instrumentIds) : repoListInstruments(db, { limit: 500 }).items;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const cached = new Map(repoGetQuotes(db, ids).map((q) => [q.instrument_id, q]));
  const now = Date.now();
  const staleIds = ids.filter((id) => {
    const row = cached.get(id);
    if (!row) return true;
    return now - Date.parse(row.updated_at) > cfg.quoteCacheTtlMs;
  });

  if (staleIds.length > 0) {
    const staleRows = rows.filter((r) => staleIds.includes(r.id));
    try {
      await ingestQuotes(db, registry, staleRows.map((r) => ({ id: r.id, market: r.market_category, providerId: r.provider_id, providerSymbol: r.provider_symbol })));
    } catch (err) {
      // Providers may be down — serve whatever cache exists and let freshness
      // labels tell the truth (STALE/DEMO), never inventing prices.
      if (cached.size === 0) {
        throw new AppError('PROVIDER_UNAVAILABLE', 'No quote data available from any provider', {
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const row of repoGetQuotes(db, staleIds)) cached.set(row.instrument_id, row);
  }

  const out: ApiInstrumentQuote[] = [];
  for (const inst of rows) {
    const quote = cached.get(inst.id);
    if (!quote) continue;
    out.push({ ...toApiInstrument(inst), quote: toApiQuote(quote) });
  }
  return out;
}

export interface CandlesResponse {
  candles: ApiCandle[];
  meta: {
    instrumentId: string;
    timeframe: Interval;
    freshness: string;
    source: ApiSource;
    updatedAt: string;
    count: number;
    verifiedCount: number;
    issues: QualityIssue[];
    isDemo: boolean;
  };
}

/**
 * Returns candles for an instrument/timeframe, ingesting missing history on
 * first access. Every returned candle carries its quality status in `meta`.
 */
export async function getCandlesApi(
  db: Db,
  registry: ProviderRegistry,
  instrumentId: string,
  interval: Interval,
  options: { limit?: number; from?: number; to?: number; refresh?: boolean } = {},
): Promise<CandlesResponse> {
  const instrument = getInstrument(db, instrumentId);
  if (!instrument) throw new AppError('NOT_FOUND', `Unknown instrument "${instrumentId}"`);

  const limit = options.limit ?? 500;
  const stats = candleStats(db, instrumentId, interval);
  const shouldIngest = options.refresh === true || stats.count < Math.min(limit, 50);

  let issues: QualityIssue[] = [];
  if (shouldIngest) {
    try {
      const result = await ingestCandles(db, registry, { id: instrument.id, market: instrument.market_category, providerId: instrument.provider_id, providerSymbol: instrument.provider_symbol }, {
        interval,
        limit,
        from: options.from,
        to: options.to,
      });
      issues = result.issues;
    } catch (err) {
      if (stats.count === 0) {
        throw new AppError('PROVIDER_UNAVAILABLE', `No candle data available for ${instrumentId}`, {
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const rows = repoGetCandles(db, {
    instrumentId,
    timeframe: interval,
    from: options.from,
    to: options.to,
    limit,
    ascending: true,
  });
  if (rows.length === 0) throw new AppError('NOT_FOUND', `No candles for ${instrumentId} (${interval})`);

  const candles: ApiCandle[] = rows.map((r) => ({ time: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const latest = rows[rows.length - 1];
  const allDemo = rows.every((r) => r.is_demo === 1);
  const allVerified = rows.every((r) => r.quality_status === 'VERIFIED');

  return {
    candles,
    meta: {
      instrumentId,
      timeframe: interval,
      freshness: allDemo ? 'DEMO' : allVerified ? 'HISTORICAL' : 'STALE',
      source: {
        provider: latest.source_provider,
        origin: latest.source_origin,
        isDemo: allDemo,
        reliability: allDemo ? 'PROVISIONAL' : allVerified ? 'VERIFIED' : 'PROVISIONAL',
      },
      updatedAt: latest.ingested_at,
      count: rows.length,
      verifiedCount: rows.filter((r) => r.quality_status === 'VERIFIED').length,
      issues,
      isDemo: allDemo,
    },
  };
}

export interface IndicatorResponse {
  instrumentId: string;
  timeframe: Interval;
  indicators: Record<string, IndicatorPoint[]>;
  source: ApiSource;
  computedAt: string;
  /** True when the underlying candles are demonstration data. */
  isDemo: boolean;
  note: string;
}

/** Computes indicators on demand from stored (completed) candles. */
export function getIndicatorsApi(
  db: Db,
  instrumentId: string,
  interval: Interval,
  names: IndicatorName[],
): IndicatorResponse {
  const instrument = getInstrument(db, instrumentId);
  if (!instrument) throw new AppError('NOT_FOUND', `Unknown instrument "${instrumentId}"`);

  const rows = repoGetCandles(db, { instrumentId, timeframe: interval, limit: 500, ascending: true, quality: 'ALL' });
  if (rows.length === 0) throw new AppError('NOT_FOUND', `No candles for ${instrumentId} (${interval}) — ingest history first`);

  const bars = rows.map((r) => ({ ts: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const indicators: Record<string, IndicatorPoint[]> = {};
  for (const name of names) indicators[name] = computeIndicator(bars, { name });

  const latest = rows[rows.length - 1];
  const allDemo = rows.every((r) => r.is_demo === 1);
  return {
    instrumentId,
    timeframe: interval,
    indicators,
    source: {
      provider: latest.source_provider,
      origin: latest.source_origin,
      isDemo: allDemo,
      reliability: allDemo ? 'PROVISIONAL' : 'VERIFIED',
    },
    computedAt: new Date().toISOString(),
    isDemo: allDemo,
    note: 'Computed from completed candles only; forming candles are excluded from confirmed signals.',
  };
}

export interface DataHealthResponse {
  providers: Array<{
    id: string;
    name: string;
    vendor: string;
    status: string;
    lastSuccessAt: string | null;
    lastError: string | null;
    latencyMs: number;
    freshnessSeconds: number;
    reliabilityPct: number;
    isDemo: boolean;
    rateLimit: { used: number; limit: number; resetsAt: string };
    apiUsage: { requestsToday: number; requestsMonth: number; quotaPct: number };
    supportedMarkets: string[];
  }>;
  issues: Array<{
    id: string;
    type: string;
    instrumentId: string;
    symbol: string;
    detail: string;
    detectedAt: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  coverage: Array<{
    instrumentId: string;
    symbol: string;
    from: string;
    to: string;
    candleCount: number;
    completenessPct: number;
    freshness: string;
  }>;
  globalFreshness: 'LIVE' | 'DELAYED' | 'HISTORICAL' | 'STALE' | 'MISSING' | 'DEMO';
  updatedAt: string;
  summary: { instruments: number; verifiedCandles: number; suspectCandles: number; rejectedCandles: number; pendingCandles: number };
}

/** Aggregates provider health, data-quality issues and coverage for the UI. */
export async function getDataHealthApi(db: Db, registry: ProviderRegistry, refresh = false): Promise<DataHealthResponse> {
  if (refresh) await registry.probeAll();

  const healthById = new Map(registry.healthSnapshot().map((h) => [h.id, h]));
  const stored = listProviderStatus(db);
  const providers = stored.map((row) => {
    const live = healthById.get(row.provider_id);
    return {
      id: row.provider_id,
      name: row.name,
      vendor: row.vendor,
      status: live?.status ?? row.status,
      lastSuccessAt: live?.lastSuccessAt ?? row.last_success_at,
      lastError: live?.lastError ?? row.last_error,
      latencyMs: live?.latencyMs ?? row.latency_ms,
      freshnessSeconds: live?.freshnessSeconds ?? row.freshness_seconds,
      reliabilityPct: live?.reliabilityPct ?? row.reliability_pct,
      isDemo: (live?.isDemo ?? row.is_demo === 1),
      rateLimit: {
        used: live?.rateLimit.used ?? row.rate_limit_used,
        limit: live?.rateLimit.limit ?? row.rate_limit_limit,
        resetsAt: live?.rateLimit.resetsAt ?? row.rate_limit_resets_at ?? new Date().toISOString(),
      },
      apiUsage: {
        requestsToday: live?.apiUsage.requestsToday ?? row.requests_today,
        requestsMonth: live?.apiUsage.requestsMonth ?? row.requests_month,
        quotaPct: live?.apiUsage.quotaPct ?? 0,
      },
      supportedMarkets: live?.supportedMarkets ?? (JSON.parse(row.supported_markets) as string[]),
    };
  });

  // Registered adapters that have not been probed yet still belong in the
  // health view — otherwise a fresh boot reports zero providers.
  const known = new Set(providers.map((p) => p.id));
  for (const live of healthById.values()) {
    if (known.has(live.id)) continue;
    providers.push({
      id: live.id,
      name: live.name,
      vendor: live.vendor,
      status: live.status,
      lastSuccessAt: live.lastSuccessAt ?? null,
      lastError: live.lastError ?? null,
      latencyMs: live.latencyMs,
      freshnessSeconds: live.freshnessSeconds,
      reliabilityPct: live.reliabilityPct,
      isDemo: live.isDemo,
      rateLimit: live.rateLimit,
      apiUsage: live.apiUsage,
      supportedMarkets: live.supportedMarkets,
    });
    known.add(live.id);
  }

  // Quality issues → derived from stored candle verdicts + recent error logs.
  const issueRows = db
    .prepare(
      `SELECT c.instrument_id, i.symbol, c.timeframe, c.quality_status, c.ts, c.source_provider, c.ingested_at
       FROM candles c JOIN instruments i ON i.id = c.instrument_id
       WHERE c.quality_status IN ('SUSPECT','REJECTED')
       ORDER BY c.ingested_at DESC LIMIT 50`,
    )
    .all() as Array<{ instrument_id: string; symbol: string; timeframe: string; quality_status: string; ts: number; source_provider: string; ingested_at: string }>;

  const issues = issueRows.map((row) => ({
    id: `${row.instrument_id}-${row.timeframe}-${row.ts}`,
    type: row.quality_status === 'REJECTED' ? 'SCHEMA_MISMATCH' : 'GAP_DETECTED',
    instrumentId: row.instrument_id,
    symbol: row.symbol,
    detail: `${row.quality_status} candle at ${new Date(row.ts * 1000).toISOString()} from ${row.source_provider} (${row.timeframe})`,
    detectedAt: row.ingested_at,
    severity: row.quality_status === 'REJECTED' ? ('HIGH' as const) : ('MEDIUM' as const),
  }));

  const rateLogs = listSystemLogs(db, { level: 'warn', limit: 20 }).filter((l) => l.message.includes('rate limit'));
  for (const entry of rateLogs) {
    issues.push({
      id: `log-${entry.id}`,
      type: 'RATE_LIMIT',
      instrumentId: '-',
      symbol: '-',
      detail: entry.message,
      detectedAt: entry.ts,
      severity: 'MEDIUM',
    });
  }

  // Coverage per instrument (timeframe 1D by default).
  const coverageRows = db
    .prepare(
      `SELECT c.instrument_id, i.symbol, MIN(c.ts) AS min_ts, MAX(c.ts) AS max_ts, COUNT(*) AS n,
              SUM(CASE WHEN c.quality_status = 'VERIFIED' THEN 1 ELSE 0 END) AS v
       FROM candles c JOIN instruments i ON i.id = c.instrument_id
       WHERE c.timeframe = '1D' GROUP BY c.instrument_id, i.symbol ORDER BY i.symbol`,
    )
    .all() as Array<{ instrument_id: string; symbol: string; min_ts: number; max_ts: number; n: number; v: number }>;

  const coverage = coverageRows.map((row) => {
    const days = Math.max(1, Math.round((row.max_ts - row.min_ts) / 86_400));
    return {
      instrumentId: row.instrument_id,
      symbol: row.symbol,
      from: new Date(row.min_ts * 1000).toISOString(),
      to: new Date(row.max_ts * 1000).toISOString(),
      historyDays: days,
      candleCount: row.n,
      completenessPct: Math.min(100, Math.round((row.v / Math.max(1, row.n)) * 100)),
      freshness: row.v === row.n ? 'HISTORICAL' : 'STALE',
    };
  });

  const totals = db
    .prepare(
      `SELECT
        SUM(CASE WHEN quality_status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN quality_status = 'SUSPECT' THEN 1 ELSE 0 END) AS suspect,
        SUM(CASE WHEN quality_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN quality_status = 'PENDING' THEN 1 ELSE 0 END) AS pending
       FROM candles`,
    )
    .get() as Record<string, number | null>;

  const instrumentCount = (db.prepare('SELECT COUNT(*) AS c FROM instruments WHERE is_active = 1').get() as { c: number }).c;
  const allDemo = providers.length > 0 && providers.every((p) => p.isDemo);
  const anyLive = providers.some((p) => !p.isDemo && (p.status === 'CONNECTED' || p.status === 'DELAYED'));

  return {
    providers,
    issues,
    coverage,
    globalFreshness: allDemo ? 'DEMO' : anyLive ? (providers.some((p) => p.status === 'DELAYED') ? 'DELAYED' : 'LIVE') : 'STALE',
    updatedAt: new Date().toISOString(),
    summary: {
      instruments: instrumentCount,
      verifiedCandles: Number(totals.verified ?? 0),
      suspectCandles: Number(totals.suspect ?? 0),
      rejectedCandles: Number(totals.rejected ?? 0),
      pendingCandles: Number(totals.pending ?? 0),
    },
  };
}

/** Exposed for the scanner: returns raw candle rows without HTTP mapping. */
export function readCandles(db: Db, instrumentId: string, interval: Interval, limit: number): CandleRow[] {
  return repoGetCandles(db, { instrumentId, timeframe: interval, limit, ascending: true, quality: 'ALL' });
}

export type { SourceRef };
