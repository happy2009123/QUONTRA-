/**
 * Market scanning service.
 *
 * Ranks instruments using a transparent 0-100 confluence score built from
 * trend, momentum, volume and volatility evidence on completed candles.
 * The score is explicitly NOT a win probability — it measures agreement
 * between configured conditions.
 *
 * Instruments without stored history are reported with `dataStatus: NO_DATA`
 * instead of being assigned a fabricated score.
 */

import type { Db } from '../db/db.ts';
import { listInstruments } from '../db/repoReference.ts';
import { getCandles, type CandleRow } from '../db/repoSeries.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { ingestCandles } from './ingestion.ts';
import { adx, atr, bollinger, ema, rsi, volumeAnalysis, supportResistance } from './indicators.ts';

export interface ScannerFilters {
  market?: string;
  sector?: string;
  search?: string;
  minScore?: number;
  signal?: 'BUY' | 'SELL' | 'WATCH' | 'ALL';
  volatility?: 'ALL' | 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
  liquidity?: 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
  limit?: number;
  offset?: number;
  /** Attempt to ingest missing history for up to this many instruments. */
  ingestLimit?: number;
}

export interface ScannerRow {
  instrumentId: string;
  symbol: string;
  name: string;
  market: string;
  exchange: string;
  sector?: string;
  timeframe: string;
  lastPrice: number;
  changePercent: number;
  score: number;
  signal: 'BUY' | 'SELL' | 'WATCH' | 'NO_TRADE';
  scoreBreakdown: {
    trend: number;
    momentum: number;
    volume: number;
    volatility: number;
    structure: number;
  };
  indicators: {
    ema20: number | null;
    ema50: number | null;
    rsi14: number | null;
    atr14: number | null;
    adx14: number | null;
    relativeVolume: number | null;
    bollingerWidth: number | null;
    support: number | null;
    resistance: number | null;
  };
  volatilityRegime: 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
  liquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  dataStatus: 'OK' | 'NO_DATA' | 'INSUFFICIENT_DATA';
  dataQuality: string;
  source: { provider: string; isDemo: boolean };
  updatedAt: string;
}

export interface ScanResult {
  rows: ScannerRow[];
  total: number;
  scanned: number;
  ingested: number;
  timeframe: string;
  generatedAt: string;
  note: string;
}

const SCORE_NOTE =
  'Score is a 0-100 confluence metric derived from trend, momentum, volume, volatility and structure. ' +
  'It is not a win probability, forecast or guarantee.';

function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((v) => v < value).length;
  return (below / values.length) * 100;
}

function toBar(row: CandleRow): { ts: number; open: number; high: number; low: number; close: number; volume: number } {
  return { ts: row.ts, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume };
}

function scoreRow(
  bars: ReturnType<typeof toBar>[],
  previousClose: number,
): { score: number; breakdown: ScannerRow['scoreBreakdown']; indicators: ScannerRow['indicators']; signal: ScannerRow['signal']; regime: ScannerRow['volatilityRegime'] } {
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);
  const adxResult = adx(bars, 14);
  const bb = bollinger(closes, 20, 2);
  const vol = volumeAnalysis(bars, 20);
  const levels = supportResistance(bars, 3);

  const ema20 = e20.at(-1) ?? null;
  const ema50 = e50.at(-1) ?? null;
  const ema200 = e200.at(-1) ?? null;
  const rsiVal = rsi14.at(-1) ?? null;
  const atrVal = atr14.at(-1) ?? null;
  const adxVal = adxResult.adx.at(-1) ?? null;

  const upper = bb.upper.at(-1) ?? null;
  const lower = bb.lower.at(-1) ?? null;
  const middle = bb.middle.at(-1) ?? null;
  const width = upper !== null && lower !== null && middle ? (upper - lower) / middle : null;

  const support = levels.supports[0]?.price ?? null;
  const resistance = levels.resistances[0]?.price ?? null;

  // Trend (0-30): alignment of price with moving averages.
  let trend = 0;
  if (ema20 !== null && ema50 !== null) {
    if (last.close > ema20 && ema20 > ema50) trend += 18;
    else if (last.close > ema20) trend += 10;
    else if (last.close < ema20 && ema20 < ema50) trend += 18;
    else if (last.close < ema20) trend += 10;
  }
  if (ema200 !== null) {
    if (last.close > ema200) trend += 8;
    else trend += 2;
  }
  if (adxVal !== null && adxVal > 25) trend += 4;

  // Momentum (0-20): RSI in a productive band, not extreme.
  let momentum = 0;
  if (rsiVal !== null) {
    if (rsiVal >= 50 && rsiVal <= 70) momentum += 20;
    else if (rsiVal > 40 && rsiVal < 50) momentum += 12;
    else if (rsiVal > 70) momentum += 6;
    else momentum += 4;
  }

  // Volume (0-15): expansion confirms participation.
  const volume = vol.relativeVolume === null ? 0 : Math.min(15, Math.round(Math.min(vol.relativeVolume, 2) * 7.5));

  // Volatility (0-10): ATR percentile — enough movement to pay for risk.
  const atrSeries = atr14.filter((v): v is number => v !== null);
  const atrPct = atrVal === null ? 50 : percentileRank(atrSeries, atrVal);
  const volatility = atrPct > 40 ? 10 : atrPct > 20 ? 6 : 3;

  // Structure (0-25): distance from support vs resistance (reward/risk proxy).
  let structure = 0;
  if (support !== null && resistance !== null && last.close > support && resistance > last.close) {
    const roomUp = resistance - last.close;
    const roomDown = last.close - support;
    const ratio = roomDown > 0 ? roomUp / roomDown : 0;
    structure = Math.min(25, Math.round(ratio * 10));
  }

  const score = Math.min(100, trend + momentum + volume + volatility + structure);

  const changePct = previousClose > 0 ? ((last.close - previousClose) / previousClose) * 100 : 0;
  let signal: ScannerRow['signal'] = 'NO_TRADE';
  if (score >= 70 && rsiVal !== null && rsiVal < 72 && changePct > -2) signal = 'BUY';
  else if (score >= 55 && rsiVal !== null && rsiVal >= 72) signal = 'SELL';
  else if (score >= 45) signal = 'WATCH';

  const atrPctile = atrPct;
  const regime: ScannerRow['volatilityRegime'] =
    atrPctile >= 90 ? 'EXTREME' : atrPctile >= 70 ? 'ELEVATED' : atrPctile >= 30 ? 'NORMAL' : 'LOW';

  return {
    score,
    breakdown: { trend, momentum, volume, volatility, structure },
    indicators: {
      ema20,
      ema50,
      rsi14: rsiVal,
      atr14: atrVal,
      adx14: adxVal,
      relativeVolume: vol.relativeVolume,
      bollingerWidth: width,
      support,
      resistance,
    },
    signal,
    regime,
  };
}

/** Runs a scan across active instruments. */
export async function scan(db: Db, registry: ProviderRegistry, filters: ScannerFilters = {}): Promise<ScanResult> {
  const timeframe = '1h';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const page = listInstruments(db, {
    search: filters.search,
    market: filters.market,
    sector: filters.sector,
    limit: 500,
    offset: 0,
  });

  let ingested = 0;
  const ingestBudget = filters.ingestLimit ?? 8;
  const rows: ScannerRow[] = [];
  let scanned = 0;

  for (const inst of page.items) {
    scanned += 1;
    let candles = getCandles(db, { instrumentId: inst.id, timeframe, limit: 300, ascending: true, quality: 'ALL' });

    if (candles.length < 60 && ingested < ingestBudget) {
      try {
        await ingestCandles(
          db,
          registry,
          { id: inst.id, market: inst.market_category, providerId: inst.provider_id, providerSymbol: inst.provider_symbol },
          { interval: '1h', limit: 300 },
        );
        ingested += 1;
        candles = getCandles(db, { instrumentId: inst.id, timeframe, limit: 300, ascending: true, quality: 'ALL' });
      } catch {
        // provider unavailable → report NO_DATA below, never invent rows
      }
    }

    const latestQuote = db.prepare('SELECT last_price, change_percent, updated_at FROM quotes WHERE instrument_id = ?').get(inst.id) as
      | { last_price: number; change_percent: number; updated_at: string }
      | undefined;

    if (candles.length < 60) {
      rows.push({
        instrumentId: inst.id,
        symbol: inst.symbol,
        name: inst.name,
        market: inst.market_category,
        exchange: inst.exchange,
        ...(inst.sector ? { sector: inst.sector } : {}),
        timeframe,
        lastPrice: latestQuote?.last_price ?? 0,
        changePercent: latestQuote?.change_percent ?? 0,
        score: 0,
        signal: 'NO_TRADE',
        scoreBreakdown: { trend: 0, momentum: 0, volume: 0, volatility: 0, structure: 0 },
        indicators: { ema20: null, ema50: null, rsi14: null, atr14: null, adx14: null, relativeVolume: null, bollingerWidth: null, support: null, resistance: null },
        volatilityRegime: 'NORMAL',
        liquidity: 'LOW',
        dataStatus: candles.length === 0 ? 'NO_DATA' : 'INSUFFICIENT_DATA',
        dataQuality: candles.length === 0 ? 'MISSING' : 'PENDING',
        source: { provider: candles[0]?.source_provider ?? 'none', isDemo: candles[0]?.is_demo === 1 },
        updatedAt: latestQuote?.updated_at ?? new Date().toISOString(),
      });
      continue;
    }

    const bars = candles.map(toBar);
    const previousClose = bars[bars.length - 2].close;
    const scored = scoreRow(bars, previousClose);
    const lastBar = bars[bars.length - 1];
    const quotePrice = latestQuote?.last_price ?? lastBar.close;
    const avgVolume = bars.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
    const liquidity: ScannerRow['liquidity'] = avgVolume > 1_000_000 ? 'HIGH' : avgVolume > 200_000 ? 'MEDIUM' : 'LOW';

    const changePercent =
      latestQuote?.change_percent ?? (previousClose > 0 ? ((lastBar.close - previousClose) / previousClose) * 100 : 0);

    rows.push({
      instrumentId: inst.id,
      symbol: inst.symbol,
      name: inst.name,
      market: inst.market_category,
      exchange: inst.exchange,
      ...(inst.sector ? { sector: inst.sector } : {}),
      timeframe,
      lastPrice: quotePrice,
      changePercent,
      score: scored.score,
      signal: scored.signal,
      scoreBreakdown: scored.breakdown,
      indicators: scored.indicators,
      volatilityRegime: scored.regime,
      liquidity,
      dataStatus: 'OK',
      dataQuality: candles.every((c) => c.quality_status === 'VERIFIED') ? 'VERIFIED' : 'SUSPECT',
      source: { provider: candles[candles.length - 1].source_provider, isDemo: candles[candles.length - 1].is_demo === 1 },
      updatedAt: candles[candles.length - 1].ingested_at,
    });
  }

  let filtered = rows;
  if (filters.minScore !== undefined) filtered = filtered.filter((r) => r.score >= filters.minScore!);
  if (filters.signal && filters.signal !== 'ALL') filtered = filtered.filter((r) => r.signal === filters.signal);
  if (filters.volatility && filters.volatility !== 'ALL') filtered = filtered.filter((r) => r.volatilityRegime === filters.volatility);
  if (filters.liquidity && filters.liquidity !== 'ALL') filtered = filtered.filter((r) => r.liquidity === filters.liquidity);

  filtered.sort((a, b) => b.score - a.score);

  return {
    rows: filtered.slice(offset, offset + limit),
    total: filtered.length,
    scanned,
    ingested,
    timeframe,
    generatedAt: new Date().toISOString(),
    note: SCORE_NOTE,
  };
}
