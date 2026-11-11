import type {
  AiExplanation,
  BacktestResult,
  Candle,
  DataCenterSnapshot,
  EconomicEvent,
  HeatmapCell,
  Instrument,
  InstrumentQuote,
  MarketOverviewSeries,
  MarketRegimeAssessment,
  NotificationItem,
  NotificationPreference,
  OpportunityReport,
  OpportunitySummary,
  PortfolioRiskMetrics,
  ReportArchiveEntry,
  ReportHistoryEntry,
  RiskAccount,
  RiskPosition,
  SeriesMeta,
  StrategyComparison,
  StrategyConfig,
  TechnicalIntel,
  Timeframe,
  VolatilityGauge,
} from '@/models';
import type { MarketCategory } from '@/models';

/** Every async surface in the app returns an explicit freshness envelope. */
export interface ApiEnvelope<T> {
  data: T;
  fetchedAt: string;
  /** True when the payload originates from the demonstration provider. */
  isDemo: boolean;
}

export interface InstrumentQuery {
  search?: string;
  market?: MarketCategory | 'ALL';
  sector?: string | 'ALL';
  timeframe?: Timeframe;
}

export interface MarketDataService {
  listInstruments(query?: InstrumentQuery): Promise<ApiEnvelope<Instrument[]>>;
  getQuotes(instrumentIds?: string[]): Promise<ApiEnvelope<InstrumentQuote[]>>;
  getOverviewSeries(timeframe: Timeframe): Promise<ApiEnvelope<MarketOverviewSeries[]>>;
  getHeatmap(): Promise<ApiEnvelope<HeatmapCell[]>>;
  getMovers(): Promise<
    ApiEnvelope<{ gainers: InstrumentQuote[]; losers: InstrumentQuote[] }>
  >;
  getVolatility(): Promise<ApiEnvelope<VolatilityGauge[]>>;
  getEconomicEvents(): Promise<ApiEnvelope<EconomicEvent[]>>;
  getRecentOpportunities(limit?: number): Promise<ApiEnvelope<OpportunitySummary[]>>;
  getCandles(
    instrumentId: string,
    timeframe: Timeframe,
    count?: number,
  ): Promise<ApiEnvelope<{ candles: Candle[]; meta: SeriesMeta }>>;
}

export interface ResearchService {
  getRegime(): Promise<ApiEnvelope<MarketRegimeAssessment>>;
  getTechnicalIntel(instrumentId: string): Promise<ApiEnvelope<TechnicalIntel>>;
  getNews(limit?: number): Promise<ApiEnvelope<import('@/models').NewsItem[]>>;
  getReport(date: string, market: MarketCategory | 'ALL'): Promise<ApiEnvelope<OpportunityReport>>;
  getReportHistory(): Promise<ApiEnvelope<ReportHistoryEntry[]>>;
  getAiExplanation(opportunityId: string): Promise<ApiEnvelope<AiExplanation>>;
}

export interface StrategyService {
  listStrategies(): Promise<ApiEnvelope<StrategyConfig[]>>;
  runBacktest(strategyId: string, instrumentIds: string[]): Promise<ApiEnvelope<BacktestResult>>;
  compare(strategyIds: string[]): Promise<ApiEnvelope<StrategyComparison>>;
}

export interface RiskService {
  getAccount(): Promise<ApiEnvelope<RiskAccount>>;
  getPositions(): Promise<ApiEnvelope<RiskPosition[]>>;
  getCorrelation(): Promise<ApiEnvelope<{ symbols: string[]; values: number[][] }>>;
  getPortfolioMetrics(): Promise<ApiEnvelope<PortfolioRiskMetrics>>;
}

export interface DataService {
  getSnapshot(): Promise<ApiEnvelope<DataCenterSnapshot>>;
}

export interface NotificationService {
  list(): Promise<ApiEnvelope<NotificationItem[]>>;
  getPreferences(): Promise<ApiEnvelope<NotificationPreference[]>>;
  savePreferences(prefs: NotificationPreference[]): Promise<ApiEnvelope<NotificationPreference[]>>;
  getArchive(): Promise<ApiEnvelope<ReportArchiveEntry[]>>;
  markRead(id: string): Promise<ApiEnvelope<null>>;
  markAllRead(): Promise<ApiEnvelope<null>>;
}

export interface QuantoraApi {
  market: MarketDataService;
  research: ResearchService;
  strategy: StrategyService;
  risk: RiskService;
  data: DataService;
  notifications: NotificationService;
}
