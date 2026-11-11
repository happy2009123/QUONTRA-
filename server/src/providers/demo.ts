/**
 * Deterministic demonstration provider.
 *
 * Everything this adapter returns is generated locally, labelled `isDemo`
 * with freshness `DEMO`, and is stable across calls for a given
 * (instrument, interval, bucket) so charts do not jump between requests.
 * It is never presented as market data.
 */

import type {
  HistoricalRequest,
  Interval,
  MarketDataProvider,
  ProviderBars,
  ProviderCapabilities,
  ProviderHealth,
  ProviderQuote,
  QuoteRequest,
  SourceRef,
} from './types.ts';
import { alignTimestamp, timeframeMs, toUnixSeconds } from '../lib/time.ts';

const SOURCE: SourceRef = {
  provider: 'QUANTORA Demo Engine',
  origin: 'SIMULATED',
  isDemo: true,
  reliability: 'PROVISIONAL',
};

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoProviderOptions {
  /** Base reference price per instrument id (falls back to a generic value). */
  basePrices?: Record<string, number>;
  /** Injected clock for deterministic tests. */
  now?: () => number;
}

export class DemoProvider implements MarketDataProvider {
  readonly id = 'demo';
  readonly name = 'QUANTORA Demo Engine';
  readonly vendor = 'QUANTORA';
  readonly isDemo = true;
  readonly supportedMarkets: string[] = ['INDIAN_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES', 'INTERNATIONAL_EQUITIES', 'INTERNATIONAL_INDICES', 'OTHER'];
  readonly capabilities: ProviderCapabilities = {
    historical: true,
    realtime: true,
    bidAsk: true,
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'],
  };

  private readonly now: () => number;
  private lastSuccessAt = new Date().toISOString();
  private requestsToday = 0;
  private requestsMonth = 0;

  private readonly options: DemoProviderOptions;
  constructor(options: DemoProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  private basePrice(instrumentId: string): number {
    return this.options.basePrices?.[instrumentId] ?? 100;
  }

  private bar(instrumentId: string, interval: Interval, ts: number): { open: number; high: number; low: number; close: number; volume: number } {
    const sizeMs = timeframeMs(interval);
    const dayIndex = Math.floor(ts / 86_400_000);
    const bucket = Math.floor(ts / sizeMs);
    const rand = mulberry32(hashSeed(`${instrumentId}:${interval}:${bucket}`));
    const dayRand = mulberry32(hashSeed(`${instrumentId}:${dayIndex}`));
    const base = this.basePrice(instrumentId);
    // Random walk anchored to the daily drift so adjacent buckets stay coherent.
    const drift = (dayRand() - 0.5) * 0.02;
    const noise = (rand() - 0.5) * 0.012;
    const close = base * (1 + drift + noise);
    const open = close * (1 - (rand() - 0.5) * 0.006);
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    const volume = Math.round((0.4 + rand()) * 1_000_000);
    return { open, high, low, close, volume };
  }

  async getHistorical(request: HistoricalRequest): Promise<ProviderBars> {
    this.requestsToday += 1;
    this.requestsMonth += 1;
    const sizeMs = timeframeMs(request.interval);
    const nowMs = this.now();
    const to = request.to ?? nowMs;
    const endBucket = alignTimestamp(to, request.interval);
    const bars = [];
    for (let i = 0; i < request.limit; i += 1) {
      const ts = endBucket - i * sizeMs;
      if (request.from !== undefined && ts < request.from) break;
      const { open, high, low, close, volume } = this.bar(request.instrumentId, request.interval, ts);
      const isComplete = ts + sizeMs <= nowMs;
      bars.push({ ts: toUnixSeconds(ts), open, high, low, close, volume, isComplete });
    }
    bars.reverse();
    this.lastSuccessAt = new Date(nowMs).toISOString();
    return { bars, source: { ...SOURCE } };
  }

  async getQuotes(requests: QuoteRequest[]): Promise<ProviderQuote[]> {
    this.requestsToday += 1;
    this.requestsMonth += 1;
    const nowMs = this.now();
    const day = new Date(nowMs).getUTCDay();
    const marketStatus = day === 0 || day === 6 ? 'CLOSED' : 'OPEN';
    const quotes = requests.map((req) => {
      const bucket = alignTimestamp(nowMs, '1h');
      const current = this.bar(req.instrumentId, '1h', bucket);
      const previous = this.bar(req.instrumentId, '1h', bucket - 3_600_000);
      const lastPrice = current.close;
      const previousClose = previous.close;
      const change = lastPrice - previousClose;
      const spreadBps = 0.0003;
      return {
        instrumentId: req.instrumentId,
        lastPrice,
        open: current.open,
        high: current.high,
        low: current.low,
        previousClose,
        change,
        changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
        volume: current.volume,
        averageVolume: Math.round(current.volume * 0.9),
        bid: lastPrice * (1 - spreadBps),
        ask: lastPrice * (1 + spreadBps),
        marketStatus,
        freshness: 'DEMO' as const,
        updatedAt: new Date(nowMs).toISOString(),
      } satisfies ProviderQuote;
    });
    this.lastSuccessAt = new Date(nowMs).toISOString();
    return quotes;
  }

  health(): ProviderHealth {
    return {
      id: this.id,
      name: this.name,
      vendor: this.vendor,
      status: 'DEMO DATA',
      lastSuccessAt: this.lastSuccessAt,
      latencyMs: 0,
      freshnessSeconds: 0,
      reliabilityPct: 100,
      isDemo: true,
      rateLimit: { used: 0, limit: 1_000_000, resetsAt: new Date(this.now() + 60_000).toISOString() },
      apiUsage: { requestsToday: this.requestsToday, requestsMonth: this.requestsMonth, quotaPct: 0 },
      supportedMarkets: this.supportedMarkets,
    };
  }

  async probe(): Promise<ProviderHealth> {
    return this.health();
  }
}
