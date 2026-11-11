/** Provider adapter contract — every market-data vendor implements this. */

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M';

export type ProviderStatus = 'CONNECTED' | 'DELAYED' | 'STALE' | 'DISCONNECTED' | 'DEMO DATA';

export type Freshness = 'LIVE' | 'DELAYED' | 'STALE' | 'DEMO';

export interface SourceRef {
  provider: string;
  origin: string;
  isDemo: boolean;
  reliability: 'VERIFIED' | 'PROVISIONAL' | 'UNAVAILABLE';
}

export interface ProviderBar {
  /** Bucket start, unix seconds (UTC). */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** False for a still-forming candle — never used for confirmed signals. */
  isComplete: boolean;
}

export interface HistoricalRequest {
  instrumentId: string;
  /** Symbol understood by this provider (e.g. RELIANCE.NS). */
  providerSymbol: string;
  interval: Interval;
  /** unix seconds; when omitted the adapter applies its own lookback. */
  from?: number;
  to?: number;
  limit: number;
}

export interface ProviderBars {
  bars: ProviderBar[];
  source: SourceRef;
}

export interface QuoteRequest {
  instrumentId: string;
  providerSymbol: string;
}

export interface ProviderQuote {
  instrumentId: string;
  lastPrice: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  averageVolume: number;
  /** Present only when the venue exposes book data. */
  bid?: number;
  ask?: number;
  marketStatus: 'OPEN' | 'PRE_OPEN' | 'CLOSED' | 'AFTER_HOURS' | 'UNKNOWN';
  freshness: Freshness;
  updatedAt: string;
}

export interface ProviderRateLimit {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface ProviderHealth {
  id: string;
  name: string;
  vendor: string;
  status: ProviderStatus;
  lastSuccessAt?: string;
  lastError?: string;
  latencyMs: number;
  freshnessSeconds: number;
  reliabilityPct: number;
  isDemo: boolean;
  rateLimit: ProviderRateLimit;
  apiUsage: { requestsToday: number; requestsMonth: number; quotaPct: number };
  supportedMarkets: string[];
}

export interface ProviderCapabilities {
  historical: boolean;
  realtime: boolean;
  bidAsk: boolean;
  intervals: Interval[];
}

export interface MarketDataProvider {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly isDemo: boolean;
  readonly capabilities: ProviderCapabilities;
  readonly supportedMarkets: string[];

  /** Performs a lightweight reachability check and refreshes cached health. */
  probe(): Promise<ProviderHealth>;
  /** Last known health without performing network I/O. */
  health(): ProviderHealth;

  getHistorical(request: HistoricalRequest): Promise<ProviderBars>;
  getQuotes(requests: QuoteRequest[]): Promise<ProviderQuote[]>;
}
