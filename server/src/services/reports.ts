/**
 * Report generation service.
 *
 * Builds a daily opportunity report from persisted opportunities for a given
 * date/market, or records an explicit "no qualified setups" report when the
 * qualification threshold was not met. Reports are stored and served with
 * their source and generation timestamp.
 */

import type { Db } from '../db/db.ts';
import { getInstrument, listInstruments } from '../db/repoReference.ts';
import { listOpportunities, upsertDailyReport, listDailyReports, getDailyReport, type OpportunityRow } from '../db/repoResearch.ts';
import { AppError } from '../lib/errors.ts';

export interface ReportOpportunity {
  id: string;
  instrumentId: string;
  symbol: string;
  instrumentName: string;
  market: string;
  strategyName: string;
  direction: 'LONG' | 'SHORT';
  signal: string;
  timeframe: string;
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
  createdAt: string;
}

export interface DailyReport {
  id: string;
  title: string;
  date: string;
  market: string;
  generatedAt: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  noQualifiedSetups: boolean;
  regimeSummary: string;
  opportunities: ReportOpportunity[];
  notes: string[];
}

const QUALIFICATION_THRESHOLD = 60;
const SCORE_DISCLAIMER =
  'Strategy-quality score is a 0-100 confluence measure. It is NOT a win probability, expected return or guarantee.';

function toReportOpportunity(db: Db, row: OpportunityRow): ReportOpportunity {
  const instrument = getInstrument(db, row.instrument_id);
  const source = JSON.parse(row.source_json) as { provider: string; isDemo: boolean; observedAt: string; reliability?: string };
  const riskFactors = JSON.parse(row.risk_factors_json) as string[];
  const qualityJson = JSON.parse(row.quality_json) as { score: number; breakdown?: Record<string, number> };
  const breakdown = qualityJson.breakdown ?? {};

  const components = [
    { label: 'Trend', weight: 30, value: breakdown.trend ?? 0 },
    { label: 'Momentum', weight: 20, value: breakdown.momentum ?? 0 },
    { label: 'Volume', weight: 15, value: breakdown.volume ?? 0 },
    { label: 'Volatility', weight: 10, value: breakdown.volatility ?? 0 },
    { label: 'Structure', weight: 25, value: breakdown.structure ?? 0 },
  ];

  return {
    id: row.id,
    instrumentId: row.instrument_id,
    symbol: instrument?.symbol ?? row.instrument_id,
    instrumentName: instrument?.name ?? row.instrument_id,
    market: instrument?.market_category ?? 'OTHER',
    strategyName: row.strategy_name,
    direction: row.direction === 'SHORT' ? 'SHORT' : 'LONG',
    signal: row.signal,
    timeframe: row.timeframe,
    lastPrice: row.last_price,
    priceCurrency: row.currency,
    observedAt: row.observed_at,
    source: {
      provider: source.provider,
      origin: source.isDemo ? 'SIMULATED' : 'MARKET_DATA',
      isDemo: source.isDemo,
      reliability: source.reliability ?? (source.isDemo ? 'PROVISIONAL' : 'VERIFIED'),
    },
    entryTrigger: row.entry_trigger,
    entryZone: { low: row.entry_zone_low, high: row.entry_zone_high },
    stopLoss: row.stop_loss,
    targets: [row.target1, row.target2],
    plannedRiskReward: row.planned_rr,
    liquidity: row.liquidity,
    spreadBps: row.spread_bps,
    upcomingEvents: [],
    technicalExplanation: row.technical_explanation,
    riskFactors,
    quality: {
      score: qualityJson.score,
      components,
      summary: `Confluence score ${qualityJson.score}/100 across five weighted components.`,
      disclaimer: SCORE_DISCLAIMER,
    },
    createdAt: row.created_at,
  };
}

function regimeSummary(opportunities: ReportOpportunity[]): string {
  if (opportunities.length === 0) return 'No qualifying setups — market conditions did not meet the configured confluence threshold.';
  const longs = opportunities.filter((o) => o.direction === 'LONG').length;
  const shorts = opportunities.length - longs;
  const bias = longs > shorts ? 'long-side' : shorts > longs ? 'short-side' : 'two-sided';
  const markets = [...new Set(opportunities.map((o) => o.market))];
  return `${opportunities.length} qualifying setup(s) with a ${bias} bias across ${markets.join(', ')}. Regime is derived from demonstration/delayed data and is reference only.`;
}

export interface GenerateReportOptions {
  date?: string;
  market?: string;
  /** Force regeneration even when a stored report exists. */
  force?: boolean;
}

/** Generates (or returns the stored) daily report for a date and market. */
export function generateDailyReport(db: Db, options: GenerateReportOptions = {}): DailyReport {
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const market = options.market ?? 'ALL';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError('VALIDATION_ERROR', 'date must be ISO yyyy-mm-dd');
  }

  const existing = getDailyReport(db, date, market);
  if (existing && !options.force) return hydrate(existing);

  const page = listOpportunities(db, {
    market: market === 'ALL' ? undefined : market,
    limit: 200,
  });

  const rows = page.items.filter((row) => row.created_at.slice(0, 10) === date && row.score >= QUALIFICATION_THRESHOLD);
  const opportunities = rows.map((row) => toReportOpportunity(db, row));
  const generatedAt = new Date().toISOString();
  const id = `rpt-${date}-${market}`.replace(/[^a-zA-Z0-9-]/g, '');
  const isDemo = opportunities.some((o) => o.source.isDemo) || opportunities.length === 0;

  const report: DailyReport = {
    id,
    title:
      opportunities.length > 0
        ? `QUANTORA Opportunity Report — ${date}`
        : `QUANTORA Opportunity Report — ${date} (No Qualified Setups)`,
    date,
    market,
    generatedAt,
    source: {
      provider: isDemo ? 'QUANTORA Demo Engine' : 'Market Data Aggregator',
      origin: isDemo ? 'SIMULATED' : 'AGGREGATED',
      isDemo,
      reliability: isDemo ? 'PROVISIONAL' : 'VERIFIED',
    },
    noQualifiedSetups: opportunities.length === 0,
    regimeSummary: regimeSummary(opportunities),
    opportunities,
    notes: [
      SCORE_DISCLAIMER,
      'All prices carry a freshness label and source stamp; demonstration values are marked DEMO.',
      'No orders are placed from this platform — it has no broker connectivity.',
    ],
  };

  upsertDailyReport(db, {
    id,
    report_date: date,
    market,
    title: report.title,
    payload_json: JSON.stringify(report),
    source_json: JSON.stringify(report.source),
    no_qualified_setups: report.noQualifiedSetups ? 1 : 0,
    generated_at: generatedAt,
  });

  return report;
}

function hydrate(row: {
  id: string;
  report_date: string;
  market: string;
  title: string;
  payload_json: string;
  source_json: string;
  no_qualified_setups: number;
  generated_at: string;
}): DailyReport {
  return JSON.parse(row.payload_json) as DailyReport;
}

export interface ReportHistoryEntry {
  id: string;
  date: string;
  title: string;
  market: string;
  opportunityCount: number;
  noQualifiedSetups: boolean;
  generatedAt: string;
}

export function listReportHistory(db: Db, limit = 30, offset = 0): { items: ReportHistoryEntry[]; total: number; limit: number; offset: number } {
  const page = listDailyReports(db, limit, offset);
  return {
    total: page.total,
    limit,
    offset,
    items: page.items.map((row) => {
      const payload = JSON.parse(row.payload_json) as DailyReport;
      return {
        id: row.id,
        date: row.report_date,
        title: row.title,
        market: row.market,
        opportunityCount: payload.opportunities.length,
        noQualifiedSetups: row.no_qualified_setups === 1,
        generatedAt: row.generated_at,
      };
    }),
  };
}

/** Ensures every active instrument appears in coverage listings used by the UI. */
export function instrumentCoverage(db: Db): Array<{ id: string; symbol: string; name: string }> {
  return listInstruments(db, { limit: 500 }).items.map((row) => ({ id: row.id, symbol: row.symbol, name: row.name }));
}
