/**
 * Data-quality pipeline — every one of the nine validation checks must fire,
 * and a clean series must come back VERIFIED.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareProviderSeries,
  statusForIssues,
  validateCandles,
  validateQuote,
  type IssueType,
  type ValidatableBar,
} from '../src/services/dataQuality.ts';

const DAY = 86_400;
const T0 = 1_767_225_600; // 2026-01-01T00:00:00Z (aligned to 1D)

function bar(offsetDays: number, overrides: Partial<ValidatableBar> = {}): ValidatableBar {
  return {
    ts: T0 + offsetDays * DAY,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 1_000,
    ...overrides,
  };
}

function types(issues: { type: IssueType }[]): IssueType[] {
  return issues.map((i) => i.type);
}

test('a clean series validates as VERIFIED with no issues', () => {
  const bars = [0, 1, 2, 3, 4].map((i) => bar(i));
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.issues.length, 0);
  assert.equal(result.checked, 5);
});

test('MISSING_CANDLES fires for a gap in the bucket sequence', () => {
  const bars = [bar(0), bar(1), bar(4)];
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(result.issues).includes('MISSING_CANDLES'));
  assert.equal(result.status, 'SUSPECT');
});

test('DUPLICATE_CANDLES fires for repeated timestamps', () => {
  const bars = [bar(0), bar(1), bar(1)];
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(result.issues).includes('DUPLICATE_CANDLES'));
  assert.equal(result.status, 'REJECTED', 'duplicates are a HIGH severity issue');
});

test('INCORRECT_TIMESTAMP fires for future and misaligned timestamps', () => {
  const future = validateCandles([bar(0), bar(1, { ts: T0 + 10 * DAY })], {
    intervalSeconds: DAY,
    nowMs: (T0 + 2 * DAY) * 1000,
  });
  assert.ok(types(future.issues).includes('INCORRECT_TIMESTAMP'));

  const misaligned = validateCandles([bar(0), bar(1, { ts: T0 + DAY + 30 })], {
    intervalSeconds: DAY,
    nowMs: (T0 + 5 * DAY) * 1000,
  });
  assert.ok(types(misaligned.issues).includes('INCORRECT_TIMESTAMP'));
});

test('OUT_OF_ORDER fires when timestamps go backwards', () => {
  const bars = [bar(0), bar(2), bar(1)];
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(result.issues).includes('OUT_OF_ORDER'));
});

test('INVALID_OHLC fires for impossible price geometry and non-positive prices', () => {
  const badHigh = validateCandles([bar(0), bar(1, { high: 90 })], { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(badHigh.issues).includes('INVALID_OHLC'));
  assert.equal(badHigh.status, 'REJECTED');

  const negative = validateCandles([bar(0, { close: -5 })], { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(negative.issues).includes('INVALID_OHLC'));
});

test('ABNORMAL_PRICE_JUMP fires beyond the configured threshold', () => {
  const bars = [bar(0, { open: 100, high: 100, low: 100, close: 100 }), bar(1, { open: 160, high: 160, low: 160, close: 160 })]; // +60% vs default 20%
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(result.issues).includes('ABNORMAL_PRICE_JUMP'));
  assert.equal(result.status, 'SUSPECT', 'a jump alone is MEDIUM severity');
});

test('MISSING_VOLUME fires for zero volume', () => {
  const bars = [bar(0), bar(1, { volume: 0 })];
  const result = validateCandles(bars, { intervalSeconds: DAY, nowMs: (T0 + 5 * DAY) * 1000 });
  assert.ok(types(result.issues).includes('MISSING_VOLUME'));
});

test('STALE_QUOTE fires for aged quotes and clean quotes pass', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const stale = validateQuote(
    { instrumentId: 'x', lastPrice: 100, volume: 1, updatedAt: new Date(now - 10 * 60_000).toISOString() },
    { nowMs: now },
  );
  assert.ok(types(stale.issues).includes('STALE_QUOTE'));
  assert.equal(stale.status, 'REJECTED');

  const fresh = validateQuote(
    { instrumentId: 'x', lastPrice: 100, volume: 1, updatedAt: new Date(now - 30_000).toISOString() },
    { nowMs: now },
  );
  assert.equal(fresh.status, 'VERIFIED');

  const badPrice = validateQuote({ instrumentId: 'x', lastPrice: 0, volume: 1, updatedAt: now }, { nowMs: now });
  assert.ok(types(badPrice.issues).includes('INVALID_OHLC'));
});

test('PROVIDER_INCONSISTENCY fires when two adapters disagree beyond tolerance', () => {
  const a = { provider: 'yahoo', bars: [bar(0, { close: 100 }), bar(1, { close: 101 })] };
  const b = { provider: 'binance', bars: [bar(0, { close: 100 }), bar(1, { close: 103 })] }; // ~2% off
  const issues = compareProviderSeries(a, b, { tolerancePct: 1 });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'PROVIDER_INCONSISTENCY');
  assert.equal(issues[0].severity, 'HIGH');

  const close = compareProviderSeries(a, b, { tolerancePct: 5 });
  assert.equal(close.length, 0, 'within tolerance → no issue');
});

test('statusForIssues maps severity to status', () => {
  assert.equal(statusForIssues([]), 'VERIFIED');
  assert.equal(statusForIssues([{ type: 'MISSING_VOLUME', severity: 'MEDIUM', detail: 'x' }]), 'SUSPECT');
  assert.equal(statusForIssues([{ type: 'INVALID_OHLC', severity: 'HIGH', detail: 'x' }]), 'REJECTED');
});
