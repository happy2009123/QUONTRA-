/** Core market-domain models shared across the QUANTORA frontend. */

export type MarketRegion = 'IN' | 'US' | 'GLOBAL' | 'FX';

export type ExchangeCode =
  | 'NSE'
  | 'BSE'
  | 'MCX'
  | 'NASDAQ'
  | 'NYSE'
  | 'FOREX'
  | 'INDEX'
  | 'CME';

export type MarketCategory =
  | 'INDIAN_EQUITIES'
  | 'INDIAN_INDICES'
  | 'IN_CURRENCY_DERIVATIVES'
  | 'INTERNATIONAL_EQUITIES'
  | 'INTERNATIONAL_INDICES'
  | 'OTHER';

export type InstrumentType =
  | 'EQUITY'
  | 'INDEX'
  | 'CURRENCY_FUTURE'
  | 'ETF'
  | 'COMMODITY'
  | 'REFERENCE_RATE';

export type MarketStatus = 'OPEN' | 'PRE_OPEN' | 'CLOSED' | 'AFTER_HOURS' | 'UNKNOWN';

/**
 * Freshness of the value shown to the user. Every price surfaced in the UI
 * must carry one of these states so demo data is never mistaken for live data.
 */
export type DataFreshness =
  | 'LIVE'
  | 'DELAYED'
  | 'HISTORICAL'
  | 'STALE'
  | 'MISSING'
  | 'DEMO';

export type SourceReliability = 'VERIFIED' | 'PROVISIONAL' | 'UNAVAILABLE';

export interface DataSourceRef {
  /** Human readable provider name, e.g. "QUANTORA Demo Engine". */
  provider: string;
  /** Underlying venue or origin, e.g. "NSE", "S&P Global", "SIMULATED". */
  origin: string;
  /** True when the value is generated demonstration data. */
  isDemo: boolean;
  reliability: SourceReliability;
}

export interface LegalRestriction {
  code: string;
  summary: string;
  detail: string;
}

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  market: MarketCategory;
  exchange: ExchangeCode;
  region: MarketRegion;
  type: InstrumentType;
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  sector?: string;
  /** Instrument-level legal restriction (e.g. FX derivatives for retail users). */
  restriction?: LegalRestriction;
}

export interface Quote {
  instrumentId: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  averageVolume: number;
  marketStatus: MarketStatus;
  updatedAt: string;
  freshness: DataFreshness;
  source: DataSourceRef;
}

/** Instrument joined with its latest quote — the unit used by tables and cards. */
export type InstrumentQuote = Instrument & { quote: Quote };

export type TrendDirection = 'UP' | 'DOWN' | 'SIDEWAYS';

export type SignalAction = 'BUY' | 'SELL' | 'WATCH' | 'NO_TRADE';

export type Timeframe =
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1D'
  | '1W'
  | '1M';

export const TIMEFRAMES: Timeframe[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1D',
  '1W',
  '1M',
];

export interface Candle {
  /** Unix seconds (Lightweight Charts convention). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SeriesMeta {
  instrumentId: string;
  timeframe: Timeframe;
  freshness: DataFreshness;
  source: DataSourceRef;
  updatedAt: string;
  /** Number of candles actually available. */
  count: number;
}

export interface HeatmapCell {
  instrumentId: string;
  symbol: string;
  name: string;
  changePercent: number;
  weight: number;
  market: MarketCategory;
}

export interface VolatilityGauge {
  instrumentId: string;
  symbol: string;
  volatility: number;
  percentile: number;
  regime: 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
  freshness: DataFreshness;
}

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  /** ISO datetime */
  scheduledAt: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  actual?: string;
  forecast?: string;
  previous?: string;
  source: DataSourceRef;
}

export interface MarketOverviewSeries {
  instrumentId: string;
  symbol: string;
  points: { time: number; value: number }[];
  changePercent: number;
  freshness: DataFreshness;
}

export interface OpportunitySummary {
  id: string;
  instrumentId: string;
  symbol: string;
  market: MarketCategory;
  direction: SignalAction;
  strategyName: string;
  strategyScore: number;
  timeframe: Timeframe;
  createdAt: string;
}

export type MarketFilterId =
  | 'ALL'
  | MarketCategory;

export type VolatilityFilterId = 'ALL' | 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';

export type LiquidityFilterId = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
