/**
 * QUANTORA frontend strategy engine.
 *
 * Client-side deterministic strategy evaluation. Mirrors the backend engine
 * so the UI can show strategy decisions without relying on a round-trip.
 * All scores are 0-100 confluence metrics — never win probabilities.
 */

import type { Candle } from '@/models';
import {
  adx,
  atr,
  bollinger,
  ema,
  macd,
  rsi,
  sma,
  vwap,
} from '@/lib/indicators';
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
} from './strategyTypes';

/* ───────────────────────── helpers ───────────────────────── */

const lastBar = (bars: Candle[]): Candle | null => (bars.length === 0 ? null : bars[bars.length - 1]);
const prevBar = (bars: Candle[], n: number): Candle | null =>
  bars.length > n ? bars[bars.length - 1 - n] : null;

const closes = (bars: Candle[]): number[] => bars.map((b) => b.close);
const highs = (bars: Candle[]): number[] => bars.map((b) => b.high);
const lows = (bars: Candle[]): number[] => bars.map((b) => b.low);

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

const body = (b: Candle): number => Math.abs(b.close - b.open);
const upperWick = (b: Candle): number => b.high - Math.max(b.open, b.close);
const lowerWick = (b: Candle): number => Math.min(b.open, b.close) - b.low;
const isBullish = (b: Candle): boolean => b.close >= b.open;
const isBearish = (b: Candle): boolean => b.close <= b.open;

const condition = (
  id: string,
  description: string,
  passed: boolean | undefined = undefined,
  left: number | null = null,
  right: number | null = null,
): StrategyConditionResult => ({ id, description, passed: passed ?? false, leftValue: left, rightValue: right });

const signalFromScore = (score: number, bullish: boolean, bearish: boolean): SignalAction => {
  if (bullish && score >= 60) return 'BUY';
  if (bearish && score >= 60) return 'SELL';
  if (score >= 40) return 'WATCH';
  return 'NO_TRADE';
};

const clamp = (v: number, mn: number, mx: number): number => Math.min(mx, Math.max(mn, v));
const recentHigh = (bars: Candle[], n: number): number | null => highest(highs(bars), n);
const recentLow = (bars: Candle[], n: number): number | null => lowest(lows(bars), n);

interface Level { price: number; touches: number; kind: 'SUPPORT' | 'RESISTANCE'; }
const localSupportResistance = (bars: Candle[], strength = 3, maxLevels = 4): { supports: Level[]; resistances: Level[] } => {
  const resistances: Level[] = [];
  const supports: Level[] = [];
  for (let i = strength; i < bars.length - strength; i += 1) {
    const window = bars.slice(i - strength, i + strength + 1);
    const isHigh = bars[i].high >= Math.max(...window.map((b) => b.high));
    const isLow = bars[i].low <= Math.min(...window.map((b) => b.low));
    if (isHigh) resistances.push({ price: bars[i].high, touches: 1, kind: 'RESISTANCE' });
    if (isLow) supports.push({ price: bars[i].low, touches: 1, kind: 'SUPPORT' });
  }
  return { supports: supports.slice(0, maxLevels), resistances: resistances.slice(0, maxLevels) };
};
const localVolumeAnalysis = (bars: Candle[], period = 20): { relativeVolume: number | null } => {
  if (bars.length < period + 1) return { relativeVolume: null };
  const vols = bars.map((b) => b.volume);
  const avg = vols.slice(vols.length - period, vols.length - 1).reduce((a, v) => a + v, 0) / (period - 1);
  const current = vols[vols.length - 1];
  return { relativeVolume: avg > 0 ? current / avg : null };
};

/* ───────────────────────── strategy implementations ───────────────────────── */

interface StrategyContext {
  bars: Candle[];
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number };
  params: Record<string, number>;
}

function evaluateEmaCrossover(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const fast = Number(params.fastEma ?? 9);
  const slow = Number(params.slowEma ?? 21);
  if (bars.length < slow + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const fastEma = ema(closes(bars), fast) as number[];
  const slowEma = ema(closes(bars), slow) as number[];
  const last = lastBar(bars)!;
  const bullish = crossesAbove(fastEma, slowEma);
  const bearish = crossesBelow(fastEma, slowEma);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  if (bullish || bearish) {
    passed.push(condition('ema-cross', `${bullish ? 'Bullish' : 'Bearish'} EMA crossover`, true, fastEma[fastEma.length - 1] ?? null, slowEma[slowEma.length - 1] ?? null));
  } else {
    failed.push(condition('ema-cross', 'No EMA crossover on completed bar', false, null, null));
  }
  const priceConfirms = bullish ? last.close > (fastEma[fastEma.length - 1] ?? 0) : bearish ? last.close < (fastEma[fastEma.length - 1] ?? 0) : false;
  if (priceConfirms) passed.push(condition('price-position', 'Price confirms EMA direction', true, last.close, null));
  else failed.push(condition('price-position', 'Price does not confirm EMA direction', false, last.close, null));
  const score = (bullish || bearish) ? 70 : 20;
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
  if (bars.length < period + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const rsiSeries = rsi(closes(bars), period) as (number | null)[];
  const lastRsi = rsiSeries[rsiSeries.length - 1];
  const prevRsi = rsiSeries[rsiSeries.length - 2];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lastRsi != null && prevRsi != null) {
    const rec = prevRsi <= oversold && lastRsi > oversold;
    const rej = prevRsi >= overbought && lastRsi < overbought;
    if (rec) { bullish = true; passed.push(condition('rsi-oversold', 'RSI recovered from oversold', true, lastRsi, oversold)); }
    if (rej) { bearish = true; passed.push(condition('rsi-overbought', 'RSI rejected from overbought', true, lastRsi, overbought)); }
    if (!rec && !rej) failed.push(condition('rsi-extreme', 'RSI not at extreme', false, lastRsi, null));
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
  if (bars.length < slow + signal + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const m = macd(closes(bars), fast, slow, signal);
  const macdLine = m.macd as number[];
  const signalLine = m.signal as number[];
  const hist = m.histogram as number[];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const cu = crossesAbove(macdLine, signalLine);
  const cd = crossesBelow(macdLine, signalLine);
  const htUp = hist.length >= 2 && hist[hist.length - 2] != null && hist[hist.length - 1] != null && hist[hist.length - 1] > hist[hist.length - 2];
  const htDn = hist.length >= 2 && hist[hist.length - 2] != null && hist[hist.length - 1] != null && hist[hist.length - 1] < hist[hist.length - 2];
  if (cu && htUp) { bullish = true; passed.push(condition('macd-cross', 'MACD crossed above signal with rising histogram', true, macdLine[macdLine.length - 1] ?? null, signalLine[signalLine.length - 1] ?? null)); }
  else if (cd && htDn) { bearish = true; passed.push(condition('macd-cross', 'MACD crossed below signal with falling histogram', true, macdLine[macdLine.length - 1] ?? null, signalLine[signalLine.length - 1] ?? null)); }
  else failed.push(condition('macd-cross', 'No confirmed MACD crossover', false, null, null));
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
  if (bars.length < period + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const bb = bollinger(closes(bars), period, dev);
  const last = lastBar(bars)!;
  const lower = bb.lower[bb.lower.length - 1];
  const upper = bb.upper[bb.upper.length - 1];
  const middle = bb.middle[bb.middle.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lower != null && last.close <= lower) { bullish = true; passed.push(condition('bb-lower', 'Price at or below lower Bollinger band', true, last.close, lower)); }
  else if (upper != null && last.close >= upper) { bearish = true; passed.push(condition('bb-upper', 'Price at or above upper Bollinger band', true, last.close, upper)); }
  else failed.push(condition('bb-extreme', 'Price not at Bollinger extreme', false, last.close, null));
  if (middle != null) passed.push(condition('bb-mean', 'Mean-reversion target is middle band', true, null, middle));
  else failed.push(condition('bb-mean', 'Bollinger middle not defined', false, null, null));
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
  if (bars.length < 20) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const v = vwap(bars) as (number | null)[];
  const vwapValue = v[v.length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (vwapValue != null) {
    const disc = last.close < vwapValue * (1 - deviation / 100);
    const prem = last.close > vwapValue * (1 + deviation / 100);
    if (disc) { bullish = true; passed.push(condition('vwap-discount', 'Price below VWAP (discount zone)', true, last.close, vwapValue)); }
    else if (prem) { bearish = true; passed.push(condition('vwap-premium', 'Price above VWAP (premium zone)', true, last.close, vwapValue)); }
    else failed.push(condition('vwap-zone', 'Price at fair value near VWAP', false, last.close, vwapValue));
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
  const threshold = Number(params.adxThreshold ?? 25);
  if (bars.length < period * 2 + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const adxValues = adx(bars, period) as (number | null)[];
  const adxVal = adxValues[adxValues.length - 1];
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  // Approximate DI direction from recent price movement when ADX confirms trend.
  const dirUp = last.close > prev.close && last.high > prev.high;
  const dirDn = last.close < prev.close && last.low < prev.low;
  if (adxVal != null) {
    const trending = adxVal >= threshold;
    if (trending && dirUp) { bullish = true; passed.push(condition('adx-trend', 'ADX trending with upward price movement', true, adxVal, threshold)); }
    else if (trending && dirDn) { bearish = true; passed.push(condition('adx-trend', 'ADX trending with downward price movement', true, adxVal, threshold)); }
    else failed.push(condition('adx-trend', 'No clear directional trend', false, adxVal, threshold));
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
  if (bars.length < period + 20) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const atrSeries = atr(bars, period) as (number | null)[];
  const atrVal = atrSeries[atrSeries.length - 1];
  const ema20 = ema(closes(bars), 20) as number[];
  const last = lastBar(bars)!;
  const e20 = ema20[ema20.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (atrVal != null && e20 != null) {
    if (last.close > e20) { bullish = true; passed.push(condition('atr-filter', 'Price above 20 EMA with measurable ATR', true, last.close, e20)); }
    else if (last.close < e20) { bearish = true; passed.push(condition('atr-filter', 'Price below 20 EMA with measurable ATR', true, last.close, e20)); }
    else failed.push(condition('atr-filter', 'Price at 20 EMA (no direction)', false, last.close, e20));
    passed.push(condition('atr-volatility', 'ATR defined for stop placement', true, atrVal, null));
  } else {
    failed.push(condition('atr-ready', 'ATR/EMA not yet defined', false, null, null));
  }
  const score = bullish || bearish ? 58 : 20;
  const stopLoss = bullish || bearish ? last.close - (bullish ? multiplier * atrVal! : -multiplier * atrVal!) : null;
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
  const volMult = Number(params.volumeMultiplier ?? 1.5);
  if (bars.length < 30) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const e9 = (ema(closes(bars), 9) as number[])[9 < closes(bars).length ? 8 : 0];
  const e21 = (ema(closes(bars), 21) as number[])[21 < closes(bars).length ? 20 : 0];
  const r = (rsi(closes(bars), rsiPeriod) as (number | null)[])[closes(bars).length - 1];
  const vol = localVolumeAnalysis(bars, 20);
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const tu = e9 != null && e21 != null && e9 > e21;
  const td = e9 != null && e21 != null && e9 < e21;
  const rb = r != null && r > 50 && r < 70;
  const rbear = r != null && r < 50 && r > 30;
  const vo = vol.relativeVolume != null && vol.relativeVolume >= volMult;
  if (tu && rb) { bullish = true; passed.push(condition('scalp-trend', 'EMA9 > EMA21 (bullish alignment)', true, e9, e21)); passed.push(condition('scalp-rsi', 'RSI in bullish momentum zone', true, r, 50)); }
  else if (td && rbear) { bearish = true; passed.push(condition('scalp-trend', 'EMA9 < EMA21 (bearish alignment)', true, e9, e21)); passed.push(condition('scalp-rsi', 'RSI in bearish momentum zone', true, r, 50)); }
  else failed.push(condition('scalp-alignment', 'EMA/RSI not aligned for scalping', false, null, null));
  if (vo) passed.push(condition('scalp-volume', 'Volume confirms move', true, vol.relativeVolume, volMult));
  else failed.push(condition('scalp-volume', 'Volume insufficient for scalp', false, vol.relativeVolume, volMult));
  const score = bullish || bearish ? (vo ? 72 : 55) : 22;
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

function evaluateFvg(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 3) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const c1 = prevBar(bars, 2)!;
  const c2 = prevBar(bars, 1)!;
  const c3 = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const bf = isBullish(c2) && c1.high < c3.low;
  const bd = isBearish(c2) && c1.low > c3.high;
  if (bf) { bullish = true; passed.push(condition('fvg-bullish', 'Bullish fair value gap', true, c1.high, c3.low)); }
  else if (bd) { bearish = true; passed.push(condition('fvg-bearish', 'Bearish fair value gap', true, c1.low, c3.high)); }
  else failed.push(condition('fvg-present', 'No fair value gap on recent bars', false, null, null));
  const score = bullish || bearish ? 64 : 24;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'FVG bullish imbalance' : bearish ? 'FVG bearish imbalance' : null,
    entryZone: bullish ? { low: c1.high, high: c3.low } : bd ? { low: c3.high, high: c1.low } : null,
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateOrderBlock(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lb = Number(params.obLookback ?? 20);
  if (bars.length < lb + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const slice = bars.slice(bars.length - lb - 1);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let bbObj: { bar: Candle; index: number } | null = null;
  let bdObj: { bar: Candle; index: number } | null = null;
  for (let i = 1; i < slice.length; i += 1) {
    const b = slice[i];
    const range = b.high - b.low;
    const bi = isBullish(b) && range > 0 && (b.close - b.open) / range > 0.6;
    const bd = isBearish(b) && range > 0 && (b.open - b.close) / range > 0.6;
    if (bi && (!bbObj || range > (bbObj.bar.high - bbObj.bar.low))) bbObj = { bar: slice[i - 1], index: i - 1 };
    if (bd && (!bdObj || range > (bdObj.bar.high - bdObj.bar.low))) bdObj = { bar: slice[i - 1], index: i - 1 };
  }
  if (bullish && bbObj) { bullish = true; passed.push(condition('ob-bullish', 'Bullish order block', true, bbObj.bar.low, bbObj.bar.high)); }
  else if (bearish && bdObj) { bearish = true; passed.push(condition('ob-bearish', 'Bearish order block', true, bdObj.bar.low, bdObj.bar.high)); }
  else failed.push(condition('ob-present', 'No valid order block in lookback window', false, null, null));
  const score = bullish || bearish ? 66 : 26;
  const ob = bbObj ?? bdObj;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Bullish order block' : bearish ? 'Bearish order block' : null,
    entryZone: ob ? { low: ob.bar.low, high: ob.bar.high } : null,
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateBreakerBlock(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars, params } = ctx;
  const lb = Number(params.obLookback ?? 20);
  if (bars.length < lb + 3) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const recent = bars.slice(bars.length - lb);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const rh = recentHigh(recent, lb);
  const rl = recentLow(recent, lb);
  if (rh != null && last.close > rh && prev.close <= rh && last.low <= rh) { bullish = true; passed.push(condition('breaker-bullish', 'Resistance broken and retested as support', true, last.close, rh)); }
  else if (rl != null && last.close < rl && prev.close >= rl && last.high >= rl) { bearish = true; passed.push(condition('breaker-bearish', 'Support broken and retested as resistance', true, last.close, rl)); }
  else failed.push(condition('breaker-present', 'No breaker block retest detected', false, null, null));
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
  const lb = Number(params.sweepLookback ?? 10);
  if (bars.length < lb + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const ph = recentHigh(prior, lb);
  const pl = recentLow(prior, lb);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const sh = ph != null && last.high > ph && isBullish(last);
  const sl = pl != null && last.low < pl && isBearish(last);
  if (sh) { bullish = true; passed.push(condition('sweep-bullish', 'Buy-side liquidity swept', true, last.high, ph)); }
  else if (sl) { bearish = true; passed.push(condition('sweep-bearish', 'Sell-side liquidity swept', true, last.low, pl)); }
  else failed.push(condition('sweep-present', 'No liquidity sweep on completed bar', false, null, null));
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
  const lb = Number(params.bosLookback ?? 10);
  if (bars.length < lb + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const sh = recentHigh(prior, lb);
  const sl = recentLow(prior, lb);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let type = '';
  if (sh != null && last.close > sh && prev.close <= sh) { bullish = true; type = last.high > sh ? 'BOS' : 'CHOCH'; passed.push(condition('bos-choch-bullish', `${type}: structure high broken`, true, last.close, sh)); }
  else if (sl != null && last.close < sl && prev.close >= sl) { bearish = true; type = 'BOS/CHOCH'; passed.push(condition('bos-choch-bearish', 'Structure low broken', true, last.close, sl)); }
  else failed.push(condition('bos-choch-present', 'No structure break on completed bar', false, null, null));
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
  const rb = Number(params.crtRangeBars ?? 3);
  if (bars.length < rb + 1) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const rangeSlice = bars.slice(bars.length - rb - 1, bars.length - 1);
  const last = lastBar(bars)!;
  const rh = recentHigh(rangeSlice, rangeSlice.length);
  const rl = recentLow(rangeSlice, rangeSlice.length);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (rh != null && rl != null) {
    const rs = rh - rl;
    const cp = rs === 0 ? 0.5 : (last.close - rl) / rs;
    if (last.close > rh && last.open <= rh) { bullish = true; passed.push(condition('crt-breakout', 'Price broke above CRT range high', true, last.close, rh)); }
    else if (last.close < rl && last.open >= rl) { bearish = true; passed.push(condition('crt-breakdown', 'Price broke below CRT range low', true, last.close, rl)); }
    else failed.push(condition('crt-contained', 'Price contained within CRT range', false, last.close, null));
    passed.push(condition('crt-position', 'Close position within range', true, cp, null));
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
  const lb = Number(params.pdLookback ?? 50);
  if (bars.length < lb + 1) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const slice = bars.slice(bars.length - lb);
  const last = lastBar(bars)!;
  const rh = recentHigh(slice, slice.length);
  const rl = recentLow(slice, slice.length);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (rh != null && rl != null && rh > rl) {
    const mid = (rh + rl) / 2;
    const sma20 = sma(closes(slice), 20) as number[];
    const tu = last.close > (sma20[sma20.length - 1] ?? 0);
    const td = last.close < (sma20[sma20.length - 1] ?? 0);
    if (last.close < mid && tu) { bullish = true; passed.push(condition('pd-discount', 'Price in discount zone of uptrend', true, last.close, mid)); }
    else if (last.close > mid && td) { bearish = true; passed.push(condition('pd-premium', 'Price in premium zone of downtrend', true, last.close, mid)); }
    else failed.push(condition('pd-zone', 'Price not in actionable premium/discount zone', false, last.close, mid));
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
  if (bars.length < 30) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const levels = localSupportResistance(bars, strength);
  const last = lastBar(bars)!;
  const price = last.close;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const sma50 = sma(closes(bars), 50) as number[];
  const tu = last.close > (sma50[sma50.length - 1] ?? 0);
  const td = last.close < (sma50[sma50.length - 1] ?? 0);
  const ns = levels.supports.some((l: { price: number }) => Math.abs(price - l.price) / l.price < 0.005);
  const nr = levels.resistances.some((l: { price: number }) => Math.abs(price - l.price) / l.price < 0.005);
  if (ns && tu && isBullish(last)) { bullish = true; passed.push(condition('sr-support', 'Price at support in uptrend', true, price, levels.supports[0]?.price ?? null)); }
  else if (nr && td && isBearish(last)) { bearish = true; passed.push(condition('sr-resistance', 'Price at resistance in downtrend', true, price, levels.resistances[0]?.price ?? null)); }
  else failed.push(condition('sr-level', 'Price not at actionable S/R level', false, price, null));
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
  const lb = Number(params.brLookback ?? 20);
  if (bars.length < lb + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const prior = bars.slice(0, bars.length - 1);
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const lh = recentHigh(prior, lb);
  const ll = recentLow(prior, lb);
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (lh != null && last.close > lh && prev.close <= lh && last.low <= lh) { bullish = true; passed.push(condition('br-breakout', 'Breakout above level with retest', true, last.close, lh)); }
  else if (ll != null && last.close < ll && prev.close >= ll && last.high >= ll) { bearish = true; passed.push(condition('br-breakdown', 'Breakdown below level with retest', true, last.close, ll)); }
  else failed.push(condition('br-level', 'No breakout and retest detected', false, null, null));
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
  const lb = Number(params.sdLookback ?? 30);
  if (bars.length < lb + 1) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const slice = bars.slice(bars.length - lb);
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  let bd: { low: number; high: number } | null = null;
  let sp: { low: number; high: number } | null = null;
  for (let i = 2; i < slice.length - 1; i += 1) {
    const b = slice[i];
    const next = slice[i + 1];
    const range = b.high - b.low;
    const su = isBullish(b) && range > 0 && (b.close - b.open) / range > 0.5;
    const sd = isBearish(b) && range > 0 && (b.open - b.close) / range > 0.5;
    if (su && next && next.close > b.high) bd = { low: b.low, high: b.high };
    if (sd && next && next.close < b.low) sp = { low: b.low, high: b.high };
  }
  if (bd && last.close >= bd.low && last.close <= bd.high && isBullish(last)) { bullish = true; passed.push(condition('sd-demand', 'Price returning to demand zone', true, last.close, bd.low)); }
  else if (sp && last.close >= sp.low && last.close <= sp.high && isBearish(last)) { bearish = true; passed.push(condition('sd-supply', 'Price returning to supply zone', true, last.close, sp.high)); }
  else failed.push(condition('sd-zone', 'Price not in supply/demand zone', false, null, null));
  const score = bullish || bearish ? 64 : 26;
  return {
    direction: signalFromScore(score, bullish, bearish),
    score,
    conditionsPassed: passed,
    conditionsFailed: failed,
    entryTrigger: bullish ? 'Demand zone long' : bearish ? 'Supply zone short' : null,
    entryZone: bd ?? sp ?? { low: last.low, high: last.high },
    invalidationLevel: null,
    stopLoss: null,
    target1: null,
    target2: null,
    riskReward: null,
  };
}

function evaluateCandlestickPatterns(ctx: StrategyContext): Partial<StrategyResult> {
  const { bars } = ctx;
  if (bars.length < 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const lr = last.high - last.low;
  const lb = body(last);
  const hammer = lr > 0 && lowerWick(last) > 2 * lb && upperWick(last) < lb * 0.5;
  const eb = isBearish(prev) && isBullish(last) && last.open < prev.close && last.close > prev.open;
  const es = isBullish(prev) && isBearish(last) && last.open > prev.close && last.close < prev.open;
  const doji = lr > 0 && lb < lr * 0.1;
  if (hammer) { bullish = true; passed.push(condition('pattern-hammer', 'Bullish hammer candle', true, lb, lr)); }
  else if (eb) { bullish = true; passed.push(condition('pattern-engulfing', 'Bullish engulfing pattern', true, last.close, prev.open)); }
  else if (es) { bearish = true; passed.push(condition('pattern-engulfing', 'Bearish engulfing pattern', true, last.close, prev.open)); }
  else if (doji) failed.push(condition('pattern-doji', 'Indecision doji — no direction', false, last.close, prev.close));
  else failed.push(condition('pattern-none', 'No recognized candlestick pattern', false, null, null));
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
  if (bars.length < 50) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const e50 = (ema(closes(bars), 50) as number[])[closes(bars).length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (e50 != null) {
    if (last.close > e50 && isBullish(last)) { bullish = true; passed.push(condition('swing-trend', 'Price above 50 EMA with bullish bar', true, last.close, e50)); }
    else if (last.close < e50 && isBearish(last)) { bearish = true; passed.push(condition('swing-trend', 'Price below 50 EMA with bearish bar', true, last.close, e50)); }
    else failed.push(condition('swing-trend', 'No clear swing direction', false, last.close, e50));
  } else failed.push(condition('swing-ready', 'EMA50 not yet defined', false, null, null));
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
  if (bars.length < 200) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const e200 = (ema(closes(bars), 200) as number[])[closes(bars).length - 1];
  const e50 = (ema(closes(bars), 50) as number[])[closes(bars).length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const prior = bars.slice(0, bars.length - 1);
  const hh = last.high > (recentHigh(prior, 20) ?? 0);
  const ll = last.low < (recentLow(prior, 20) ?? 0);
  if (e200 != null && e50 != null) {
    if (last.close > e200 && e50 > e200 && hh) { bullish = true; passed.push(condition('tf-trend', 'Uptrend: price > EMA200 > EMA50, higher high', true, last.close, e200)); }
    else if (last.close < e200 && e50 < e200 && ll) { bearish = true; passed.push(condition('tf-trend', 'Downtrend: price < EMA200 < EMA50, lower low', true, last.close, e200)); }
    else failed.push(condition('tf-trend', 'No established trend following setup', false, null, null));
  } else failed.push(condition('tf-ready', 'EMAs not yet defined', false, null, null));
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
  const z = Number(params.zScoreThreshold ?? 2);
  if (bars.length < period + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const cs = closes(bars);
  const mean = sma(cs, period) as number[];
  const last = lastBar(bars)!;
  const m = mean[mean.length - 1];
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (m != null) {
    const recent = cs.slice(cs.length - period);
    const variance = recent.reduce((s, v) => s + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const zScore = sd === 0 ? 0 : (last.close - m) / sd;
    if (zScore <= -z && isBullish(last)) { bullish = true; passed.push(condition('mr-zscore', 'Price extended below mean (oversold)', true, zScore, -z)); }
    else if (zScore >= z && isBearish(last)) { bearish = true; passed.push(condition('mr-zscore', 'Price extended above mean (overbought)', true, zScore, zScore)); }
    else failed.push(condition('mr-zscore', 'Price not extended enough for mean reversion', false, zScore, null));
    passed.push(condition('mr-mean', 'Mean-reversion target is SMA mean', true, last.close, m));
  } else failed.push(condition('mr-ready', 'Mean not yet defined', false, null, null));
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
  const lb = Number(params.momLookback ?? 10);
  const volMult = Number(params.volumeMultiplier ?? 1.5);
  if (bars.length < lb + 2) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const last = lastBar(bars)!;
  const prev = prevBar(bars, 1)!;
  const vol = localVolumeAnalysis(bars, 20);
  const pc = (last.close - prev.close) / prev.close;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  const su = pc > 0.015 && last.close > last.open;
  const sd = pc < -0.015 && last.close < last.open;
  const vo = vol.relativeVolume != null && vol.relativeVolume >= volMult;
  if (su && vo) { bullish = true; passed.push(condition('momo-move', 'Strong upward move with volume', true, pc, vol.relativeVolume)); }
  else if (sd && vo) { bearish = true; passed.push(condition('momo-move', 'Strong downward move with volume', true, pc, vol.relativeVolume)); }
  else failed.push(condition('momo-move', 'No strong momentum move with volume', false, pc, null));
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
  if (bars.length < 100) return { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const s50 = (sma(closes(bars), 50) as number[])[closes(bars).length - 1];
  const s200 = (sma(closes(bars), 200) as number[])[closes(bars).length - 1];
  const last = lastBar(bars)!;
  const passed: StrategyConditionResult[] = [];
  const failed: StrategyConditionResult[] = [];
  let bullish = false;
  let bearish = false;
  if (s50 != null && s200 != null) {
    const ab = last.close > s50 && s50 > s200;
    const adn = last.close < s50 && s50 < s200;
    if (ab) { bullish = true; passed.push(condition('mtf-align', 'Timeframes aligned bullish', true, last.close, s50)); }
    else if (adn) { bearish = true; passed.push(condition('mtf-align', 'Timeframes aligned bearish', true, last.close, s50)); }
    else failed.push(condition('mtf-align', 'Timeframes not aligned', false, null, null));
  } else failed.push(condition('mtf-ready', 'SMAs not yet defined', false, null, null));
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
  id, label, type: typeof def === 'boolean' ? 'boolean' : 'number', default: def, ...opts,
});

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  { id: 'scalp-1m', name: '1-Minute Scalping', category: 'SCALPING', description: 'Fast EMA9/EMA21 alignment with RSI momentum on 1-minute bars.', timeframes: ['1m'], parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 0.4, target2Pct: 0.8 }, rationale: 'Buys when EMA9 > EMA21 and RSI in bullish zone with volume confirmation.' },
  { id: 'scalp-3m', name: '3-Minute Scalping', category: 'SCALPING', description: 'EMA alignment + RSI momentum on 3-minute bars.', timeframes: ['3m', '5m'], parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 }, rationale: 'Scalps intraday momentum with EMA and RSI confirmation.' },
  { id: 'scalp-5m', name: '5-Minute Scalping', category: 'SCALPING', description: 'EMA alignment + RSI momentum on 5-minute bars.', timeframes: ['5m', '15m'], parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 }, rationale: 'Slightly slower scalping with more confirmation per bar.' },
  { id: 'momo-scalp', name: 'Momentum Scalping', category: 'SCALPING', description: 'RSI momentum cross with volume confirmation.', timeframes: ['1m', '3m', '5m', '15m'], parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.5 }, defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 }, rationale: 'Longs when RSI crosses above 60, shorts when below 40.' },
  { id: 'vwap-scalp', name: 'VWAP Scalping', category: 'SCALPING', description: 'Mean reversion to VWAP from discount/premium zones.', timeframes: ['1m', '3m', '5m', '15m'], parameters: [PARAM('vwapDeviation', 'VWAP deviation %', 0.5, { min: 0.1, max: 2, step: 0.1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.4 }, defaultTargets: { target1Pct: 0.5, target2Pct: 1.0 }, rationale: 'Buys when price is below VWAP (discount), sells when above VWAP (premium).' },
  { id: 'crt', name: 'CRT — Candle Range Theory', category: 'ICT_SMART_MONEY', description: 'Breakout of the opening candle range.', timeframes: ['5m', '15m', '1h', '1D'], parameters: [PARAM('crtRangeBars', 'Range-defining bars', 3, { min: 2, max: 10, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 }, rationale: 'Trades the breakout of the range set by the first N candles.' },
  { id: 'order-block', name: 'Order Blocks', category: 'ICT_SMART_MONEY', description: 'Last opposing candle before a strong impulsive move.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('obLookback', 'Lookback bars', 20, { min: 10, max: 100, step: 1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Enters at order blocks created by institutional order flow.' },
  { id: 'breaker-block', name: 'Breaker Blocks', category: 'ICT_SMART_MONEY', description: 'Failed order block retested as support/resistance.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('obLookback', 'Lookback bars', 20, { min: 10, max: 100, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 }, rationale: 'Trades retests of broken order blocks.' },
  { id: 'fvg', name: 'Fair Value Gaps', category: 'ICT_SMART_MONEY', description: 'Three-candle price inefficiency (imbalance).', timeframes: ['5m', '15m', '1h', '4h'], parameters: [], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 0.9, target2Pct: 1.8 }, rationale: 'Price tends to return to fill fair value gaps.' },
  { id: 'liquidity-sweep', name: 'Liquidity Sweeps', category: 'ICT_SMART_MONEY', description: 'Stop-hunt reversal after sweeping recent highs/lows.', timeframes: ['5m', '15m', '1h'], parameters: [PARAM('sweepLookback', 'Sweep lookback bars', 10, { min: 5, max: 50, step: 1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.0 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Buys bearish sweeps, sells bullish sweeps on reversal.' },
  { id: 'bos-choch', name: 'BOS and CHOCH', category: 'ICT_SMART_MONEY', description: 'Break of Structure and Change of Character.', timeframes: ['15m', '1h', '4h'], parameters: [PARAM('bosLookback', 'Structure lookback bars', 10, { min: 5, max: 50, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Trades structure breaks in the direction of market structure.' },
  { id: 'mss', name: 'Market Structure Shift', category: 'ICT_SMART_MONEY', description: 'Shift from bullish to bearish structure (or vice versa).', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('bosLookback', 'Structure lookback bars', 10, { min: 5, max: 50, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 }, rationale: 'Identifies when market structure shifts direction.' },
  { id: 'buy-sell-liquidity', name: 'Buy-side and Sell-side Liquidity', category: 'ICT_SMART_MONEY', description: 'Liquidity pools above recent highs / below recent lows.', timeframes: ['15m', '1h', '4h'], parameters: [PARAM('sweepLookback', 'Liquidity lookback bars', 10, { min: 5, max: 50, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Price seeks liquidity before reversing.' },
  { id: 'premium-discount', name: 'Premium and Discount Zones', category: 'ICT_SMART_MONEY', description: 'Buy in discount zones of an uptrend; sell in premium zones of a downtrend.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('pdLookback', 'Range lookback bars', 50, { min: 20, max: 200, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Discount = below 50% range; premium = above 50% range.' },
  { id: 'support-resistance', name: 'Support and Resistance', category: 'PRICE_ACTION', description: 'Bounces at support, rejections at resistance.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('srStrength', 'Touch strength', 3, { min: 2, max: 10, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 }, rationale: 'Trades reactions at key support/resistance levels.' },
  { id: 'breakout-retest', name: 'Breakout and Retest', category: 'PRICE_ACTION', description: 'Breakout above a level followed by a retest.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('brLookback', 'Level lookback bars', 20, { min: 10, max: 100, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Enters on retest after a confirmed breakout.' },
  { id: 'supply-demand', name: 'Supply and Demand', category: 'PRICE_ACTION', description: 'Zones where price reversed with strong impulse.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('sdLookback', 'Zone lookback bars', 30, { min: 10, max: 100, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Buys demand zones, sells supply zones.' },
  { id: 'trendline', name: 'Trendline Trading', category: 'PRICE_ACTION', description: 'Bounces off rising trendlines / breakdowns from falling trendlines.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('srStrength', 'Touch strength', 3, { min: 2, max: 10, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Approximates trendlines via swing highs/lows and SMA alignment.' },
  { id: 'candlestick-patterns', name: 'Candlestick Patterns', category: 'PRICE_ACTION', description: 'Hammer, engulfing, doji and other single-bar patterns.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.5 }, defaultTargets: { target1Pct: 0.6, target2Pct: 1.2 }, rationale: 'Single-candle reversal and continuation signals.' },
  { id: 'ema-crossover', name: 'EMA Crossover', category: 'INDICATORS', description: 'Fast EMA crosses slow EMA.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('fastEma', 'Fast EMA', 9, { min: 5, max: 50, step: 1 }), PARAM('slowEma', 'Slow EMA', 21, { min: 10, max: 100, step: 1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 }, rationale: 'Longs on bullish crossover, shorts on bearish crossover.' },
  { id: 'rsi', name: 'RSI', category: 'INDICATORS', description: 'RSI oversold recovery / overbought rejection.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('rsiPeriod', 'RSI period', 14, { min: 5, max: 50, step: 1 }), PARAM('overbought', 'Overbought level', 70, { min: 60, max: 90, step: 1 }), PARAM('oversold', 'Oversold level', 30, { min: 10, max: 40, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 }, rationale: 'Buys RSI recovery from oversold, sells rejection from overbought.' },
  { id: 'macd', name: 'MACD', category: 'INDICATORS', description: 'MACD line crosses signal with histogram confirmation.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('macdFast', 'MACD fast', 12, { min: 5, max: 30, step: 1 }), PARAM('macdSlow', 'MACD slow', 26, { min: 10, max: 50, step: 1 }), PARAM('macdSignal', 'MACD signal', 9, { min: 5, max: 20, step: 1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.7 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Longs on bullish MACD crossover with rising histogram.' },
  { id: 'bollinger-bands', name: 'Bollinger Bands', category: 'INDICATORS', description: 'Mean reversion from Bollinger Band extremes.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('bbPeriod', 'Bollinger period', 20, { min: 10, max: 50, step: 1 }), PARAM('bbDev', 'Standard deviations', 2, { min: 1.5, max: 3, step: 0.1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 0.8, target2Pct: 1.6 }, rationale: 'Buys lower-band touches, sells upper-band touches.' },
  { id: 'vwap', name: 'VWAP', category: 'INDICATORS', description: 'Price vs volume-weighted average price.', timeframes: ['1m', '5m', '15m', '1h'], parameters: [PARAM('vwapDeviation', 'VWAP deviation %', 0.5, { min: 0.1, max: 2, step: 0.1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.4 }, defaultTargets: { target1Pct: 0.5, target2Pct: 1.0 }, rationale: 'Buys below VWAP, sells above VWAP.' },
  { id: 'adx', name: 'ADX', category: 'INDICATORS', description: 'Trend strength with +DI/-DI direction.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('adxPeriod', 'ADX period', 14, { min: 5, max: 50, step: 1 }), PARAM('adxThreshold', 'ADX threshold', 25, { min: 15, max: 50, step: 1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Trades only when ADX confirms a directional trend.' },
  { id: 'atr', name: 'ATR', category: 'INDICATORS', description: 'Volatility-based stops with EMA20 direction filter.', timeframes: ['15m', '1h', '4h', '1D'], parameters: [PARAM('atrPeriod', 'ATR period', 14, { min: 5, max: 50, step: 1 }), PARAM('atrMultiplier', 'ATR multiplier', 2, { min: 1, max: 5, step: 0.1 })], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.0 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Uses ATR for stop placement; direction from EMA20 filter.' },
  { id: 'swing-trading', name: 'Swing Trading', category: 'OTHER', description: 'Multi-session trend with pullback to EMA50.', timeframes: ['1h', '4h', '1D'], parameters: [], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.0 }, defaultTargets: { target1Pct: 1.5, target2Pct: 3.0 }, rationale: 'Holds positions across sessions in the direction of the trend.' },
  { id: 'trend-following', name: 'Trend Following', category: 'OTHER', description: 'Price above/below EMA200 with EMA50 alignment.', timeframes: ['4h', '1D', '1W'], parameters: [], defaultStopLoss: { mode: 'ATR_MULTIPLE', value: 2.5 }, defaultTargets: { target1Pct: 2.0, target2Pct: 4.0 }, rationale: 'Captures sustained trends with EMA200 filter.' },
  { id: 'mean-reversion', name: 'Mean Reversion', category: 'OTHER', description: 'Z-score mean reversion from SMA mean.', timeframes: ['1h', '4h', '1D'], parameters: [PARAM('mrPeriod', 'Mean period', 20, { min: 10, max: 100, step: 1 }), PARAM('zScoreThreshold', 'Z-score threshold', 2, { min: 1, max: 4, step: 0.1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Buys oversold extensions, sells overbought extensions.' },
  { id: 'momentum-trading', name: 'Momentum Trading', category: 'OTHER', description: 'Strong price move with volume confirmation.', timeframes: ['15m', '1h', '4h'], parameters: [PARAM('momLookback', 'Momentum lookback bars', 10, { min: 3, max: 30, step: 1 }), PARAM('volumeMultiplier', 'Volume multiplier', 1.5, { min: 1, max: 3, step: 0.1 })], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.6 }, defaultTargets: { target1Pct: 1.0, target2Pct: 2.0 }, rationale: 'Trades strong directional moves with volume.' },
  { id: 'multi-timeframe', name: 'Multi-Timeframe Analysis', category: 'OTHER', description: 'Aligns trend across multiple timeframes via SMA stack.', timeframes: ['1h', '4h', '1D'], parameters: [], defaultStopLoss: { mode: 'FIXED_PCT', value: 0.8 }, defaultTargets: { target1Pct: 1.2, target2Pct: 2.4 }, rationale: 'Only trades when timeframes are aligned.' },
];

export function getStrategyDefinition(id: string): StrategyDefinition | undefined {
  return STRATEGY_DEFINITIONS.find((s) => s.id === id);
}

export function getStrategyDefinitionsByCategory(category: StrategyCategory): StrategyDefinition[] {
  return STRATEGY_DEFINITIONS.filter((s) => s.category === category);
}

/* ───────────────────────── evaluation dispatcher ───────────────────────── */

type Evaluator = (ctx: StrategyContext) => Partial<StrategyResult>;

const EVALUATORS: Record<string, Evaluator> = {
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
  'momo-scalp': evaluateMomentumTrading,
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
  candles: Candle[],
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number },
  userParams: Record<string, number | boolean>,
): StrategyResult {
  if (candles.length < 20) {
    return {
      strategyId: definition.id,
      strategyName: definition.name,
      category: definition.category,
      direction: 'NO_TRADE',
      score: 0,
      timeframe: definition.timeframes[0] ?? '1h',
      conditionsPassed: [],
      conditionsFailed: [condition('insufficient-data', `Need >= 20 completed candles, have ${candles.length}`, false, null, null)],
      entryTrigger: null,
      entryZone: null,
      invalidationLevel: null,
      stopLoss: null,
      target1: null,
      target2: null,
      riskReward: null,
      rationale: 'Insufficient completed history to evaluate.',
      evaluatedAt: new Date().toISOString(),
      isDemo: true,
    };
  }

  const params: Record<string, number> = {};
  for (const p of definition.parameters) {
    const v = userParams[p.id];
    params[p.id] = typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : (Number(p.default) ?? 0));
  }

  const ctx: StrategyContext = { bars: candles, quote, params };
  const evaluator = EVALUATORS[definition.id];
  const fallback: Partial<StrategyResult> = { direction: 'NO_TRADE', score: 0, conditionsPassed: [], conditionsFailed: [] };
  const partial = evaluator ? evaluator(ctx) : fallback;

  const last = lastBar(candles);
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
  const rationale = (direction === 'NO_TRADE')
    ? `No setup: ${passed.filter((p) => p.passed).length} conditions met, ${failed.filter((f) => !f.passed).length} not met. Score ${score}/100 (confluence, not probability).`
    : `${direction} bias: ${passed.filter((p) => p.passed).length} conditions met, ${failed.filter((f) => !f.passed).length} not met. Score ${score}/100.`;

  return {
    strategyId: definition.id,
    strategyName: definition.name,
    category: definition.category,
    direction,
    score,
    timeframe: definition.timeframes[0] ?? '1h',
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
    evaluatedAt: new Date().toISOString(),
    isDemo: true,
  };
}

/* ───────────────────────── combination + instrument decision ───────────────────────── */

function decideDirection(results: StrategyResult[], combination: CombinationConfig): SignalAction {
  const enabled = results.filter((r) => r.direction !== 'NO_TRADE');
  if (enabled.length === 0) return 'NO_TRADE';
  const bc = enabled.filter((r) => r.direction === 'BUY').length;
  const sc = enabled.filter((r) => r.direction === 'SELL').length;
  const wc = enabled.filter((r) => r.direction === 'WATCH').length;
  const minConf = Math.max(0, Math.min(combination.minConfirmations, enabled.length));
  const enoughBuy = bc >= minConf && bc > 0;
  const enoughSell = sc >= minConf && sc > 0;
  if (combination.operator === 'AND') {
    if (bc === enabled.length && enoughBuy) return 'BUY';
    if (sc === enabled.length && enoughSell) return 'SELL';
    if (wc >= minConf && wc === enabled.length) return 'WATCH';
    return 'NO_TRADE';
  }
  if (enoughBuy && bc >= sc) return 'BUY';
  if (enoughSell && sc > bc) return 'SELL';
  if (wc >= minConf) return 'WATCH';
  return 'NO_TRADE';
}

function aggregateScore(results: StrategyResult[], direction: SignalAction): number {
  const agreeing = results.filter((r) => r.direction === direction && r.direction !== 'NO_TRADE');
  if (agreeing.length === 0) return 0;
  return Math.round(agreeing.reduce((a, r) => a + r.score, 0) / agreeing.length);
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
  candles: Candle[],
  quote: { lastPrice: number; bid?: number; ask?: number; spreadBps?: number },
  userConfig: { combination: CombinationConfig; strategies: UserStrategyConfig[]; timeframes: string[]; minRiskReward: number; maxSpreadBps: number; minLiquidity: 'HIGH' | 'MEDIUM' | 'LOW' },
): InstrumentDecision {
  const enabled = userConfig.strategies.filter((s) => s.enabled);
  const results: StrategyResult[] = [];
  for (const uc of enabled) {
    const def = getStrategyDefinition(uc.strategyId);
    if (!def) continue;
    results.push(evaluateStrategy(def, candles, quote, uc.parameters));
  }
  const primary = decideDirection(results, userConfig.combination);
  const agreeing = results.filter((r) => r.direction === primary && primary !== 'NO_TRADE');
  const direction = primary === 'NO_TRADE' ? null : primary;
  const score = aggregateScore(results, primary);
  const consensus = consensusEntry(results, primary);
  const risks: string[] = [];
  const spread = quote.spreadBps ?? 0;
  if (spread > userConfig.maxSpreadBps) risks.push(`Spread ${spread}bps exceeds max ${userConfig.maxSpreadBps}bps`);
  if (consensus.rr != null && consensus.rr < userConfig.minRiskReward) risks.push(`Risk/reward ${consensus.rr.toFixed(2)} below minimum ${userConfig.minRiskReward}`);
  let reason = '';
  switch (primary) {
    case 'BUY': reason = `${agreeing.length} of ${enabled.length} enabled strategies agree on BUY. Score ${score}/100.`; break;
    case 'SELL': reason = `${agreeing.length} of ${enabled.length} enabled strategies agree on SELL. Score ${score}/100.`; break;
    case 'WATCH': reason = `Developing setup: ${agreeing.length} strategies lean ${direction}. Not yet confirmed.`; break;
    default: reason = `No qualified setup: ${agreeing.length} strategies agree. Conditions incomplete or conflicting.`; break;
  }
  return {
    instrumentId, symbol, market, exchange, lastPrice: quote.lastPrice, freshness: 'DEMO',
    source: { provider: 'QUANTORA Strategy Engine', origin: 'SIMULATED', isDemo: true, reliability: 'PROVISIONAL' },
    timeframe: userConfig.timeframes[0] ?? '1h', primaryDecision: primary, direction, strategyResults: results,
    combinationLogic: userConfig.combination, agreementCount: agreeing.length, totalEnabled: enabled.length,
    entryTrigger: agreeing.length > 0 ? agreeing[0].entryTrigger : null,
    entryZone: consensus.entry != null ? { low: consensus.entry, high: consensus.entry } : null,
    stopLoss: consensus.stop, target1: consensus.t1, target2: consensus.t2, riskReward: consensus.rr,
    strategyQualityScore: score,
    conditionsPassedTotal: results.reduce((a, r) => a + r.conditionsPassed.filter((p) => p.passed).length, 0),
    conditionsFailedTotal: results.reduce((a, r) => a + r.conditionsFailed.filter((f) => !f.passed).length, 0),
    invalidationLevel: consensus.stop ?? null, reason, risks, evaluatedAt: new Date().toISOString(),
  };
}

export type { InstrumentDecision, StrategyResult, CombinationConfig, UserStrategyConfig, UserStrategyPreset, StoredUserStrategyConfig, StrategyCategory, SignalAction, LogicOperator, StopLossMode, StrategyParameter, StrategyDefinition, StrategyConditionResult } from './strategyTypes';
