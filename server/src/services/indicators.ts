/**
 * Technical analysis service.
 *
 * Pure functions over completed candles. All series-returning functions align
 * their output with the input array (index i corresponds to input[i]) and use
 * `null` for periods where the indicator is not yet defined.
 *
 * Signals must only consume completed candles — use `completedOnly()` before
 * evaluating any condition so a forming bar can never trigger an entry.
 */

export interface Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Series = (number | null)[];

/** Filters out candles that have not closed yet. */
export function completedOnly<T extends { ts: number }>(bars: T[], intervalSeconds: number, nowMs: number = Date.now()): T[] {
  const nowSeconds = nowMs / 1000;
  return bars.filter((bar) => bar.ts + intervalSeconds <= nowSeconds);
}

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i];
  let previous = seed / period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}

/** Relative Strength Index (Wilder smoothing). */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const toRsi = (g: number, l: number): number => {
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD line, signal line and histogram (EMA fast − EMA slow, EMA signal). */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine: Series = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });

  // Signal EMA is computed over the defined portion of the MACD line.
  const definedFrom = macdLine.findIndex((v) => v !== null);
  const signal: Series = new Array(closes.length).fill(null);
  const histogram: Series = new Array(closes.length).fill(null);
  if (definedFrom >= 0) {
    const slice = macdLine.slice(definedFrom).map((v) => v as number);
    const signalSlice = ema(slice, signalPeriod);
    for (let i = 0; i < signalSlice.length; i += 1) {
      const idx = definedFrom + i;
      signal[idx] = signalSlice[i];
      const m = macdLine[idx];
      const s = signalSlice[i];
      histogram[idx] = m === null || s === null ? null : m - s;
    }
  }
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Bollinger Bands — middle band is an SMA, bands use population deviation. */
export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[i] as number;
    const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/** Cumulative VWAP over the supplied bars (typical price × volume). */
export function vwap(bars: Bar[]): Series {
  const out: Series = new Array(bars.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const typical = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += typical * bars[i].volume;
    cumV += bars[i].volume;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

/** Average True Range (Wilder smoothing). */
export function atr(bars: Bar[], period = 14): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const trueRanges: number[] = [0];
  for (let i = 1; i < bars.length; i += 1) {
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
    trueRanges.push(tr);
  }
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += trueRanges[i];
  let previous = sum / period;
  out[period] = previous;
  for (let i = period + 1; i < bars.length; i += 1) {
    previous = (previous * (period - 1) + trueRanges[i]) / period;
    out[i] = previous;
  }
  return out;
}

export interface AdxResult {
  adx: Series;
  plusDi: Series;
  minusDi: Series;
}

/** Average Directional Index with +DI / −DI (Wilder smoothing). */
export function adx(bars: Bar[], period = 14): AdxResult {
  const n = bars.length;
  const adxOut: Series = new Array(n).fill(null);
  const plusOut: Series = new Array(n).fill(null);
  const minusOut: Series = new Array(n).fill(null);
  if (n <= 2 * period) return { adx: adxOut, plusDi: plusOut, minusDi: minusOut };

  const tr: number[] = [0];
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];
  for (let i = 1; i < n; i += 1) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      ),
    );
  }

  const smooth = (arr: number[], from: number, count: number): number => {
    let sum = 0;
    for (let i = from; i < from + count; i += 1) sum += arr[i];
    return sum;
  };

  let trSmooth = smooth(tr, 1, period);
  let plusSmooth = smooth(plusDm, 1, period);
  let minusSmooth = smooth(minusDm, 1, period);

  const dx: number[] = [];
  const computeDi = (index: number): void => {
    const plusDI = trSmooth > 0 ? (100 * plusSmooth) / trSmooth : 0;
    const minusDI = trSmooth > 0 ? (100 * minusSmooth) / trSmooth : 0;
    plusOut[index] = plusDI;
    minusOut[index] = minusDI;
    const sum = plusDI + minusDI;
    dx.push(sum > 0 ? (100 * Math.abs(plusDI - minusDI)) / sum : 0);
  };

  computeDi(period);
  for (let i = period + 1; i < n; i += 1) {
    trSmooth = trSmooth - trSmooth / period + tr[i];
    plusSmooth = plusSmooth - plusSmooth / period + plusDm[i];
    minusSmooth = minusSmooth - minusSmooth / period + minusDm[i];
    computeDi(i);
  }

  if (dx.length >= period) {
    let adxValue = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adxOut[period + period - 1] = adxValue;
    for (let i = period; i < dx.length; i += 1) {
      adxValue = (adxValue * (period - 1) + dx[i]) / period;
      adxOut[period + period - 1 + i] = adxValue;
    }
  }
  return { adx: adxOut, plusDi: plusOut, minusDi: minusOut };
}

export interface VolumeAnalysis {
  volumeSma: Series;
  /** Volume of the last bar relative to its SMA (1 = average). */
  relativeVolume: number | null;
  trend: 'RISING' | 'FALLING' | 'FLAT';
  /** True when the last bar's volume confirms the move (expansion). */
  expanding: boolean;
}

/** Volume analysis: average, relative volume and short-term trend. */
export function volumeAnalysis(bars: Bar[], period = 20): VolumeAnalysis {
  const volumes = bars.map((b) => b.volume);
  const volumeSma = sma(volumes, period);
  const last = volumes.at(-1) ?? null;
  const lastAvg = volumeSma.at(-1) ?? null;
  const relativeVolume = last !== null && lastAvg !== null && lastAvg > 0 ? last / lastAvg : null;

  const recent = volumeSma.filter((v): v is number => v !== null).slice(-5);
  let trend: VolumeAnalysis['trend'] = 'FLAT';
  if (recent.length >= 2) {
    const first = recent[0];
    const lastPoint = recent[recent.length - 1];
    const delta = (lastPoint - first) / (first || 1);
    trend = delta > 0.05 ? 'RISING' : delta < -0.05 ? 'FALLING' : 'FLAT';
  }

  const priceUp = bars.length >= 2 ? bars[bars.length - 1].close > bars[bars.length - 2].close : false;
  const expanding = relativeVolume !== null && relativeVolume >= 1.2 && (priceUp || true);

  return { volumeSma, relativeVolume, trend, expanding };
}

export interface Level {
  price: number;
  touches: number;
  kind: 'SUPPORT' | 'RESISTANCE';
}

/**
 * Support and resistance from swing pivots: a bar is a pivot when its high is
 * the maximum (or minimum) within `strength` bars on each side.
 */
export function supportResistance(bars: Bar[], strength = 3, maxLevels = 4): { supports: Level[]; resistances: Level[] } {
  const resistances: Level[] = [];
  const supports: Level[] = [];
  for (let i = strength; i < bars.length - strength; i += 1) {
    const window = bars.slice(i - strength, i + strength + 1);
    const isHigh = bars[i].high >= Math.max(...window.map((b) => b.high));
    const isLow = bars[i].low <= Math.min(...window.map((b) => b.low));
    if (isHigh) resistances.push({ price: bars[i].high, touches: 1, kind: 'RESISTANCE' });
    if (isLow) supports.push({ price: bars[i].low, touches: 1, kind: 'SUPPORT' });
  }

  const cluster = (levels: Level[]): Level[] => {
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const out: Level[] = [];
    for (const level of sorted) {
      const last = out[out.length - 1];
      if (last && Math.abs(level.price - last.price) / Math.max(last.price, 1e-9) < 0.005) {
        last.price = (last.price * last.touches + level.price) / (last.touches + 1);
        last.touches += 1;
      } else {
        out.push({ ...level });
      }
    }
    return out.sort((a, b) => b.touches - a.touches).slice(0, maxLevels);
  };

  return { supports: cluster(supports), resistances: cluster(resistances) };
}

export type IndicatorName =
  | 'RSI'
  | 'MACD'
  | 'EMA'
  | 'SMA'
  | 'VWAP'
  | 'ATR'
  | 'ADX'
  | 'BOLLINGER'
  | 'VOLUME'
  | 'SUPPORT_RESISTANCE';

export interface IndicatorRequest {
  name: IndicatorName;
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
}

export interface IndicatorPoint {
  ts: number;
  /** Number for scalar indicators, object for multi-output ones. */
  value: number | Record<string, number>;
  /** False when the value is still warming up or computed on a forming bar. */
  confirmed: boolean;
}

/**
 * Computes one indicator over a candle series, returning only the points that
 * are defined (warm-up periods omitted).
 */
export function computeIndicator(bars: Bar[], request: IndicatorRequest): IndicatorPoint[] {
  const closes = bars.map((b) => b.close);
  const period = request.period ?? 14;

  const pack = (series: Series): IndicatorPoint[] =>
    bars.map((bar, i) => ({ ts: bar.ts, value: series[i] as number, confirmed: true })).filter((p) => p.value !== null && Number.isFinite(p.value));

  switch (request.name) {
    case 'RSI':
      return pack(rsi(closes, period));
    case 'SMA':
      return pack(sma(closes, period));
    case 'EMA':
      return pack(ema(closes, period));
    case 'ATR':
      return pack(atr(bars, period));
    case 'VWAP':
      return pack(vwap(bars));
    case 'BOLLINGER': {
      const bands = bollinger(closes, period, 2);
      const points: IndicatorPoint[] = [];
      bars.forEach((bar, i) => {
        const upper = bands.upper[i];
        const middle = bands.middle[i];
        const lower = bands.lower[i];
        if (upper == null || middle == null || lower == null) return;
        points.push({ ts: bar.ts, value: { upper, middle, lower }, confirmed: true });
      });
      return points;
    }
    case 'MACD': {
      const result = macd(closes, request.fast ?? 12, request.slow ?? 26, request.signal ?? 9);
      const points: IndicatorPoint[] = [];
      bars.forEach((bar, i) => {
        const macdValue = result.macd[i];
        const signalValue = result.signal[i];
        if (macdValue == null || signalValue == null) return;
        points.push({
          ts: bar.ts,
          value: { macd: macdValue, signal: signalValue, histogram: result.histogram[i] ?? 0 },
          confirmed: true,
        });
      });
      return points;
    }
    case 'ADX': {
      const result = adx(bars, period);
      const points: IndicatorPoint[] = [];
      bars.forEach((bar, i) => {
        const adxValue = result.adx[i];
        if (adxValue == null) return;
        points.push({
          ts: bar.ts,
          value: { adx: adxValue, plusDi: result.plusDi[i] ?? 0, minusDi: result.minusDi[i] ?? 0 },
          confirmed: true,
        });
      });
      return points;
    }
    case 'VOLUME': {
      const analysis = volumeAnalysis(bars, period);
      const last = bars.at(-1);
      if (!last || analysis.relativeVolume === null) return [];
      return [
        {
          ts: last.ts,
          value: {
            relativeVolume: analysis.relativeVolume,
            volumeSma: (analysis.volumeSma.at(-1) ?? 0) as number,
            trend: analysis.trend === 'RISING' ? 1 : analysis.trend === 'FALLING' ? -1 : 0,
          },
          confirmed: true,
        },
      ];
    }
    case 'SUPPORT_RESISTANCE': {
      const { supports, resistances } = supportResistance(bars, 3);
      const last = bars.at(-1);
      if (!last) return [];
      return [
        {
          ts: last.ts,
          value: {
            supports: supports[0]?.price ?? 0,
            resistances: resistances[0]?.price ?? 0,
            supportTouches: supports[0]?.touches ?? 0,
            resistanceTouches: resistances[0]?.touches ?? 0,
          },
          confirmed: true,
        },
      ];
    }
    default:
      return [];
  }
}
