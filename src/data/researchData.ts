import type {
  AiExplanation,
  EconomicEvent,
  HeatmapCell,
  InstrumentQuote,
  MarketOverviewSeries,
  MarketRegimeAssessment,
  NewsItem,
  Opportunity,
  OpportunityReport,
  OpportunitySummary,
  ReportHistoryEntry,
  StrategyQuality,
  TechnicalIntel,
  VolatilityGauge,
} from '@/models';
import { INSTRUMENTS, INSTRUMENT_BY_ID, demoSource } from './universe';
import { buildQuote, buildCandles } from './marketData';
import { seededRandom, pick } from '@/lib/rng';

const now = () => new Date();

function isoDaysAgo(days: number, hour = 9, minute = 15): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function buildAllQuotes(at: Date = now()): InstrumentQuote[] {
  return INSTRUMENTS.map((instrument) => {
    const quote = buildQuote(instrument.id, at);
    return { ...instrument, quote: quote! };
  }).filter((q) => q.quote);
}

export function buildOverviewSeries(count = 90): MarketOverviewSeries[] {
  const ids = ['idx-nifty50', 'idx-sensex', 'idx-sp500', 'idx-nasdaq', 'idx-dow', 'fx-usdinr'];
  return ids.map((id) => {
    const candles = buildCandles(id, '1D', count);
    const first = candles[0].close;
    return {
      instrumentId: id,
      symbol: INSTRUMENT_BY_ID[id]?.symbol ?? id,
      points: candles.map((c) => ({ time: c.time, value: c.close })),
      changePercent: Math.round(((candles[candles.length - 1].close - first) / first) * 10000) / 100,
      freshness: 'DEMO',
    };
  });
}

export function buildHeatmap(): HeatmapCell[] {
  const rand = seededRandom('heatmap-v1');
  return INSTRUMENTS.filter((i) => i.market !== 'OTHER' || i.type === 'COMMODITY').map((i) => {
    const changePercent = Math.round((rand() * 5.4 - 2.4) * 100) / 100;
    return {
      instrumentId: i.id,
      symbol: i.symbol,
      name: i.name,
      changePercent,
      weight: Math.abs(changePercent) * (0.6 + rand()),
      market: i.market,
    };
  });
}

export function buildMovers(): { gainers: InstrumentQuote[]; losers: InstrumentQuote[] } {
  const rand = seededRandom(`movers:${new Date().toDateString()}`);
  const quotes = buildAllQuotes()
    .map((q) => ({ q, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.q);
  return { gainers: quotes.slice(0, 6), losers: quotes.slice(-6).reverse() };
}

export function buildVolatility(): VolatilityGauge[] {
  const rand = seededRandom('vol-panel-v1');
  const ids = ['idx-nifty50', 'idx-sp500', 'idx-nasdaq', 'idx-indiavix', 'oth-crude', 'fx-usdinr'];
  return ids.map((id) => {
    const volatility = Math.round((3 + rand() * 28) * 100) / 100;
    const percentile = Math.round(rand() * 100);
    const regime: VolatilityGauge['regime'] =
      percentile > 88 ? 'EXTREME' : percentile > 65 ? 'ELEVATED' : percentile > 30 ? 'NORMAL' : 'LOW';
    return { instrumentId: id, symbol: INSTRUMENT_BY_ID[id].symbol, volatility, percentile, regime, freshness: 'DEMO' };
  });
}

export function buildEconomicEvents(): EconomicEvent[] {
  const source = { ...demoSource(), origin: 'DEMO CALENDAR' };
  const events: [string, string, string, EconomicEvent['impact'], number][] = [
    ['US CPI (YoY)', 'United States', 'HIGH', 'HIGH', 1],
    ['RBI Policy Rate Decision', 'India', 'HIGH', 'HIGH', 3],
    ['India WPI Inflation', 'India', 'MEDIUM', 'MEDIUM', 2],
    ['US Initial Jobless Claims', 'United States', 'LOW', 'MEDIUM', 4],
    ['FOMC Minutes', 'United States', 'HIGH', 'HIGH', 6],
    ['India Manufacturing PMI', 'India', 'MEDIUM', 'MEDIUM', 5],
    ['Crude Oil Inventories', 'United States', 'MEDIUM', 'LOW', 2],
    ['ECB Rate Decision', 'Euro Area', 'HIGH', 'HIGH', 8],
  ];
  return events.map(([title, country, impact, , days], idx) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(idx % 2 === 0 ? 18 : 15, 30, 0, 0);
    return {
      id: `evt-${idx}`,
      title,
      country,
      scheduledAt: d.toISOString(),
      impact: impact as EconomicEvent['impact'],
      forecast: idx % 2 === 0 ? '3.1%' : '—',
      previous: idx % 2 === 0 ? '3.3%' : '—',
      source,
    };
  });
}

export function buildRecentOpportunities(limit = 5): OpportunitySummary[] {
  const rand = seededRandom('recent-opps-v1');
  const pool = INSTRUMENTS.filter((i) =>
    ['INDIAN_EQUITIES', 'INTERNATIONAL_EQUITIES', 'INDIAN_INDICES', 'IN_CURRENCY_DERIVATIVES'].includes(i.market),
  );
  const strategies = [
    'EMA Ribbon Continuation',
    'VWAP Mean Reversion',
    'Bollinger Squeeze Breakout',
    'RSI Divergence Reversal',
    'ATR Volatility Expansion',
    'Multi-Timeframe Trend Alignment',
  ];
  const directions = ['BUY', 'SELL', 'WATCH'] as const;
  return pool
    .slice()
    .sort(() => rand() - 0.5)
    .slice(0, limit)
    .map((i, idx) => ({
      id: `opp-${i.id}`,
      instrumentId: i.id,
      symbol: i.symbol,
      market: i.market,
      direction: pick(rand, directions),
      strategyName: strategies[idx % strategies.length],
      strategyScore: Math.round(58 + rand() * 38),
      timeframe: pick(rand, ['15m', '1h', '4h', '1D'] as const),
      createdAt: isoDaysAgo(0, 8 + idx, 45 - idx * 7),
    }));
}

export function buildNews(limit = 12): NewsItem[] {
  const source = 'QUANTORA Demo Newswire';
  const seeds: [string, NewsItem['category'], NewsItem['sentiment'], string[]][] = [
    ['Benchmark indices extend gains as financials lead broader participation', 'MARKET_HEADLINE', 'POSITIVE', ['idx-nifty50', 'eq-hdfcbank', 'eq-icicibank']],
    ['Central bank holds policy rate, signals data-dependent stance', 'CENTRAL_BANK', 'NEUTRAL', ['idx-nifty50', 'fx-usdinr']],
    ['IT majors guide for softer discretionary spending in next quarter', 'EARNINGS', 'NEGATIVE', ['eq-tcs', 'eq-infy', 'eq-wipro']],
    ['Crude inventories draw more than expected, energy complex firms', 'MARKET_HEADLINE', 'POSITIVE', ['oth-crude', 'eq-reliance']],
    ['US inflation print lands in line; rate path expectations unchanged', 'ECONOMIC_EVENT', 'NEUTRAL', ['idx-sp500', 'idx-dow']],
    ['Semiconductor demand outlook revised upward by major analysts', 'EARNINGS', 'POSITIVE', ['intl-nvda', 'idx-nasdaq']],
    ['Currency future open interest rises ahead of expiry', 'MARKET_HEADLINE', 'NEUTRAL', ['cd-usdinr']],
    ['Regulator reiterates risk disclosure norms for derivative segments', 'POLICY', 'NEGATIVE', ['cd-usdinr', 'cd-eurinr']],
    ['Bank credit growth accelerates on retail and MSME demand', 'MARKET_HEADLINE', 'POSITIVE', ['eq-sbin', 'eq-axisbank']],
    ['Auto dispatch numbers point to steady festive-season volumes', 'EARNINGS', 'POSITIVE', ['eq-maruti', 'eq-tatamotors']],
    ['European indices close mixed ahead of policy minutes', 'MARKET_HEADLINE', 'NEUTRAL', ['idx-dax', 'idx-ftse']],
    ['Pharma exports momentum continues; margin resilience noted', 'EARNINGS', 'POSITIVE', ['eq-sunpharma']],
  ];
  return seeds.slice(0, limit).map(([headline, category, sentiment, instruments], idx) => ({
    id: `news-${idx}`,
    headline,
    summary: 'Demonstration headline generated for interface review. Not a verified news feed.',
    category,
    publishedAt: isoDaysAgo(0, 6 + idx, (idx * 13) % 60),
    source,
    sentiment,
    sentimentScore: sentiment === 'POSITIVE' ? 0.62 + (idx % 3) * 0.1 : sentiment === 'NEGATIVE' ? -0.58 - (idx % 3) * 0.08 : (idx % 3) - 1,
    instruments,
  }));
}

export function buildRegime(): MarketRegimeAssessment {
  return {
    primary: 'SIDEWAYS',
    confidence: 68,
    volatilityState: 'NORMAL',
    breadth: 54,
    explanation:
      'Large-cap breadth is neutral while realised volatility sits near its 60-day median. Trend persistence across 15m/1h/1D is mixed, which favours range-aware strategies over breakout continuation. Demonstration assessment only.',
    updatedAt: now().toISOString(),
    source: { ...demoSource(), origin: 'QUANTORA REGIME MODEL (DEMO)' },
  };
}

const INDICATOR_READINGS = [
  ['RSI (14)', 58.4, 'Neutral — mid-range, no exhaustion'],
  ['MACD (12,26,9)', 12.8, 'Bullish crossover, momentum building'],
  ['ADX (14)', 22.1, 'Moderate trend strength'],
  ['ATR (14)', 41.6, 'Normalised volatility'],
  ['VWAP', 26_180.4, 'Price oscillating around session mean'],
  ['Bollinger %B', 0.62, 'Upper half of band, not stretched'],
];

export function buildTechnicalIntel(instrumentId: string): TechnicalIntel {
  const rand = seededRandom(`tech:${instrumentId}`);
  const candles = buildCandles(instrumentId, '1D', 120);
  const price = candles[candles.length - 1].close;
  const rsi = Math.round((38 + rand() * 34) * 10) / 10;
  const adx = Math.round((14 + rand() * 24) * 10) / 10;
  const atr = Math.round(price * (0.006 + rand() * 0.02) * 1000) / 1000;
  const dir = rand();
  const alignment: TechnicalIntel['multiTimeframeTrend']['alignment'] =
    dir > 0.6 ? 'ALIGNED' : dir > 0.3 ? 'MIXED' : 'CONFLICTING';
  const trend = (d: number): 'UP' | 'DOWN' | 'SIDEWAYS' =>
    d > 0.55 ? 'UP' : d < 0.4 ? 'DOWN' : 'SIDEWAYS';

  const support = [0.97, 0.94].map((f, i) => ({
    price: Math.round(price * f * 100) / 100,
    label: i === 0 ? 'Primary support' : 'Secondary support',
    strength: Math.round((62 + rand() * 30) * 10) / 10,
  }));
  const resistance = [1.03, 1.06].map((f, i) => ({
    price: Math.round(price * f * 100) / 100,
    label: i === 0 ? 'Primary resistance' : 'Secondary resistance',
    strength: Math.round((58 + rand() * 34) * 10) / 10,
  }));

  return {
    instrumentId,
    symbol: INSTRUMENT_BY_ID[instrumentId]?.symbol ?? instrumentId,
    multiTimeframeTrend: {
      '15m': trend(rand()),
      '1h': trend(rand()),
      '1D': trend(rand()),
      alignment,
    },
    indicatorSummary: INDICATOR_READINGS.map(([name, value, reading]) => ({
      name: name as string,
      value: typeof value === 'number' && value > 1000 ? Math.round(price * (0.98 + rand() * 0.04) * 100) / 100 : (value as number),
      reading: reading as string,
    })),
    support,
    resistance,
    volumeConfirmation: alignment === 'ALIGNED' ? 'CONFIRMED' : alignment === 'MIXED' ? 'NEUTRAL' : 'DIVERGENT',
    rsi,
    atr,
    adx,
    freshness: 'DEMO',
  };
}

const STRATEGY_NAMES = [
  'EMA Ribbon Continuation',
  'VWAP Mean Reversion',
  'Bollinger Squeeze Breakout',
  'RSI Divergence Reversal',
  'Multi-Timeframe Trend Alignment',
];

function qualityFor(rand: () => number, seedLabel: string): StrategyQuality {
  const components = [
    { label: 'Trend alignment', weight: 0.28, value: Math.round(45 + rand() * 55) },
    { label: 'Momentum quality', weight: 0.22, value: Math.round(40 + rand() * 60) },
    { label: 'Volume confirmation', weight: 0.18, value: Math.round(35 + rand() * 65) },
    { label: 'Volatility regime fit', weight: 0.16, value: Math.round(40 + rand() * 60) },
    { label: 'Risk geometry', weight: 0.16, value: Math.round(50 + rand() * 50) },
  ];
  const score = Math.round(components.reduce((s, c) => s + c.value * c.weight, 0));
  return {
    score,
    components,
    summary: `Composite strategy-quality score ${score}/100 for ${seedLabel}.`,
    disclaimer:
      'Strategy-quality score measures setup confluence on a 0–100 scale. It is NOT a win probability, forecast, or guarantee of outcome.',
  };
}

export function buildOpportunityReport(date: string, market: string): OpportunityReport {
  const rand = seededRandom(`report:${date}:${market}`);
  const dayIndex = Number(date.replace(/-/g, '')) || 20260101;
  // Deterministically empty reports so the NO QUALIFIED SETUPS state is reachable.
  const isEmpty = dayIndex % 3 === 1;

  const pool = INSTRUMENTS.filter(
    (i) =>
      (market === 'ALL' || i.market === market) &&
      ['INDIAN_EQUITIES', 'INDIAN_INDICES', 'INTERNATIONAL_EQUITIES', 'IN_CURRENCY_DERIVATIVES'].includes(i.market),
  ).slice(0, 24);

  const opportunities: Opportunity[] = pool
    .map((instrument, idx) => ({ instrument, r: rand(), idx }))
    .filter((x) => x.r > 0.72)
    .slice(0, 4)
    .map(({ instrument, r }, idx) => {
      const quote = buildQuote(instrument.id)!;
      const direction = r > 0.86 ? 'SHORT' : 'LONG';
      const entryTrigger =
        direction === 'LONG'
          ? 'Close above 20-period EMA with expanding volume and RSI holding above 50.'
          : 'Rejection from primary resistance with bearish MACD cross and volume expansion.';
      const stopPct = 1.2 + r * 1.6;
      const entry = quote.lastPrice;
      const stop = direction === 'LONG' ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100);
      const t1 = direction === 'LONG' ? entry * 1.018 : entry * 0.982;
      const t2 = direction === 'LONG' ? entry * 1.034 : entry * 0.966;
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(t2 - entry);
      return {
        id: `opp-${date}-${instrument.id}`,
        instrumentId: instrument.id,
        symbol: instrument.symbol,
        instrumentName: instrument.name,
        market: instrument.market,
        strategyName: STRATEGY_NAMES[idx % STRATEGY_NAMES.length],
        direction,
        signal: direction === 'LONG' ? 'BUY' : 'SELL',
        timeframe: (['15m', '1h', '4h', '1D'] as const)[idx % 4],
        lastPrice: entry,
        priceCurrency: instrument.currency,
        observedAt: quote.updatedAt,
        source: quote.source,
        entryTrigger,
        entryZone: { low: Math.round(entry * 0.997 * 1000) / 1000, high: Math.round(entry * 1.003 * 1000) / 1000 },
        stopLoss: Math.round(stop * 1000) / 1000,
        targets: [Math.round(t1 * 1000) / 1000, Math.round(t2 * 1000) / 1000],
        plannedRiskReward: Math.round((reward / risk) * 100) / 100,
        liquidity: r > 0.85 ? 'HIGH' : r > 0.6 ? 'MEDIUM' : 'LOW',
        spreadBps: Math.round((1.5 + r * 9) * 10) / 10,
        upcomingEvents: idx % 2 === 0 ? ['Central bank policy announcement'] : ['Quarterly earnings release'],
        technicalExplanation:
          'Multi-timeframe trend is coherent, momentum indicators are rising from neutral, and the last three sessions show above-average participation on the direction of the move. The setup fails if price closes back through the trigger level on expanding volume.',
        riskFactors: [
          'Event risk in the next 5 sessions could gap through the stop level.',
          'Correlation with the benchmark index elevates systematic drawdown risk.',
          'Liquidity thins outside the first and last hour of the session.',
        ],
        quality: qualityFor(rand, instrument.symbol),
        createdAt: new Date(date + 'T09:45:00+05:30').toISOString(),
      } satisfies Opportunity;
    });

  return {
    id: `report-${date}-${market}`,
    title: 'Daily Opportunity Report',
    date,
    market: market as OpportunityReport['market'],
    generatedAt: new Date(date + 'T17:30:00+05:30').toISOString(),
    source: { ...demoSource(), origin: 'QUANTORA RESEARCH ENGINE (DEMO)' },
    noQualifiedSetups: isEmpty || opportunities.length === 0,
    regimeSummary:
      'Regime model reads sideways-to-mildly-bullish with normalised volatility. Only setups clearing the 70/100 confluence threshold are published.',
    opportunities: isEmpty ? [] : opportunities,
    notes: [
      'All prices in this report are demonstration values with a DEMO source label.',
      'Strategy-quality score is a confluence metric, not a win probability.',
      'Position sizing must respect the risk limits configured in the Risk Management Center.',
    ],
  };
}

export function buildReportHistory(): ReportHistoryEntry[] {
  const markets: (OpportunityReport['market'])[] = ['ALL', 'INDIAN_EQUITIES', 'INTERNATIONAL_EQUITIES', 'INDIAN_INDICES'];
  return Array.from({ length: 14 }).map((_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - idx);
    const date = d.toISOString().slice(0, 10);
    const rand = seededRandom(`hist:${date}`);
    const empty = Number(date.replace(/-/g, '')) % 3 === 1;
    return {
      id: `hist-${date}`,
      date,
      title: 'Daily Opportunity Report',
      market: markets[idx % markets.length],
      opportunityCount: empty ? 0 : Math.round(1 + rand() * 4),
      noQualifiedSetups: empty,
      generatedAt: new Date(date + 'T17:30:00+05:30').toISOString(),
    };
  });
}

export function buildAiExplanation(opportunityId: string): AiExplanation {
  const rand = seededRandom(`ai:${opportunityId}`);
  const passes = rand() > 0.35;
  const reasons = [
    { label: 'Trend alignment across 15m/1h/1D', detail: 'Higher-timeframe slope agrees with the trade direction.', weight: 28 },
    { label: 'Momentum confirmation', detail: 'RSI and MACD both support continuation rather than exhaustion.', weight: 22 },
    { label: 'Volume participation', detail: 'Volume on trigger bars exceeds the 20-period average.', weight: 18 },
    { label: 'Volatility regime fit', detail: 'Realised volatility supports the planned stop distance.', weight: 16 },
    { label: 'Risk geometry', detail: 'Planned reward exceeds planned risk by more than 1.5R.', weight: 16 },
  ].map((r) => ({ ...r, passed: passes ? true : rand() > 0.5 }));

  const failed = reasons.filter((r) => !r.passed).map((r) => r.label);
  const score = Math.round(reasons.reduce((s, r) => s + (r.passed ? r.weight : 0), 0) + rand() * 8);

  return {
    opportunityId,
    qualifies: passes,
    headline: passes
      ? 'Setup qualifies: confluence clears the publication threshold.'
      : 'Setup fails: one or more mandatory confluence gates are not satisfied.',
    reasons,
    failedConditions: failed,
    quality: {
      score,
      components: reasons.map((r) => ({ label: r.label, weight: r.weight / 100, value: r.passed ? Math.round(70 + rand() * 30) : Math.round(20 + rand() * 35) })),
      summary: `Confluence score ${score}/100 across five weighted gates.`,
      disclaimer:
        'Strategy-quality score is a transparent confluence measure (0–100). It is NOT a win probability and carries no forecast of future performance.',
    },
  };
}
