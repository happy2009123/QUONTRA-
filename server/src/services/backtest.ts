/**
 * Strategy backtesting service.
 *
 * Event-driven, long-only simulator over stored candles with modelled
 * transaction costs. Results are explicitly marked simulated. Two signal
 * engines are provided and selected by strategy family:
 *   MEAN_REVERSION → RSI(14) band reversion
 *   everything else → SMA(fast) / SMA(slow) trend crossover
 *
 * Entry signals are evaluated only on completed candles (lookahead bias is
 * avoided by acting on bar i's close and filling at bar i+1's open).
 */

import type { Db } from '../db/db.ts';
import { getCandles } from '../db/repoSeries.ts';
import { getStrategy, insertBacktest, insertTrades, listBacktests, listTrades, type BacktestRow } from '../db/repoOps.ts';
import { AppError } from '../lib/errors.ts';
import { ema, rsi, sma } from './indicators.ts';
import type { Interval } from '../providers/types.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { getCandlesApi } from './marketDataService.ts';

export interface CostModel {
  brokerageBps: number;
  slippageBps: number;
  sttBps: number;
  exchangeFeesBps: number;
  gstPct: number;
}

export const DEFAULT_COSTS: CostModel = {
  brokerageBps: 3,
  slippageBps: 2,
  sttBps: 0.1 * 100, // 0.1% expressed in bps
  exchangeFeesBps: 0.5,
  gstPct: 18,
};

export interface BacktestInput {
  strategyId: string;
  instrumentIds: string[];
  from?: string;
  to?: string;
  costs?: CostModel;
  initialCapital?: number;
  riskPerTradePct?: number;
  outOfSamplePct?: number;
  timeframe?: Interval;
  /** When provided, missing history is ingested from providers before the run. */
  registry?: ProviderRegistry;
}

export interface BacktestTrade {
  id: string;
  instrumentId: string;
  symbol: string;
  direction: 'LONG';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  rMultiple: number;
  exitReason: 'TARGET' | 'STOP' | 'SIGNAL' | 'TIME';
}

export interface BacktestMetrics {
  netReturnPct: number;
  annualizedReturnPct: number;
  winRatePct: number;
  profitFactor: number;
  averageRewardRisk: number;
  tradeCount: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  expectancyR: number;
  netProfitAfterCosts: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface BacktestOutcome {
  id: string;
  strategyId: string;
  strategyName: string;
  instrumentIds: string[];
  window: { from: string; to: string };
  costs: CostModel;
  initialCapital: number;
  isSimulated: true;
  phase: 'IN_SAMPLE' | 'OUT_OF_SAMPLE';
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  warnings: string[];
  generatedAt: string;
  stored: boolean;
}

interface Signal {
  at: number; // bar index
  action: 'BUY' | 'EXIT';
}

function costRate(costs: CostModel): number {
  const bps = costs.brokerageBps + costs.slippageBps + costs.sttBps + costs.exchangeFeesBps;
  return (bps / 10_000) * (1 + costs.gstPct / 100);
}

function buildSignals(
  family: string,
  bars: { ts: number; close: number; open: number; high: number; low: number; volume: number }[],
): Signal[] {
  const closes = bars.map((b) => b.close);
  const signals: Signal[] = [];

  if (family === 'MEAN_REVERSION') {
    const rsiSeries = rsi(closes, 14);
    for (let i = 1; i < bars.length; i += 1) {
      const prev = rsiSeries[i - 1];
      const curr = rsiSeries[i];
      if (prev === null || curr === null) continue;
      if (prev < 30 && curr >= 30) signals.push({ at: i, action: 'BUY' });
      else if (prev > 70 && curr <= 70) signals.push({ at: i, action: 'EXIT' });
    }
    return signals;
  }

  if (family === 'MOMENTUM') {
    const fast = ema(closes, 12);
    const slow = ema(closes, 26);
    const signal = ema(
      closes.map((_, i) => (fast[i] === null || slow[i] === null ? 0 : (fast[i] as number) - (slow[i] as number))),
      9,
    );
    for (let i = 1; i < bars.length; i += 1) {
      const prevM = fast[i - 1];
      const prevS = slow[i - 1];
      const currM = fast[i];
      const currS = slow[i];
      if (prevM === null || prevS === null || currM === null || currS === null) continue;
      const prevHist = (prevM - prevS) - (signal[i - 1] ?? 0);
      const currHist = (currM - currS) - (signal[i] ?? 0);
      if (prevHist <= 0 && currHist > 0) signals.push({ at: i, action: 'BUY' });
      else if (prevHist >= 0 && currHist < 0) signals.push({ at: i, action: 'EXIT' });
    }
    return signals;
  }

  const fast = sma(closes, 20);
  const slow = sma(closes, 50);
  for (let i = 1; i < bars.length; i += 1) {
    const prevF = fast[i - 1];
    const prevS = slow[i - 1];
    const currF = fast[i];
    const currS = slow[i];
    if (prevF === null || prevS === null || currF === null || currS === null) continue;
    if (prevF <= prevS && currF > currS) signals.push({ at: i, action: 'BUY' });
    else if (prevF >= prevS && currF < currS) signals.push({ at: i, action: 'EXIT' });
  }
  return signals;
}

interface OpenPosition {
  instrumentId: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  entryIndex: number;
  entryTime: number;
  stop: number;
  target: number;
  riskPerUnit: number;
}

/** Runs one simulation pass over a slice of bars. */
function simulate(
  family: string,
  series: Array<{ instrumentId: string; symbol: string; bars: { ts: number; open: number; high: number; low: number; close: number; volume: number }[] }>,
  costs: CostModel,
  initialCapital: number,
  riskPerTradePct: number,
): { metrics: BacktestMetrics; equity: EquityPoint[]; trades: BacktestTrade[]; warnings: string[] } {
  const warnings: string[] = [];
  const rate = costRate(costs);
  let cash = initialCapital;
  const positions = new Map<string, OpenPosition>();
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [];

  // Build a merged timeline of bar indices across instruments (per-instrument
  // indices are tracked locally so multi-instrument runs stay aligned).
  const maxBars = Math.max(0, ...series.map((s) => s.bars.length));
  if (maxBars < 60) warnings.push(`Insufficient history (${maxBars} bars) — results are not statistically meaningful.`);

  for (let i = 1; i < maxBars; i += 1) {
    for (const entry of series) {
      const bars = entry.bars;
      if (i >= bars.length) continue;
      const bar = bars[i];
      const position = positions.get(entry.instrumentId);

      // Manage open position: stop / target / time exit.
      if (position) {
        let exitPrice: number | null = null;
        let reason: BacktestTrade['exitReason'] = 'SIGNAL';
        if (bar.low <= position.stop) {
          exitPrice = position.stop;
          reason = 'STOP';
        } else if (bar.high >= position.target) {
          exitPrice = position.target;
          reason = 'TARGET';
        } else if (i - position.entryIndex >= 20) {
          exitPrice = bar.close;
          reason = 'TIME';
        }
        if (exitPrice !== null) {
          const gross = (exitPrice - position.entryPrice) * position.quantity;
          const notional = (position.entryPrice + exitPrice) * position.quantity;
          const costsIncurred = notional * rate;
          const net = gross - costsIncurred;
          cash += position.quantity * exitPrice - costsIncurred;
          const r = position.riskPerUnit > 0 ? (exitPrice - position.entryPrice) / position.riskPerUnit : 0;
          trades.push({
            id: `trd-${entry.instrumentId}-${position.entryTime}-${i}`,
            instrumentId: entry.instrumentId,
            symbol: entry.symbol,
            direction: 'LONG',
            entryTime: new Date(position.entryTime * 1000).toISOString(),
            exitTime: new Date(bar.ts * 1000).toISOString(),
            entryPrice: round4(position.entryPrice),
            exitPrice: round4(exitPrice),
            quantity: position.quantity,
            grossPnl: round4(gross),
            costs: round4(costsIncurred),
            netPnl: round4(net),
            rMultiple: round4(r),
            exitReason: reason,
          });
          positions.delete(entry.instrumentId);
        }
      }

      // Evaluate signals on the close of bar i, fill at the open of bar i.
      const signals = buildSignals(family, bars.slice(0, i + 1)).filter((s) => s.at === i - 1);
      const hasBuy = signals.some((s) => s.action === 'BUY');
      const hasExit = signals.some((s) => s.action === 'EXIT');
      const current = positions.get(entry.instrumentId);

      if (!current && hasBuy) {
        const stopDistance = Math.max(bar.close * 0.01, (bar.high - bar.low) * 1.5 || bar.close * 0.01);
        const riskAmount = (cash * riskPerTradePct) / 100;
        const quantity = Math.floor(riskAmount / stopDistance);
        if (quantity >= 1 && cash > bar.open * quantity) {
          const entryPrice = bar.open;
          const notional = entryPrice * quantity;
          const entryCosts = notional * rate;
          cash -= notional + entryCosts;
          positions.set(entry.instrumentId, {
            instrumentId: entry.instrumentId,
            symbol: entry.symbol,
            quantity,
            entryPrice,
            entryIndex: i,
            entryTime: bar.ts,
            stop: entryPrice - stopDistance,
            target: entryPrice + stopDistance * 2,
            riskPerUnit: stopDistance,
          });
        }
      } else if (current && hasExit) {
        const exitPrice = bar.open;
        const gross = (exitPrice - current.entryPrice) * current.quantity;
        const notional = (current.entryPrice + exitPrice) * current.quantity;
        const costsIncurred = notional * rate;
        cash += current.quantity * exitPrice - costsIncurred;
        trades.push({
          id: `trd-${entry.instrumentId}-${current.entryTime}-${i}-sig`,
          instrumentId: entry.instrumentId,
          symbol: entry.symbol,
          direction: 'LONG',
          entryTime: new Date(current.entryTime * 1000).toISOString(),
          exitTime: new Date(bar.ts * 1000).toISOString(),
          entryPrice: round4(current.entryPrice),
          exitPrice: round4(exitPrice),
          quantity: current.quantity,
          grossPnl: round4(gross),
          costs: round4(costsIncurred),
          netPnl: round4(gross - costsIncurred),
          rMultiple: round4(current.riskPerUnit > 0 ? (exitPrice - current.entryPrice) / current.riskPerUnit : 0),
          exitReason: 'SIGNAL',
        });
        positions.delete(entry.instrumentId);
      }
    }

    // Mark-to-market equity across all instruments.
    let equityValue = cash;
    for (const [instrumentId, position] of positions) {
      const entry = series.find((s) => s.instrumentId === instrumentId);
      const bar = entry?.bars[i];
      const mark = bar?.close ?? position.entryPrice;
      equityValue += position.quantity * mark;
    }
    const time = series[0]?.bars[i]?.ts ?? 0;
    equity.push({ time, equity: round4(equityValue), drawdown: 0 });
  }

  // Drawdown pass.
  let peak = initialCapital;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    point.drawdown = peak > 0 ? round4(((peak - point.equity) / peak) * 100) : 0;
  }

  const metrics = computeMetrics(trades, equity, initialCapital);
  if (trades.length < 20) warnings.push(`Thin sample: only ${trades.length} trades — overfitting risk is elevated.`);
  warnings.push('Simulated performance with modelled costs; past or simulated results do not indicate future returns.');
  return { metrics, equity, trades, warnings };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function computeMetrics(trades: BacktestTrade[], equity: EquityPoint[], initialCapital: number): BacktestMetrics {
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const finalEquity = equity.at(-1)?.equity ?? initialCapital;
  const netProfit = finalEquity - initialCapital;
  const netReturnPct = (netProfit / initialCapital) * 100;

  const firstTime = equity[0]?.time ?? 0;
  const lastTime = equity.at(-1)?.time ?? 0;
  const days = Math.max(1, (lastTime - firstTime) / 86_400);
  const years = days / 365;
  const annualizedReturnPct =
    years > 0 && finalEquity > 0 ? (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100 : 0;

  const returns: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = equity[i - 1].equity;
    if (prev > 0) returns.push(equity[i].equity / prev - 1);
  }
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
  const std = Math.sqrt(variance);
  const downside = returns.filter((r) => r < 0);
  const downsideVar = downside.length > 1 ? downside.reduce((a, r) => a + r ** 2, 0) / downside.length : 0;
  const downsideDev = Math.sqrt(downsideVar);

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRatePct = trades.length ? (wins.length / trades.length) * 100 : 0;
  const maxDrawdownPct = equity.reduce((max, p) => Math.max(max, p.drawdown), 0);

  return {
    netReturnPct: round4(netReturnPct),
    annualizedReturnPct: round4(annualizedReturnPct),
    winRatePct: round4(winRatePct),
    profitFactor: grossLoss > 0 ? round4(grossProfit / grossLoss) : grossProfit > 0 ? 999 : 0,
    averageRewardRisk: avgLoss > 0 ? round4(avgWin / avgLoss) : 0,
    tradeCount: trades.length,
    maxDrawdownPct: round4(maxDrawdownPct),
    sharpe: std > 0 ? round4((mean / std) * Math.sqrt(252)) : 0,
    sortino: downsideDev > 0 ? round4((mean / downsideDev) * Math.sqrt(252)) : 0,
    expectancyR: avgLoss > 0 ? round4((winRatePct / 100) * (avgWin / avgLoss) - (1 - winRatePct / 100)) : 0,
    netProfitAfterCosts: round4(netProfit),
  };
}

/** Executes a backtest, persists the result and returns the API payload. */
export async function runBacktest(db: Db, input: BacktestInput): Promise<BacktestOutcome> {
  const strategy = getStrategy(db, input.strategyId);
  if (!strategy) throw new AppError('NOT_FOUND', `Unknown strategy "${input.strategyId}"`);
  if (input.instrumentIds.length === 0) throw new AppError('VALIDATION_ERROR', 'At least one instrument is required');

  const timeframe: Interval = input.timeframe ?? '1D';
  const costs = input.costs ?? DEFAULT_COSTS;
  const initialCapital = input.initialCapital ?? 1_000_000;
  const riskPerTradePct = input.riskPerTradePct ?? 1;
  const outOfSamplePct = clamp(input.outOfSamplePct ?? 0, 0, 0.6);

  const fromMs = input.from ? Date.parse(input.from) : undefined;
  const toMs = input.to ? Date.parse(input.to) : undefined;

  const series: Array<{ instrumentId: string; symbol: string; bars: Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }> }> = [];
  for (const id of input.instrumentIds) {
    const instrument = db.prepare('SELECT symbol FROM instruments WHERE id = ?').get(id) as { symbol: string } | undefined;
    if (!instrument) throw new AppError('NOT_FOUND', `Unknown instrument "${id}"`);

    // Ingest missing history from providers when the local store is too thin.
    if (input.registry) {
      const stored = db
        .prepare('SELECT COUNT(*) AS c FROM candles WHERE instrument_id = ? AND timeframe = ?')
        .get(id, timeframe) as { c: number };
      if (stored.c < 60) await getCandlesApi(db, input.registry, id, timeframe, { limit: 1_500 });
    }

    const candles = getCandles(db, {
      instrumentId: id,
      timeframe,
      from: fromMs !== undefined ? Math.floor(fromMs / 1000) : undefined,
      to: toMs !== undefined ? Math.floor(toMs / 1000) : undefined,
      limit: 2_000,
      ascending: true,
      quality: 'ALL',
    });
    series.push({
      instrumentId: id,
      symbol: instrument.symbol,
      bars: candles.map((c) => ({ ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    });
  }

  const warnings: string[] = [];
  const usable = series.filter((s) => s.bars.length >= 60);
  if (usable.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No instrument has enough candle history to backtest (need >= 60 bars).', {
      instrumentIds: input.instrumentIds,
      timeframe,
    });
  }
  if (usable.length < series.length) {
    warnings.push(`${series.length - usable.length} instrument(s) skipped for insufficient history.`);
  }

  // Out-of-sample split: run the tail segment as the reported phase.
  const minBars = Math.min(...usable.map((s) => s.bars.length));
  const splitIndex = outOfSamplePct > 0 ? Math.floor(minBars * (1 - outOfSamplePct)) : 0;
  const sliced = usable.map((s) => ({ ...s, bars: s.bars.slice(splitIndex) }));
  const phase: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' = outOfSamplePct > 0 ? 'OUT_OF_SAMPLE' : 'IN_SAMPLE';

  const result = simulate(strategy.family, sliced, costs, initialCapital, riskPerTradePct);
  if (outOfSamplePct > 0) {
    const inSample = simulate(strategy.family, usable.map((s) => ({ ...s, bars: s.bars.slice(0, splitIndex) })), costs, initialCapital, riskPerTradePct);
    warnings.push(
      `Out-of-sample window is the last ${Math.round(outOfSamplePct * 100)}% of the data: in-sample net ${inSample.metrics.netReturnPct.toFixed(2)}% vs out-of-sample net ${result.metrics.netReturnPct.toFixed(2)}%.`,
    );
  }

  const windowFrom = new Date((usable[0].bars[splitIndex]?.ts ?? usable[0].bars[0].ts) * 1000).toISOString();
  const windowTo = new Date(usable[0].bars.at(-1)!.ts * 1000).toISOString();
  const generatedAt = new Date().toISOString();
  const id = `bt-${strategy.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const outcome: BacktestOutcome = {
    id,
    strategyId: strategy.id,
    strategyName: strategy.name,
    instrumentIds: usable.map((s) => s.instrumentId),
    window: { from: windowFrom, to: windowTo },
    costs,
    initialCapital,
    isSimulated: true,
    phase,
    metrics: result.metrics,
    equityCurve: result.equity,
    trades: result.trades,
    warnings: [...warnings, ...result.warnings],
    generatedAt,
    stored: false,
  };

  insertBacktest(db, {
    id,
    strategy_id: strategy.id,
    instrument_ids: JSON.stringify(outcome.instrumentIds),
    window_from: windowFrom,
    window_to: windowTo,
    costs_json: JSON.stringify(costs),
    initial_capital: initialCapital,
    phase,
    metrics_json: JSON.stringify(result.metrics),
    equity_json: JSON.stringify(result.equity),
    warnings_json: JSON.stringify(outcome.warnings),
    is_simulated: 1,
    created_at: generatedAt,
  });
  insertTrades(
    db,
    result.trades.map((t) => ({
      id: t.id,
      backtest_id: id,
      instrument_id: t.instrumentId,
      symbol: t.symbol,
      direction: t.direction,
      entry_ts: t.entryTime,
      exit_ts: t.exitTime,
      entry_price: t.entryPrice,
      exit_price: t.exitPrice,
      quantity: t.quantity,
      gross_pnl: t.grossPnl,
      costs: t.costs,
      net_pnl: t.netPnl,
      r_multiple: t.rMultiple,
      exit_reason: t.exitReason,
    })),
  );
  outcome.stored = true;
  return outcome;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Reconstructs a stored backtest (with trades) for the API. */
export function getStoredBacktest(db: Db, id: string): (BacktestOutcome & { stored: true }) | null {
  const row = getBacktestRow(db, id);
  return row ? hydrate(db, row) : null;
}

function getBacktestRow(db: Db, id: string): BacktestRow | undefined {
  return listBacktests(db, undefined, 1, 0).items.find((r) => r.id === id) ?? findBacktest(db, id);
}

function findBacktest(db: Db, id: string): BacktestRow | undefined {
  return db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(id) as unknown as BacktestRow | undefined;
}

function hydrate(db: Db, row: BacktestRow): BacktestOutcome & { stored: true } {
  const trades = listTrades(db, row.id).map(
    (t): BacktestTrade => ({
      id: t.id,
      instrumentId: t.instrument_id,
      symbol: t.symbol,
      direction: 'LONG',
      entryTime: t.entry_ts,
      exitTime: t.exit_ts,
      entryPrice: t.entry_price,
      exitPrice: t.exit_price,
      quantity: t.quantity,
      grossPnl: t.gross_pnl,
      costs: t.costs,
      netPnl: t.net_pnl,
      rMultiple: t.r_multiple,
      exitReason: t.exit_reason as BacktestTrade['exitReason'],
    }),
  );
  return {
    id: row.id,
    strategyId: row.strategy_id,
    strategyName: getStrategy(db, row.strategy_id)?.name ?? row.strategy_id,
    instrumentIds: JSON.parse(row.instrument_ids) as string[],
    window: { from: row.window_from, to: row.window_to },
    costs: JSON.parse(row.costs_json) as CostModel,
    initialCapital: row.initial_capital,
    isSimulated: true,
    phase: row.phase as 'IN_SAMPLE' | 'OUT_OF_SAMPLE',
    metrics: JSON.parse(row.metrics_json) as BacktestMetrics,
    equityCurve: JSON.parse(row.equity_json) as EquityPoint[],
    trades,
    warnings: JSON.parse(row.warnings_json) as string[],
    generatedAt: row.created_at,
    stored: true,
  };
}

/** Recent stored backtests (summary rows for the API list). */
export function listStoredBacktests(db: Db, strategyId?: string, limit = 20, offset = 0): { items: Array<Record<string, unknown>>; total: number } {
  const page = listBacktests(db, strategyId, limit, offset);
  return {
    total: page.total,
    items: page.items.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id,
      strategyName: getStrategy(db, row.strategy_id)?.name ?? row.strategy_id,
      window: { from: row.window_from, to: row.window_to },
      phase: row.phase,
      metrics: JSON.parse(row.metrics_json) as BacktestMetrics,
      isSimulated: true,
      createdAt: row.created_at,
    })),
  };
}

/** Compares strategies by running the same window for each. */
export async function compareStrategies(
  db: Db,
  strategyIds: string[],
  instrumentIds: string[],
  registry?: ProviderRegistry,
): Promise<{ rows: Array<Record<string, unknown>>; warnings: string[] }> {
  if (strategyIds.length === 0) throw new AppError('VALIDATION_ERROR', 'Provide at least one strategy id');
  const rows: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  for (const strategyId of strategyIds) {
    try {
      const outcome = await runBacktest(db, { strategyId, instrumentIds, outOfSamplePct: 0.3, registry });
      rows.push({
        strategyId: outcome.strategyId,
        strategyName: outcome.strategyName,
        metrics: outcome.metrics,
        phase: outcome.phase,
        backtestId: outcome.id,
      });
    } catch (err) {
      warnings.push(`${strategyId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { rows, warnings };
}
