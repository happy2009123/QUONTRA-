import type { Candle, Instrument, InstrumentQuote, Timeframe } from '@/models';
import type {
  ApiEnvelope,
  DataService,
  InstrumentQuery,
  MarketDataService,
  NotificationService,
  QuantoraApi,
  ResearchService,
  RiskService,
  StrategyService,
} from './services';
import { INSTRUMENTS, MARKET_LABELS } from '@/data/universe';
import { buildCandles, buildQuote } from '@/data/marketData';
import {
  buildAiExplanation,
  buildAllQuotes,
  buildEconomicEvents,
  buildHeatmap,
  buildMovers,
  buildNews,
  buildOpportunityReport,
  buildOverviewSeries,
  buildRecentOpportunities,
  buildRegime,
  buildReportHistory,
  buildTechnicalIntel,
  buildVolatility,
} from '@/data/researchData';
import {
  buildBacktestResult,
  buildComparison,
  STRATEGIES,
} from '@/data/strategyData';
import {
  buildCorrelation,
  buildDataSnapshot,
  buildNotificationPreferences,
  buildNotifications,
  buildPortfolioMetrics,
  buildReportArchive,
  buildRiskAccount,
  buildRiskPositions,
} from '@/data/opsData';

const LATENCY = { min: 160, max: 420 };

function delay(min = LATENCY.min, max = LATENCY.max): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function envelope<T>(data: T, isDemo = true): Promise<ApiEnvelope<T>> {
  await delay();
  return { data, fetchedAt: new Date().toISOString(), isDemo };
}

const market: MarketDataService = {
  async listInstruments(query: InstrumentQuery = {}) {
    const search = query.search?.trim().toLowerCase() ?? '';
    const rows: Instrument[] = INSTRUMENTS.filter((i) => {
      const matchesSearch =
        !search ||
        i.symbol.toLowerCase().includes(search) ||
        i.name.toLowerCase().includes(search);
      const matchesMarket = !query.market || query.market === 'ALL' || i.market === query.market;
      const matchesSector = !query.sector || query.sector === 'ALL' || i.sector === query.sector;
      return matchesSearch && matchesMarket && matchesSector;
    });
    return envelope(rows);
  },

  async getQuotes(instrumentIds?: string[]) {
    const quotes: InstrumentQuote[] = buildAllQuotes().filter(
      (q) => !instrumentIds || instrumentIds.includes(q.id),
    );
    return envelope(quotes);
  },

  async getOverviewSeries(timeframe: Timeframe) {
    const count = timeframe === '1D' ? 90 : timeframe === '1W' ? 60 : 120;
    return envelope(buildOverviewSeries(count));
  },

  async getHeatmap() {
    return envelope(buildHeatmap());
  },

  async getMovers() {
    return envelope(buildMovers());
  },

  async getVolatility() {
    return envelope(buildVolatility());
  },

  async getEconomicEvents() {
    return envelope(buildEconomicEvents());
  },

  async getRecentOpportunities(limit = 5) {
    return envelope(buildRecentOpportunities(limit));
  },

  async getCandles(instrumentId: string, timeframe: Timeframe, count = 400) {
    const candles: Candle[] = buildCandles(instrumentId, timeframe, count);
    const quote = buildQuote(instrumentId);
    return envelope({
      candles,
      meta: {
        instrumentId,
        timeframe,
        freshness: quote?.freshness ?? 'DEMO',
        source: quote?.source ?? {
          provider: 'QUANTORA Demo Engine',
          origin: 'SIMULATED',
          isDemo: true,
          reliability: 'PROVISIONAL',
        },
        updatedAt: quote?.updatedAt ?? new Date().toISOString(),
        count: candles.length,
      },
    });
  },
};

const research: ResearchService = {
  getRegime: () => envelope(buildRegime()),
  getTechnicalIntel: (instrumentId) => envelope(buildTechnicalIntel(instrumentId)),
  getNews: (limit = 12) => envelope(buildNews(limit)),
  getReport: (date, marketFilter) => envelope(buildOpportunityReport(date, marketFilter)),
  getReportHistory: () => envelope(buildReportHistory()),
  getAiExplanation: (opportunityId) => envelope(buildAiExplanation(opportunityId)),
};

const strategy: StrategyService = {
  listStrategies: () => envelope(STRATEGIES),
  async runBacktest(strategyId, instrumentIds) {
    await delay(520, 1_100);
    return { data: buildBacktestResult(strategyId, instrumentIds), fetchedAt: new Date().toISOString(), isDemo: true };
  },
  compare: (strategyIds) => envelope(buildComparison(strategyIds)),
};

const risk: RiskService = {
  getAccount: () => envelope(buildRiskAccount()),
  getPositions: () => envelope(buildRiskPositions()),
  getCorrelation: () => envelope(buildCorrelation()),
  getPortfolioMetrics: () => envelope(buildPortfolioMetrics()),
};

const data: DataService = {
  getSnapshot: () => envelope(buildDataSnapshot()),
};

let notificationStore = buildNotifications();

const notifications: NotificationService = {
  async list() {
    return envelope(notificationStore);
  },
  getPreferences: () => envelope(buildNotificationPreferences()),
  async savePreferences(prefs) {
    await delay(120, 260);
    return envelope(prefs);
  },
  getArchive: () => envelope(buildReportArchive()),
  async markRead(id) {
    await delay(60, 140);
    notificationStore = notificationStore.map((n) => (n.id === id ? { ...n, read: true } : n));
    return envelope(null);
  },
  async markAllRead() {
    await delay(80, 180);
    notificationStore = notificationStore.map((n) => ({ ...n, read: true }));
    return envelope(null);
  },
};

export const mockApi: QuantoraApi = { market, research, strategy, risk, data, notifications };

/** Human label helper used by filter UIs. */
export function marketLabel(key: string): string {
  if (key === 'ALL') return 'All markets';
  return MARKET_LABELS[key as keyof typeof MARKET_LABELS] ?? key;
}
