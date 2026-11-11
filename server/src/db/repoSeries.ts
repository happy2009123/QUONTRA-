/** Repositories for time-series data: candles, quotes, indicator values. */

import type { Db } from './db.ts';
import { withTx } from './tx.ts';

export type QualityStatus = 'PENDING' | 'VERIFIED' | 'SUSPECT' | 'REJECTED';

export interface CandleRow {
  instrument_id: string;
  timeframe: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source_provider: string;
  source_origin: string;
  is_demo: number;
  quality_status: QualityStatus;
  is_complete: number;
  ingested_at: string;
}

export interface QuoteRow {
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
}

export interface IndicatorRow {
  instrument_id: string;
  timeframe: string;
  name: string;
  ts: number;
  value_json: string;
  computed_at: string;
}

export interface CandleWrite {
  instrument_id: string;
  timeframe: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source_provider: string;
  source_origin: string;
  is_demo: boolean;
  quality_status: QualityStatus;
  is_complete: boolean;
}

export interface InsertResult {
  inserted: number;
  duplicates: number;
}

/**
 * Inserts candles, ignoring rows that already exist so repeated fetches can
 * never duplicate time-series data (primary key is instrument/timeframe/ts).
 */
export function insertCandles(db: Db, rows: CandleWrite[]): InsertResult {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO candles
       (instrument_id, timeframe, ts, open, high, low, close, volume,
        source_provider, source_origin, is_demo, quality_status, is_complete, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ingestedAt = new Date().toISOString();
  let inserted = 0;
  withTx(db, () => {
    for (const row of rows) {
      const result = stmt.run(
        row.instrument_id,
        row.timeframe,
        row.ts,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.source_provider,
        row.source_origin,
        row.is_demo ? 1 : 0,
        row.quality_status,
        row.is_complete ? 1 : 0,
        ingestedAt,
      );
      inserted += Number(result.changes);
    }
  });
  return { inserted, duplicates: rows.length - inserted };
}

/** Updates quality status for a batch of candles (post-validation). */
export function updateCandleQuality(db: Db, instrumentId: string, timeframe: string, tsList: number[], status: QualityStatus): number {
  const stmt = db.prepare('UPDATE candles SET quality_status = ? WHERE instrument_id = ? AND timeframe = ? AND ts = ?');
  let changed = 0;
  withTx(db, () => {
    for (const ts of tsList) changed += Number(stmt.run(status, instrumentId, timeframe, ts).changes);
  });
  return changed;
}

export interface CandleQuery {
  instrumentId: string;
  timeframe: string;
  from?: number;
  to?: number;
  limit?: number;
  quality?: QualityStatus | 'ALL';
  ascending?: boolean;
}

export function getCandles(db: Db, query: CandleQuery): CandleRow[] {
  const where = ['instrument_id = ?', 'timeframe = ?'];
  const params: unknown[] = [query.instrumentId, query.timeframe];
  if (query.from !== undefined) {
    where.push('ts >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    where.push('ts <= ?');
    params.push(query.to);
  }
  if (query.quality && query.quality !== 'ALL') {
    where.push('quality_status = ?');
    params.push(query.quality);
  }
  const order = query.ascending === false ? 'DESC' : 'ASC';
  const limit = query.limit ?? 500;
  return db
    .prepare(`SELECT * FROM candles WHERE ${where.join(' AND ')} ORDER BY ts ${order} LIMIT ?`)
    .all(...(params as never[]), limit) as unknown as CandleRow[];
}

export interface CandleStats {
  count: number;
  minTs: number | null;
  maxTs: number | null;
  verified: number;
  suspect: number;
  rejected: number;
  pending: number;
}

export function candleStats(db: Db, instrumentId: string, timeframe: string): CandleStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(ts) AS min_ts, MAX(ts) AS max_ts,
              SUM(CASE WHEN quality_status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified,
              SUM(CASE WHEN quality_status = 'SUSPECT' THEN 1 ELSE 0 END) AS suspect,
              SUM(CASE WHEN quality_status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN quality_status = 'PENDING' THEN 1 ELSE 0 END) AS pending
       FROM candles WHERE instrument_id = ? AND timeframe = ?`,
    )
    .get(instrumentId, timeframe) as Record<string, number | null>;
  return {
    count: Number(row.count ?? 0),
    minTs: row.min_ts === null ? null : Number(row.min_ts),
    maxTs: row.max_ts === null ? null : Number(row.max_ts),
    verified: Number(row.verified ?? 0),
    suspect: Number(row.suspect ?? 0),
    rejected: Number(row.rejected ?? 0),
    pending: Number(row.pending ?? 0),
  };
}

export function upsertQuote(db: Db, quote: QuoteRow): void {
  db.prepare(
    `INSERT INTO quotes (instrument_id, last_price, change, change_percent, open, high, low, previous_close,
        volume, average_volume, bid, ask, market_status, freshness, source_provider, source_origin,
        is_demo, quality_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instrument_id) DO UPDATE SET
       last_price = excluded.last_price, change = excluded.change, change_percent = excluded.change_percent,
       open = excluded.open, high = excluded.high, low = excluded.low, previous_close = excluded.previous_close,
       volume = excluded.volume, average_volume = excluded.average_volume, bid = excluded.bid, ask = excluded.ask,
       market_status = excluded.market_status, freshness = excluded.freshness,
       source_provider = excluded.source_provider, source_origin = excluded.source_origin,
       is_demo = excluded.is_demo, quality_status = excluded.quality_status, updated_at = excluded.updated_at`,
  ).run(
    quote.instrument_id,
    quote.last_price,
    quote.change,
    quote.change_percent,
    quote.open,
    quote.high,
    quote.low,
    quote.previous_close,
    quote.volume,
    quote.average_volume,
    quote.bid,
    quote.ask,
    quote.market_status,
    quote.freshness,
    quote.source_provider,
    quote.source_origin,
    quote.is_demo,
    quote.quality_status,
    quote.updated_at,
  );
}

export function getQuotes(db: Db, instrumentIds?: string[]): QuoteRow[] {
  if (!instrumentIds || instrumentIds.length === 0) {
    return db.prepare('SELECT * FROM quotes').all() as unknown as QuoteRow[];
  }
  const placeholders = instrumentIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM quotes WHERE instrument_id IN (${placeholders})`)
    .all(...(instrumentIds as never[])) as unknown as QuoteRow[];
}

export function getQuote(db: Db, instrumentId: string): QuoteRow | undefined {
  return db.prepare('SELECT * FROM quotes WHERE instrument_id = ?').get(instrumentId) as unknown as QuoteRow | undefined;
}

export function upsertIndicatorValues(db: Db, rows: IndicatorRow[]): number {
  const stmt = db.prepare(
    `INSERT INTO indicator_values (instrument_id, timeframe, name, ts, value_json, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(instrument_id, timeframe, name, ts) DO UPDATE SET
       value_json = excluded.value_json, computed_at = excluded.computed_at`,
  );
  const computedAt = new Date().toISOString();
  let changed = 0;
  withTx(db, () => {
    for (const row of rows) {
      stmt.run(row.instrument_id, row.timeframe, row.name, row.ts, row.value_json, row.computed_at || computedAt);
      changed += 1;
    }
  });
  return changed;
}

export function getIndicatorValues(db: Db, instrumentId: string, timeframe: string, name: string, limit = 500): IndicatorRow[] {
  return db
    .prepare(
      'SELECT * FROM indicator_values WHERE instrument_id = ? AND timeframe = ? AND name = ? ORDER BY ts DESC LIMIT ?',
    )
    .all(instrumentId, timeframe, name, limit) as unknown as IndicatorRow[];
}
