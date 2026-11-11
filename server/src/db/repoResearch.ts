/** Repositories for research output: opportunities, events, daily reports. */

import type { Db } from './db.ts';

export interface OpportunityRow {
  id: string;
  instrument_id: string;
  strategy_id: string;
  strategy_name: string;
  direction: string;
  signal: string;
  timeframe: string;
  score: number;
  last_price: number;
  currency: string;
  observed_at: string;
  source_json: string;
  entry_trigger: string;
  entry_zone_low: number;
  entry_zone_high: number;
  stop_loss: number;
  target1: number;
  target2: number;
  planned_rr: number;
  liquidity: string;
  spread_bps: number;
  technical_explanation: string;
  risk_factors_json: string;
  quality_json: string;
  data_quality: string;
  created_at: string;
}

export interface MarketEventRow {
  id: string;
  instrument_id: string | null;
  kind: string;
  title: string;
  country: string | null;
  impact: string | null;
  payload_json: string | null;
  source_provider: string;
  is_demo: number;
  occurred_at: string;
}

export interface DailyReportRow {
  id: string;
  report_date: string;
  market: string;
  title: string;
  payload_json: string;
  source_json: string;
  no_qualified_setups: number;
  generated_at: string;
}

export function insertOpportunity(db: Db, row: OpportunityRow): void {
  db.prepare(
    `INSERT INTO opportunities (id, instrument_id, strategy_id, strategy_name, direction, signal, timeframe,
        score, last_price, currency, observed_at, source_json, entry_trigger, entry_zone_low, entry_zone_high,
        stop_loss, target1, target2, planned_rr, liquidity, spread_bps, technical_explanation,
        risk_factors_json, quality_json, data_quality, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    row.id,
    row.instrument_id,
    row.strategy_id,
    row.strategy_name,
    row.direction,
    row.signal,
    row.timeframe,
    row.score,
    row.last_price,
    row.currency,
    row.observed_at,
    row.source_json,
    row.entry_trigger,
    row.entry_zone_low,
    row.entry_zone_high,
    row.stop_loss,
    row.target1,
    row.target2,
    row.planned_rr,
    row.liquidity,
    row.spread_bps,
    row.technical_explanation,
    row.risk_factors_json,
    row.quality_json,
    row.data_quality,
    row.created_at,
  );
}

export interface OpportunityQuery {
  market?: string;
  instrumentId?: string;
  strategyId?: string;
  minScore?: number;
  signal?: string;
  limit?: number;
  offset?: number;
}

export function listOpportunities(db: Db, query: OpportunityQuery = {}): { items: OpportunityRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.market && query.market !== 'ALL') {
    where.push('i.market_category = ?');
    params.push(query.market);
  }
  if (query.instrumentId) {
    where.push('o.instrument_id = ?');
    params.push(query.instrumentId);
  }
  if (query.strategyId) {
    where.push('o.strategy_id = ?');
    params.push(query.strategyId);
  }
  if (query.signal) {
    where.push('o.signal = ?');
    params.push(query.signal);
  }
  if (query.minScore !== undefined) {
    where.push('o.score >= ?');
    params.push(query.minScore);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM opportunities o JOIN instruments i ON i.id = o.instrument_id ${whereSql}`)
      .get(...(params as never[])) as { c: number }
  ).c;
  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;
  const items = db
    .prepare(
      `SELECT o.* FROM opportunities o JOIN instruments i ON i.id = o.instrument_id
       ${whereSql} ORDER BY o.score DESC, o.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...(params as never[]), limit, offset) as unknown as OpportunityRow[];
  return { items, total };
}

export function getOpportunity(db: Db, id: string): OpportunityRow | undefined {
  return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as unknown as OpportunityRow | undefined;
}

export function upsertEvent(db: Db, row: MarketEventRow): void {
  db.prepare(
    `INSERT INTO market_events (id, instrument_id, kind, title, country, impact, payload_json, source_provider, is_demo, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, impact = excluded.impact,
       payload_json = excluded.payload_json, occurred_at = excluded.occurred_at`,
  ).run(
    row.id,
    row.instrument_id,
    row.kind,
    row.title,
    row.country,
    row.impact,
    row.payload_json,
    row.source_provider,
    row.is_demo,
    row.occurred_at,
  );
}

export function listEvents(db: Db, limit = 50, fromIso?: string): MarketEventRow[] {
  if (fromIso) {
    return db
      .prepare('SELECT * FROM market_events WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT ?')
      .all(fromIso, limit) as unknown as MarketEventRow[];
  }
  return db
    .prepare('SELECT * FROM market_events ORDER BY occurred_at DESC LIMIT ?')
    .all(limit) as unknown as MarketEventRow[];
}

export function upsertDailyReport(db: Db, row: DailyReportRow): void {
  db.prepare(
    `INSERT INTO daily_reports (id, report_date, market, title, payload_json, source_json, no_qualified_setups, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(report_date, market) DO UPDATE SET
       title = excluded.title, payload_json = excluded.payload_json, source_json = excluded.source_json,
       no_qualified_setups = excluded.no_qualified_setups, generated_at = excluded.generated_at`,
  ).run(
    row.id,
    row.report_date,
    row.market,
    row.title,
    row.payload_json,
    row.source_json,
    row.no_qualified_setups,
    row.generated_at,
  );
}

export function getDailyReport(db: Db, date: string, market: string): DailyReportRow | undefined {
  return db
    .prepare('SELECT * FROM daily_reports WHERE report_date = ? AND market = ?')
    .get(date, market) as unknown as DailyReportRow | undefined;
}

export function listDailyReports(db: Db, limit = 30, offset = 0): { items: DailyReportRow[]; total: number } {
  const total = (db.prepare('SELECT COUNT(*) AS c FROM daily_reports').get() as { c: number }).c;
  const items = db
    .prepare('SELECT * FROM daily_reports ORDER BY report_date DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as unknown as DailyReportRow[];
  return { items, total };
}
