/**
 * Binance spot adapter (public REST endpoints).
 *
 * Real market data for crypto pairs only — this adapter intentionally covers
 * a single asset class and does not pretend to serve equities or FX. API key
 * is optional (public endpoints are unauthenticated) but supported for
 * weighted/private deployments via BINANCE_API_KEY.
 *
 * If the endpoint is unreachable from the deployment network the adapter
 * reports DISCONNECTED with the captured error; callers must fall back to the
 * demo provider and label results as demonstration data.
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
import { timeframeMs } from '../lib/time.ts';

const SOURCE: SourceRef = {
  provider: 'Binance',
  origin: 'BINANCE_SPOT',
  isDemo: false,
  reliability: 'VERIFIED',
};

const BINANCE_INTERVAL: Partial<Record<Interval, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
  '1W': '1w',
  '1M': '1M',
};

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

export interface BinanceProviderOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  ratePerMinute: number;
  maxRetries: number;
  now?: () => number;
}

export class BinanceProvider implements MarketDataProvider {
  readonly id = 'binance';
  readonly name = 'Binance Spot';
  readonly vendor = 'Binance';
  readonly isDemo = false;
  readonly supportedMarkets: string[] = ['CRYPTO'];
  readonly capabilities: ProviderCapabilities = {
    historical: true,
    realtime: true,
    bidAsk: true,
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

  private readonly options: BinanceProviderOptions;
  constructor(options: BinanceProviderOptions) {
    this.options = options;
    this.limiter = new RateLimiter(options.ratePerMinute);
    this.now = options.now ?? Date.now;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'QUANTORA-Backend/1.0' };
    if (this.options.apiKey) headers['X-MBX-APIKEY'] = this.options.apiKey;
    return headers;
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
          if (response.status === 429 || response.status === 418) {
            throw new AppError('RATE_LIMITED', `${label} rate limited by provider (HTTP ${response.status})`);
          }
          if (!response.ok) {
            throw new AppError('PROVIDER_UNAVAILABLE', `${label} returned HTTP ${response.status}`, {
              status: response.status,
            });
          }
          return (await response.json()) as unknown;
        },
        {
          retries: this.options.maxRetries,
          shouldRetry: (err) => {
            if (err instanceof AppError && err.code === 'PROVIDER_UNAVAILABLE') {
              const status = (err.details as { status?: number } | undefined)?.status;
              if (status && status < 500 && status !== 429) return false;
            }
            return true;
          },
        },
      );
      this.latencyMs = this.now() - started;
      this.lastSuccessAt = new Date(this.now()).toISOString();
      this.status = 'CONNECTED';
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

  async getHistorical(request: HistoricalRequest): Promise<ProviderBars> {
    const interval = BINANCE_INTERVAL[request.interval];
    if (!interval) throw new AppError('NOT_IMPLEMENTED', `Binance adapter does not support interval ${request.interval}`);
    const params = new URLSearchParams({ symbol: request.providerSymbol, interval, limit: String(Math.min(1000, request.limit)) });
    if (request.from !== undefined) params.set('startTime', String(request.from * 1000));
    if (request.to !== undefined) params.set('endTime', String(request.to * 1000));
    const url = `${this.options.baseUrl}/api/v3/klines?${params.toString()}`;
    const payload = (await this.getJson(url, `binance.klines(${request.providerSymbol})`)) as Kline[];
    if (!Array.isArray(payload)) throw new AppError('PROVIDER_UNAVAILABLE', 'Binance returned an unexpected payload');

    const sizeMs = timeframeMs(request.interval);
    const nowMs = this.now();
    const bars: ProviderBars['bars'] = payload.map((k) => ({
      ts: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      isComplete: k[0] + sizeMs <= nowMs,
    }));
    return { bars, source: { ...SOURCE } };
  }

  async getQuotes(requests: QuoteRequest[]): Promise<ProviderQuote[]> {
    const out: ProviderQuote[] = [];
    for (const req of requests) {
      const [ticker, book] = await Promise.all([
        this.getJson(
          `${this.options.baseUrl}/api/v3/ticker/24hr?symbol=${encodeURIComponent(req.providerSymbol)}`,
          `binance.ticker(${req.providerSymbol})`,
        ) as Promise<Record<string, string>>,
        this.getJson(
          `${this.options.baseUrl}/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(req.providerSymbol)}`,
          `binance.book(${req.providerSymbol})`,
        ) as Promise<Record<string, string>>,
      ]);
      const lastPrice = Number(ticker.lastPrice);
      if (!Number.isFinite(lastPrice)) continue;
      const previousClose = Number(ticker.openPrice);
      const change = Number(ticker.priceChange);
      out.push({
        instrumentId: req.instrumentId,
        lastPrice,
        open: Number(ticker.openPrice),
        high: Number(ticker.highPrice),
        low: Number(ticker.lowPrice),
        previousClose,
        change,
        changePercent: Number(ticker.priceChangePercent),
        volume: Number(ticker.volume),
        averageVolume: Number(ticker.volume),
        bid: Number(book.bidPrice),
        ask: Number(book.askPrice),
        marketStatus: 'OPEN', // crypto venues trade continuously
        freshness: 'LIVE',
        updatedAt: new Date(this.now()).toISOString(),
      });
    }
    if (out.length === 0) throw new AppError('PROVIDER_UNAVAILABLE', 'Binance returned no quotes');
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
      freshnessSeconds: this.status === 'CONNECTED' ? 15 : 0,
      reliabilityPct: Math.round(reliability * 10) / 10,
      isDemo: false,
      rateLimit: { used: this.limiter.used, limit: this.limiter.limit, resetsAt: this.limiter.resetsAt },
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
      await this.getJson(`${this.options.baseUrl}/api/v3/ping`, 'binance.ping');
    } catch {
      // health() carries the failure detail
    }
    return this.health();
  }
}
