/**
 * Provider registry: adapter lifecycle, routing, failover and health persistence.
 *
 * Routing rules
 *  1. An instrument may declare a preferred provider (`provider_id`) and the
 *     symbol that provider understands (`provider_symbol`).
 *  2. Otherwise the first enabled adapter whose `supportedMarkets` covers the
 *     instrument's market category is used.
 *  3. On failure the registry walks the remaining adapters in configured
 *     order (QUANTORA_PROVIDERS) and finally the demo adapter, which is only
 *     used when DEMO_PROVIDER_ENABLED=true and whose output is always marked
 *     isDemo so the UI cannot present it as real market data.
 */

import type { AppConfig } from '../config/env.ts';
import type { Db } from '../db/db.ts';
import { upsertProviderStatus } from '../db/repoOps.ts';
import { AppError } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';
import { DemoProvider } from './demo.ts';
import { YahooProvider } from './yahoo.ts';
import { BinanceProvider } from './binance.ts';
import type {
  HistoricalRequest,
  Interval,
  MarketDataProvider,
  ProviderBars,
  ProviderHealth,
  ProviderQuote,
  QuoteRequest,
  SourceRef,
} from './types.ts';

export interface InstrumentRouting {
  id: string;
  market: string;
  providerId?: string | null;
  providerSymbol?: string | null;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();
  private readonly order: string[] = [];

  private readonly db?: Db;

  constructor(cfg: AppConfig, db?: Db) {
    this.db = db;
    const enabled = new Set(cfg.providers.enabled);

    if (enabled.has('demo') && cfg.providers.demo.enabled) {
      this.register(new DemoProvider({ basePrices: DEMO_BASE_PRICES }));
    }
    if (enabled.has('yahoo') && cfg.providers.yahoo.enabled) {
      this.register(
        new YahooProvider({
          baseUrl: cfg.providers.yahoo.baseUrl,
          apiKey: cfg.providers.yahoo.apiKey,
          timeoutMs: cfg.providers.yahoo.timeoutMs,
          ratePerMinute: cfg.providers.yahoo.ratePerMinute,
          maxRetries: cfg.providers.yahoo.maxRetries,
        }),
      );
    }
    if (enabled.has('binance') && cfg.providers.binance.enabled) {
      this.register(
        new BinanceProvider({
          baseUrl: cfg.providers.binance.baseUrl,
          apiKey: cfg.providers.binance.apiKey,
          timeoutMs: cfg.providers.binance.timeoutMs,
          ratePerMinute: cfg.providers.binance.ratePerMinute,
          maxRetries: cfg.providers.binance.maxRetries,
        }),
      );
    }
  }

  register(provider: MarketDataProvider): void {
    if (this.providers.has(provider.id)) return;
    this.providers.set(provider.id, provider);
    this.order.push(provider.id);
  }

  get(id: string): MarketDataProvider | undefined {
    return this.providers.get(id);
  }

  list(): MarketDataProvider[] {
    return this.order.map((id) => this.providers.get(id)!).filter(Boolean);
  }

  /** Providers that can legally/technically serve the given market category. */
  candidatesFor(instrument: InstrumentRouting): MarketDataProvider[] {
    const primary = instrument.providerId ? this.providers.get(instrument.providerId) : undefined;
    const rest = this.list().filter(
      (p) => p.id !== primary?.id && (p.isDemo || p.supportedMarkets.includes(instrument.market)),
    );
    const ordered = primary ? [primary, ...rest] : rest;
    // Live adapters first, demo last — demo is a fallback, never a silent default.
    return [...ordered.filter((p) => !p.isDemo), ...ordered.filter((p) => p.isDemo)];
  }

  /**
   * Fetches candles with failover across adapters.
   * Throws PROVIDER_UNAVAILABLE when no enabled adapter can serve the request.
   */
  async fetchHistorical(
    instrument: InstrumentRouting & { providerSymbol?: string | null },
    interval: Interval,
    options: { limit: number; from?: number; to?: number } = { limit: 500 },
  ): Promise<ProviderBars> {
    const candidates = this.candidatesFor(instrument);
    if (candidates.length === 0) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'No providers are enabled for this market');
    }
    const errors: string[] = [];
    for (const provider of candidates) {
      const providerSymbol = instrument.providerSymbol ?? instrument.id;
      const request: HistoricalRequest = {
        instrumentId: instrument.id,
        providerSymbol,
        interval,
        limit: options.limit,
        from: options.from,
        to: options.to,
      };
      try {
        const bars = await provider.getHistorical(request);
        if (bars.bars.length === 0) {
          errors.push(`${provider.id}: empty series`);
          continue;
        }
        return bars;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.id}: ${message}`);
        log.warn('provider historical fetch failed', { provider: provider.id, instrument: instrument.id, error: message });
      }
    }
    throw new AppError('PROVIDER_UNAVAILABLE', `No provider returned data for ${instrument.id}`, { errors });
  }

  /** Fetches quotes grouping instruments by the adapter that will serve them. */
  async fetchQuotes(instruments: (InstrumentRouting & { providerSymbol?: string | null })[]): Promise<{
    quotes: ProviderQuote[];
    sources: Record<string, SourceRef>;
    errors: Record<string, string>;
  }> {
    const byProvider = new Map<string, InstrumentRouting[]>();
    for (const inst of instruments) {
      const candidates = this.candidatesFor(inst);
      const provider = candidates.find((p) => !p.isDemo) ?? candidates[0];
      if (!provider) continue;
      const list = byProvider.get(provider.id) ?? [];
      list.push(inst);
      byProvider.set(provider.id, list);
    }

    const quotes: ProviderQuote[] = [];
    const sources: Record<string, SourceRef> = {};
    const errors: Record<string, string> = {};

    for (const [providerId, list] of byProvider) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;
      const requests: QuoteRequest[] = list.map((i) => ({
        instrumentId: i.id,
        providerSymbol: i.providerSymbol ?? i.id,
      }));
      try {
        const result = await provider.getQuotes(requests);
        for (const quote of result) {
          quotes.push(quote);
          sources[quote.instrumentId] = {
            provider: provider.name,
            origin: provider.id.toUpperCase(),
            isDemo: provider.isDemo,
            reliability: provider.isDemo ? 'PROVISIONAL' : 'VERIFIED',
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors[providerId] = message;
        log.warn('provider quote fetch failed', { provider: providerId, error: message });
      }
    }
    return { quotes, sources, errors };
  }

  /** Runs probes for every registered adapter and persists health rows. */
  async probeAll(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const provider of this.list()) {
      try {
        results.push(await provider.probe());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn('provider probe failed', { provider: provider.id, error: message });
        results.push(provider.health());
      }
    }
    if (this.db) {
      for (const health of results) this.persistHealth(health);
    }
    return results;
  }

  persistHealth(health: ProviderHealth): void {
    if (!this.db) return;
    upsertProviderStatus(this.db, {
      provider_id: health.id,
      name: health.name,
      vendor: health.vendor,
      status: health.status,
      last_success_at: health.lastSuccessAt ?? null,
      last_error: health.lastError ?? null,
      latency_ms: health.latencyMs,
      freshness_seconds: health.freshnessSeconds,
      reliability_pct: health.reliabilityPct,
      is_demo: health.isDemo ? 1 : 0,
      rate_limit_used: Number.isFinite(health.rateLimit.used) ? health.rateLimit.used : 0,
      rate_limit_limit: Number.isFinite(health.rateLimit.limit) ? health.rateLimit.limit : 0,
      rate_limit_resets_at: health.rateLimit.resetsAt,
      requests_today: health.apiUsage.requestsToday,
      requests_month: health.apiUsage.requestsMonth,
      supported_markets: JSON.stringify(health.supportedMarkets),
      updated_at: new Date().toISOString(),
    });
  }

  /** Snapshot of in-memory health (no network I/O). */
  healthSnapshot(): ProviderHealth[] {
    return this.list().map((p) => p.health());
  }
}

/**
 * Reference prices used by the demo adapter. Kept in one place so the seed
 * layer and the demo generator agree; they are labelled demonstration values.
 */
export const DEMO_BASE_PRICES: Record<string, number> = {
  'idx-nifty50': 26412.35,
  'idx-sensex': 86241.7,
  'idx-niftybank': 57890.15,
  'idx-niftyit': 43120.6,
  'idx-niftymid': 61240.9,
  'idx-indiavix': 13.42,
  'eq-reliance': 1428.55,
  'eq-tcs': 4112.8,
  'eq-hdfcbank': 1987.4,
  'eq-infy': 1876.25,
  'eq-icicibank': 1421.9,
  'eq-sbin': 892.35,
  'eq-bhartiartl': 1962.1,
  'eq-itc': 468.7,
  'eq-lt': 3894.5,
  'eq-axisbank': 1204.6,
  'eq-maruti': 15420.75,
  'eq-tatamotors': 712.45,
  'eq-sunpharma': 1782.3,
  'eq-wipro': 542.15,
  'eq-hindunilvr': 2438.9,
  'eq-asianpaint': 2894.2,
  'eq-titan': 3612.5,
  'eq-bajfinance': 9820.4,
  'eq-ntpc': 342.8,
  'eq-powergrid': 286.45,
  'eq-tatasteel': 168.75,
  'eq-adanient': 2412.6,
  'cd-usdinr': 88.42,
  'cd-eurinr': 95.68,
  'cd-gbpinr': 113.24,
  'cd-jpyinr': 0.5784,
  'fx-usdinr': 88.41,
  'idx-sp500': 6918.42,
  'idx-nasdaq': 25842.16,
  'idx-dow': 47120.88,
  'idx-ftse': 9842.5,
  'idx-nikkei': 48210.3,
  'idx-dax': 24118.7,
  'intl-aapl': 268.42,
  'intl-msft': 512.36,
  'intl-nvda': 184.72,
  'intl-amzn': 232.18,
  'intl-googl': 214.55,
  'intl-meta': 612.9,
  'intl-tsla': 342.65,
  'intl-jpm': 292.14,
  'intl-xom': 122.48,
  'intl-jnj': 164.72,
  'oth-gold': 102840,
  'oth-silver': 126480,
  'oth-crude': 6482,
};
