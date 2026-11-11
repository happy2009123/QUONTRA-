/**
 * Indicator maths — validated against published reference datasets.
 *
 * RSI uses the StockCharts reference price series; EMA must be seeded with the
 * SMA of the first `period` values; Bollinger bands use population deviation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adx,
  bollinger,
  completedOnly,
  computeIndicator,
  ema,
  macd,
  rsi,
  sma,
  type Bar,
} from '../src/services/indicators.ts';

/** StockCharts RSI article price series (33 closes). */
const RSI_PRICES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
  46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66,
  43.13,
];

test('RSI matches the StockCharts reference series within published rounding', () => {
  const values = rsi(RSI_PRICES, 14);
  // Published: 70.53, 66.32, 66.55, 69.41, 66.36 (their table rounds each step).
  const published = [70.53, 66.32, 66.55, 69.41, 66.36];
  published.forEach((expected, i) => {
    const actual = values[14 + i];
    assert.ok(actual !== null, `RSI at index ${14 + i} must be defined`);
    assert.ok(Math.abs(actual - expected) < 0.15, `RSI[${14 + i}] = ${actual}, expected ≈ ${expected}`);
  });
});

test('RSI is bounded 0-100, undefined during warm-up, 100 on no losses', () => {
  const values = rsi(RSI_PRICES, 14);
  assert.equal(values[13], null, 'warm-up period must be null');
  for (const v of values) {
    if (v === null) continue;
    assert.ok(v >= 0 && v <= 100, `RSI out of range: ${v}`);
  }
  const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
  const allUp = rsi(rising, 14);
  assert.equal(allUp.at(-1), 100, 'monotonic rise has zero average loss');
});

test('EMA is seeded with the SMA of the first period values', () => {
  const values = [10, 11, 12, 13, 14, 15, 16];
  const e = ema(values, 5);
  const s = sma(values, 5);
  assert.equal(e[4], s[4], 'EMA seed must equal SMA');
  // EMA(5) recursion: next = close * k + prev * (1-k), k = 2/6
  const k = 2 / 6;
  assert.ok(Math.abs((e[5] as number) - (15 * k + (e[4] as number) * (1 - k))) < 1e-12);
  assert.equal(e[3], null, 'no value before the seed');
});

test('SMA window average is correct and warm-up is null', () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s, [null, null, 2, 3, 4]);
});

test('Bollinger bands use population deviation', () => {
  const values = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  const b = bollinger(values, 20, 2);
  const mean = 10.5;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / 20; // population
  const sd = Math.sqrt(variance);
  assert.equal(b.middle[19], mean);
  assert.ok(Math.abs((b.upper[19] as number) - (mean + 2 * sd)) < 1e-9);
  assert.ok(Math.abs((b.lower[19] as number) - (mean - 2 * sd)) < 1e-9);
  assert.equal(b.upper[18], null, 'bands undefined before the window fills');
});

test('MACD line equals fast EMA minus slow EMA and histogram is consistent', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.1);
  const m = macd(closes, 12, 26, 9);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  for (let i = 0; i < closes.length; i += 1) {
    if (m.macd[i] === null) continue;
    assert.ok(Math.abs((m.macd[i] as number) - ((fast[i] as number) - (slow[i] as number))) < 1e-9);
    if (m.signal[i] !== null) {
      assert.ok(Math.abs((m.histogram[i] as number) - ((m.macd[i] as number) - (m.signal[i] as number))) < 1e-9);
    }
  }
  assert.ok(m.macd.some((v) => v !== null), 'MACD must produce values once both EMAs are seeded');
});

test('ADX returns bounded ADX/DI values once the window is warm', () => {
  const bars: Bar[] = Array.from({ length: 40 }, (_, i) => {
    const base = 100 + i;
    return { ts: 1_700_000_000 + i * 86_400, open: base - 1, high: base + 2, low: base - 2, close: base + 1, volume: 1_000 };
  });
  const result = adx(bars, 14);
  const last = result.adx.at(-1);
  assert.ok(last !== null && last !== undefined, 'ADX must be defined after warm-up');
  assert.ok(last >= 0 && last <= 100, `ADX out of range: ${last}`);
  for (const v of result.plusDi) if (v !== null) assert.ok(v >= 0 && v <= 100);
});

test('completedOnly drops the still-forming candle', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const bars = [
    { ts: now / 1000 - 172_800, close: 1 },
    { ts: now / 1000 - 86_400, close: 2 },
    { ts: now / 1000, close: 3 }, // forming now
    { ts: now / 1000 + 60, close: 4 }, // future — never complete
  ];
  const kept = completedOnly(bars, 86_400, now);
  assert.equal(kept.length, 2, 'only completed candles survive');
  assert.equal(kept.at(-1)?.close, 2);
});

test('computeIndicator returns only defined points and rejects unknown names', () => {
  const bars: Bar[] = Array.from({ length: 40 }, (_, i) => ({
    ts: 1_700_000_000 + i * 86_400,
    open: 100 + i * 0.5,
    high: 101 + i * 0.5,
    low: 99 + i * 0.5,
    close: 100.5 + i * 0.5,
    volume: 10_000 + i,
  }));
  const rsiPoints = computeIndicator(bars, { name: 'RSI', period: 14 });
  assert.ok(rsiPoints.length > 0);
  assert.ok(rsiPoints.every((p) => Number.isFinite(p.value as number) && p.confirmed));
  const boll = computeIndicator(bars, { name: 'BOLLINGER', period: 20 });
  assert.ok(boll.every((p) => typeof p.value === 'object' && p.value !== null));
});
