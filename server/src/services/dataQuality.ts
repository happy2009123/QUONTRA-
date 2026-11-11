/**
 * Data validation service.
 *
 * Every candle series and quote that enters the platform is run through these
 * checks before it can be marked VERIFIED. Anything suspect or rejected is
 * persisted with its status so downstream signal generation can refuse to use
 * unverified data.
 *
 * Checks implemented:
 *  MISSING_CANDLES · DUPLICATE_CANDLES · INCORRECT_TIMESTAMP · OUT_OF_ORDER
 *  INVALID_OHLC · ABNORMAL_PRICE_JUMP · STALE_QUOTE · MISSING_VOLUME
 *  PROVIDER_INCONSISTENCY
 */

export type QualityStatus = 'VERIFIED' | 'SUSPECT' | 'REJECTED' | 'PENDING';

export type IssueType =
  | 'MISSING_CANDLES'
  | 'DUPLICATE_CANDLES'
  | 'INCORRECT_TIMESTAMP'
  | 'OUT_OF_ORDER'
  | 'INVALID_OHLC'
  | 'ABNORMAL_PRICE_JUMP'
  | 'STALE_QUOTE'
  | 'MISSING_VOLUME'
  | 'PROVIDER_INCONSISTENCY';

export interface QualityIssue {
  type: IssueType;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  detail: string;
  /** Timestamp the issue refers to, when applicable. */
  ts?: number;
}

export interface ValidatableBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleValidationOptions {
  /** Nominal candle duration in seconds (5m → 300). */
  intervalSeconds: number;
  /** Max |close/prevClose − 1| before a jump is flagged (default 0.20 = 20%). */
  maxJumpPct?: number;
  /** Treat zero/absent volume as an issue (default true). */
  checkVolume?: boolean;
  /** Clock used for future-timestamp detection (unix ms). */
  nowMs?: number;
  /** Tolerance for "future" timestamps (default 60s). */
  futureToleranceSeconds?: number;
}

export interface ValidationResult {
  status: QualityStatus;
  issues: QualityIssue[];
  checked: number;
}

function severityToStatus(issues: QualityIssue[]): QualityStatus {
  if (issues.some((i) => i.severity === 'HIGH')) return 'REJECTED';
  if (issues.length > 0) return 'SUSPECT';
  return 'VERIFIED';
}

/**
 * Validates a candle series. The input order is preserved; issues are
 * reported in the order they are discovered.
 */
export function validateCandles(bars: ValidatableBar[], options: CandleValidationOptions): ValidationResult {
  const maxJump = options.maxJumpPct ?? 0.2;
  const checkVolume = options.checkVolume ?? true;
  const nowMs = options.nowMs ?? Date.now();
  const futureTolerance = options.futureToleranceSeconds ?? 60;
  const issues: QualityIssue[] = [];
  const seen = new Set<number>();
  let duplicates = 0;
  let outOfOrder = 0;
  let previousTs: number | undefined;

  for (const bar of bars) {
    // INCORRECT_TIMESTAMP
    if (!Number.isFinite(bar.ts) || bar.ts <= 0 || !Number.isInteger(bar.ts)) {
      issues.push({ type: 'INCORRECT_TIMESTAMP', severity: 'HIGH', detail: `non-integer or non-positive timestamp: ${bar.ts}`, ts: Number.isFinite(bar.ts) ? bar.ts : undefined });
      continue;
    }
    if (bar.ts * 1000 > nowMs + futureTolerance * 1000) {
      issues.push({ type: 'INCORRECT_TIMESTAMP', severity: 'HIGH', detail: `timestamp is in the future: ${bar.ts}`, ts: bar.ts });
    }
    if (bar.ts % options.intervalSeconds !== 0) {
      issues.push({ type: 'INCORRECT_TIMESTAMP', severity: 'MEDIUM', detail: `timestamp ${bar.ts} is not aligned to the ${options.intervalSeconds}s interval`, ts: bar.ts });
    }

    // DUPLICATE_CANDLES
    if (seen.has(bar.ts)) duplicates += 1;
    else seen.add(bar.ts);

    // OUT_OF_ORDER
    if (previousTs !== undefined && bar.ts < previousTs) outOfOrder += 1;
    previousTs = bar.ts;

    // INVALID_OHLC
    const { open, high, low, close } = bar;
    const negatives = [open, high, low, close].some((v) => !Number.isFinite(v) || v <= 0);
    if (negatives) {
      issues.push({ type: 'INVALID_OHLC', severity: 'HIGH', detail: `non-positive or non-finite price at ${bar.ts}`, ts: bar.ts });
    } else {
      const maxOf = Math.max(open, close, low);
      const minOf = Math.min(open, close, low);
      if (high < maxOf || high < low) {
        issues.push({ type: 'INVALID_OHLC', severity: 'HIGH', detail: `high ${high} below open/close/low at ${bar.ts}`, ts: bar.ts });
      }
      if (low > minOf || low > high) {
        issues.push({ type: 'INVALID_OHLC', severity: 'HIGH', detail: `low ${low} above open/close/high at ${bar.ts}`, ts: bar.ts });
      }
    }

    // MISSING_VOLUME
    if (checkVolume && (!Number.isFinite(bar.volume) || bar.volume <= 0)) {
      issues.push({ type: 'MISSING_VOLUME', severity: 'MEDIUM', detail: `missing or zero volume at ${bar.ts}`, ts: bar.ts });
    }
  }

  // MISSING_CANDLES — gaps in the expected bucket sequence
  const sorted = [...bars].filter((b) => Number.isInteger(b.ts) && b.ts > 0).sort((a, b) => a.ts - b.ts);
  let gaps = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const expected = sorted[i - 1].ts + options.intervalSeconds;
    if (sorted[i].ts > expected) {
      const missing = Math.round((sorted[i].ts - expected) / options.intervalSeconds);
      gaps += missing;
    }
  }
  if (gaps > 0) {
    issues.push({ type: 'MISSING_CANDLES', severity: 'MEDIUM', detail: `${gaps} missing candle(s) in the series` });
  }
  if (duplicates > 0) {
    issues.push({ type: 'DUPLICATE_CANDLES', severity: 'HIGH', detail: `${duplicates} duplicate timestamp(s)` });
  }
  if (outOfOrder > 0) {
    issues.push({ type: 'OUT_OF_ORDER', severity: 'MEDIUM', detail: `${outOfOrder} candle(s) out of chronological order` });
  }

  // ABNORMAL_PRICE_JUMP — close-to-close move beyond the threshold
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1].close;
    const curr = sorted[i].close;
    if (prev > 0 && curr > 0) {
      const move = Math.abs(curr / prev - 1);
      if (move > maxJump) {
        issues.push({
          type: 'ABNORMAL_PRICE_JUMP',
          severity: 'MEDIUM',
          detail: `close moved ${(move * 100).toFixed(1)}% between ${sorted[i - 1].ts} and ${sorted[i].ts} (threshold ${(maxJump * 100).toFixed(0)}%)`,
          ts: sorted[i].ts,
        });
      }
    }
  }

  return { status: severityToStatus(issues), issues, checked: bars.length };
}

export interface ValidatableQuote {
  instrumentId: string;
  lastPrice: number;
  volume: number;
  updatedAt: string | number;
}

export interface QuoteValidationOptions {
  /** Maximum age before a quote is considered stale (ms). Default 5 min. */
  maxAgeMs?: number;
  nowMs?: number;
}

/** Validates a quote for staleness, price sanity and volume presence. */
export function validateQuote(quote: ValidatableQuote, options: QuoteValidationOptions = {}): ValidationResult {
  const maxAge = options.maxAgeMs ?? 300_000;
  const nowMs = options.nowMs ?? Date.now();
  const issues: QualityIssue[] = [];

  const updatedMs = typeof quote.updatedAt === 'number' ? quote.updatedAt : Date.parse(quote.updatedAt);
  if (!Number.isFinite(updatedMs)) {
    issues.push({ type: 'INCORRECT_TIMESTAMP', severity: 'HIGH', detail: `unreadable updatedAt for ${quote.instrumentId}` });
  } else if (nowMs - updatedMs > maxAge) {
    issues.push({
      type: 'STALE_QUOTE',
      severity: 'HIGH',
      detail: `quote age ${Math.round((nowMs - updatedMs) / 1000)}s exceeds ${Math.round(maxAge / 1000)}s for ${quote.instrumentId}`,
    });
  } else if (nowMs - updatedMs > maxAge / 3) {
    issues.push({
      type: 'STALE_QUOTE',
      severity: 'MEDIUM',
      detail: `quote age ${Math.round((nowMs - updatedMs) / 1000)}s is elevated for ${quote.instrumentId}`,
    });
  }

  if (!Number.isFinite(quote.lastPrice) || quote.lastPrice <= 0) {
    issues.push({ type: 'INVALID_OHLC', severity: 'HIGH', detail: `invalid last price for ${quote.instrumentId}` });
  }
  if (!Number.isFinite(quote.volume) || quote.volume < 0) {
    issues.push({ type: 'MISSING_VOLUME', severity: 'MEDIUM', detail: `invalid volume for ${quote.instrumentId}` });
  }

  return { status: severityToStatus(issues), issues, checked: 1 };
}

export interface ProviderSeriesComparison {
  instrumentId: string;
  ts: number;
  providerA: string;
  providerB: string;
  priceA: number;
  priceB: number;
  tolerancePct: number;
}

/**
 * Flags INCONSISTENT_PROVIDER_DATA when two adapters disagree on the same
 * candle beyond a tolerance (default 1%).
 */
export function compareProviderSeries(
  a: { provider: string; bars: ValidatableBar[] },
  b: { provider: string; bars: ValidatableBar[] },
  options: { tolerancePct?: number } = {},
): QualityIssue[] {
  const tolerance = (options.tolerancePct ?? 1) / 100;
  const bByTs = new Map(b.bars.map((bar) => [bar.ts, bar]));
  const issues: QualityIssue[] = [];
  for (const bar of a.bars) {
    const other = bByTs.get(bar.ts);
    if (!other) continue;
    const base = Math.max(Math.abs(bar.close), Math.abs(other.close), 1e-9);
    const delta = Math.abs(bar.close - other.close) / base;
    if (delta > tolerance) {
      issues.push({
        type: 'PROVIDER_INCONSISTENCY',
        severity: 'HIGH',
        detail: `${a.provider}=${bar.close} vs ${b.provider}=${other.close} at ${bar.ts} (Δ ${(delta * 100).toFixed(2)}% > ${tolerance * 100}%)`,
        ts: bar.ts,
      });
    }
  }
  return issues;
}

/** Convenience: derive a data-quality status for a stored candle row. */
export function statusForIssues(issues: QualityIssue[]): QualityStatus {
  return severityToStatus(issues);
}
