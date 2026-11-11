/**
 * Opportunity ranking service.
 *
 * Turns qualified scanner rows into persisted opportunities with an explicit
 * source, timestamp and quality label. Every opportunity states that the
 * score is a confluence metric, not a win probability.
 */

import type { Db } from '../db/db.ts';
import { getInstrument } from '../db/repoReference.ts';
import { getOpportunity, listOpportunities, type OpportunityRow } from '../db/repoResearch.ts';
import { insertSystemLog } from '../db/repoOps.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { scan, type ScannerRow } from './scanner.ts';

export const SCORE_DISCLAIMER =
  'Strategy-quality score is a 0-100 confluence measure, NOT a win probability, expected return or guarantee.';

export interface GenerateOpportunitiesOptions {
  market?: string;
  minScore?: number;
  limit?: number;
  timeframe?: string;
  dryRun?: boolean;
  /** Max instruments to ingest history for during the scan (default 60). */
  ingestLimit?: number;
}

export interface GeneratedOpportunity {
  id: string;
  instrumentId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  signal: 'BUY' | 'SELL' | 'WATCH';
  score: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  source: string;
  isDemo: boolean;
  createdAt: string;
  stored: boolean;
}

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Builds an opportunity from a scanner row using ATR-derived levels. */
function build(row: ScannerRow): GeneratedOpportunity | null {
  if (row.dataStatus !== 'OK' || row.score < 60) return null;
  if (row.signal !== 'BUY' && row.signal !== 'SELL') return null;
  const price = row.lastPrice;
  const atr = row.indicators.atr14 ?? price * 0.01;
  if (!(price > 0)) return null;

  const direction = row.signal === 'BUY' ? 'LONG' : 'SHORT';
  const stopDistance = atr * 1.5;
  const stopLoss = direction === 'LONG' ? price - stopDistance : price + stopDistance;
  const target1 = direction === 'LONG' ? price + stopDistance * 1.2 : price - stopDistance * 1.2;
  const target2 = direction === 'LONG' ? price + stopDistance * 2.4 : price - stopDistance * 2.4;
  const riskReward = stopDistance > 0 ? round(((direction === 'LONG' ? target1 - price : price - target1) / stopDistance), 2) : 0;

  const createdAt = new Date().toISOString();
  const id = `opp-${row.instrumentId}-${row.timeframe}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, '');

  return {
    id,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    direction,
    signal: row.signal,
    score: row.score,
    entryPrice: round(price, 4),
    stopLoss: round(stopLoss, 4),
    target1: round(target1, 4),
    target2: round(target2, 4),
    riskReward,
    source: `${row.source.provider} · ${row.timeframe} candles`,
    isDemo: row.source.isDemo,
    createdAt,
    stored: false,
  };
}

/** Scans the market and persists qualifying opportunities (idempotent by id). */
export async function generateOpportunities(
  db: Db,
  registry: ProviderRegistry,
  options: GenerateOpportunitiesOptions = {},
): Promise<{ opportunities: GeneratedOpportunity[]; scanned: number; stored: number; note: string }> {
  const scanResult = await scan(db, registry, {
    market: options.market,
    minScore: options.minScore ?? 60,
    limit: options.limit ?? 50,
    ingestLimit: options.ingestLimit ?? 60,
  });

  const generated: GeneratedOpportunity[] = [];
  let stored = 0;

  for (const row of scanResult.rows) {
    const opportunity = build(row);
    if (!opportunity) continue;
    generated.push(opportunity);
    if (options.dryRun) continue;

    const instrument = getInstrument(db, row.instrumentId);
    const quality = row.dataQuality === 'VERIFIED' ? 'VERIFIED' : 'SUSPECT';
    const entry = db
      .prepare(
        `INSERT INTO opportunities (id, instrument_id, strategy_id, strategy_name, direction, signal, timeframe,
            score, last_price, currency, observed_at, source_json, entry_trigger, entry_zone_low, entry_zone_high,
            stop_loss, target1, target2, planned_rr, liquidity, spread_bps, technical_explanation,
            risk_factors_json, quality_json, data_quality, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(
        opportunity.id,
        row.instrumentId,
        'str-ema-pullback',
        `${row.symbol} confluence setup`,
        opportunity.direction,
        opportunity.signal,
        row.timeframe,
        opportunity.score,
        opportunity.entryPrice,
        instrument?.currency ?? 'INR',
        scanResult.generatedAt,
        JSON.stringify({ provider: row.source.provider, isDemo: row.source.isDemo, observedAt: scanResult.generatedAt, reliability: row.source.isDemo ? 'PROVISIONAL' : 'VERIFIED' }),
        `${row.symbol} ${row.signal} trigger on ${row.timeframe} as price holds ${row.indicators.ema20 !== null && opportunity.entryPrice > row.indicators.ema20 ? 'above' : 'below'} EMA20 with RSI ${row.indicators.rsi14 !== null ? Math.round(row.indicators.rsi14) : '—'} and ${row.indicators.adx14 !== null ? Math.round(row.indicators.adx14) : '—'} ADX`,
        round(opportunity.entryPrice * 0.995, 4),
        round(opportunity.entryPrice * 1.005, 4),
        opportunity.stopLoss,
        opportunity.target1,
        opportunity.target2,
        opportunity.riskReward,
        row.liquidity,
        0,
        `Trend score ${row.scoreBreakdown.trend}/30, momentum ${row.scoreBreakdown.momentum}/20, volume ${row.scoreBreakdown.volume}/15, volatility ${row.scoreBreakdown.volatility}/10, structure ${row.scoreBreakdown.structure}/25. ${SCORE_DISCLAIMER}`,
        JSON.stringify([
          'Simulated assessment based on demonstration or delayed market data',
          'Transaction costs and slippage are not included in the entry plan',
          'No position is ever placed automatically — this platform does not connect to a broker',
        ]),
        JSON.stringify({ score: row.score, breakdown: row.scoreBreakdown, disclaimer: SCORE_DISCLAIMER }),
        quality,
        opportunity.createdAt,
      );
    if (Number(entry.changes) > 0) {
      opportunity.stored = true;
      stored += 1;
    }
  }

  if (stored > 0 && !options.dryRun) {
    insertSystemLog(db, {
      level: 'info',
      source: 'opportunities',
      message: `generated ${stored} opportunity rows`,
      context: { scanned: scanResult.scanned, minScore: options.minScore ?? 60 },
    });
  }

  return { opportunities: generated, scanned: scanResult.scanned, stored, note: SCORE_DISCLAIMER };
}

export interface OpportunityListItem {
  id: string;
  instrumentId: string;
  symbol: string;
  market: string;
  direction: string;
  signal: string;
  strategyName: string;
  score: number;
  timeframe: string;
  lastPrice: number;
  currency: string;
  stopLoss: number;
  target1: number;
  target2: number;
  plannedRr: number;
  liquidity: string;
  entryTrigger: string;
  technicalExplanation: string;
  riskFactors: string[];
  quality: { score: number; disclaimer: string };
  source: { provider: string; isDemo: boolean; observedAt: string };
  dataQuality: string;
  createdAt: string;
}

function toListItem(db: Db, row: OpportunityRow): OpportunityListItem {
  const instrument = getInstrument(db, row.instrument_id);
  const source = JSON.parse(row.source_json) as { provider: string; isDemo: boolean; observedAt: string };
  const riskFactors = JSON.parse(row.risk_factors_json) as string[];
  const quality = JSON.parse(row.quality_json) as { score: number; disclaimer: string };
  return {
    id: row.id,
    instrumentId: row.instrument_id,
    symbol: instrument?.symbol ?? row.instrument_id,
    market: instrument?.market_category ?? 'OTHER',
    direction: row.direction,
    signal: row.signal,
    strategyName: row.strategy_name,
    score: row.score,
    timeframe: row.timeframe,
    lastPrice: row.last_price,
    currency: row.currency,
    stopLoss: row.stop_loss,
    target1: row.target1,
    target2: row.target2,
    plannedRr: row.planned_rr,
    liquidity: row.liquidity,
    entryTrigger: row.entry_trigger,
    technicalExplanation: row.technical_explanation,
    riskFactors,
    quality,
    source: { provider: source.provider, isDemo: source.isDemo, observedAt: source.observedAt },
    dataQuality: row.data_quality,
    createdAt: row.created_at,
  };
}

export function listOpportunitiesApi(
  db: Db,
  query: { market?: string; minScore?: number; signal?: string; limit?: number; offset?: number },
): { items: OpportunityListItem[]; total: number; limit: number; offset: number; note: string } {
  const page = listOpportunities(db, {
    market: query.market,
    minScore: query.minScore,
    signal: query.signal,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
  });
  return {
    items: page.items.map((row) => toListItem(db, row)),
    total: page.total,
    limit: query.limit ?? 20,
    offset: query.offset ?? 0,
    note: SCORE_DISCLAIMER,
  };
}

export function getOpportunityApi(db: Db, id: string): OpportunityListItem | null {
  const row = getOpportunity(db, id);
  return row ? toListItem(db, row) : null;
}
