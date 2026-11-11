/**
 * Market data ingestion: historical candles and real-time quotes.
 *
 * Flow: provider adapter → validation → persistence with quality status.
 * Re-ingesting the same series is idempotent (INSERT OR IGNORE on the
 * instrument/timeframe/ts primary key), so retries can never duplicate rows.
 */

import type { Db } from '../db/db.ts';
import { insertCandles, updateCandleQuality, upsertQuote, type CandleWrite, type QualityStatus } from '../db/repoSeries.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { Interval, ProviderQuote, SourceRef } from '../providers/types.ts';
import { alignTimestamp, timeframeMs, toUnixSeconds } from '../lib/time.ts';
import { validateCandles, validateQuote, type QualityIssue } from './dataQuality.ts';

export interface IngestCandleOptions {
  interval: Interval;
  limit: number;
  from?: number;
  to?: number;
  /** Skip persistence and only validate (used by tests and dry-runs). */
  dryRun?: boolean;
}

export interface IngestCandleResult {
  instrumentId: string;
  interval: Interval;
  fetched: number;
  inserted: number;
  duplicates: number;
  status: QualityStatus;
  issues: QualityIssue[];
  source: SourceRef;
  isDemo: boolean;
  generatedAt: string;
}

export interface RoutableInstrument {
  id: string;
  market: string;
  providerId?: string | null;
  providerSymbol?: string | null;
}

/** Fetches, validates and stores candles for one instrument/interval. */
export async function ingestCandles(
  db: Db,
  registry: ProviderRegistry,
  instrument: RoutableInstrument,
  options: IngestCandleOptions,
): Promise<IngestCandleResult> {
  const barsResult = await registry.fetchHistorical(instrument, options.interval, {
    limit: options.limit,
    from: options.from,
    to: options.to,
  });

  const intervalSeconds = Math.round(timeframeMs(options.interval) / 1000);
  const validation = validateCandles(barsResult.bars, {
    intervalSeconds,
    nowMs: Date.now(),
    checkVolume: true,
  });

  const writes: CandleWrite[] = barsResult.bars.map((bar) => ({
    instrument_id: instrument.id,
    timeframe: options.interval,
    ts: bar.ts,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    source_provider: barsResult.source.provider,
    source_origin: barsResult.source.origin,
    is_demo: barsResult.source.isDemo,
    quality_status: 'PENDING',
    is_complete: bar.isComplete,
  }));

  let inserted = 0;
  let duplicates = 0;
  if (!options.dryRun && writes.length > 0) {
    const result = insertCandles(db, writes);
    inserted = result.inserted;
    duplicates = result.duplicates;

    // Apply the validation verdict to everything in this batch.
    const rejectedTs = new Set<number>();
    const suspectTs = new Set<number>();
    for (const issue of validation.issues) {
      if (issue.ts === undefined) continue;
      if (issue.severity === 'HIGH') rejectedTs.add(issue.ts);
      else suspectTs.add(issue.ts);
    }
    const touched = [...rejectedTs, ...suspectTs];
    if (touched.length > 0) {
      updateCandleQuality(db, instrument.id, options.interval, [...rejectedTs], 'REJECTED');
      updateCandleQuality(db, instrument.id, options.interval, [...suspectTs], 'SUSPECT');
    }
    // Anything still PENDING after this batch and not flagged is VERIFIED.
    updateVerified(db, instrument.id, options.interval, validation.status === 'VERIFIED');
  }

  return {
    instrumentId: instrument.id,
    interval: options.interval,
    fetched: barsResult.bars.length,
    inserted,
    duplicates,
    status: validation.status,
    issues: validation.issues,
    source: barsResult.source,
    isDemo: barsResult.source.isDemo,
    generatedAt: new Date().toISOString(),
  };
}

function updateVerified(db: Db, instrumentId: string, interval: string, verified: boolean): void {
  if (verified) {
    db.prepare(
      `UPDATE candles SET quality_status = 'VERIFIED'
       WHERE instrument_id = ? AND timeframe = ? AND quality_status = 'PENDING'`,
    ).run(instrumentId, interval);
  } else {
    db.prepare(
      `UPDATE candles SET quality_status = 'SUSPECT'
       WHERE instrument_id = ? AND timeframe = ? AND quality_status = 'PENDING'`,
    ).run(instrumentId, interval);
  }
}

export interface QuoteIngestResult {
  fetched: number;
  stored: number;
  rejected: number;
  errors: Record<string, string>;
  sources: Record<string, SourceRef>;
}

/** Fetches quotes for the given instruments, validates them and upserts. */
export async function ingestQuotes(
  db: Db,
  registry: ProviderRegistry,
  instruments: RoutableInstrument[],
): Promise<QuoteIngestResult> {
  const { quotes, sources, errors } = await registry.fetchQuotes(instruments);
  let stored = 0;
  let rejected = 0;
  for (const quote of quotes) {
    const validation = validateQuote(
      { instrumentId: quote.instrumentId, lastPrice: quote.lastPrice, volume: quote.volume, updatedAt: quote.updatedAt },
      { maxAgeMs: quote.freshness === 'LIVE' ? 60_000 : 900_000 },
    );
    if (validation.status === 'REJECTED') {
      rejected += 1;
      continue;
    }
    const source = sources[quote.instrumentId];
    upsertQuote(db, toQuoteRow(quote, source, validation.status));
    stored += 1;
  }
  return { fetched: quotes.length, stored, rejected, errors, sources };
}

export function toQuoteRow(
  quote: ProviderQuote,
  source: SourceRef | undefined,
  quality: QualityStatus,
): {
  instrument_id: string;
  last_price: number;
  change: number;
  change_percent: number;
  open: number;
  high: number;
  low: number;
  previous_close: number;
  volume: number;
  average_volume: number;
  bid: number | null;
  ask: number | null;
  market_status: string;
  freshness: string;
  source_provider: string;
  source_origin: string;
  is_demo: number;
  quality_status: QualityStatus;
  updated_at: string;
} {
  return {
    instrument_id: quote.instrumentId,
    last_price: quote.lastPrice,
    change: quote.change,
    change_percent: quote.changePercent,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previous_close: quote.previousClose,
    volume: quote.volume,
    average_volume: quote.averageVolume,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    market_status: quote.marketStatus,
    freshness: quote.freshness,
    source_provider: source?.provider ?? 'unknown',
    source_origin: source?.origin ?? 'UNKNOWN',
    is_demo: (source?.isDemo ?? true) ? 1 : 0,
    quality_status: quality,
    updated_at: quote.updatedAt,
  };
}

/** Aligns a requested window to candle buckets and returns unix seconds. */
export function normalizeWindow(interval: Interval, from?: number, to?: number): { from?: number; to?: number } {
  return {
    from: from !== undefined ? toUnixSeconds(alignTimestamp(from * 1000, interval)) : undefined,
    to: to !== undefined ? toUnixSeconds(alignTimestamp(to * 1000, interval)) : undefined,
  };
}
