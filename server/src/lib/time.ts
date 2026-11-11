/** Timeframe helpers, UTC conversion and exchange-timezone formatting. */

export const SUPPORTED_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'] as const;
export type Timeframe = (typeof SUPPORTED_TIMEFRAMES)[number];

const TF_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1D': 86_400_000,
  '1W': 604_800_000,
  '1M': 2_592_000_000, // nominal; month alignment uses calendar arithmetic
};

export function isTimeframe(value: string): value is Timeframe {
  return (SUPPORTED_TIMEFRAMES as readonly string[]).includes(value);
}

export function timeframeMs(tf: Timeframe): number {
  return TF_MS[tf];
}

/** Unix seconds (chart convention) for a Date/ms value. */
export function toUnixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** ISO-8601 UTC string for a unix-seconds value. */
export function isoFromUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Normalises any timestamp input to unix seconds; throws on non-finite values. */
export function toUnixSecondsStrict(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`invalid timestamp: ${value}`);
  // Accept both millisecond and second inputs (ms values are > 1e11 after 1973).
  return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
}

/**
 * Aligns a timestamp down to the start of its candle bucket (UTC for intraday,
 * exchange-session aware callers pass pre-aligned values).
 */
export function alignTimestamp(ms: number, tf: Timeframe): number {
  if (tf === '1M') {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  const size = TF_MS[tf];
  return Math.floor(ms / size) * size;
}

/** Formats a UTC instant in an exchange timezone (e.g. Asia/Kolkata). */
export function formatInZone(ms: number, timeZone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    ...options,
  }).format(new Date(ms));
}

/** Returns true when `at` falls inside a session window given in minutes-from-midnight in the exchange zone. */
export function withinSession(
  atMs: number,
  timeZone: string,
  session: { openMinutes: number; closeMinutes: number; weekdays: number[] },
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(atMs));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.find((p) => p.type === 'weekday')?.value ?? ''] ?? -1;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (!session.weekdays.includes(weekday)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= session.openMinutes && minutes < session.closeMinutes;
}

/** Adds calendar months to a UTC timestamp (used for 1M candle alignment). */
export function addUtcMonths(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** Offset of `timeZone` from UTC at a given instant, in milliseconds. */
export function tzOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - ms;
}

/**
 * Converts a wall-clock time in a specific timezone (minutes past midnight on
 * a calendar date) to a UTC instant. Session open/close times are stored in
 * UTC while the exchange timezone is retained on the market row.
 */
export function zonedWallClockToUtc(dateDay: string, minutesPastMidnight: number, timeZone: string): number {
  const [y, m, d] = dateDay.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0) + minutesPastMidnight * 60_000;
  // Two-pass correction handles DST transitions for the target zone: solve
  // instant = wall − offset(instant), re-evaluating the offset until stable.
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const next = wall - tzOffsetMs(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

