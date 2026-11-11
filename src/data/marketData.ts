import type { Candle, MarketCategory, Quote, Timeframe } from '@/models';
import { seededRandom } from '@/lib/rng';
import { BASE_PRICE, INSTRUMENT_BY_ID, demoSource, freshnessFor, marketStatusFor } from './universe';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
  '1W': 604800,
  '1M': 2592000,
};

const VOL_BY_TYPE: Record<string, number> = {
  INDEX: 0.0045,
  EQUITY: 0.0075,
  CURRENCY_FUTURE: 0.0018,
  REFERENCE_RATE: 0.0016,
  COMMODITY: 0.006,
  ETF: 0.005,
};

function volatilityFor(instrumentId: string): number {
  const instrument = INSTRUMENT_BY_ID[instrumentId];
  if (!instrument) return 0.006;
  return VOL_BY_TYPE[instrument.type] ?? 0.006;
}

/** Aligns a timestamp to the timeframe bucket. */
export function bucketTime(time: number, timeframe: Timeframe): number {
  const step = TIMEFRAME_SECONDS[timeframe];
  if (timeframe === '1W') {
    const d = new Date(time * 1000);
    const day = d.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  if (timeframe === '1M') {
    const d = new Date(time * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  }
  return Math.floor(time / step) * step;
}

/**
 * Synthetic OHLCV series for the demonstration build.
 * Values are generated, never presented as verified market data.
 */
export function buildCandles(
  instrumentId: string,
  timeframe: Timeframe,
  count = 400,
  now: number = Math.floor(Date.now() / 1000),
): Candle[] {
  const base = BASE_PRICE[instrumentId] ?? 100;
  const rand = seededRandom(`${instrumentId}:${timeframe}`);
  const step = TIMEFRAME_SECONDS[timeframe];
  const anchor = bucketTime(now, timeframe);
  const vol = volatilityFor(instrumentId) * Math.sqrt(step / 86400);

  const closes: number[] = [];
  let price = base * (1 - vol * 6);
  let drift = (rand() - 0.45) * vol * 0.35;

  for (let i = 0; i < count; i += 1) {
    if (i % 40 === 0) drift = (rand() - 0.47) * vol * 0.6;
    const shock = (rand() - 0.5) * 2 * vol;
    const meanRevert = ((base - price) / base) * 0.012;
    price = price * (1 + drift + shock + meanRevert);
    price = Math.max(price, base * 0.35);
    closes.push(price);
  }

  // Normalise so the final close matches the reference demo price.
  const scale = base / closes[closes.length - 1];
  for (let i = 0; i < closes.length; i += 1) closes[i] *= scale;

  const candles: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const close = closes[i];
    const open = i === 0 ? close * (1 - vol * 0.4) : closes[i - 1];
    const spread = Math.abs(close - open) + close * vol * (0.35 + rand() * 0.6);
    const high = Math.max(open, close) + spread * rand() * 0.7;
    const low = Math.min(open, close) - spread * rand() * 0.7;
    const volumeBase = instrumentVolume(instrumentId, timeframe);
    const volume = Math.round(volumeBase * (0.55 + rand() * 0.95));
    candles.push({
      time: anchor - (count - 1 - i) * step,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume,
    });
  }
  return candles;
}

function instrumentVolume(instrumentId: string, timeframe: Timeframe): number {
  const instrument = INSTRUMENT_BY_ID[instrumentId];
  const perDay = instrument?.type === 'INDEX' ? 0 : instrument?.region === 'US' ? 42_000_000 : 1_800_000;
  const factor = { '1m': 0.01, '5m': 0.04, '15m': 0.1, '30m': 0.2, '1h': 0.4, '4h': 1.2, '1D': 4, '1W': 20, '1M': 90 }[
    timeframe
  ];
  return Math.max(1, Math.round(perDay * factor));
}

function round(value: number): number {
  if (value >= 1000) return Math.round(value * 100) / 100;
  if (value >= 100) return Math.round(value * 1000) / 1000;
  if (value >= 1) return Math.round(value * 10000) / 10000;
  return Math.round(value * 1000000) / 1000000;
}

export function buildQuote(
  instrumentId: string,
  now: Date = new Date(),
): Quote | null {
  const instrument = INSTRUMENT_BY_ID[instrumentId];
  if (!instrument) return null;
  const candles = buildCandles(instrumentId, '1D', 60, Math.floor(now.getTime() / 1000));
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last.close - prev.close;
  const changePercent = (change / prev.close) * 100;
  const daySlice = candles.slice(-1)[0];

  return {
    instrumentId,
    lastPrice: last.close,
    change: round(change),
    changePercent: Math.round(changePercent * 100) / 100,
    open: prev.close,
    high: daySlice.high,
    low: daySlice.low,
    previousClose: prev.close,
    volume: last.volume,
    averageVolume: Math.round(candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20),
    marketStatus: marketStatusFor(instrument.market, now),
    updatedAt: now.toISOString(),
    freshness: freshnessFor(instrument.market),
    source: demoSource(),
  };
}

export function isRestricted(market: MarketCategory): boolean {
  return market === 'IN_CURRENCY_DERIVATIVES';
}
