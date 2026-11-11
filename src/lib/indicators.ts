import type { Candle } from '@/models';

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine: Series = closes.map((_, i) =>
    fastEma[i] != null && slowEma[i] != null ? fastEma[i]! - slowEma[i]! : null,
  );
  const compact = macdLine.filter((v): v is number => v != null);
  const signalCompact = ema(compact, signalPeriod);
  // Align the compact signal series back onto the original index space.
  let cursor = 0;
  const signal: Series = macdLine.map((v) => {
    if (v == null) return null;
    const value = signalCompact[cursor] ?? null;
    cursor += 1;
    return value;
  });
  const histogram: Series = macdLine.map((v, i) => (v != null && signal[i] != null ? v - signal[i]! : null));
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
  bandwidth: Series;
}

export function bollinger(closes: number[], period = 20, dev = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  const bandwidth: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const mean = middle[i]!;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = mean + dev * sd;
    lower[i] = mean - dev * sd;
    bandwidth[i] = mean === 0 ? null : ((upper[i]! - lower[i]!) / mean) * 100;
  }
  return { upper, middle, lower, bandwidth };
}

/** Session-anchored VWAP (resets each UTC day for daily data, per-bar otherwise). */
export function vwap(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let currentDay = -1;
  candles.forEach((c, i) => {
    const day = Math.floor(c.time / 86_400);
    if (day !== currentDay) {
      currentDay = day;
      cumulativePV = 0;
      cumulativeVolume = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumulativePV += typical * c.volume;
    cumulativeVolume += c.volume;
    out[i] = cumulativeVolume === 0 ? null : cumulativePV / cumulativeVolume;
  });
  return out;
}

export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1].close;
    tr.push(
      Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prev), Math.abs(candles[i].low - prev)),
    );
  }
  let value = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < tr.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

export function adx(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length < period * 2 + 1) return out;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prevClose), Math.abs(candles[i].low - prevClose)),
    );
  }
  const smooth = (arr: number[]): number[] => {
    const res: number[] = [];
    let sum = arr.slice(1, period + 1).reduce((s, v) => s + v, 0);
    res.push(sum);
    for (let i = period + 1; i < arr.length; i += 1) {
      sum = sum - sum / period + arr[i];
      res.push(sum);
    }
    return res;
  };
  const sTR = smooth(tr);
  const sPlus = smooth(plusDM);
  const sMinus = smooth(minusDM);
  const dx: number[] = [];
  for (let i = 0; i < sTR.length; i += 1) {
    const plusDI = sTR[i] === 0 ? 0 : (100 * sPlus[i]) / sTR[i];
    const minusDI = sTR[i] === 0 ? 0 : (100 * sMinus[i]) / sTR[i];
    const sum = plusDI + minusDI;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum);
  }
  if (dx.length <= period) return out;
  let value = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const startIdx = period; // index within dx, which starts at candle 1
  out[startIdx + period - 1] = value;
  for (let i = period; i < dx.length; i += 1) {
    value = (value * (period - 1) + dx[i]) / period;
    out[startIdx + i] = value;
  }
  return out;
}

/** Percentage distance of price from a moving average — used in summary panels. */
export function pctFrom(value: number | null, base: number | null): number | null {
  if (value == null || base == null || base === 0) return null;
  return ((value - base) / base) * 100;
}
