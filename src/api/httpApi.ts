import type {
  BacktestResult,
  Candle,
  ConnectionStatus,
  DataCenterSnapshot,
  DataIssueType,
  DataFreshness,
  DataProviderStatus,
  DataSourceRef,
  Instrument,
  InstrumentQuote,
  MarketCategory,
  OpportunityReport,
  OpportunitySummary,
  PerformanceMetrics,
  SeriesMeta,
  SourceReliability,
  StrategyConfig,
  TestPhase,
  Timeframe,
} from '@/models';
import type {
  ApiEnvelope,
  InstrumentQuery,
  MarketDataService,
  QuantoraApi,
  ResearchService,
  StrategyService,
  RiskService,
  DataService,
  NotificationService,
} from './services';
import { mockApi } from './mockApi';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const ADMIN_TOKEN = (import.meta.env.VITE_ADMIN_TOKEN as string | undefined) ?? '';
const REQUEST_TIMEOUT_MS = 30_000;

interface ApiHttpError extends Error {
  status: number;
  code: string;
  body?: unknown;
}

class ApiHttpErrorImpl extends Error implements ApiHttpError {
  readonly status: number;
  readonly code: string;
  readonly body?: unknown;
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
    this.name = 'ApiHttpError';
  }
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return /fetch|network|connection/i.test((e as Error).message);
  if (e instanceof Error && e.name === 'AbortError') return true;
  return false;
}

interface HttpEnvelope<T> {
  data: T;
  fetchedAt: string;
  isDemo: boolean;
}

async function request<T>(input: string, init: RequestInit = {}): Promise<HttpEnvelope<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(input, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      let code = 'HTTP_ERROR';
      let body: unknown;
      try {
        body = await res.json();
      } catch {}
      if (body && typeof body === 'object' && 'error' in body) {
        const err = (body as { error: { code?: string; message?: string } }).error;
        if (err && typeof err === 'object') {
          code = err.code ?? code;
          throw new ApiHttpErrorImpl(res.status, code, err.message ?? `Request failed with status ${res.status}`, body);
        }
      }
      throw new ApiHttpErrorImpl(res.status, code, `Request failed with status ${res.status}`, body);
    }
    const json = (await res.json()) as { data?: T; fetchedAt?: string; isDemo?: boolean };
    return {
      data: json.data as T,
      fetchedAt: json.fetchedAt ?? new Date().toISOString(),
      isDemo: json.isDemo ?? true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Falls back to the demo mock only when the backend cannot be reached. */
async function withMockFallback<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isNetworkError(e)) return fallback();
    throw e;
  }
}

const apiBase = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

function url(path: string, params: Record<string, string | number | boolean | undefined> = {}): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${apiBase}${path}${qs ? '?' + qs : ''}`;
}

function withAdmin(init: RequestInit = {}): RequestInit {
  const headers: Record<string, string> = {};
  const raw = init.headers;
  if (raw) {
    if (Array.isArray(raw)) {
      for (const [k, v] of raw) headers[k] = v;
    } else if (typeof raw.forEach === 'function') {
      raw.forEach((value: string, key: string) => { headers[key] = value; });
    } else {
      Object.assign(headers, raw);
    }
  }
  if (ADMIN_TOKEN) headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  return { ...init, headers };
}

/* ── backend response shapes ─────────────────────────────────────────── */

interface BackendInstrument {
  id: string;
  symbol: string;
  name: string;
  market: string;
  exchange: string;
  region: string;
  type: string;
  currency: string;
  sector?: string;
  restriction?: { code: string; summary: string; detail: string };
}

interface BackendQuote {
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
  marketStatus: string;
  freshness: string;
  updatedAt: string;
  quality: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
}

interface BackendInstrumentQuote extends BackendInstrument {
  quote: BackendQuote;
}

interface BackendCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BackendCandleMeta {
  instrumentId: string;
  timeframe: string;
  freshness: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  updatedAt: string;
  count: number;
  isDemo?: boolean;
}

interface BackendOpportunityItem {
  id: string;
  instrumentId: string;
  symbol: string;
  market: string;
  direction: string;
  signal: string;
  strategyName: string;
  score: number;
  timeframe: string;
  createdAt: string;
}

interface BackendOpportunity extends BackendOpportunityItem {
  instrumentName: string;
  lastPrice: number;
  priceCurrency: string;
  observedAt: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  entryTrigger: string;
  entryZone: { low: number; high: number };
  stopLoss: number;
  targets: [number, number];
  plannedRiskReward: number;
  liquidity: string;
  spreadBps: number;
  upcomingEvents: string[];
  technicalExplanation: string;
  riskFactors: string[];
  quality: {
    score: number;
    components: Array<{ label: string; weight: number; value: number }>;
    summary: string;
    disclaimer: string;
  };
}

interface BackendDailyReport {
  id: string;
  title: string;
  date: string;
  market: string;
  generatedAt: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  noQualifiedSetups: boolean;
  regimeSummary: string;
  opportunities: BackendOpportunity[];
  notes: string[];
}

interface BackendStrategyRow {
  id: string;
  name: string;
  family: string;
  description: string;
  timeframe: string;
  indicators: unknown[];
  entryConditions: unknown[];
  exitConditions: unknown[];
  stopLoss: { mode: string; value: number };
  targets: { target1Pct: number; target2Pct: number };
  exitMode: string;
  disclaimer: string;
}

interface BackendConditionRow {
  id: string;
  left_expr: string;
  operator: string;
  right_expr: string;
  lookback: number;
}

interface BacktestOutcome {
  id: string;
  strategyId: string;
  strategyName: string;
  instrumentIds: string[];
  window: { from: string; to: string };
  costs: Record<string, unknown>;
  initialCapital: number;
  isSimulated: boolean;
  phase: string;
  metrics: Record<string, unknown>;
  equityCurve: Array<{ time: number; equity: number; drawdown: number }>;
  trades: Array<{
    id: string;
    instrumentId: string;
    symbol: string;
    direction: string;
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    grossPnl: number;
    costs: number;
    netPnl: number;
    rMultiple: number;
    exitReason: string;
  }>;
  warnings: string[];
  generatedAt: string;
}

interface BackendProvider {
  id: string;
  name: string;
  vendor: string;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  latencyMs: number;
  freshnessSeconds: number;
  reliabilityPct: number;
  isDemo: boolean;
  rateLimit: { used: number; limit: number; resetsAt: string };
  apiUsage: { requestsToday: number; requestsMonth: number; quotaPct: number };
  supportedMarkets: string[];
}

interface BackendIssue {
  id: string;
  type: string;
  instrumentId: string;
  symbol: string;
  detail: string;
  detectedAt: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface BackendCoverage {
  instrumentId: string;
  symbol: string;
  from: string;
  to: string;
  candleCount: number;
  completenessPct: number;
  freshness: string;
}

interface DataHealthResponse {
  providers: BackendProvider[];
  issues: BackendIssue[];
  coverage: BackendCoverage[];
  globalFreshness: DataFreshness;
  updatedAt: string;
  summary: Record<string, unknown>;
}

/* ── mappers ─────────────────────────────────────────────────────────── */

function mapSource(s: { provider: string; origin: string; isDemo: boolean; reliability: string }): DataSourceRef {
  return {
    provider: s.provider,
    origin: s.origin,
    isDemo: s.isDemo,
    reliability: s.reliability as SourceReliability,
  };
}

function mapInstrument(row: BackendInstrument): Instrument {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    market: row.market as MarketCategory,
    exchange: row.exchange as Instrument['exchange'],
    region: row.region as Instrument['region'],
    type: row.type as Instrument['type'],
    currency: row.currency as Instrument['currency'],
    sector: row.sector,
    restriction: row.restriction,
  };
}

function mapQuote(q: BackendQuote): InstrumentQuote['quote'] {
  return {
    instrumentId: q.instrumentId,
    lastPrice: q.lastPrice,
    change: q.change,
    changePercent: q.changePercent,
    open: q.open,
    high: q.high,
    low: q.low,
    previousClose: q.previousClose,
    volume: q.volume,
    averageVolume: q.averageVolume,
    marketStatus: q.marketStatus as InstrumentQuote['quote']['marketStatus'],
    freshness: q.freshness as DataFreshness,
    updatedAt: q.updatedAt,
    source: mapSource(q.source),
  };
}

function mapInstrumentQuote(row: BackendInstrumentQuote): InstrumentQuote {
  return {
    ...row,
    market: row.market as MarketCategory,
    exchange: row.exchange as Instrument['exchange'],
    region: row.region as Instrument['region'],
    type: row.type as Instrument['type'],
    currency: row.currency as Instrument['currency'],
    quote: mapQuote(row.quote),
  };
}

function mapCandle(meta: BackendCandleMeta): SeriesMeta {
  return {
    instrumentId: meta.instrumentId,
    timeframe: meta.timeframe as Timeframe,
    freshness: meta.freshness as DataFreshness,
    source: mapSource(meta.source),
    updatedAt: meta.updatedAt,
    count: meta.count,
  };
}

function mapOpportunityItem(row: BackendOpportunityItem): OpportunitySummary {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    market: row.market as MarketCategory,
    direction: row.signal as OpportunitySummary['direction'],
    strategyName: row.strategyName,
    strategyScore: row.score,
    timeframe: row.timeframe as Timeframe,
    createdAt: row.createdAt,
  };
}

function mapOpportunity(row: BackendOpportunity): import('@/models').Opportunity {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    instrumentName: row.instrumentName,
    market: row.market as MarketCategory,
    strategyName: row.strategyName,
    direction: row.direction as import('@/models').ReportDirection,
    signal: row.signal as import('@/models').SignalAction,
    timeframe: row.timeframe as Timeframe,
    lastPrice: row.lastPrice,
    priceCurrency: row.priceCurrency,
    observedAt: row.observedAt,
    source: mapSource(row.source),
    entryTrigger: row.entryTrigger,
    entryZone: row.entryZone,
    stopLoss: row.stopLoss,
    targets: row.targets,
    plannedRiskReward: row.plannedRiskReward,
    liquidity: row.liquidity as import('@/models').Opportunity['liquidity'],
    spreadBps: row.spreadBps,
    upcomingEvents: row.upcomingEvents,
    technicalExplanation: row.technicalExplanation,
    riskFactors: row.riskFactors,
    quality: row.quality as import('@/models').StrategyQuality,
    createdAt: row.createdAt,
  };
}

function mapReport(report: BackendDailyReport): OpportunityReport {
  return {
    id: report.id,
    title: report.title,
    date: report.date,
    market: report.market as MarketCategory | 'ALL',
    generatedAt: report.generatedAt,
    source: mapSource(report.source),
    noQualifiedSetups: report.noQualifiedSetups,
    regimeSummary: report.regimeSummary,
    opportunities: report.opportunities.map(mapOpportunity),
    notes: report.notes,
  };
}

function mapStrategy(row: BackendStrategyRow): StrategyConfig {
  const mapCondition = (c: BackendConditionRow) => ({
    id: c.id,
    left: c.left_expr,
    operator: c.operator as StrategyConfig['entryConditions'][number]['operator'],
    right: c.right_expr,
    lookback: c.lookback,
  });
  return {
    id: row.id,
    name: row.name,
    family: row.family as StrategyConfig['family'],
    description: row.description,
    timeframe: row.timeframe as Timeframe,
    indicators: row.indicators as StrategyConfig['indicators'],
    entryConditions: (row.entryConditions as BackendConditionRow[]).map(mapCondition),
    exitConditions: (row.exitConditions as BackendConditionRow[]).map(mapCondition),
    stopLoss: row.stopLoss as StrategyConfig['stopLoss'],
    targets: row.targets as StrategyConfig['targets'],
    exitMode: row.exitMode as StrategyConfig['exitMode'],
  };
}

function mapBacktest(outcome: BacktestOutcome): BacktestResult {
  return {
    id: outcome.id,
    strategyId: outcome.strategyId,
    strategyName: outcome.strategyName,
    instrumentIds: outcome.instrumentIds,
    window: outcome.window,
    costs: outcome.costs as unknown as BacktestResult['costs'],
    initialCapital: outcome.initialCapital,
    isSimulated: true,
    phase: outcome.phase as BacktestResult['phase'],
    metrics: outcome.metrics as unknown as BacktestResult['metrics'],
    equityCurve: outcome.equityCurve,
    trades: outcome.trades as BacktestResult['trades'],
    regimeBreakdown: [],
    warnings: outcome.warnings,
    generatedAt: outcome.generatedAt,
  };
}

function mapConnectionStatus(status: string): ConnectionStatus {
  const valid: ConnectionStatus[] = ['CONNECTED', 'DELAYED', 'STALE', 'DISCONNECTED', 'DEMO DATA'];
  return valid.includes(status as ConnectionStatus) ? (status as ConnectionStatus) : 'STALE';
}

function mapSnapshot(health: DataHealthResponse): DataCenterSnapshot {
  return {
    providers: health.providers.map((p): DataProviderStatus => ({
      id: p.id,
      name: p.name,
      vendor: p.vendor,
      status: mapConnectionStatus(p.status),
      lastSuccessAt: p.lastSuccessAt ?? new Date(0).toISOString(),
      latencyMs: p.latencyMs,
      freshnessSeconds: p.freshnessSeconds,
      reliabilityPct: p.reliabilityPct,
      isDemo: p.isDemo,
      rateLimit: p.rateLimit,
      apiUsage: p.apiUsage,
      supportedMarkets: p.supportedMarkets,
    })),
    issues: health.issues.map((i) => ({
      id: i.id,
      type: i.type as DataIssueType,
      instrumentId: i.instrumentId,
      symbol: i.symbol,
      detail: i.detail,
      detectedAt: i.detectedAt,
      severity: i.severity,
    })),
    coverage: health.coverage.map((c) => ({
      instrumentId: c.instrumentId,
      symbol: c.symbol,
      from: c.from,
      to: c.to,
      candleCount: c.candleCount,
      completenessPct: c.completenessPct,
      freshness: c.freshness as DataFreshness,
    })),
    globalFreshness: health.globalFreshness,
    updatedAt: health.updatedAt,
  };
}

/* ── service implementations ─────────────────────────────────────────── */

const market: MarketDataService = {
  async listInstruments(query: InstrumentQuery = {}) {
    const page = await withMockFallback(
      () => request<{ items: BackendInstrument[]; total: number }>(url('/api/instruments', {
        search: query.search,
        market: query.market,
        sector: query.sector,
        limit: 100,
        offset: 0,
      })).then((r) => ({ data: r.data.items.map(mapInstrument), fetchedAt: r.fetchedAt, isDemo: r.isDemo })),
      () => mockApi.market.listInstruments(query),
    );
    return page;
  },

  async getQuotes(instrumentIds?: string[]) {
    return withMockFallback(
      () => request<BackendInstrumentQuote[]>(url('/api/quotes', { ids: instrumentIds ? instrumentIds.join(',') : undefined })).then((r) => ({
        data: r.data.map(mapInstrumentQuote),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.market.getQuotes(instrumentIds),
    );
  },

  async getOverviewSeries(timeframe: Timeframe) {
    return mockApi.market.getOverviewSeries(timeframe);
  },

  async getHeatmap() {
    return mockApi.market.getHeatmap();
  },

  async getMovers() {
    return mockApi.market.getMovers();
  },

  async getVolatility() {
    return mockApi.market.getVolatility();
  },

  async getEconomicEvents() {
    return mockApi.market.getEconomicEvents();
  },

  async getRecentOpportunities(limit = 5) {
    return withMockFallback(
      () => request<{ items: BackendOpportunityItem[]; total: number }>(url('/api/opportunities', { limit })).then((r) => ({
        data: r.data.items.map(mapOpportunityItem),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.market.getRecentOpportunities(limit),
    );
  },

  async getCandles(instrumentId: string, timeframe: Timeframe, count = 400) {
    return withMockFallback(
      () => request<{ candles: BackendCandle[]; meta: BackendCandleMeta }>(url('/api/candles', {
        instrumentId,
        timeframe,
        limit: count,
      })).then((r) => ({
        data: { candles: r.data.candles as Candle[], meta: mapCandle(r.data.meta) },
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.market.getCandles(instrumentId, timeframe, count),
    );
  },
};

const research: ResearchService = {
  async getRegime() {
    return mockApi.research.getRegime();
  },

  async getTechnicalIntel(instrumentId: string) {
    return mockApi.research.getTechnicalIntel(instrumentId);
  },

  async getNews(limit = 12) {
    return mockApi.research.getNews(limit);
  },

  async getReport(date: string, market: MarketCategory | 'ALL') {
    return withMockFallback(
      () => request<BackendDailyReport>(url('/api/reports', { date, market })).then((r) => ({
        data: mapReport(r.data),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.research.getReport(date, market),
    );
  },

  async getReportHistory() {
    return withMockFallback(
      () => request<{ items: BackendOpportunityItem[] }>(url('/api/reports', { history: 'true', limit: 30 })).then((r) => ({
        data: r.data.items.map((it) => ({
          id: it.id,
          date: it.createdAt.slice(0, 10),
          title: `${it.symbol} ${it.strategyName}`,
          market: it.market as MarketCategory | 'ALL',
          opportunityCount: 1,
          noQualifiedSetups: false,
          generatedAt: it.createdAt,
        })),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.research.getReportHistory(),
    );
  },

  async getAiExplanation(opportunityId: string) {
    return mockApi.research.getAiExplanation(opportunityId);
  },
};

const strategy: StrategyService = {
  async listStrategies() {
    return withMockFallback(
      () => request<BackendStrategyRow[]>(url('/api/strategies')).then((r) => ({
        data: r.data.map(mapStrategy),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.strategy.listStrategies(),
    );
  },

  async runBacktest(strategyId: string, instrumentIds: string[]) {
    if (!ADMIN_TOKEN) {
      return mockApi.strategy.runBacktest(strategyId, instrumentIds);
    }
    return withMockFallback(
      () => request<BacktestOutcome>(url('/api/backtests'), { ...withAdmin({ method: 'POST', body: JSON.stringify({ strategyId, instrumentIds }) }) }).then((r) => ({
        data: mapBacktest(r.data),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.strategy.runBacktest(strategyId, instrumentIds),
    );
  },

  async compare(strategyIds: string[]) {
    if (!ADMIN_TOKEN) {
      return mockApi.strategy.compare(strategyIds);
    }
    return withMockFallback(
      () => request<{ rows: Array<{ strategyId: string; strategyName: string; metrics: Record<string, unknown>; phase: string }>; warnings: string[] }>(
        url('/api/backtests/compare'),
        { ...withAdmin({ method: 'POST', body: JSON.stringify({ strategyIds, instrumentIds: [] }) }) },
      ).then((r) => ({
        data: {
          rows: r.data.rows.map((row) => ({
            strategyId: row.strategyId,
            strategyName: row.strategyName,
            metrics: row.metrics as unknown as PerformanceMetrics,
            phase: row.phase as unknown as TestPhase,
          })),
        },
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.strategy.compare(strategyIds),
    );
  },
};

const risk: RiskService = {
  async getAccount() {
    return mockApi.risk.getAccount();
  },

  async getPositions() {
    return mockApi.risk.getPositions();
  },

  async getCorrelation() {
    return mockApi.risk.getCorrelation();
  },

  async getPortfolioMetrics() {
    return mockApi.risk.getPortfolioMetrics();
  },
};

const data: DataService = {
  async getSnapshot() {
    return withMockFallback(
      () => request<DataHealthResponse>(url('/api/data-health')).then((r) => ({
        data: mapSnapshot(r.data),
        fetchedAt: r.fetchedAt,
        isDemo: r.isDemo,
      })),
      () => mockApi.data.getSnapshot(),
    );
  },
};

const notifications: NotificationService = {
  async list() {
    return mockApi.notifications.list();
  },

  async getPreferences() {
    return mockApi.notifications.getPreferences();
  },

  async savePreferences(prefs) {
    return mockApi.notifications.savePreferences(prefs);
  },

  async getArchive() {
    return mockApi.notifications.getArchive();
  },

  async markRead(id: string) {
    return mockApi.notifications.markRead(id);
  },

  async markAllRead() {
    return mockApi.notifications.markAllRead();
  },
};

export const httpApi: QuantoraApi = { market, research, strategy, risk, data, notifications };

export type { ApiEnvelope, QuantoraApi };
