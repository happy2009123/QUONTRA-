import type {
  CorrelationCell,
  DataCenterSnapshot,
  NotificationItem,
  NotificationPreference,
  PortfolioRiskMetrics,
  ReportArchiveEntry,
  RiskAccount,
  RiskPosition,
} from '@/models';
import { INSTRUMENTS } from './universe';
import { seededRandom } from '@/lib/rng';

export function buildRiskAccount(): RiskAccount {
  return {
    simulatedBalance: 2_500_000,
    currency: 'INR',
    riskPerTradePct: 1,
    dailyLossLimitPct: 3,
    maxDrawdownPct: 12,
    currentDrawdownPct: 2.4,
    openPositions: 5,
    netExposure: 46.8,
    updatedAt: new Date().toISOString(),
    isSimulation: true,
  };
}

export function buildRiskPositions(): RiskPosition[] {
  const rand = seededRandom('risk-positions-v1');
  const ids = ['eq-reliance', 'eq-hdfcbank', 'intl-nvda', 'cd-usdinr', 'oth-gold', 'eq-tcs'];
  return ids.map((id) => {
    const instrument = INSTRUMENTS.find((i) => i.id === id)!;
    const weight = Math.round((4 + rand() * 14) * 10) / 10;
    return {
      instrumentId: id,
      symbol: instrument.symbol,
      market: instrument.market,
      side: rand() > 0.3 ? 'LONG' : 'SHORT',
      quantity: Math.round(40 + rand() * 900),
      notional: Math.round(120_000 + rand() * 780_000),
      weightPct: weight,
      unrealizedPnl: Math.round((rand() * 90_000 - 32_000) * 100) / 100,
      stopDistancePct: Math.round((0.7 + rand() * 2.4) * 10) / 10,
    };
  });
}

export function buildCorrelation(): { symbols: string[]; values: number[][] } {
  const rand = seededRandom('correlation-v1');
  const symbols = ['NIFTY 50', 'SENSEX', 'S&P 500', 'NASDAQ 100', 'USD/INR', 'GOLD', 'RELIANCE', 'TCS'];
  const values = symbols.map((_, i) =>
    symbols.map((__, j) => {
      if (i === j) return 1;
      const base = i < 4 && j < 4 ? 0.72 : i >= 4 && j >= 4 ? 0.35 : 0.12;
      return Math.round((base + (rand() - 0.5) * 0.5) * 100) / 100;
    }),
  );
  return { symbols, values };
}

export function buildPortfolioMetrics(): PortfolioRiskMetrics {
  return {
    portfolioVolatilityPct: 11.4,
    valueAtRiskPct: 1.86,
    expectedShortfallPct: 2.94,
    betaToBenchmark: 0.87,
    grossExposurePct: 86.2,
    netExposurePct: 46.8,
    diversificationRatio: 1.34,
    updatedAt: new Date().toISOString(),
    isSimulation: true,
  };
}

export function buildDataSnapshot(): DataCenterSnapshot {
  const now = new Date();
  const mins = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  return {
    providers: [
      {
        id: 'demo-engine',
        name: 'QUANTORA Demo Engine',
        vendor: 'Built-in',
        status: 'DEMO DATA',
        lastSuccessAt: mins(0),
        latencyMs: 42,
        freshnessSeconds: 30,
        reliabilityPct: 100,
        isDemo: true,
        rateLimit: { used: 0, limit: 10_000, resetsAt: mins(-600) },
        apiUsage: { requestsToday: 1_284, requestsMonth: 34_902, quotaPct: 12 },
        supportedMarkets: ['Indian Equities', 'Indian Indices', 'Currency Derivatives', 'International'],
      },
      {
        id: 'india-exchange-feed',
        name: 'India Exchange Reference Feed',
        vendor: 'Vendor A (not connected)',
        status: 'DISCONNECTED',
        lastSuccessAt: mins(1_980),
        latencyMs: 0,
        freshnessSeconds: 0,
        reliabilityPct: 0,
        isDemo: false,
        rateLimit: { used: 0, limit: 600, resetsAt: mins(-120) },
        apiUsage: { requestsToday: 0, requestsMonth: 4_120, quotaPct: 0 },
        supportedMarkets: ['Indian Equities', 'Indian Indices'],
      },
      {
        id: 'global-index-feed',
        name: 'Global Index Delayed Feed',
        vendor: 'Vendor B (not connected)',
        status: 'STALE',
        lastSuccessAt: mins(288),
        latencyMs: 640,
        freshnessSeconds: 17_280,
        reliabilityPct: 82,
        isDemo: false,
        rateLimit: { used: 412, limit: 3_000, resetsAt: mins(-40) },
        apiUsage: { requestsToday: 412, requestsMonth: 12_880, quotaPct: 14 },
        supportedMarkets: ['International Indices', 'International Equities'],
      },
      {
        id: 'economic-calendar',
        name: 'Economic Calendar Service',
        vendor: 'Vendor C (not connected)',
        status: 'DELAYED',
        lastSuccessAt: mins(26),
        latencyMs: 310,
        freshnessSeconds: 1_560,
        reliabilityPct: 94,
        isDemo: false,
        rateLimit: { used: 96, limit: 500, resetsAt: mins(-15) },
        apiUsage: { requestsToday: 96, requestsMonth: 2_140, quotaPct: 19 },
        supportedMarkets: ['Economic Events'],
      },
    ],
    issues: [
      {
        id: 'iss-1',
        type: 'MISSING_CANDLES',
        instrumentId: 'cd-jpyinr',
        symbol: 'JPYINR FUT',
        detail: 'Gap of 14 one-minute candles between 09:12 and 09:26 IST on the last session.',
        detectedAt: mins(180),
        severity: 'MEDIUM',
      },
      {
        id: 'iss-2',
        type: 'DUPLICATE_RECORDS',
        instrumentId: 'intl-tsla',
        symbol: 'TSLA',
        detail: '3 duplicate daily bars detected for the same trading date; deduplication applied.',
        detectedAt: mins(420),
        severity: 'LOW',
      },
      {
        id: 'iss-3',
        type: 'RATE_LIMIT',
        instrumentId: '—',
        symbol: 'Economic Calendar',
        detail: 'Rate-limit threshold at 80% of hourly quota; backoff scheduling engaged.',
        detectedAt: mins(12),
        severity: 'HIGH',
      },
    ],
    coverage: [
      { instrumentId: 'idx-nifty50', symbol: 'NIFTY 50', from: '2010-01-01', to: now.toISOString().slice(0, 10), candleCount: 4_012, completenessPct: 99.8, freshness: 'HISTORICAL' },
      { instrumentId: 'idx-sensex', symbol: 'SENSEX', from: '2010-01-01', to: now.toISOString().slice(0, 10), candleCount: 3_998, completenessPct: 99.4, freshness: 'HISTORICAL' },
      { instrumentId: 'eq-reliance', symbol: 'RELIANCE', from: '2012-04-02', to: now.toISOString().slice(0, 10), candleCount: 3_410, completenessPct: 98.9, freshness: 'HISTORICAL' },
      { instrumentId: 'cd-usdinr', symbol: 'USDINR FUT', from: '2019-06-03', to: now.toISOString().slice(0, 10), candleCount: 1_742, completenessPct: 96.2, freshness: 'HISTORICAL' },
      { instrumentId: 'idx-sp500', symbol: 'S&P 500', from: '2010-01-01', to: now.toISOString().slice(0, 10), candleCount: 4_021, completenessPct: 99.9, freshness: 'DELAYED' },
      { instrumentId: 'intl-nvda', symbol: 'NVDA', from: '2015-01-02', to: now.toISOString().slice(0, 10), candleCount: 2_884, completenessPct: 99.1, freshness: 'DELAYED' },
    ],
    globalFreshness: 'DEMO',
    updatedAt: now.toISOString(),
  };
}

export function buildNotifications(): NotificationItem[] {
  const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  return [
    { id: 'n1', kind: 'REPORT_READY', title: 'Daily opportunity report published', body: 'Today’s report is available. 3 setups cleared the confluence threshold.', createdAt: iso(24), read: false, severity: 'INFO', href: '/reports' },
    { id: 'n2', kind: 'NEW_SETUP', title: 'New qualifying setup — HDFCBANK', body: 'EMA Ribbon Continuation on 1h cleared the 70/100 quality gate.', createdAt: iso(68), read: false, severity: 'INFO', href: '/reports' },
    { id: 'n3', kind: 'DATA_FAILURE', title: 'Global index feed is stale', body: 'Last successful update was more than 4 hours ago. Values are labelled STALE.', createdAt: iso(140), read: false, severity: 'WARNING', href: '/data' },
    { id: 'n4', kind: 'MARKET_EVENT', title: 'High-impact event in 2 days', body: 'RBI policy rate decision — review exposure in IN instruments.', createdAt: iso(320), read: true, severity: 'WARNING', href: '/intelligence' },
    { id: 'n5', kind: 'STRATEGY_WARNING', title: 'Thin trade sample for VWAP Mean Reversion', body: 'Only 41 simulated trades in the out-of-sample window.', createdAt: iso(600), read: true, severity: 'WARNING', href: '/backtesting' },
    { id: 'n6', kind: 'DATA_FAILURE', title: 'Missing one-minute candles — JPYINR FUT', body: '14 candles missing in the last session. Charting falls back to available data.', createdAt: iso(1_400), read: true, severity: 'CRITICAL', href: '/data' },
    { id: 'n7', kind: 'SYSTEM', title: 'Demonstration environment', body: 'All values in this build are generated demo data and are labelled accordingly.', createdAt: iso(2_880), read: true, severity: 'INFO', href: '/settings' },
  ];
}

export function buildNotificationPreferences(): NotificationPreference[] {
  return [
    { kind: 'REPORT_READY', enabled: true, channels: ['IN_APP', 'EMAIL'], minSeverity: 'INFO' },
    { kind: 'NEW_SETUP', enabled: true, channels: ['IN_APP', 'PUSH'], minSeverity: 'INFO' },
    { kind: 'DATA_FAILURE', enabled: true, channels: ['IN_APP', 'EMAIL'], minSeverity: 'WARNING' },
    { kind: 'MARKET_EVENT', enabled: true, channels: ['IN_APP'], minSeverity: 'WARNING' },
    { kind: 'STRATEGY_WARNING', enabled: false, channels: ['IN_APP'], minSeverity: 'INFO' },
    { kind: 'SYSTEM', enabled: true, channels: ['IN_APP'], minSeverity: 'INFO' },
  ];
}

export function buildReportArchive(): ReportArchiveEntry[] {
  const rand = seededRandom('archive-v1');
  return Array.from({ length: 18 }).map((_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - idx);
    const date = d.toISOString().slice(0, 10);
    const empty = Number(date.replace(/-/g, '')) % 3 === 1;
    return {
      id: `arc-${date}`,
      date,
      title: 'Daily Opportunity Report',
      market: (['ALL', 'INDIAN_EQUITIES', 'INTERNATIONAL_EQUITIES'] as const)[idx % 3],
      opportunityCount: empty ? 0 : Math.round(1 + rand() * 4),
      noQualifiedSetups: empty,
      generatedAt: new Date(date + 'T17:30:00+05:30').toISOString(),
      format: (['PDF', 'CSV', 'JSON'] as const)[idx % 3],
      sizeKb: Math.round(80 + rand() * 640),
    };
  });
}

export function correlationCells(matrix: { symbols: string[]; values: number[][] }): CorrelationCell[] {
  const cells: CorrelationCell[] = [];
  matrix.symbols.forEach((row, i) =>
    matrix.symbols.forEach((col, j) => cells.push({ row, col, value: matrix.values[i][j] })),
  );
  return cells;
}
