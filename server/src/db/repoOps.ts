/** Repositories for strategies, backtests, paper trades, risk, provider health and logs. */

import type { Db } from './db.ts';
import { withTx } from './tx.ts';

export interface StrategyRow {
  id: string;
  name: string;
  family: string;
  description: string;
  timeframe: string;
  config_json: string;
  created_at: string;
}

export interface BacktestRow {
  id: string;
  strategy_id: string;
  instrument_ids: string;
  window_from: string;
  window_to: string;
  costs_json: string;
  initial_capital: number;
  phase: string;
  metrics_json: string;
  equity_json: string;
  warnings_json: string;
  is_simulated: number;
  created_at: string;
}

export interface TradeRow {
  id: string;
  backtest_id: string;
  instrument_id: string;
  symbol: string;
  direction: string;
  entry_ts: string;
  exit_ts: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pnl: number;
  costs: number;
  net_pnl: number;
  r_multiple: number;
  exit_reason: string;
}

export interface PaperTradeRow {
  id: string;
  instrument_id: string;
  strategy_id: string | null;
  direction: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface RiskCalculationRow {
  id: string;
  kind: string;
  instrument_id: string | null;
  input_json: string;
  result_json: string;
  data_quality: string;
  created_at: string;
}

export interface ProviderStatusRow {
  provider_id: string;
  name: string;
  vendor: string;
  status: string;
  last_success_at: string | null;
  last_error: string | null;
  latency_ms: number;
  freshness_seconds: number;
  reliability_pct: number;
  is_demo: number;
  rate_limit_used: number;
  rate_limit_limit: number;
  rate_limit_resets_at: string | null;
  requests_today: number;
  requests_month: number;
  supported_markets: string;
  updated_at: string;
}

export interface SystemLogRow {
  id: number;
  ts: string;
  level: string;
  source: string;
  message: string;
  context_json: string | null;
}

export function upsertStrategy(db: Db, row: Omit<StrategyRow, 'created_at'> & { created_at?: string }): void {
  db.prepare(
    `INSERT INTO strategies (id, name, family, description, timeframe, config_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, family = excluded.family,
       description = excluded.description, timeframe = excluded.timeframe, config_json = excluded.config_json`,
  ).run(
    row.id,
    row.name,
    row.family,
    row.description,
    row.timeframe,
    row.config_json,
    row.created_at ?? new Date().toISOString(),
  );
}

export function listStrategies(db: Db): StrategyRow[] {
  return db.prepare('SELECT * FROM strategies ORDER BY name').all() as unknown as StrategyRow[];
}

export function getStrategy(db: Db, id: string): StrategyRow | undefined {
  return db.prepare('SELECT * FROM strategies WHERE id = ?').get(id) as unknown as StrategyRow | undefined;
}

export function insertStrategyConfig(db: Db, id: string, strategyId: string, version: number, configJson: string, isActive: boolean): void {
  db.prepare(
    `INSERT INTO strategy_configs (id, strategy_id, version, config_json, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(strategy_id, version) DO NOTHING`,
  ).run(id, strategyId, version, configJson, isActive ? 1 : 0, new Date().toISOString());
}

export function insertConditions(
  db: Db,
  rows: { id: string; strategyId: string; kind: 'ENTRY' | 'EXIT'; ordinal: number; leftExpr: string; operator: string; rightExpr: string; lookback: number }[],
): void {
  const stmt = db.prepare(
    `INSERT INTO entry_exit_conditions (id, strategy_id, kind, ordinal, left_expr, operator, right_expr, lookback)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  );
  withTx(db, () => {
    for (const r of rows) stmt.run(r.id, r.strategyId, r.kind, r.ordinal, r.leftExpr, r.operator, r.rightExpr, r.lookback);
  });
}

export function listConditions(db: Db, strategyId: string, kind?: 'ENTRY' | 'EXIT'): Record<'ENTRY' | 'EXIT', unknown[]> {
  const rows = kind
    ? (db.prepare('SELECT * FROM entry_exit_conditions WHERE strategy_id = ? AND kind = ? ORDER BY ordinal').all(strategyId, kind) as unknown as Record<string, unknown>[])
    : (db.prepare('SELECT * FROM entry_exit_conditions WHERE strategy_id = ? ORDER BY kind, ordinal').all(strategyId) as unknown as Record<string, unknown>[]);
  const out: Record<'ENTRY' | 'EXIT', unknown[]> = { ENTRY: [], EXIT: [] };
  for (const row of rows) out[row.kind as 'ENTRY' | 'EXIT'].push(row);
  return out;
}

export function insertBacktest(db: Db, row: BacktestRow): void {
  db.prepare(
    `INSERT INTO backtest_results (id, strategy_id, instrument_ids, window_from, window_to, costs_json,
        initial_capital, phase, metrics_json, equity_json, warnings_json, is_simulated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    row.id,
    row.strategy_id,
    row.instrument_ids,
    row.window_from,
    row.window_to,
    row.costs_json,
    row.initial_capital,
    row.phase,
    row.metrics_json,
    row.equity_json,
    row.warnings_json,
    row.is_simulated,
    row.created_at,
  );
}

export function getBacktest(db: Db, id: string): BacktestRow | undefined {
  return db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(id) as unknown as BacktestRow | undefined;
}

export function listBacktests(db: Db, strategyId?: string, limit = 20, offset = 0): { items: BacktestRow[]; total: number } {
  const where = strategyId ? 'WHERE strategy_id = ?' : '';
  const params = strategyId ? [strategyId] : [];
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM backtest_results ${where}`).get(...(params as never[])) as { c: number }
  ).c;
  const items = db
    .prepare(`SELECT * FROM backtest_results ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...(params as never[]), limit, offset) as unknown as BacktestRow[];
  return { items, total };
}

export function insertTrades(db: Db, trades: TradeRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO backtest_trades (id, backtest_id, instrument_id, symbol, direction, entry_ts, exit_ts,
        entry_price, exit_price, quantity, gross_pnl, costs, net_pnl, r_multiple, exit_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  );
  withTx(db, () => {
    for (const t of trades) {
      stmt.run(
        t.id, t.backtest_id, t.instrument_id, t.symbol, t.direction, t.entry_ts, t.exit_ts,
        t.entry_price, t.exit_price, t.quantity, t.gross_pnl, t.costs, t.net_pnl, t.r_multiple, t.exit_reason,
      );
    }
  });
}

export function listTrades(db: Db, backtestId: string, limit = 500): TradeRow[] {
  return db
    .prepare('SELECT * FROM backtest_trades WHERE backtest_id = ? ORDER BY entry_ts LIMIT ?')
    .all(backtestId, limit) as unknown as TradeRow[];
}

export function insertPaperTrade(db: Db, row: PaperTradeRow): void {
  db.prepare(
    `INSERT INTO paper_trades (id, instrument_id, strategy_id, direction, quantity, entry_price, exit_price,
        status, opened_at, closed_at, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).run(
    row.id, row.instrument_id, row.strategy_id, row.direction, row.quantity, row.entry_price, row.exit_price,
    row.status, row.opened_at, row.closed_at, row.notes, row.created_at,
  );
}

export function listPaperTrades(db: Db, status?: string, limit = 100): PaperTradeRow[] {
  if (status) {
    return db
      .prepare('SELECT * FROM paper_trades WHERE status = ? ORDER BY opened_at DESC LIMIT ?')
      .all(status, limit) as unknown as PaperTradeRow[];
  }
  return db.prepare('SELECT * FROM paper_trades ORDER BY opened_at DESC LIMIT ?').all(limit) as unknown as PaperTradeRow[];
}

export function insertRiskCalculation(db: Db, row: RiskCalculationRow): void {
  db.prepare(
    `INSERT INTO risk_calculations (id, kind, instrument_id, input_json, result_json, data_quality, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).run(row.id, row.kind, row.instrument_id, row.input_json, row.result_json, row.data_quality, row.created_at);
}

export function listRiskCalculations(db: Db, limit = 50): RiskCalculationRow[] {
  return db
    .prepare('SELECT * FROM risk_calculations ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as RiskCalculationRow[];
}

export function upsertProviderStatus(db: Db, row: ProviderStatusRow): void {
  db.prepare(
    `INSERT INTO provider_status (provider_id, name, vendor, status, last_success_at, last_error, latency_ms,
        freshness_seconds, reliability_pct, is_demo, rate_limit_used, rate_limit_limit, rate_limit_resets_at,
        requests_today, requests_month, supported_markets, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id) DO UPDATE SET
       name = excluded.name, vendor = excluded.vendor, status = excluded.status,
       last_success_at = excluded.last_success_at, last_error = excluded.last_error,
       latency_ms = excluded.latency_ms, freshness_seconds = excluded.freshness_seconds,
       reliability_pct = excluded.reliability_pct, is_demo = excluded.is_demo,
       rate_limit_used = excluded.rate_limit_used, rate_limit_limit = excluded.rate_limit_limit,
       rate_limit_resets_at = excluded.rate_limit_resets_at, requests_today = excluded.requests_today,
       requests_month = excluded.requests_month, supported_markets = excluded.supported_markets,
       updated_at = excluded.updated_at`,
  ).run(
    row.provider_id, row.name, row.vendor, row.status, row.last_success_at, row.last_error, row.latency_ms,
    row.freshness_seconds, row.reliability_pct, row.is_demo, row.rate_limit_used, row.rate_limit_limit,
    row.rate_limit_resets_at, row.requests_today, row.requests_month, row.supported_markets, row.updated_at,
  );
}

export function listProviderStatus(db: Db): ProviderStatusRow[] {
  return db.prepare('SELECT * FROM provider_status ORDER BY provider_id').all() as unknown as ProviderStatusRow[];
}

export function insertSystemLog(db: Db, row: { level: string; source: string; message: string; context?: unknown }): void {
  db.prepare(
    'INSERT INTO system_logs (ts, level, source, message, context_json) VALUES (?, ?, ?, ?, ?)',
  ).run(new Date().toISOString(), row.level, row.source, row.message, row.context === undefined ? null : JSON.stringify(row.context));
}

export function listSystemLogs(db: Db, options: { level?: string; limit?: number } = {}): SystemLogRow[] {
  const limit = options.limit ?? 100;
  if (options.level) {
    return db
      .prepare('SELECT * FROM system_logs WHERE level = ? ORDER BY id DESC LIMIT ?')
      .all(options.level, limit) as unknown as SystemLogRow[];
  }
  return db.prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT ?').all(limit) as unknown as SystemLogRow[];
}
