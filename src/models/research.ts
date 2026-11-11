import type {
  DataFreshness,
  DataSourceRef,
  MarketCategory,
  SignalAction,
  Timeframe,
  TrendDirection,
} from './market';

export type MarketRegime = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';

export type ReportDirection = 'LONG' | 'SHORT' | 'FLAT';

/** Transparent 0-100 component score. Explicitly NOT a win probability. */
export interface StrategyQuality {
  score: number;
  components: { label: string; weight: number; value: number }[];
  summary: string;
  disclaimer: string;
}

export interface PriceLevel {
  price: number;
  label: string;
  strength: number;
}

export interface TechnicalIntel {
  instrumentId: string;
  symbol: string;
  multiTimeframeTrend: {
    '15m': TrendDirection;
    '1h': TrendDirection;
    '1D': TrendDirection;
    alignment: 'ALIGNED' | 'MIXED' | 'CONFLICTING';
  };
  indicatorSummary: { name: string; value: number | null; reading: string }[];
  support: PriceLevel[];
  resistance: PriceLevel[];
  volumeConfirmation: 'CONFIRMED' | 'NEUTRAL' | 'DIVERGENT';
  rsi: number;
  atr: number;
  adx: number;
  freshness: DataFreshness;
}

export interface MarketRegimeAssessment {
  primary: MarketRegime;
  confidence: number;
  volatilityState: 'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
  breadth: number;
  explanation: string;
  updatedAt: string;
  source: DataSourceRef;
}

export type NewsCategory =
  | 'MARKET_HEADLINE'
  | 'ECONOMIC_EVENT'
  | 'EARNINGS'
  | 'CENTRAL_BANK'
  | 'POLICY';

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  category: NewsCategory;
  publishedAt: string;
  source: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  sentimentScore: number;
  instruments: string[];
}

export interface Opportunity {
  id: string;
  instrumentId: string;
  symbol: string;
  instrumentName: string;
  market: MarketCategory;
  strategyName: string;
  direction: ReportDirection;
  signal: SignalAction;
  timeframe: Timeframe;
  /** Verified (or clearly labelled demo) last price at report time. */
  lastPrice: number;
  priceCurrency: string;
  observedAt: string;
  source: DataSourceRef;
  entryTrigger: string;
  entryZone: { low: number; high: number };
  stopLoss: number;
  targets: [number, number];
  plannedRiskReward: number;
  liquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  spreadBps: number;
  upcomingEvents: string[];
  technicalExplanation: string;
  riskFactors: string[];
  quality: StrategyQuality;
  createdAt: string;
}

export interface OpportunityReport {
  id: string;
  title: string;
  /** ISO date (yyyy-mm-dd) */
  date: string;
  market: MarketCategory | 'ALL';
  generatedAt: string;
  source: DataSourceRef;
  /** True when no setups cleared the qualification threshold. */
  noQualifiedSetups: boolean;
  regimeSummary: string;
  opportunities: Opportunity[];
  notes: string[];
}

export interface ReportHistoryEntry {
  id: string;
  date: string;
  title: string;
  market: MarketCategory | 'ALL';
  opportunityCount: number;
  noQualifiedSetups: boolean;
  generatedAt: string;
}

export interface AiExplanation {
  opportunityId: string;
  qualifies: boolean;
  headline: string;
  reasons: { label: string; detail: string; weight: number; passed: boolean }[];
  failedConditions: string[];
  quality: StrategyQuality;
}
