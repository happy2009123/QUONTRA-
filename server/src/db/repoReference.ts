/** Repositories for reference data: markets, instruments, sessions. */

import type { Db } from './db.ts';

export interface MarketRow {
  id: string;
  category: string;
  name: string;
  region: string;
  timezone: string;
  weekday_open_min: number;
  weekday_close_min: number;
  weekdays: string;
  currency: string;
  created_at: string;
}

export interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  market_category: string;
  exchange: string;
  region: string;
  type: string;
  currency: string;
  sector: string | null;
  provider_id: string | null;
  provider_symbol: string | null;
  restriction_code: string | null;
  restriction_summary: string | null;
  restriction_detail: string | null;
  is_active: number;
  created_at: string;
}

export interface SessionRow {
  id: string;
  market_id: string;
  session_date: string;
  open_at_utc: string;
  close_at_utc: string;
  status: string;
  is_holiday: number;
  note: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function upsertMarket(db: Db, market: Omit<MarketRow, 'created_at'> & { created_at?: string }): void {
  db.prepare(
    `INSERT INTO markets (id, category, name, region, timezone, weekday_open_min, weekday_close_min, weekdays, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category) DO UPDATE SET
       name = excluded.name, region = excluded.region, timezone = excluded.timezone,
       weekday_open_min = excluded.weekday_open_min, weekday_close_min = excluded.weekday_close_min,
       weekdays = excluded.weekdays, currency = excluded.currency`,
  ).run(
    market.id,
    market.category,
    market.name,
    market.region,
    market.timezone,
    market.weekday_open_min,
    market.weekday_close_min,
    market.weekdays,
    market.currency,
    market.created_at ?? new Date().toISOString(),
  );
}

export function listMarkets(db: Db): MarketRow[] {
  return db.prepare('SELECT * FROM markets ORDER BY category').all() as unknown as MarketRow[];
}

export function upsertInstrument(db: Db, inst: Omit<InstrumentRow, 'created_at'> & { created_at?: string }): void {
  db.prepare(
    `INSERT INTO instruments (id, symbol, name, market_category, exchange, region, type, currency, sector,
       provider_id, provider_symbol, restriction_code, restriction_summary, restriction_detail, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       symbol = excluded.symbol, name = excluded.name, market_category = excluded.market_category,
       exchange = excluded.exchange, region = excluded.region, type = excluded.type, currency = excluded.currency,
       sector = excluded.sector, provider_id = excluded.provider_id, provider_symbol = excluded.provider_symbol,
       restriction_code = excluded.restriction_code, restriction_summary = excluded.restriction_summary,
       restriction_detail = excluded.restriction_detail, is_active = excluded.is_active`,
  ).run(
    inst.id,
    inst.symbol,
    inst.name,
    inst.market_category,
    inst.exchange,
    inst.region,
    inst.type,
    inst.currency,
    inst.sector,
    inst.provider_id,
    inst.provider_symbol,
    inst.restriction_code,
    inst.restriction_summary,
    inst.restriction_detail,
    inst.is_active,
    inst.created_at ?? new Date().toISOString(),
  );
}

export interface InstrumentQuery {
  search?: string;
  market?: string;
  sector?: string;
  exchange?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function listInstruments(db: Db, query: InstrumentQuery = {}): Page<InstrumentRow> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.activeOnly !== false) where.push('is_active = 1');
  if (query.search) {
    where.push('(symbol LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE)');
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  if (query.market && query.market !== 'ALL') {
    where.push('market_category = ?');
    params.push(query.market);
  }
  if (query.sector && query.sector !== 'ALL') {
    where.push('sector = ?');
    params.push(query.sector);
  }
  if (query.exchange && query.exchange !== 'ALL') {
    where.push('exchange = ?');
    params.push(query.exchange);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM instruments ${whereSql}`).get(...(params as never[])) as { c: number }
  ).c;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const items = db
    .prepare(`SELECT * FROM instruments ${whereSql} ORDER BY symbol LIMIT ? OFFSET ?`)
    .all(...(params as never[]), limit, offset) as unknown as InstrumentRow[];
  return { items, total, limit, offset };
}

export function getInstrument(db: Db, id: string): InstrumentRow | undefined {
  return db.prepare('SELECT * FROM instruments WHERE id = ?').get(id) as unknown as InstrumentRow | undefined;
}

export function getInstrumentsByIds(db: Db, ids: string[]): InstrumentRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM instruments WHERE id IN (${placeholders})`)
    .all(...(ids as never[])) as unknown as InstrumentRow[];
}

export function getInstrumentBySymbol(db: Db, symbol: string, exchange?: string): InstrumentRow | undefined {
  if (exchange) {
    return db.prepare('SELECT * FROM instruments WHERE symbol = ? AND exchange = ?').get(symbol, exchange) as unknown as InstrumentRow | undefined;
  }
  return db.prepare('SELECT * FROM instruments WHERE symbol = ? LIMIT 1').get(symbol) as unknown as InstrumentRow | undefined;
}

export function countInstruments(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM instruments WHERE is_active = 1').get() as { c: number }).c;
}

export function upsertSession(db: Db, session: Omit<SessionRow, 'created_at'> & { created_at?: string }): void {
  db.prepare(
    `INSERT INTO market_sessions (id, market_id, session_date, open_at_utc, close_at_utc, status, is_holiday, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(market_id, session_date) DO UPDATE SET
       open_at_utc = excluded.open_at_utc, close_at_utc = excluded.close_at_utc,
       status = excluded.status, is_holiday = excluded.is_holiday, note = excluded.note`,
  ).run(
    session.id,
    session.market_id,
    session.session_date,
    session.open_at_utc,
    session.close_at_utc,
    session.status,
    session.is_holiday,
    session.note,
    session.created_at ?? new Date().toISOString(),
  );
}

export function listSessions(db: Db, marketId: string, fromDate: string, toDate: string): SessionRow[] {
  return db
    .prepare(
      'SELECT * FROM market_sessions WHERE market_id = ? AND session_date BETWEEN ? AND ? ORDER BY session_date',
    )
    .all(marketId, fromDate, toDate) as unknown as SessionRow[];
}
