/** Timeframe, UTC and exchange-timezone conversions. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignTimestamp,
  isoFromUnixSeconds,
  isTimeframe,
  SUPPORTED_TIMEFRAMES,
  timeframeMs,
  toUnixSeconds,
  toUnixSecondsStrict,
  withinSession,
  zonedWallClockToUtc,
} from '../src/lib/time.ts';

test('timeframe helpers cover every supported timeframe', () => {
  assert.equal(SUPPORTED_TIMEFRAMES.length, 9);
  assert.ok(isTimeframe('1D'));
  assert.ok(!isTimeframe('2h'));
  assert.equal(timeframeMs('1h'), 3_600_000);
  assert.equal(timeframeMs('4h'), 14_400_000);
  assert.equal(timeframeMs('1D'), 86_400_000);
});

test('alignTimestamp buckets a timestamp down to its candle start', () => {
  const ms = Date.UTC(2026, 0, 1, 13, 37, 45); // 13:37:45Z
  assert.equal(new Date(alignTimestamp(ms, '1h')).toISOString(), '2026-01-01T13:00:00.000Z');
  assert.equal(new Date(alignTimestamp(ms, '4h')).toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(new Date(alignTimestamp(ms, '1D')).toISOString(), '2026-01-01T00:00:00.000Z');
  // Months align to the first of the month.
  assert.equal(new Date(alignTimestamp(ms, '1M')).toISOString(), '2026-01-01T00:00:00.000Z');
});

test('unix seconds helpers round-trip and reject garbage', () => {
  const ms = Date.UTC(2026, 5, 15, 8, 30, 0);
  assert.equal(isoFromUnixSeconds(toUnixSeconds(ms)), new Date(ms).toISOString());
  assert.equal(toUnixSecondsStrict(ms), ms / 1000);
  assert.throws(() => toUnixSecondsStrict(Number.NaN), /invalid timestamp/);
  assert.throws(() => toUnixSecondsStrict(Number.POSITIVE_INFINITY), /invalid timestamp/);
});

test('zonedWallClockToUtc maps an IST session open to the right UTC instant', () => {
  // NSE opens 09:15 Asia/Kolkata → 03:15 UTC (IST is UTC+5:30, no DST).
  const open = zonedWallClockToUtc('2026-01-01', 9 * 60 + 15, 'Asia/Kolkata');
  assert.equal(new Date(open).toISOString(), '2026-01-01T03:45:00.000Z');

  // US market open 09:30 in a DST zone (America/New_York, March → EDT).
  const nyOpen = zonedWallClockToUtc('2026-06-15', 9 * 60 + 30, 'America/New_York');
  assert.equal(new Date(nyOpen).toISOString(), '2026-06-15T13:30:00.000Z');

  // Winter (EST, UTC-5).
  const nyWinter = zonedWallClockToUtc('2026-01-15', 9 * 60 + 30, 'America/New_York');
  assert.equal(new Date(nyWinter).toISOString(), '2026-01-15T14:30:00.000Z');
});

test('withinSession respects weekday and minute windows in the exchange zone', () => {
  const session = { openMinutes: 9 * 60 + 15, closeMinutes: 15 * 60 + 30, weekdays: [1, 2, 3, 4, 5] };
  // Monday 2026-01-05 10:00 IST = 04:30 UTC.
  const during = Date.UTC(2026, 0, 5, 4, 30);
  assert.equal(withinSession(during, 'Asia/Kolkata', session), true);

  // Before open: 09:00 IST = 03:30 UTC.
  const before = Date.UTC(2026, 0, 5, 3, 30);
  assert.equal(withinSession(before, 'Asia/Kolkata', session), false);

  // Saturday.
  const saturday = Date.UTC(2026, 0, 3, 4, 30);
  assert.equal(withinSession(saturday, 'Asia/Kolkata', session), false);

  // Exactly at close (15:30 IST) is out — window is half-open.
  const atClose = zonedWallClockToUtc('2026-01-05', 15 * 60 + 30, 'Asia/Kolkata');
  assert.equal(withinSession(atClose, 'Asia/Kolkata', session), false);
});
