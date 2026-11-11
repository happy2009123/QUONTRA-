/**
 * Yahoo Finance adapter (public chart endpoints).
 *
 * Real market data, no API key required for the public endpoints. Optional
 * YAHOO_API_KEY is forwarded as a bearer token for licensed/proxied setups.
 * Coverage: NSE/BSE equities and indices (`.NS`/`.BO`), US equities and major
 * global indices. Currency futures, MCX commodities and reference rates are
 * NOT covered here — those instruments fall back to the demo provider and are
 * labelled as demonstration data.
 *
 * Yahoo does not expose order-book data, so `bidAsk` capability is false.
 * Public equity data is delayed: freshness is reported as DELAYED, never LIVE.
 */

import type {
  HistoricalRequest,
  Interval,
  MarketDataProvider,
  ProviderBars,
  ProviderCapabilities,
  ProviderHealth,
  ProviderQuote,
  ProviderStatus,
  QuoteRequest,
  SourceRef,
} from './types.ts';
import { AppError } from '../lib/errors.ts';
import { fetchWithTimeout, withRetry } from './retry.ts';
import { RateLimiter } from './rateLimit.ts';
import { alignTimestamp, timeframeMs } from '../lib/time.ts';

const SOURCE: SourceRef = {
  provider: 'Yahoo Finance',
  origin: 'YAHOO_PUBLIC',
  isDemo: false,
  reliability: 'PROVISIONAL',
};

/** Yahoo interval tokens for the intervals we expose. */
const YAHOO_INTERVAL: Partial<Record<Interval, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '1D': '1d',
  '1W': '1wk',
  '1M': '1mo',
};

/** Lookback range per interval (Yahoo restricts intraday history). */
const YAHOO_RANGE: Partial<Record<Interval, string>> = {
  '1m': '7d',
  '5m': '60d',
  '15m': '60d',
  '30m': '60d',
  '1h': '2y',
  '1D': '10y',
  '1W': '10y',
  '1M': '10y',
};

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta: Record<string, unknown>;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { code?: string; description?: string };
  };
}

export interface YahooProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  ratePerMinute: number;
  maxRetries: number;
  now?: () => number;
}

export class YahooProvider implements MarketDataProvider {
  readonly id = 'yahoo';
  readonly name = 'Yahoo Finance';
  readonly vendor = 'Yahoo';
  readonly isDemo = false;
  readonly supportedMarkets: string[] = ['INDIAN_EQUITIES', 'INDIAN_INDICES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES'];
  readonly capabilities: ProviderCapabilities = {
    historical: true,
    realtime: false,
    bidAsk: false,
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'],
  };

  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private status: ProviderStatus = 'DISCONNECTED';
  private lastSuccessAt?: string;
  private lastError?: string;
  private latencyMs = 0;
  private requestsToday = 0;
  private requestsMonth = 0;
  private successes = 0;
  private failures = 0;
  private windowStart = Date.now();

  private readonly options: YahooProviderOptions;
  constructor(options: YahooProviderOptions) {
    this.options = options;
    this.limiter = new RateLimiter(options.ratePerMinute);
    this.now = options.now ?? Date.now;
  }

  private bumpUsage(): void {
    const t = this.now();
    if (t - this.windowStart >= 86_400_000) {
      this.windowStart = t;
      this.requestsToday = 0;
    }
    this.requestsToday += 1;
    this.requestsMonth += 1;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'QUANTORA-Backend/1.0 (+research; demonstration build)',
    };
    if (this.options.apiKey) headers.Authorization = `Bearer ${this.options.apiKey}`;
    return headers;
  }

  private async getJson(url: string, label: string): Promise<unknown> {
    await this.limiter.acquire();
    const started = this.now();
    try {
      const res = await withRetry(
        async () => {
          const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: this.headers(),
            timeoutMs: this.options.timeoutMs,
            label,
          });
          if (response.status === 429) {
            throw new AppError('RATE_LIMITED', `${label} rate limited by provider`);
          }
          if (!response.ok) {
            // 4xx are not retryable; 5xx are.
            if (response.status >= 500) {
              throw new AppError('PROVIDER_UNAVAILABLE', `${label} returned HTTP ${response.status}`);
            }
            throw new AppError('PROVIDER_UNAVAILABLE', `${label} returned HTTP ${response.status}`, {
              status: response.status,
              retryable: false,
            });
          }
          return (await response.json()) as unknown;
        },
        {
          retries: this.options.maxRetries,
          shouldRetry: (err) => {
            if (err instanceof AppError && err.code === 'PROVIDER_UNAVAILABLE') {
              const status = (err.details as { status?: number; retryable?: boolean } | undefined)?.status;
              if (status && status < 500 && status !== 429) return false;
            }
            return true;
          },
        },
      );
      this.latencyMs = this.now() - started;
      this.lastSuccessAt = new Date(this.now()).toISOString();
      this.status = 'DELAYED'; // public equity feeds are delayed
      this.successes += 1;
      this.bumpUsage();
      return res;
    } catch (err) {
      this.latencyMs = this.now() - started;
      this.failures += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.status = 'DISCONNECTED';
      this.bumpUsage();
      throw err;
    }
  }

  private async chart(symbol: string, interval: string, range?: string, limit?: number): Promise<YahooChartResponse> {
    const params = new URLSearchParams({ interval });
    if (range) params.set('range', range);
    if (limit) params.set('limit', String(limit));
    const url = `${this.options.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
    return (await this.getJson(url, `yahoo.chart(${symbol})`)) as YahooChartResponse;
  }

  async getHistorical(request: HistoricalRequest): Promise<ProviderBars> {
    const yahooInterval = YAHOO_INTERVAL[request.interval];
    if (!yahooInterval) {
      throw new AppError('NOT_IMPLEMENTED', `Yahoo adapter does not support interval ${request.interval}`);
    }

    let bars = await this.fetchBars(request, yahooInterval);

    // 4h has no Yahoo interval — aggregate completed 1h candles (UTC buckets).
    if (request.interval === '4h') {
      bars = aggregateBars(bars, 4 * 3_600_000, this.now());
    }

    const from = request.from;
    const to = request.to;
    if (from !== undefined) bars = bars.filter((b) => b.ts >= from);
    if (to !== undefined) bars = bars.filter((b) => b.ts <= to);
    if (bars.length > request.limit) bars = bars.slice(-request.limit);

    return { bars, source: { ...SOURCE } };
  }

  private async fetchBars(request: HistoricalRequest, yahooInterval: string): Promise<ProviderBars['bars']> {
    const chart = await this.chart(request.providerSymbol, yahooInterval, YAHOO_RANGE[request.interval], request.limit);
    const result = chart.chart?.result?.[0];
    if (!result) {
      const message = chart.chart?.error?.description ?? 'no result payload';
      throw new AppError('PROVIDER_UNAVAILABLE', `Yahoo returned no data for ${request.providerSymbol}: ${message}`);
    }
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens = quote.open ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];
    const closes = quote.close ?? [];
    const volumes = quote.volume ?? [];
    const sizeMs = timeframeMs(request.interval);
    const nowMs = this.now();

    const bars: ProviderBars['bars'] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const open = opens[i];
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      if (open == null || high == null || low == null || close == null) continue; // missing candle
      const ts = timestamps[i];
      bars.push({
        ts,
        open,
        high,
        low,
        close,
        volume: volumes[i] ?? 0,
        isComplete: ts * 1000 + sizeMs <= nowMs,
      });
    }
    return bars;
  }

  async getQuotes(requests: QuoteRequest[]): Promise<ProviderQuote[]> {
    const out: ProviderQuote[] = [];
    for (const req of requests) {
      const chart = await this.chart(req.providerSymbol, '1d', '5d', 5);
      const result = chart.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta as Record<string, number | string | undefined>;
      const quote = result.indicators?.quote?.[0] ?? {};
      const lastPrice = Number(meta.regularMarketPrice ?? 0);
      const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
      const opens = (quote.open ?? []).filter((o): o is number => o != null);
      const highs = (quote.high ?? []).filter((h): h is number => h != null);
      const lows = (quote.low ?? []).filter((l): l is number => l != null);
      const volumes = (quote.volume ?? []).filter((v): v is number => v != null);
      if (!lastPrice) continue;
      const change = lastPrice - previousClose;
      const marketState = String(meta.marketState ?? 'CLOSED');
      const marketStatus =
        marketState === 'REGULAR'
          ? 'OPEN'
          : marketState === 'PRE'
            ? 'PRE_OPEN'
            : marketState === 'POST'
              ? 'AFTER_HOURS'
              : marketState === 'CLOSED'
                ? 'CLOSED'
                : 'UNKNOWN';
      out.push({
        instrumentId: req.instrumentId,
        lastPrice,
        open: opens.at(-1) ?? lastPrice,
        high: highs.at(-1) ?? lastPrice,
        low: lows.at(-1) ?? lastPrice,
        previousClose: previousClose || lastPrice,
        change,
        changePercent: previousClose ? (change / previousClose) * 100 : 0,
        volume: volumes.at(-1) ?? 0,
        averageVolume: volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0,
        marketStatus,
        freshness: 'DELAYED',
        updatedAt: new Date(Number(meta.regularMarketTime ?? this.now() / 1000) * 1000).toISOString(),
      });
    }
    if (out.length === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Yahoo returned no quotes for the requested symbols');
    }
    return out;
  }

  health(): ProviderHealth {
    const total = this.successes + this.failures;
    const reliability = total === 0 ? 100 : (this.successes / total) * 100;
    return {
      id: this.id,
      name: this.name,
      vendor: this.vendor,
      status: this.status,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      latencyMs: this.latencyMs,
      freshnessSeconds: this.status === 'DISCONNECTED' ? 0 : 900,
      reliabilityPct: Math.round(reliability * 10) / 10,
      isDemo: false,
      rateLimit: {
        used: this.limiter.used,
        limit: this.limiter.limit,
        resetsAt: this.limiter.resetsAt,
      },
      apiUsage: {
        requestsToday: this.requestsToday,
        requestsMonth: this.requestsMonth,
        quotaPct: Math.min(100, Math.round((this.requestsToday / Math.max(1, this.limiter.limit * 24)) * 100)),
      },
      supportedMarkets: this.supportedMarkets,
    };
  }

  async probe(): Promise<ProviderHealth> {
    try {
      await this.chart('AAPL', '1d', '1d', 2);
    } catch {
      // health() already carries the failure
    }
    return this.health();
  }
}

/** Buckets raw bars into fixed-size UTC buckets, keeping only completed targets. */
export function aggregateBars(
  bars: { ts: number; open: number; high: number; low: number; close: number; volume: number; isComplete: boolean }[],
  bucketMs: number,
  nowMs: number,
): ProviderBars['bars'] {
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number; firstTs: number; anyIncomplete: boolean }>();
  for (const bar of bars) {
    const bucket = Math.floor(bar.ts / (bucketMs / 1000)) * (bucketMs / 1000);
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        firstTs: bucket,
        anyIncomplete: !bar.isComplete,
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
      if (!bar.isComplete) existing.anyIncomplete = true;
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({
      ts,
      open: v.open,
      high: v.high,
      low: v.low,
      close: v.close,
      volume: v.volume,
      isComplete: !v.anyIncomplete && ts + bucketMs / 1000 <= nowMs / 1000,
    }));
}

/** Utility used by the seed layer: aligns "now" down to an interval bucket. */
export function currentBucket(nowMs: number, interval: Interval): number {
  return alignTimestamp(nowMs, interval);
}
