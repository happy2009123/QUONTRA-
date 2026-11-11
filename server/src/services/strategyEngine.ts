/**
 * QUANTORA deterministic strategy engine.
 *
 * Every strategy below is a pure function of (candles, quote, parameters,
 * timeframe). Given identical inputs it always produces the same decision.
 * Scores are 0-100 confluence metrics — explicitly not win probabilities.
 * Signals consume only completed candles (callers must pre-filter).
 */

import type { Bar } from './indicators.ts';
import {
  adx,
  atr,
  bollinger,
  completedOnly,
  ema,
  macd,
  rsi,
  sma,
  supportResistance,
  vwap,
  volumeAnalysis,
} from './indicators.ts';
import type {
  CombinationConfig,
  InstrumentDecision,
  SignalAction,
  StrategyCategory,
  StrategyConditionResult,
  StrategyDefinition,
  StrategyParameter,
  StrategyResult,
  UserStrategyConfig,
} from '../lib/strategyTypes.ts';

/* ───────────────────────── helpers ───────────────────────── */

const lastBar = (bars: Bar[]): Bar | null => (bars.length === 0 ? null : bars[bars.length - 1]);
const prevBar = (bars: Bar[], n: number): Bar | null =>
  bars.length > n ? bars[bars.length - 1 - n] : null;

const closes = (bars: Bar[]): number[] => bars.map((b) => b.close);
const highs = (bars: Bar[]): number[] => bars.map((b) => b.high);
const lows = (bars: Bar[]): number[] => bars.map((b) => b.low);

const highest = (values: number[], n: number): number | null => {
  if (values.length < n) return null;
  let m = values[values.length - n];
  for (let i = values.length - n + 1; i < values.length; i += 1) if (values[i] > m) m = values[i];
  return m;
};
const lowest = (values: number[], n: number): number | null => {
  if (values.length < n) return null;
  let m = values[values.length - n];
  for (let i = values.length - n + 1; i < values.length; i += 1) if (values[i] < m) m = values[i];
  return m;
};

const crossesAbove = (a: number[], b: number[]): boolean => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  return a[n - 2] <= b[n - 2] && a[n - 1] > b[n - 1];
};
const crossesBelow = (a: number[], b: number[]): boolean => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  return a[n - 2] >= b[n - 2] && a[n - 1] < b[n - 1];
};

const body = (b: Bar): number => Math.abs(b.close - b.open);
const upperWick = (b: Bar): number => b.high - Math.max(b.open, b.close);
const lowerWick = (b: Bar): number => Math.min(b.open, b.close) - b.low;
const isBullish = (b: Bar): boolean => b.close >= b.open;
const isBearish = (b: Bar): boolean => b.close <= b.open;

/**
 * condition(id, description, passed, leftValue, rightValue)
 * `passed` defaults to false when omitted.
 */
const condition = (
  id: string,
  description: string,
  passed: boolean | undefined = undefined,
  left: number | null = null,
  right: number | null = null,
): StrategyConditionResult => ({
  id,
  description,
  passed: passed ?? false,
  leftValue: left,
  rightValue: right,
});

const signalFromScore = (score: number, bullish: boolean, bearish: boolean): SignalAction => {
  if (bullish && score >= 60) return 'BUY';
  if (bearish && score >= 60) return 'SELL';
  if (score >= 40) return 'WATCH';
  return 'NO_TRADE';
};

const clamp = (v: number, mn: number, mx: number): number => Math.min(mx, Math.max(mn, v));

const recentHigh = (bars: Bar[], n: number): number | null => highest(highs(bars), n);
const recentLow = (bars: Bar[], n: number): number | null => lowest(lows(bars), n);

/* ───────────────────────── strategy implementations ───────────────────────── */

interface StrategyContext {
  bars: Bar[];
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number };
  params: Record<string, number>;
  timeframe: string;
  nowMs: number;
}

function evaluateEmaCrossover(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const fast = Number(params.fastEma ?? 9);
  const slow = Number(params.slowEma ?? 21);
  if (bars.length < slow + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const fastEma = ema(closes(bars), fast);
  const slowEma = ema(closes(bars), slow);
  const last = lastBar(bars)!;
  const bullishCross = crossesAbove(fastEma as number[], slowEma as number[]);
  const bearishCross = crossesBelow(fastEma as number[], slowEma as number[]);
  const priceAboveFast = last.close > (fastEma[fastEma.length - 1] ?? 0);
  const priceBelowFast = last.close < (fastEma[fastEma.length - 1] ?? 0);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (bullishCross) {
    bullish = true;
    passed.push(condition('ema-cross', 'Fast EMA crossed above slow EMA', true, fastEma[fastEma.length - 1] ?? null, slowEma[slowEma.length - 1] ?? null));
  } else if (bearishCross) {
    bearish = true;
    passed.push(condition('ema-cross', 'Fast EMA crossed below slow EMA', true, fastEma[fastEma.length - 1] ?? null, slowEma[slowEma.length - 1] ?? null));
  } else {
    failed.push(condition('ema-cross', 'No EMA crossover on completed bar', false, null, null));
  }
  if ((bullish && priceAboveFast) || (bearish && priceBelowFast)) {
    passed.push(condition('price-position', 'Price confirms EMA direction', true, last.close, null));
  } else {
    failed.push(condition('price-position', 'Price does not confirm EMA direction', false, last.close, null));
  }
  const score = bullish || bearish ? 70 : 20;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish || bearish ? 'EMA crossover' : null,
    entryZone: { low: Math.min(last.open, last.close), high: Math.max(last.open, last.close) },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateRsi(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const period = Number(params.rsiPeriod ?? 14);
  const overbought = Number(params.overbought ?? 70);
  const oversold = Number(params.oversold ?? 30);
  if (bars.length < period + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const rsiSeries = rsi(closes(bars), period);
  const lastRsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lastRsi != null && prevRsi != null) {
    const oversoldRecovery = prevRsi <= oversold && lastRsi > oversold;
    const overboughtRejection = prevRsi >= overbought && lastRsi < overbought;
    if (oversoldRecovery) {
      bullish = true;
      passed.push(condition('rsi-oversold', 'RSI recovered from oversold', true, lastRsi, oversold));
    }
    if (overboughtRejection) {
      bearish = true;
      passed.push(condition('rsi-overbought', 'RSI rejected from overbought', true, lastRsi, overbought));
    }
    if (!oversoldRecovery && !overboughtRejection) {
      failed.push(condition('rsi-extreme', 'RSI not at extreme', false, lastRsi, null));
    }
  } else {
    failed.push(condition('rsi-ready', 'RSI not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 65 : 25;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'RSI oversold recovery' : bearish ? 'RSI overbought rejection' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMacd(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const fast = Number(params.macdFast ?? 12);
  const slow = Number(params.macdSlow ?? 26);
  const signal = Number(params.macdSignal ?? 9);
  if (bars.length < slow + signal + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const macdResult = macd(closes(bars), fast, slow, signal);
  const macdLine = macdResult.macd as number[];
  const signalLine = macdResult.signal as number[];
  const histLine = macdResult.histogram as number[];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const crossUp = crossesAbove(macdLine, signalLine);
  const crossDn = crossesBelow(macdLine, signalLine);
  const histTurningUp = histLine.length >= 2 && histLine[histLine.length - 2] != null && histLine[histLine.length - 1] != null && histLine[histLine.length - 1] > histLine[histLine.length - 2];
  const histTurningDn = histLine.length >= 2 && histLine[histLine.length - 2] != null && histLine[histLine.length - 1] != null && histLine[histLine.length - 1] < histLine[histLine.length - 2];
  if (crossUp && histTurningUp) {
    bullish = true;
    passed.push(condition('macd-cross', 'MACD crossed above signal with rising histogram', true, macdLine[macdLine.length - 1] ?? null, signalLine[signalLine.length - 1] ?? null));
  } else if (crossDn && histTurningDn) {
    bearish = true;
    passed.push(condition('macd-cross', 'MACD crossed below signal with falling histogram', true, macdLine[macdLine.length - 1] ?? null, signalLine[signalLine.length - 1] ?? null));
  } else {
    failed.push(condition('macd-cross', 'No confirmed MACD crossover', false, null, null));
  }
  const score = bullish || bearish ? 68 : 22;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish || bearish ? 'MACD crossover' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateBollinger(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const period = Number(params.bbPeriod ?? 20);
  const dev = Number(params.bbDev ?? 2);
  if (bars.length < period + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const bb = bollinger(closes(bars), period, dev);
  const last = lastBar(bars)!;
  const lower = bb.lower[bb.lower.length - 1];
  const upper = bb.upper[bb.upper.length - 1];
  const middle = bb.middle[bb.middle.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lower != null && last.close <= lower) {
    bullish = true;
    passed.push(condition('bb-lower', 'Price at or below lower Bollinger band', true, last.close, lower));
  } else if (upper != null && last.close >= upper) {
    bearish = true;
    passed.push(condition('bb-upper', 'Price at or above upper Bollinger band', true, last.close, upper));
  } else {
    failed.push(condition('bb-extreme', 'Price not at Bollinger extreme', false, last.close, null));
  }
  if (middle != null) {
    passed.push(condition('bb-mean', 'Mean-reversion target is middle band', true, null, middle));
  } else {
    failed.push(condition('bb-mean', 'Bollinger middle not defined', false, null, null));
  }
  const score = bullish || bearish ? 62 : 28;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bollinger lower band touch' : bearish ? 'Bollinger upper band touch' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: middle ?? null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateVwap(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const deviation = Number(params.vwapDeviation ?? 0.5);
  if (bars.length < 20) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const vwapSeries = vwap(bars as unknown as { ts: number; open: number; high: number; low: number; close: number; volume: number }[]) as (number | null)[];
  const vwapValue = vwapSeries[vwapSeries.length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (vwapValue != null) {
    const discount = last.close < vwapValue * (1 - deviation / 100);
    const premium = last.close > vwapValue * (1 + deviation / 100);
    if (discount) {
      bullish = true;
      passed.push(condition('vwap-discount', 'Price below VWAP (discount zone)', true, last.close, vwapValue));
    } else if (premium) {
      bearish = true;
      passed.push(condition('vwap-premium', 'Price above VWAP (premium zone)', true, last.close, vwapValue));
    } else {
      failed.push(condition('vwap-zone', 'Price at fair value near VWAP', false, last.close, vwapValue));
    }
  } else {
    failed.push(condition('vwap-ready', 'VWAP not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 60 : 24;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'VWAP discount reversion' : bearish ? 'VWAP premium reversion' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: vwapValue ?? null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateAdx(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const period = Number(params.adxPeriod ?? 14);
  const adxThreshold = Number(params.adxThreshold ?? 25);
  if (bars.length < period * 2 + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const adxResult = adx(bars, period);
  const adxValues = adxResult.adx as (number | null)[];
  const plusDI = adxResult.plusDi as (number | null)[];
  const minusDI = adxResult.minusDi as (number | null)[];
  const adxValue = adxValues[adxValues.length - 1];
  const pdi = plusDI[plusDI.length - 1];
  const mdi = minusDI[minusDI.length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (adxValue != null && pdi != null && mdi != null) {
    const trending = adxValue >= adxThreshold;
    if (trending && pdi > mdi) {
      bullish = true;
      passed.push(condition('adx-trend', 'ADX trending with +DI > -DI', true, adxValue, adxThreshold));
    } else if (trending && mdi > pdi) {
      bearish = true;
      passed.push(condition('adx-trend', 'ADX trending with -DI > +DI', true, adxValue, adxThreshold));
    } else {
      failed.push(condition('adx-trend', 'No clear directional trend', false, adxValue, adxThreshold));
    }
  } else {
    failed.push(condition('adx-ready', 'ADX not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 66 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'ADX bullish trend' : bearish ? 'ADX bearish trend' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateAtr(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const period = Number(params.atrPeriod ?? 14);
  const multiplier = Number(params.atrMultiplier ?? 2);
  if (bars.length < period + 20) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const atrSeries = atr(bars, period);
  const atrValue = atrSeries[atrSeries.length - 1];
  const ema20 = ema(closes(bars), 20);
  const last = lastBar(bars)!;
  const e20 = ema20[ema20.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (atrValue != null && e20 != null) {
    if (last.close > e20) {
      bullish = true;
      passed.push(condition('atr-filter', 'Price above 20 EMA with measurable ATR', true, last.close, e20));
    } else if (last.close < e20) {
      bearish = true;
      passed.push(condition('atr-filter', 'Price below 20 EMA with measurable ATR', true, last.close, e20));
    } else {
      failed.push(condition('atr-filter', 'Price at 20 EMA (no direction)', false, last.close, e20));
    }
    passed.push(condition('atr-volatility', 'ATR defined for stop placement', true, atrValue, null));
  } else {
    failed.push(condition('atr-ready', 'ATR/EMA not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 58 : 20;
  const stopLoss = bullish || bearish ? last.close - (bullish ? multiplier * atrValue! : -multiplier * atrValue!) : null;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'ATR bullish filter' : bearish ? 'ATR bearish filter' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: stopLoss ?? null,
    stopLoss,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateScalping(ctx: StrategyContext, minute: number): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const rsiPeriod = Number(params.rsiPeriod ?? 14);
  const volMultiplier = Number(params.volumeMultiplier ?? 1.5);
  if (bars.length < 30) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const ema9 = ema(closes(bars), 9);
  const ema21 = ema(closes(bars), 21);
  const rsiSeries = rsi(closes(bars), rsiPeriod);
  const vol = volumeAnalysis(bars, 20);
  const last = lastBar(bars)!;
  const e9 = ema9[ema9.length - 1];
  const e21 = ema21[ema21.length - 1];
  const r = rsiSeries[rsiSeries.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const trendUp = e9 != null && e21 != null && e9 > e21;
  const trendDn = e9 != null && e21 != null && e9 < e21;
  const rsiBull = r != null && r > 50 && r < 70;
  const rsiBear = r != null && r < 50 && r > 30;
  const volOk = vol.relativeVolume != null && vol.relativeVolume >= volMultiplier;
  if (trendUp && rsiBull) {
    bullish = true;
    passed.push(condition('scalp-trend', 'EMA9 > EMA21 (bullish alignment)', true, e9, e21));
    passed.push(condition('scalp-rsi', 'RSI in bullish momentum zone', true, r, 50));
  } else if (trendDn && rsiBear) {
    bearish = true;
    passed.push(condition('scalp-trend', 'EMA9 < EMA21 (bearish alignment)', true, e9, e21));
    passed.push(condition('scalp-rsi', 'RSI in bearish momentum zone', true, r, 50));
  } else {
    failed.push(condition('scalp-alignment', 'EMA/RSI not aligned for scalping', false, null, null));
  }
  if (volOk) {
    passed.push(condition('scalp-volume', 'Volume confirms move', true, vol.relativeVolume, volMultiplier));
  } else {
    failed.push(condition('scalp-volume', 'Volume insufficient for scalp', false, vol.relativeVolume, volMultiplier));
  }
  const score = bullish || bearish ? (volOk ? 72 : 55) : 22;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: `${minute}-min ${bullish || bearish ? (bullish ? 'long' : 'short') : 'no'} scalp`,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMomentumScalping(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const rsiPeriod = Number(params.rsiPeriod ?? 14);
  if (bars.length < rsiPeriod + 5) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const rsiSeries = rsi(closes(bars), rsiPeriod);
  const lastRsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lastRsi != null && prevRsi != null) {
    const momentumUp = prevRsi < 60 && lastRsi >= 60;
    const momentumDn = prevRsi > 40 && lastRsi <= 40;
    if (momentumUp) {
      bullish = true;
      passed.push(condition('momo-rsi', 'RSI crossed above 60 (momentum long)', true, lastRsi, 60));
    } else if (momentumDn) {
      bearish = true;
      passed.push(condition('momo-rsi', 'RSI crossed below 40 (momentum short)', true, lastRsi, 40));
    } else {
      failed.push(condition('momo-rsi', 'RSI not crossing momentum threshold', false, lastRsi, null));
    }
  } else {
    failed.push(condition('momo-ready', 'RSI not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 68 : 25;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'RSI momentum long' : bearish ? 'RSI momentum short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateFvg(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 3) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const c1 = prevBar(bars, 2)!;
  const c2 = prevBar(bars, 1)!;
  const c3 = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const bullishFvg = isBullish(c2) && c1.high < c3.low;
  const bearishFvg = isBearish(c2) && c1.low > c3.high;
  if (bullishFvg) {
    bullish = true;
    passed.push(condition('fvg-bullish', 'Bullish fair value gap (inefficiency)', true, c1.high, c3.low));
  } else if (bearishFvg) {
    bearish = true;
    passed.push(condition('fvg-bearish', 'Bearish fair value gap (inefficiency)', true, c1.low, c3.high));
  } else {
    failed.push(condition('fvg-present', 'No fair value gap on recent bars', false, null, null));
  }
  const score = bullish || bearish ? 64 : 24;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'FVG bullish imbalance' : bearish ? 'FVG bearish imbalance' : null,
    entryZone: bullish ? { low: c1.high, high: c3.low } : bearish ? { low: c3.high, high: c1.low } : null,
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateOrderBlock(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.obLookback ?? 20);
  if (bars.length < lookback + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const slice = bars.slice(bars.length - lookback - 1);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let bestBullish: { bar: Bar; index: number } | null = null;
  let bestBearish: { bar: Bar; index: number } | null = null;
  for (let i = 1; i < slice.length; i += 1) {
    const b = slice[i];
    const range = b.high - b.low;
    const bullishImpulse = isBullish(b) && range > 0 && (b.close - b.open) / range > 0.6;
    const bearishImpulse = isBearish(b) && range > 0 && (b.open - b.close) / range > 0.6;
    if (bullishImpulse && (!bestBullish || range > (bestBullish.bar.high - bestBullish.bar.low))) {
      bestBullish = { bar: slice[i - 1], index: i - 1 };
    }
    if (bearishImpulse && (!bestBearish || range > (bestBearish.bar.high - bestBearish.bar.low))) {
      bestBearish = { bar: slice[i - 1], index: i - 1 };
    }
  }
  if (bullish && bestBullish) {
    bullish = true;
    passed.push(condition('ob-bullish', 'Bullish order block identified before impulse', true, bestBullish.bar.low, bestBullish.bar.high));
  } else if (bearish && bestBearish) {
    bearish = true;
    passed.push(condition('ob-bearish', 'Bearish order block identified before impulse', true, bestBearish.bar.low, bestBearish.bar.high));
  } else {
    failed.push(condition('ob-present', 'No valid order block in lookback window', false, null, null));
  }
  const score = bullish || bearish ? 66 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bullish order block' : bearish ? 'Bearish order block' : null,
    entryZone: bestBullish ?? bestBearish ? { low: (bestBullish ?? bestBearish)!.bar.low, high: (bestBullish ?? bestBearish)!.bar.high } : null,
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateBreakerBlock(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.obLookback ?? 20);
  if (bars.length < lookback + 3) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const recent = bars.slice(bars.length - lookback);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const recentHighVal = recentHigh(recent, lookback);
  const recentLowVal = recentLow(recent, lookback);
  if (recentHighVal != null && last.close > recentHighVal && prev.close <= recentHighVal && last.low <= recentHighVal) {
    bullish = true;
    passed.push(condition('breaker-bullish', 'Resistance broken and retested as support', true, last.close, recentHighVal));
  } else if (recentLowVal != null && last.close < recentLowVal && prev.close >= recentLowVal && last.high >= recentLowVal) {
    bearish = true;
    passed.push(condition('breaker-bearish', 'Support broken and retested as resistance', true, last.close, recentLowVal));
  } else {
    failed.push(condition('breaker-present', 'No breaker block retest detected', false, null, null));
  }
  const score = bullish || bearish ? 68 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bullish breaker retest' : bearish ? 'Bearish breaker retest' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateLiquiditySweep(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.sweepLookback ?? 10);
  if (bars.length < lookback + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const priorHigh = recentHigh(prior, lookback);
  const priorLow = recentLow(prior, lookback);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const sweptHigh = priorHigh != null && last.high > priorHigh && isBullish(last);
  const sweptLow = priorLow != null && last.low < priorLow && isBearish(last);
  if (sweptHigh) {
    bullish = true;
    passed.push(condition('sweep-bullish', 'Buy-side liquidity swept, bullish reversal', true, last.high, priorHigh));
  } else if (sweptLow) {
    bearish = true;
    passed.push(condition('sweep-bearish', 'Sell-side liquidity swept, bearish reversal', true, last.low, priorLow));
  } else {
    failed.push(condition('sweep-present', 'No liquidity sweep on completed bar', false, null, null));
  }
  const score = bullish || bearish ? 70 : 28;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bullish liquidity sweep reversal' : bearish ? 'Bearish liquidity sweep reversal' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateBosChoch(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.bosLookback ?? 10);
  if (bars.length < lookback + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const structureHigh = recentHigh(prior, lookback);
  const structureLow = recentLow(prior, lookback);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let type = '';
  if (structureHigh != null && last.close > structureHigh && prev.close <= structureHigh) {
    const higherHigh = last.high > structureHigh;
    bullish = true;
    type = higherHigh ? 'BOS' : 'CHOCH';
    passed.push(condition('bos-choch-bullish', `${type}: structure high broken`, true, last.close, structureHigh));
  } else if (structureLow != null && last.close < structureLow && prev.close >= structureLow) {
    bearish = true;
    type = 'BOS/CHOCH';
    passed.push(condition('bos-choch-bearish', 'Structure low broken', true, last.close, structureLow));
  } else {
    failed.push(condition('bos-choch-present', 'No structure break on completed bar', false, null, null));
  }
  const score = bullish || bearish ? 70 : 28;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? `${type} bullish break` : bearish ? `${type} bearish break` : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMarketStructureShift(ctx: StrategyContext): Partial<StrategyResult> {
  return evaluateBosChoch(ctx);
}

function evaluateCrt(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const rangeBars = Number(params.crtRangeBars ?? 3);
  if (bars.length < rangeBars + 1) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const rangeSlice = bars.slice(bars.length - rangeBars - 1, bars.length - 1);
  const last = lastBar(bars)!;
  const rangeHigh = recentHigh(rangeSlice, rangeSlice.length);
  const rangeLow = recentLow(rangeSlice, rangeSlice.length);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (rangeHigh != null && rangeLow != null) {
    const rangeSize = rangeHigh - rangeLow;
    const closePosition = rangeSize === 0 ? 0.5 : (last.close - rangeLow) / rangeSize;
    if (last.close > rangeHigh && last.open <= rangeHigh) {
      bullish = true;
      passed.push(condition('crt-breakout', 'Price broke above CRT range high', true, last.close, rangeHigh));
    } else if (last.close < rangeLow && last.open >= rangeLow) {
      bearish = true;
      passed.push(condition('crt-breakdown', 'Price broke below CRT range low', true, last.close, rangeLow));
    } else {
      failed.push(condition('crt-contained', 'Price contained within CRT range', false, last.close, null));
    }
    passed.push(condition('crt-position', 'Close position within range', true, closePosition, null));
  } else {
    failed.push(condition('crt-range', 'CRT range not defined', false, null, null));
  }
  const score = bullish || bearish ? 66 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'CRT range breakout' : bearish ? 'CRT range breakdown' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluatePremiumDiscount(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.pdLookback ?? 50);
  if (bars.length < lookback + 1) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const slice = bars.slice(bars.length - lookback);
  const last = lastBar(bars)!;
  const rangeHigh = recentHigh(slice, slice.length);
  const rangeLow = recentLow(slice, slice.length);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (rangeHigh != null && rangeLow != null && rangeHigh > rangeLow) {
    const mid = (rangeHigh + rangeLow) / 2;
    const inDiscount = last.close < mid;
    const inPremium = last.close > mid;
    const sma20 = sma(closes(slice), 20);
    const trendUp = last.close > (sma20[sma20.length - 1] ?? 0);
    const trendDn = last.close < (sma20[sma20.length - 1] ?? 0);
    if (inDiscount && trendUp) {
      bullish = true;
      passed.push(condition('pd-discount', 'Price in discount zone of uptrend', true, last.close, mid));
    } else if (inPremium && trendDn) {
      bearish = true;
      passed.push(condition('pd-premium', 'Price in premium zone of downtrend', true, last.close, mid));
    } else {
      failed.push(condition('pd-zone', 'Price not in actionable premium/discount zone', false, last.close, mid));
    }
  } else {
    failed.push(condition('pd-range', 'Insufficient range for premium/discount', false, null, null));
  }
  const score = bullish || bearish ? 60 : 24;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Discount zone long' : bearish ? 'Premium zone short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateSupportResistance(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const strength = Number(params.srStrength ?? 3);
  if (bars.length < 30) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const levels = supportResistance(bars, strength);
  const last = lastBar(bars)!;
  const price = last.close;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const sma50 = sma(closes(bars), 50);
  const trendUp = last.close > (sma50[sma50.length - 1] ?? 0);
  const trendDn = last.close < (sma50[sma50.length - 1] ?? 0);
  const nearSupport = levels.supports.some((l) => Math.abs(price - l.price) / l.price < 0.005);
  const nearResistance = levels.resistances.some((l) => Math.abs(price - l.price) / l.price < 0.005);
  if (nearSupport && trendUp && isBullish(last)) {
    bullish = true;
    passed.push(condition('sr-support', 'Price at support in uptrend', true, price, levels.supports[0]?.price ?? null));
  } else if (nearResistance && trendDn && isBearish(last)) {
    bearish = true;
    passed.push(condition('sr-resistance', 'Price at resistance in downtrend', true, price, levels.resistances[0]?.price ?? null));
  } else {
    failed.push(condition('sr-level', 'Price not at actionable S/R level', false, price, null));
  }
  const score = bullish || bearish ? 62 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Support bounce' : bearish ? 'Resistance rejection' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateBreakoutRetest(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.brLookback ?? 20);
  if (bars.length < lookback + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const levelHigh = recentHigh(prior, lookback);
  const levelLow = recentLow(prior, lookback);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (levelHigh != null && last.close > levelHigh && prev.close <= levelHigh && last.low <= levelHigh) {
    bullish = true;
    passed.push(condition('br-breakout', 'Breakout above level with retest', true, last.close, levelHigh));
  } else if (levelLow != null && last.close < levelLow && prev.close >= levelLow && last.high >= levelLow) {
    bearish = true;
    passed.push(condition('br-breakdown', 'Breakdown below level with retest', true, last.close, levelLow));
  } else {
    failed.push(condition('br-level', 'No breakout and retest detected', false, null, null));
  }
  const score = bullish || bearish ? 68 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Breakout and retest long' : bearish ? 'Breakdown and retest short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateSupplyDemand(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.sdLookback ?? 30);
  if (bars.length < lookback + 1) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const slice = bars.slice(bars.length - lookback);
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let bestDemand: { low: number; high: number } | null = null;
  let bestSupply: { low: number; high: number } | null = null;
  for (let i = 2; i < slice.length - 1; i += 1) {
    const b = slice[i];
    const next = slice[i + 1];
    const range = b.high - b.low;
    const strongUp = isBullish(b) && range > 0 && (b.close - b.open) / range > 0.5;
    const strongDn = isBearish(b) && range > 0 && (b.open - b.close) / range > 0.5;
    if (strongUp && next && next.close > b.high) {
      bestDemand = { low: b.low, high: b.high };
    }
    if (strongDn && next && next.close < b.low) {
      bestSupply = { low: b.low, high: b.high };
    }
  }
  if (bestDemand && last.close >= bestDemand.low && last.close <= bestDemand.high && isBullish(last)) {
    bullish = true;
    passed.push(condition('sd-demand', 'Price returning to demand zone', true, last.close, bestDemand.low));
  } else if (bestSupply && last.close >= bestSupply.low && last.close <= bestSupply.high && isBearish(last)) {
    bearish = true;
    passed.push(condition('sd-supply', 'Price returning to supply zone', true, last.close, bestSupply.high));
  } else {
    failed.push(condition('sd-zone', 'Price not in supply/demand zone', false, null, null));
  }
  const score = bullish || bearish ? 64 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Demand zone long' : bearish ? 'Supply zone short' : null,
    entryZone: bestDemand ?? bestSupply ?? { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateCandlestickPatterns(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const lastRange = last.high - last.low;
  const lastBody = body(last);
  const hammer = lastRange > 0 && lowerWick(last) > 2 * lastBody && upperWick(last) < lastBody * 0.5;
  const engulfingBull = isBearish(prev) && isBullish(last) && last.open < prev.close && last.close > prev.open;
  const engulfingBear = isBullish(prev) && isBearish(last) && last.open > prev.close && last.close < prev.open;
  const doji = lastRange > 0 && lastBody < lastRange * 0.1;
  if (hammer) {
    bullish = true;
    passed.push(condition('pattern-hammer', 'Bullish hammer candle', true, lastBody, lastRange));
  } else if (engulfingBull) {
    bullish = true;
    passed.push(condition('pattern-engulfing', 'Bullish engulfing pattern', true, last.close, prev.open));
  } else if (engulfingBear) {
    bearish = true;
    passed.push(condition('pattern-engulfing', 'Bearish engulfing pattern', true, last.close, prev.open));
  } else if (doji) {
    failed.push(condition('pattern-doji', 'Indecision doji — no direction', false, last.close, prev.close));
  } else {
    failed.push(condition('pattern-none', 'No recognized candlestick pattern', false, null, null));
  }
  const score = bullish || bearish ? 58 : 20;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bullish candlestick pattern' : bearish ? 'Bearish candlestick pattern' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateSwingTrading(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 50) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const ema50 = ema(closes(bars), 50);
  const last = lastBar(bars)!;
  const e50 = ema50[ema50.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (e50 != null) {
    if (last.close > e50 && isBullish(last)) {
      bullish = true;
      passed.push(condition('swing-trend', 'Price above 50 EMA with bullish bar', true, last.close, e50));
    } else if (last.close < e50 && isBearish(last)) {
      bearish = true;
      passed.push(condition('swing-trend', 'Price below 50 EMA with bearish bar', true, last.close, e50));
    } else {
      failed.push(condition('swing-trend', 'No clear swing direction', false, last.close, e50));
    }
  } else {
    failed.push(condition('swing-ready', 'EMA50 not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 62 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Swing long above EMA50' : bearish ? 'Swing short below EMA50' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateTrendFollowing(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 200) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const ema200 = ema(closes(bars), 200);
  const ema50 = ema(closes(bars), 50);
  const last = lastBar(bars)!;
  const e200 = ema200[ema200.length - 1];
  const e50 = ema50[ema50.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const prior = bars.slice(0, bars.length - 1);
  const higherHigh = last.high > (recentHigh(prior, 20) ?? 0);
  const lowerLow = last.low < (recentLow(prior, 20) ?? 0);
  if (e200 != null && e50 != null) {
    if (last.close > e200 && e50 > e200 && higherHigh) {
      bullish = true;
      passed.push(condition('tf-trend', 'Uptrend: price > EMA200 > EMA50, higher high', true, last.close, e200));
    } else if (last.close < e200 && e50 < e200 && lowerLow) {
      bearish = true;
      passed.push(condition('tf-trend', 'Downtrend: price < EMA200 < EMA50, lower low', true, last.close, e200));
    } else {
      failed.push(condition('tf-trend', 'No established trend following setup', false, null, null));
    }
  } else {
    failed.push(condition('tf-ready', 'EMAs not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 70 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Trend following long' : bearish ? 'Trend following short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMeanReversion(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const period = Number(params.mrPeriod ?? 20);
  const zScoreThreshold = Number(params.zScoreThreshold ?? 2);
  if (bars.length < period + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const closeSeries = closes(bars);
  const mean = sma(closeSeries, period);
  const last = lastBar(bars)!;
  const m = mean[mean.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (m != null) {
    const recent = closeSeries.slice(closeSeries.length - period);
    const variance = recent.reduce((s, v) => s + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const zScore = sd === 0 ? 0 : (last.close - m) / sd;
    if (zScore <= -zScoreThreshold && isBullish(last)) {
      bullish = true;
      passed.push(condition('mr-zscore', 'Price extended below mean (oversold)', true, zScore, -zScoreThreshold));
    } else if (zScore >= zScoreThreshold && isBearish(last)) {
      bearish = true;
      passed.push(condition('mr-zscore', 'Price extended above mean (overbought)', true, zScore, zScoreThreshold));
    } else {
      failed.push(condition('mr-zscore', 'Price not extended enough for mean reversion', false, zScore, null));
    }
    passed.push(condition('mr-mean', 'Mean-reversion target is SMA mean', true, last.close, m));
  } else {
    failed.push(condition('mr-ready', 'Mean not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 60 : 24;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Mean reversion long' : bearish ? 'Mean reversion short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: m ?? null,
    stopLoss: null,
    target1: m ?? null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMomentumTrading(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lookback = Number(params.momLookback ?? 10);
  const volMult = Number(params.volumeMultiplier ?? 1.5);
  if (bars.length < lookback + 2) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const vol = volumeAnalysis(bars, 20);
  const priceChange = (last.close - prev.close) / prev.close;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const strongUp = priceChange > 0.015 && last.close > last.open;
  const strongDn = priceChange < -0.015 && last.close < last.open;
  const volOk = vol.relativeVolume != null && vol.relativeVolume >= volMult;
  if (strongUp && volOk) {
    bullish = true;
    passed.push(condition('momo-move', 'Strong upward move with volume', true, priceChange, vol.relativeVolume));
  } else if (strongDn && volOk) {
    bearish = true;
    passed.push(condition('momo-move', 'Strong downward move with volume', true, priceChange, vol.relativeVolume));
  } else {
    failed.push(condition('momo-move', 'No strong momentum move with volume', false, priceChange, null));
  }
  const score = bullish || bearish ? 66 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Momentum long' : bearish ? 'Momentum short' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateMultiTimeframe(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 100) {
    return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  }
  const sma50 = sma(closes(bars), 50);
  const sma200 = sma(closes(bars), 200);
  const last = lastBar(bars)!;
  const s50 = sma50[sma50.length - 1];
  const s200 = sma200[sma200.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (s50 != null && s200 != null) {
    const alignedBull = last.close > s50 && s50 > s200;
    const alignedBear = last.close < s50 && s50 < s200;
    if (alignedBull) {
      bullish = true;
      passed.push(condition('mtf-align', 'Timeframes aligned bullish', true, last.close, s50));
    } else if (alignedBear) {
      bearish = true;
      passed.push(condition('mtf-align', 'Timeframes aligned bearish', true, last.close, s50));
    } else {
      failed.push(condition('mtf-align', 'Timeframes not aligned', false, null, null));
    }
  } else {
    failed.push(condition('mtf-ready', 'SMAs not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 64 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Multi-timeframe bullish alignment' : bearish ? 'Multi-timeframe bearish alignment' : null,
    entryZone: { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

/* ───────────────────────── strategy registry ───────────────────────── */

const PARAM = (id: string, label: string, def: number | boolean, opts?: { min?: number; max?: number; step?: number; options?: StrategyParameter['options'] }): StrategyParameter => ({
  id,
  label,
  type: typeof def === 'boolean' ? 'boolean' : 'number',
  default: def,
  ...opts,
});

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {
    id: 'scalp-1m',
    name: '1-Minute Scalping',
    category: 'SCALPING',
    description: 'Fast EMA9/EMA21 alignment with RSI momentum on 1-minute bars.',
    timeframes: ['1m'],
    parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 0.4, target2Pct: 0.8 },
    rationale: 'Buys when EMA9 > EMA21 and RSI in bullish zone with volume confirmation.',
  },
  {
    id: 'scalp-3m',
    name: '3-Minute Scalping',
    category: 'SCALPING',
    description: 'EMA alignment + RSI momentum on 3-minute bars.',
    timeframes: ['3m', '5m'],
    parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 },
    rationale: 'Scalps intraday momentum with EMA and RSI confirmation.',
  },
  {
    id: 'scalp-5m',
    name: '5-Minute Scalping',
    category: 'SCALPING',
    description: 'EMA alignment + RSI momentum on 5-minute bars.',
    timeframes: ['5m', '15m'],
    parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 },
    rationale: 'Slightly slower scalping with more confirmation per bar.',
  },
  {
    id: 'momo-scalp',
    name: 'Momentum Scalping',
    category: 'SCALPING',
    description: 'RSI momentum cross with volume confirmation.',
    timeframes: ['1m', '3m', '5m', '15m'],
    parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.5 },
    defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 },
    rationale: 'Longs when RSI crosses above 60, shorts when below 40.',
  },
  {
    id: 'vwap-scalp',
    name: 'VWAP Scalping',
    category: 'SCALPING',
    description: 'Mean reversion to VWAP from discount/premium zones.',
    timeframes: ['1m', '3m', '5m', '15m'],
    parameters: [PARAM('vwapDeviation', 'VWAP deviation %', 0.5, { min: 0.1, max: 2, step: 0.1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.4 },
    defaultTargets: { target1Pct: 0.5, target2Pct: 1.0 },
    rationale: 'Buys when price is below VWAP (discount), sells when above VWAP (premium).',
  },
  {
    id: 'crt',
    name: 'CRT — Candle Range Theory',
    category: 'ICT_SMART_MONEY',
    description: 'Breakout of the opening candle range.',
    timeframes: ['5m', '15m', '1h', '1D'],
    parameters: [PARAM('crtRangeBars', 'Range-defining bars', 3, { min: 2, max: 10, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 },
    rationale: 'Trades the breakout of the range set by the first N candles.',
  },
  {
    id: 'order-block',
    name: 'Order Blocks',
    category: 'ICT_SMART_MONEY',
    description: 'Last opposing candle before a strong impulsive move.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('obLookback', 'Lookback bars', 20, { min: 10, max: 100, step: 1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Enters at order blocks created by institutional order flow.',
  },
  {
    id: 'breaker-block',
    name: 'Breaker Blocks',
    category: 'ICT_SMART_MONEY',
    description: 'Failed order block retested as support/resistance.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('obLookback', 'Lookback bars', 20, { min: 10, max: 100, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 },
    rationale: 'Trades retests of broken order blocks.',
  },
  {
    id: 'fvg',
    name: 'Fair Value Gaps',
    category: 'ICT_SMART_MONEY',
    description: 'Three-candle price inefficiency (imbalance).',
    timeframes: ['5m', '15m', '1h', '4h'],
    parameters: [],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 0.9, target2Pct: 1.8 },
    rationale: 'Price tends to return to fill fair value gaps.',
  },
  {
    id: 'liquidity-sweep',
    name: 'Liquidity Sweeps',
    category: 'ICT_SMART_MONEY',
    description: 'Stop-hunt reversal after sweeping recent highs/lows.',
    timeframes: ['5m', '15m', '1h'],
    parameters: [PARAM('sweepLookback', 'Sweep lookback bars', 10, { min: 5, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.0 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Buys bearish sweeps, sells bullish sweeps on reversal.',
  },
  {
    id: 'bos-choch',
    name: 'BOS and CHOCH',
    category: 'ICT_SMART_MONEY',
    description: 'Break of Structure and Change of Character.',
    timeframes: ['15m', '1h', '4h'],
    parameters: [PARAM('bosLookback', 'Structure lookback bars', 10, { min: 5, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Trades structure breaks in the direction of market structure.',
  },
  {
    id: 'mss',
    name: 'Market Structure Shift',
    category: 'ICT_SMART_MONEY',
    description: 'Shift from bullish to bearish structure (or vice versa).',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('bosLookback', 'Structure lookback bars', 10, { min: 5, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 },
    rationale: 'Identifies when market structure shifts direction.',
  },
  {
    id: 'buy-sell-liquidity',
    name: 'Buy-side and Sell-side Liquidity',
    category: 'ICT_SMART_MONEY',
    description: 'Liquidity pools above recent highs / below recent lows.',
    timeframes: ['15m', '1h', '4h'],
    parameters: [PARAM('sweepLookback', 'Liquidity lookback bars', 10, { min: 5, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Price seeks liquidity before reversing.',
  },
  {
    id: 'premium-discount',
    name: 'Premium and Discount Zones',
    category: 'ICT_SMART_MONEY',
    description: 'Buy in discount zones of an uptrend; sell in premium zones of a downtrend.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('pdLookback', 'Range lookback bars', 50, { min: 20, max: 200, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Discount = below 50% range; premium = above 50% range.',
  },
  {
    id: 'support-resistance',
    name: 'Support and Resistance',
    category: 'PRICE_ACTION',
    description: 'Bounces at support, rejections at resistance.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('srStrength', 'Touch strength', 3, { min: 2, max: 10, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 },
    rationale: 'Trades reactions at key support/resistance levels.',
  },
  {
    id: 'breakout-retest',
    name: 'Breakout and Retest',
    category: 'PRICE_ACTION',
    description: 'Breakout above a level followed by a retest.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('brLookback', 'Level lookback bars', 20, { min: 10, max: 100, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Enters on retest after a confirmed breakout.',
  },
  {
    id: 'supply-demand',
    name: 'Supply and Demand',
    category: 'PRICE_ACTION',
    description: 'Zones where price reversed with strong impulse.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('sdLookback', 'Zone lookback bars', 30, { min: 10, max: 100, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Buys demand zones, sells supply zones.',
  },
  {
    id: 'trendline',
    name: 'Trendline Trading',
    category: 'PRICE_ACTION',
    description: 'Bounces off rising trendlines / breakdowns from falling trendlines.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('srStrength', 'Touch strength', 3, { min: 2, max: 10, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Approximates trendlines via swing highs/lows and SMA alignment.',
  },
  {
    id: 'candlestick-patterns',
    name: 'Candlestick Patterns',
    category: 'PRICE_ACTION',
    description: 'Hammer, engulfing, doji and other single-bar patterns.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.5 },
    defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 },
    rationale: 'Single-candle reversal and continuation signals.',
  },
  {
    id: 'ema-crossover',
    name: 'EMA Crossover',
    category: 'INDICATORS',
    description: 'Fast EMA crosses slow EMA.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('fastEma', 'Fast EMA', 9, { min: 5, max: 50, step: 1 }), PARAM('slowEma', 'Slow EMA', 21, { min: 10, max: 100, step: 1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 },
    rationale: 'Longs on bullish crossover, shorts on bearish crossover.',
  },
  {
    id: 'rsi',
    name: 'RSI',
    category: 'INDICATORS',
    description: 'RSI oversold recovery / overbought rejection.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('overbought', 'Overbought level', 70, { min: 60, max: 90, step: 1 }), PARAM('oversold', 'Oversold level', 30, { min: 10, max: 40, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 },
    rationale: 'Buys RSI recovery from oversold, sells rejection from overbought.',
  },
  {
    id: 'macd',
    name: 'MACD',
    category: 'INDICATORS',
    description: 'MACD line crosses signal with histogram confirmation.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('macdFast', 'MACD fast', 12, { min: 5, max: 30, step: 1 }), PARAM('macdSlow', 'MACD slow', 26, { min: 10, max: 50, step: 1 }), PARAM('macdSignal', 'MACD signal', 9, { min: 5, max: 20, step: 1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Longs on bullish MACD crossover with rising histogram.',
  },
  {
    id: 'bollinger-bands',
    name: 'Bollinger Bands',
    category: 'INDICATORS',
    description: 'Mean reversion from Bollinger Band extremes.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('bbPeriod', 'Bollinger period', 20, { min: 10, max: 50, step: 1 }), PARAM('bbDev', 'Standard deviations', 2, { min: 1.5, max: 3, step: 0.1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 },
    rationale: 'Buys lower-band touches, sells upper-band touches.',
  },
  {
    id: 'vwap',
    name: 'VWAP',
    category: 'INDICATORS',
    description: 'Price vs volume-weighted average price.',
    timeframes: ['1m', '5m', '15m', '1h'],
    parameters: [PARAM('vwapDeviation', 'VWAP deviation %', 0.5, { min: 0.1, max: 2, step: 0.1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.4 },
    defaultTargets: { target1Pct: 0.5, target2Pct: 1.0 },
    rationale: 'Buys below VWAP, sells above VWAP.',
  },
  {
    id: 'adx',
    name: 'ADX',
    category: 'INDICATORS',
    description: 'Trend strength with +DI/-DI direction.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('adxPeriod', 'ADX period', 14, { min: 5, max: 50, step: 1 }), PARAM('adxThreshold', 'ADX threshold', 25, { min: 15, max: 50, step: 1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Trades only when ADX confirms a directional trend.',
  },
  {
    id: 'atr',
    name: 'ATR',
    category: 'INDICATORS',
    description: 'Volatility-based stops with EMA20 direction filter.',
    timeframes: ['15m', '1h', '4h', '1D'],
    parameters: [PARAM('atrPeriod', 'ATR period', 14, { min: 5, max: 50, step: 1 }), PARAM('atrMultiplier', 'ATR multiplier', 2, { min: 1, max: 5, step: 0.1 })],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.0 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Uses ATR for stop placement; direction from EMA20 filter.',
  },
  {
    id: 'swing-trading',
    name: 'Swing Trading',
    category: 'OTHER',
    description: 'Multi-session trend with pullback to EMA50.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.0 },
    defaultTargets: { target1Pct: 1.5, target2Pct: 3.0 },
    rationale: 'Holds positions across sessions in the direction of the trend.',
  },
  {
    id: 'trend-following',
    name: 'Trend Following',
    category: 'OTHER',
    description: 'Price above/below EMA200 with EMA50 alignment.',
    timeframes: ['4h', '1D', '1W'],
    parameters: [],
    defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.5 },
    defaultTargets: { target1Pct: 2.0, target2Pct: 4.0 },
    rationale: 'Captures sustained trends with EMA200 filter.',
  },
  {
    id: 'mean-reversion',
    name: 'Mean Reversion',
    category: 'OTHER',
    description: 'Z-score mean reversion from SMA mean.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [PARAM('mrPeriod', 'Mean period', 20, { min: 10, max: 100, step: 1 }), PARAM('zScoreThreshold', 'Z-score threshold', 2, { min: 1, max: 4, step: 0.1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Buys oversold extensions, sells overbought extensions.',
  },
  {
    id: 'momentum-trading',
    name: 'Momentum Trading',
    category: 'OTHER',
    description: 'Strong price move with volume confirmation.',
    timeframes: ['15m', '1h', '4h'],
    parameters: [PARAM('momLookback', 'Momentum lookback bars', 10, { min: 3, max: 30, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 },
    defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 },
    rationale: 'Trades strong directional moves with volume.',
  },
  {
    id: 'multi-timeframe',
    name: 'Multi-Timeframe Analysis',
    category: 'OTHER',
    description: 'Aligns trend across multiple timeframes via SMA stack.',
    timeframes: ['1h', '4h', '1D'],
    parameters: [],
    defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 },
    defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 },
    rationale: 'Only trades when timeframes are aligned.',
  },
];

export function getStrategyDefinition(id: string): StrategyDefinition | undefined {
  return STRATEGY_DEFINITIONS.find((s) => s.id === id);
}

export function getStrategyDefinitionsByCategory(category: StrategyCategory): StrategyDefinition[] {
  return STRATEGY_DEFINITIONS.filter((s) => s.category === category);
}

/* ───────────────────────── strategy evaluation dispatcher ───────────────────────── */

type StrategyEvaluator = (ctx: StrategyContext) => Partial<StrategyResult>;

const EVALUATORS: Record<string, StrategyEvaluator> = {
  'ema-crossover': evaluateEmaCrossover,
  'rsi': evaluateRsi,
  'macd': evaluateMacd,
  'bollinger-bands': evaluateBollinger,
  'vwap': evaluateVwap,
  'adx': evaluateAdx,
  'atr': evaluateAtr,
  'scalp-1m': (ctx) => evaluateScalping(ctx, 1),
  'scalp-3m': (ctx) => evaluateScalping(ctx, 3),
  'scalp-5m': (ctx) => evaluateScalping(ctx, 5),
  'momo-scalp': evaluateMomentumScalping,
  'vwap-scalp': evaluateVwap,
  'crt': evaluateCrt,
  'order-block': evaluateOrderBlock,
  'breaker-block': evaluateBreakerBlock,
  'fvg': evaluateFvg,
  'liquidity-sweep': evaluateLiquiditySweep,
  'bos-choch': evaluateBosChoch,
  'mss': evaluateMarketStructureShift,
  'buy-sell-liquidity': evaluateLiquiditySweep,
  'premium-discount': evaluatePremiumDiscount,
  'support-resistance': evaluateSupportResistance,
  'breakout-retest': evaluateBreakoutRetest,
  'supply-demand': evaluateSupplyDemand,
  'trendline': evaluateSupportResistance,
  'candlestick-patterns': evaluateCandlestickPatterns,
  'swing-trading': evaluateSwingTrading,
  'trend-following': evaluateTrendFollowing,
  'mean-reversion': evaluateMeanReversion,
  'momentum-trading': evaluateMomentumTrading,
  'multi-timeframe': evaluateMultiTimeframe,
};

export function evaluateStrategy(
  definition: StrategyDefinition,
  candles: Bar[],
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number },
  userParams: Record<string, number | boolean>,
  timeframe: string,
  nowMs: number,
): StrategyResult {
  const completed = completedOnly(candles, intervalSecondsForTimeframe(timeframe), nowMs);
  if (completed.length < 20) {
    return {
      strategyId: definition.id,
      strategyName: definition.name,
      category: definition.category,
      direction: 'NO_TRADE',
      score: 0,
      timeframe,
      conditionsPassed: [],
      conditionsFailed: [condition('insufficient-data', `Need >= 20 completed candles, have ${completed.length}`, false, null, null)],
      entryTrigger: null,
      entryZone: null,
      invalidationLevel: null,
      stopLoss: null,
      target1: null,
      target2: null,
      riskReward: null,
      rationale: 'Insufficient completed history to evaluate.',
      evaluatedAt: new Date(nowMs).toISOString(),
      isDemo: true,
    };
  }

  const params: Record<string, number> = {};
  for (const p of definition.parameters) {
    const v = userParams[p.id];
    params[p.id] = typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : (Number(p.default) ?? 0));
  }

  const ctx: StrategyContext = { bars: completed, quote, params, timeframe, nowMs };
  const evaluator = EVALUATORS[definition.id];
  const fallback: Partial<StrategyResult> = {
    direction: 'NO_TRADE',
    score: 0,
    conditionsPassed: [],
    conditionsFailed: [],
  };
  const partial = evaluator ? evaluator(ctx) : fallback;

  const last = lastBar(completed);
  const stopLoss = partial.stopLoss ?? null;
  const target1 = partial.target1 ?? null;
  const target2 = partial.target2 ?? null;
  const price = last?.close ?? quote.lastPrice;
  const invalidation = partial.invalidationLevel ?? null;
  let riskReward: number | null = null;
  if (stopLoss != null && target1 != null && price != null) {
    const risk = Math.abs(price - stopLoss);
    const reward = Math.abs(target1 - price);
    riskReward = risk > 0 ? reward / risk : null;
  }

  const passed = partial.conditionsPassed ?? [];
  const failed = partial.conditionsFailed ?? [];
  const direction = partial.direction ?? 'NO_TRADE';
  const score = clamp(partial.score ?? 0, 0, 100);
  const rationale = buildRationale(direction, score, passed, failed);

  return {
    strategyId: definition.id,
    strategyName: definition.name,
    category: definition.category,
    direction,
    score,
    timeframe,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: partial.entryTrigger ?? null,
    entryZone: partial.entryZone ?? null,
    invalidationLevel: invalidation,
    stopLoss,
    target1,
    target2,
    riskReward,
    rationale,
    evaluatedAt: new Date(nowMs).toISOString(),
    isDemo: true,
  };
}

function intervalSecondsForTimeframe(tf: string): number {
  const m = tf.match(/^(\d+)m$/);
  if (m) return Number(m[1]) * 60;
  if (tf === '1h') return 3600;
  if (tf === '4h') return 14400;
  if (tf === '1D') return 86400;
  if (tf === '1W') return 604800;
  return 3600;
}

function buildRationale(direction: SignalAction, score: number, passed: StrategyConditionResult[], failed: StrategyConditionResult[]): string {
  const passCount = passed.filter((p) => p.passed).length;
  const failCount = failed.filter((f) => !f.passed).length;
  if (direction === 'NO_TRADE') return `No setup: ${passCount} conditions met, ${failCount} not met. Score ${score}/100 (confluence, not probability).`;
  return `${direction} bias: ${passCount} conditions met, ${failCount} not met. Score ${score}/100.`;
}

/* ───────────────────────── combination + instrument decision ───────────────────────── */

function decideDirection(results: StrategyResult[], combination: CombinationConfig): SignalAction {
  const enabled = results.filter((r) => r.direction !== 'NO_TRADE');
  if (enabled.length === 0) return 'NO_TRADE';

  const buyCount = enabled.filter((r) => r.direction === 'BUY').length;
  const sellCount = enabled.filter((r) => r.direction === 'SELL').length;
  const watchCount = enabled.filter((r) => r.direction === 'WATCH').length;

  const minConf = Math.max(0, Math.min(combination.minConfirmations, enabled.length));
  const enoughBuy = buyCount >= minConf && buyCount > 0;
  const enoughSell = sellCount >= minConf && sellCount > 0;

  if (combination.operator === 'AND') {
    const nonNoTrade = enabled.length;
    if (buyCount === nonNoTrade && enoughBuy) return 'BUY';
    if (sellCount === nonNoTrade && enoughSell) return 'SELL';
    if (watchCount >= minConf && watchCount === nonNoTrade) return 'WATCH';
    return 'NO_TRADE';
  }
  if (enoughBuy && buyCount >= sellCount) return 'BUY';
  if (enoughSell && sellCount > buyCount) return 'SELL';
  if (watchCount >= minConf) return 'WATCH';
  return 'NO_TRADE';
}

function aggregateScore(results: StrategyResult[], direction: SignalAction): number {
  const agreeing = results.filter((r) => r.direction === direction && r.direction !== 'NO_TRADE');
  if (agreeing.length === 0) return 0;
  const sum = agreeing.reduce((a, r) => a + r.score, 0);
  return Math.round(sum / agreeing.length);
}

function consensusEntry(results: StrategyResult[], direction: SignalAction): { entry: number | null; stop: number | null; t1: number | null; t2: number | null; rr: number | null } {
  const agreeing = results.filter((r) => r.direction === direction && r.direction !== 'NO_TRADE').sort((a, b) => b.score - a.score);
  if (agreeing.length === 0) return { entry: null, stop: null, t1: null, t2: null, rr: null };
  const best = agreeing[0];
  return {
    entry: best.entryZone ? (best.entryZone.low + best.entryZone.high) / 2 : null,
    stop: best.invalidationLevel ?? best.stopLoss ?? null,
    t1: best.target1 ?? null,
    t2: best.target2 ?? null,
    rr: best.riskReward ?? null,
  };
}

export function evaluateInstrument(
  instrumentId: string,
  symbol: string,
  market: string,
  exchange: string,
  candles: Bar[],
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number },
  userConfig: {
    combination: CombinationConfig;
    strategies: UserStrategyConfig[];
    timeframes: string[];
    minRiskReward: number;
    maxSpreadBps: number;
    minLiquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  },
  nowMs: number,
): InstrumentDecision {
  const enabled = userConfig.strategies.filter((s) => s.enabled);
  const results: StrategyResult[] = [];

  for (const uc of enabled) {
    const def = getStrategyDefinition(uc.strategyId);
    if (!def) continue;
    const tf = userConfig.timeframes.find((t) => def.timeframes.includes(t)) ?? def.timeframes[0] ?? '1h';
    const result = evaluateStrategy(def, candles, quote, uc.parameters, tf, nowMs);
    results.push(result);
  }

  const primary = decideDirection(results, userConfig.combination);
  const agreeing = results.filter((r) => r.direction === primary && primary !== 'NO_TRADE');
  const direction = primary === 'NO_TRADE' ? null : primary;
  const score = aggregateScore(results, primary);
  const consensus = consensusEntry(results, primary);

  const risks: string[] = [];
  const quoteSpread = quote.spreadBps != null ? quote.spreadBps : 0;
  if (quoteSpread > userConfig.maxSpreadBps) risks.push(`Spread ${quoteSpread}bps exceeds max ${userConfig.maxSpreadBps}bps`);
  if (consensus.rr != null && consensus.rr < userConfig.minRiskReward) risks.push(`Risk/reward ${consensus.rr.toFixed(2)} below minimum ${userConfig.minRiskReward}`);

  let reason = '';
  switch (primary) {
    case 'BUY':
      reason = `${agreeing.length} of ${enabled.length} enabled strategies agree on BUY. Score ${score}/100.`;
      break;
    case 'SELL':
      reason = `${agreeing.length} of ${enabled.length} enabled strategies agree on SELL. Score ${score}/100.`;
      break;
    case 'WATCH':
      reason = `Developing setup: ${agreeing.length} strategies lean ${direction}. Not yet confirmed.`;
      break;
    default:
      reason = `No qualified setup: ${agreeing.length} strategies agree. Conditions incomplete or conflicting.`;
      break;
  }

  return {
    instrumentId,
    symbol,
    market,
    exchange,
    lastPrice: quote.lastPrice,
    freshness: 'DEMO',
    source: { provider: 'QUANTORA Strategy Engine', origin: 'SIMULATED', isDemo: true, reliability: 'PROVISIONAL' },
    timeframe: userConfig.timeframes[0] ?? '1h',
    primaryDecision: primary,
    direction,
    strategyResults: results,
    combinationLogic: userConfig.combination,
    agreementCount: agreeing.length,
    totalEnabled: enabled.length,
    entryTrigger: agreeing.length > 0 ? agreeing[0].entryTrigger : null,
    entryZone: consensus.entry != null ? { low: consensus.entry, high: consensus.entry } : null,
    stopLoss: consensus.stop,
    target1: consensus.t1,
    target2: consensus.t2,
    riskReward: consensus.rr,
    strategyQualityScore: score,
    conditionsPassedTotal: results.reduce((a, r) => a + r.conditionsPassed.filter((p) => p.passed).length, 0),
    conditionsFailedTotal: results.reduce((a, r) => a + r.conditionsFailed.filter((f) => !f.passed).length, 0),
    invalidationLevel: consensus.stop ?? null,
    reason,
    risks,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}
