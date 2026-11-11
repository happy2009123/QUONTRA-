import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info, X } from 'lucide-react';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  PageHeader,
  SearchInput,
  Select,
  SkeletonTable,
} from '@/components/ui';
import type { Column, SelectOption, Tone } from '@/components/ui';
import { MARKET_LABELS } from '@/data/universe';
import { TIMEFRAMES } from '@/models';
import type {
  Instrument,
  LiquidityFilterId,
  MarketCategory,
  MarketFilterId,
  Quote,
  SignalAction,
  Timeframe,
  TrendDirection,
  VolatilityFilterId,
} from '@/models';
import { formatPercent, formatPrice, formatSigned, formatTimestamp } from '@/lib/format';
import { seededRandom } from '@/lib/rng';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/* Deterministic demonstration strategy evaluator (never live signals) */
/* ------------------------------------------------------------------ */

type VolatilityBucket = Exclude<VolatilityFilterId, 'ALL'>;
type LiquidityBucket = Exclude<LiquidityFilterId, 'ALL'>;

interface DemoEvaluation {
  trend: TrendDirection;
  strategyScore: number;
  signal: SignalAction;
  volatility: VolatilityBucket;
  liquidity: LiquidityBucket;
  opportunity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Seeded per instrument + timeframe so every reload shows the same demo
 * confluence metrics. Strategy score (0–100) is a confluence metric, not a
 * win probability; signals are demonstration only.
 */
function evaluateDemoStrategy(
  instrumentId: string,
  timeframe: Timeframe,
  changePercent: number,
): DemoEvaluation {
  const rand = seededRandom(instrumentId + timeframe);

  const trendRoll = rand();
  const trend: TrendDirection = trendRoll < 0.42 ? 'UP' : trendRoll < 0.74 ? 'DOWN' : 'SIDEWAYS';

  const strategyScore = Math.round(rand() * 100);

  let signal: SignalAction = 'NO_TRADE';
  if (trend === 'UP' && strategyScore >= 62) signal = 'BUY';
  else if (trend === 'DOWN' && strategyScore >= 62) signal = 'SELL';
  else if (strategyScore >= 42) signal = 'WATCH';

  const volRoll = rand();
  const volatility: VolatilityBucket =
    volRoll < 0.24 ? 'LOW' : volRoll < 0.62 ? 'NORMAL' : volRoll < 0.9 ? 'ELEVATED' : 'EXTREME';

  const liqRoll = rand();
  const liquidity: LiquidityBucket = liqRoll < 0.42 ? 'HIGH' : liqRoll < 0.78 ? 'MEDIUM' : 'LOW';

  const drift = trend === 'UP' ? 8 : trend === 'DOWN' ? -8 : 0;
  const opportunity = clamp(Math.round(strategyScore + drift + changePercent * 1.5), 0, 100);

  return { trend, strategyScore, signal, volatility, liquidity, opportunity };
}

/* ------------------------------------------------------------------ */
/* View model + table columns                                          */
/* ------------------------------------------------------------------ */

interface ScanRow {
  instrument: Instrument;
  quote: Quote;
  timeframe: Timeframe;
  demo: DemoEvaluation;
}

const SIGNAL_TONE: Record<SignalAction, Tone> = {
  BUY: 'positive',
  SELL: 'negative',
  WATCH: 'info',
  NO_TRADE: 'muted',
};

const TREND_TONE: Record<TrendDirection, Tone> = {
  UP: 'positive',
  DOWN: 'negative',
  SIDEWAYS: 'neutral',
};

const TREND_LABEL: Record<TrendDirection, string> = {
  UP: 'Up',
  DOWN: 'Down',
  SIDEWAYS: 'Sideways',
};

const TREND_RANK: Record<TrendDirection, number> = { UP: 2, SIDEWAYS: 1, DOWN: 0 };
const SIGNAL_RANK: Record<SignalAction, number> = { BUY: 3, SELL: 2, WATCH: 1, NO_TRADE: 0 };

function scoreBarClass(score: number): string {
  if (score >= 70) return 'bg-pos';
  if (score >= 40) return 'bg-warn';
  return 'bg-neg';
}

const DEMO_TAG =
  'text-[9px] font-semibold uppercase tracking-[0.06em] text-gold-2/80';

const columns: Column<ScanRow>[] = [
  {
    key: 'instrument',
    header: 'Instrument',
    width: '190px',
    sortable: true,
    sortValue: (row) => row.instrument.symbol,
    cell: (row) => (
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-fg">{row.instrument.symbol}</span>
          {row.instrument.restriction && (
            <Badge tone="warning" title={row.instrument.restriction.summary}>
              Ref
            </Badge>
          )}
        </span>
        <span className="truncate text-[11px] text-mut">{row.instrument.name}</span>
      </div>
    ),
  },
  {
    key: 'market',
    header: 'Market',
    width: '170px',
    sortable: true,
    sortValue: (row) => MARKET_LABELS[row.instrument.market],
    cell: (row) => (
      <span className="block whitespace-nowrap">
        <span className="block text-[12px] text-fg">{MARKET_LABELS[row.instrument.market]}</span>
        <span className="block text-[10.5px] text-mut-2">{row.instrument.exchange}</span>
      </span>
    ),
  },
  {
    key: 'price',
    header: 'Last Price',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.quote.lastPrice,
    cell: (row) => (
      <span className="num font-medium">{formatPrice(row.quote.lastPrice, row.instrument.currency)}</span>
    ),
  },
  {
    key: 'change',
    header: 'Change',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.quote.changePercent,
    cell: (row) => {
      const pct = row.quote.changePercent;
      const tone = pct > 0 ? 'text-pos' : pct < 0 ? 'text-neg' : 'text-mut';
      const subTone = pct > 0 ? 'text-pos/75' : pct < 0 ? 'text-neg/75' : 'text-mut-2';
      return (
        <span className="block">
          <span className={cn('num block font-medium', tone)}>{formatPercent(pct)}</span>
          <span className={cn('num block text-[10.5px]', subTone)}>{formatSigned(row.quote.change)}</span>
        </span>
      );
    },
  },
  {
    key: 'trend',
    header: 'Trend',
    align: 'center',
    sortable: true,
    sortValue: (row) => TREND_RANK[row.demo.trend],
    cell: (row) => (
      <Badge tone={TREND_TONE[row.demo.trend]} dot>
        {TREND_LABEL[row.demo.trend]}
      </Badge>
    ),
  },
  {
    key: 'strategy',
    header: 'Strategy Score',
    align: 'right',
    width: '170px',
    sortable: true,
    sortValue: (row) => row.demo.strategyScore,
    cell: (row) => {
      const score = row.demo.strategyScore;
      return (
        <span className="flex items-center justify-end gap-2">
          <span className="h-1 w-14 overflow-hidden rounded-full bg-[#1a2029]" aria-hidden>
            <span
              className={cn('block h-full rounded-full', scoreBarClass(score))}
              style={{ width: `${score}%` }}
            />
          </span>
          <span className="num w-5 text-right font-semibold">{score}</span>
          <span className={DEMO_TAG} title="Demo confluence metric — not a win probability">
            DEMO
          </span>
        </span>
      );
    },
  },
  {
    key: 'signal',
    header: 'Signal',
    align: 'center',
    width: '130px',
    sortable: true,
    sortValue: (row) => SIGNAL_RANK[row.demo.signal],
    cell: (row) => (
      <span className="flex items-center justify-center gap-1.5">
        <Badge tone={SIGNAL_TONE[row.demo.signal]} dot>
          {row.demo.signal.replace('_', ' ')}
        </Badge>
        <span className={DEMO_TAG}>DEMO</span>
      </span>
    ),
  },
  {
    key: 'timeframe',
    header: 'Timeframe',
    width: '90px',
    cell: (row) => <span className="num text-mut">{row.timeframe}</span>,
  },
  {
    key: 'updated',
    header: 'Updated',
    sortable: true,
    sortValue: (row) => row.quote.updatedAt,
    cell: (row) => <span className="num text-[11.5px] text-mut">{formatTimestamp(row.quote.updatedAt)}</span>,
  },
];

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

type SortKey = 'opportunity' | 'change' | 'symbol' | 'price' | 'strategy';

interface Filters {
  search: string;
  market: MarketFilterId;
  sector: string;
  timeframe: Timeframe;
  signal: SignalAction | 'ALL';
  minScore: number;
  volatility: VolatilityFilterId;
  liquidity: LiquidityFilterId;
}

const DEFAULT_FILTERS: Filters = {
  search: '',
  market: 'ALL',
  sector: 'ALL',
  timeframe: '1D',
  signal: 'ALL',
  minScore: 0,
  volatility: 'ALL',
  liquidity: 'ALL',
};

const MARKET_OPTIONS: SelectOption<MarketFilterId>[] = [
  { value: 'ALL', label: 'All markets' },
  ...(Object.keys(MARKET_LABELS) as MarketCategory[]).map((market) => ({
    value: market,
    label: MARKET_LABELS[market],
  })),
];

const TIMEFRAME_OPTIONS: SelectOption<Timeframe>[] = TIMEFRAMES.map((tf) => ({
  value: tf,
  label: tf,
}));

const SIGNAL_OPTIONS: SelectOption<SignalAction | 'ALL'>[] = [
  { value: 'ALL', label: 'All signals' },
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
  { value: 'WATCH', label: 'Watch' },
  { value: 'NO_TRADE', label: 'No trade' },
];

const VOLATILITY_OPTIONS: SelectOption<VolatilityFilterId>[] = [
  { value: 'ALL', label: 'All volatility' },
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'ELEVATED', label: 'Elevated' },
  { value: 'EXTREME', label: 'Extreme' },
];

const LIQUIDITY_OPTIONS: SelectOption<LiquidityFilterId>[] = [
  { value: 'ALL', label: 'All liquidity' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const SORT_OPTIONS: SelectOption<SortKey>[] = [
  { value: 'opportunity', label: 'Opportunity score' },
  { value: 'change', label: 'Change %' },
  { value: 'symbol', label: 'Symbol' },
  { value: 'price', label: 'Price' },
  { value: 'strategy', label: 'Strategy score' },
];

const INITIAL_SORT: Record<SortKey, { key: string; direction: 'asc' | 'desc' } | undefined> = {
  opportunity: undefined,
  change: { key: 'change', direction: 'desc' },
  symbol: { key: 'instrument', direction: 'asc' },
  price: { key: 'price', direction: 'desc' },
  strategy: { key: 'strategy', direction: 'desc' },
};

function sortRows(rows: ScanRow[], sort: SortKey): ScanRow[] {
  const out = [...rows];
  switch (sort) {
    case 'change':
      out.sort((a, b) => b.quote.changePercent - a.quote.changePercent);
      break;
    case 'symbol':
      out.sort((a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol));
      break;
    case 'price':
      out.sort((a, b) => b.quote.lastPrice - a.quote.lastPrice);
      break;
    case 'strategy':
      out.sort((a, b) => b.demo.strategyScore - a.demo.strategyScore);
      break;
    default:
      out.sort((a, b) => b.demo.opportunity - a.demo.opportunity);
  }
  return out;
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface ActiveChip {
  id: string;
  label: string;
  clear: () => void;
}

/* ------------------------------------------------------------------ */
/* Mobile result cards                                                 */
/* ------------------------------------------------------------------ */

function ScannerCardList({ rows, onOpen }: { rows: ScanRow[]; onOpen: (row: ScanRow) => void }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const { instrument, quote, demo, timeframe } = row;
        const pct = quote.changePercent;
        const tone = pct > 0 ? 'text-pos' : pct < 0 ? 'text-neg' : 'text-mut';
        return (
          <li key={instrument.id}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="panel w-full min-w-0 p-3 text-left transition-colors hover:border-[#333c49] focus-visible:outline-2 focus-visible:outline-gold/70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-fg">{instrument.symbol}</span>
                    <Badge tone="gold">{MARKET_LABELS[instrument.market]}</Badge>
                  </div>
                  <span className="mt-0.5 block truncate text-[11.5px] text-mut">
                    {instrument.name}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num font-semibold text-fg">
                    {formatPrice(quote.lastPrice, instrument.currency)}
                  </div>
                  <div className={cn('num text-[12px] font-medium', tone)}>
                    {formatPercent(pct)}{' '}
                    <span className="text-[10.5px] font-normal">{formatSigned(quote.change)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Badge tone={TREND_TONE[demo.trend]} dot>
                  {TREND_LABEL[demo.trend]}
                </Badge>

                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-12 overflow-hidden rounded-full bg-[#1a2029]" aria-hidden>
                    <span
                      className={cn('block h-full rounded-full', scoreBarClass(demo.strategyScore))}
                      style={{ width: `${demo.strategyScore}%` }}
                    />
                  </span>
                  <span className="num text-[12px] font-semibold">{demo.strategyScore}</span>
                  <span className={DEMO_TAG}>DEMO</span>
                </span>

                <span className="flex items-center gap-1.5">
                  <Badge tone={SIGNAL_TONE[demo.signal]} dot>
                    {demo.signal.replace('_', ' ')}
                  </Badge>
                  <span className={DEMO_TAG}>DEMO</span>
                </span>

                <span className="num ml-auto text-[11px] text-mut">
                  {timeframe} · {formatTimestamp(quote.updatedAt)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Scanner() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>('opportunity');

  const patch = (partial: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...partial }));
  const debouncedSearch = useDebounced(filters.search);

  const { data: universe, loading: universeLoading, error: universeError, reload: reloadUniverse } =
    useAsync(() => api.market.listInstruments({}), []);

  const {
    data: instruments,
    loading: instrumentsLoading,
    error: instrumentsError,
    reload: reloadInstruments,
  } = useAsync(
    () =>
      api.market.listInstruments({
        search: debouncedSearch || undefined,
        market: filters.market,
        sector: filters.sector,
      }),
    [debouncedSearch, filters.market, filters.sector],
  );

  const { data: quotes, loading: quotesLoading, error: quotesError, reload: reloadQuotes } = useAsync(
    () => api.market.getQuotes(),
    [],
  );

  const loading = instrumentsLoading || quotesLoading;
  const error = instrumentsError || quotesError || universeError;
  const retry = () => {
    reloadInstruments();
    reloadQuotes();
    reloadUniverse();
  };

  const sectorOptions = useMemo<SelectOption<string>[]>(() => {
    const sectors = new Set<string>();
    for (const instrument of universe ?? []) {
      if (instrument.sector) sectors.add(instrument.sector);
    }
    return [
      { value: 'ALL', label: 'All sectors' },
      ...[...sectors].sort().map((sector) => ({ value: sector, label: sector })),
    ];
  }, [universe]);

  const rows = useMemo<ScanRow[]>(() => {
    if (!instruments || !quotes) return [];
    const quoteById = new Map(quotes.map((q) => [q.id, q.quote]));
    const out: ScanRow[] = [];
    for (const instrument of instruments) {
      const quote = quoteById.get(instrument.id);
      if (!quote) continue;
      out.push({
        instrument,
        quote,
        timeframe: filters.timeframe,
        demo: evaluateDemoStrategy(instrument.id, filters.timeframe, quote.changePercent),
      });
    }
    return out;
  }, [instruments, quotes, filters.timeframe]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (filters.signal === 'ALL' || row.demo.signal === filters.signal) &&
          row.demo.strategyScore >= filters.minScore &&
          (filters.volatility === 'ALL' || row.demo.volatility === filters.volatility) &&
          (filters.liquidity === 'ALL' || row.demo.liquidity === filters.liquidity),
      ),
    [rows, filters.signal, filters.minScore, filters.volatility, filters.liquidity],
  );

  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  const activeChips = useMemo<ActiveChip[]>(() => {
    const chips: ActiveChip[] = [];
    if (filters.search) {
      chips.push({
        id: 'search',
        label: `Search “${filters.search}”`,
        clear: () => patch({ search: '' }),
      });
    }
    if (filters.market !== 'ALL') {
      chips.push({
        id: 'market',
        label: MARKET_LABELS[filters.market],
        clear: () => patch({ market: 'ALL' }),
      });
    }
    if (filters.sector !== 'ALL') {
      chips.push({ id: 'sector', label: filters.sector, clear: () => patch({ sector: 'ALL' }) });
    }
    if (filters.timeframe !== DEFAULT_FILTERS.timeframe) {
      chips.push({
        id: 'timeframe',
        label: `Timeframe ${filters.timeframe}`,
        clear: () => patch({ timeframe: DEFAULT_FILTERS.timeframe }),
      });
    }
    if (filters.signal !== 'ALL') {
      chips.push({
        id: 'signal',
        label: `Signal ${filters.signal.replace('_', ' ')}`,
        clear: () => patch({ signal: 'ALL' }),
      });
    }
    if (filters.minScore > 0) {
      chips.push({
        id: 'minScore',
        label: `Score ≥ ${filters.minScore}`,
        clear: () => patch({ minScore: 0 }),
      });
    }
    if (filters.volatility !== 'ALL') {
      chips.push({
        id: 'volatility',
        label: `Volatility ${filters.volatility}`,
        clear: () => patch({ volatility: 'ALL' }),
      });
    }
    if (filters.liquidity !== 'ALL') {
      chips.push({
        id: 'liquidity',
        label: `Liquidity ${filters.liquidity}`,
        clear: () => patch({ liquidity: 'ALL' }),
      });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const clearAll = () => setFilters({ ...DEFAULT_FILTERS });
  const openRow = (row: ScanRow) => navigate(`/charts?instrument=${row.instrument.id}`);

  const emptyAction = (
    <Button size="sm" variant="secondary" onClick={clearAll}>
      Clear filters
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="QUANTORA"
        title="Global Market Scanner"
        description="Scan supported instruments across markets with strategy-quality, volatility and liquidity filters."
      />

      <div
        role="note"
        className="flex items-start gap-3 rounded-[5px] border border-gold/40 bg-gold/[0.07] px-4 py-3"
      >
        <Info size={15} className="mt-0.5 shrink-0 text-gold-2" aria-hidden />
        <div className="min-w-0">
          <p className="text-[12.5px] leading-relaxed text-fg">
            Demonstration environment — signals and strategy scores are generated demo data, never
            live trading signals.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-mut">
            The strategy score (0–100) is a confluence metric, not a win probability. Trend, score
            and signal cells are tagged DEMO.
          </p>
        </div>
      </div>

      <section className="panel min-w-0 p-3" aria-label="Scanner filters">
        <div className="flex flex-wrap items-end gap-x-2.5 gap-y-2">
          <SearchInput
            className="w-full sm:w-56"
            value={filters.search}
            onChange={(value) => patch({ search: value })}
            placeholder="Symbol or name…"
            label="Search instruments"
          />
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-48"
            label="Market"
            value={filters.market}
            options={MARKET_OPTIONS}
            onChange={(value) => patch({ market: value })}
          />
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-44"
            label="Sector"
            value={filters.sector}
            options={sectorOptions}
            onChange={(value) => patch({ sector: value })}
            disabled={universeLoading || universeError !== null}
          />
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-28"
            label="Timeframe"
            value={filters.timeframe}
            options={TIMEFRAME_OPTIONS}
            onChange={(value) => patch({ timeframe: value })}
          />
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-32"
            label="Signal"
            value={filters.signal}
            options={SIGNAL_OPTIONS}
            onChange={(value) => patch({ signal: value })}
          />
          <div className="flex w-[calc(50%-0.3125rem)] min-w-0 flex-col gap-1 sm:w-44">
            <label
              htmlFor="scanner-min-score"
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-mut"
            >
              Score ≥ <span className="num text-gold-2">{filters.minScore}</span>
            </label>
            <input
              id="scanner-min-score"
              type="range"
              min={0}
              max={100}
              step={1}
              value={filters.minScore}
              onChange={(event) => patch({ minScore: Number(event.target.value) })}
              className="h-8 w-full cursor-pointer accent-[#C6A15B] focus-visible:outline-2 focus-visible:outline-gold/70"
            />
          </div>
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-36"
            label="Volatility"
            value={filters.volatility}
            options={VOLATILITY_OPTIONS}
            onChange={(value) => patch({ volatility: value })}
          />
          <Select
            className="w-[calc(50%-0.3125rem)] sm:w-32"
            label="Liquidity"
            value={filters.liquidity}
            options={LIQUIDITY_OPTIONS}
            onChange={(value) => patch({ liquidity: value })}
          />
          <Select
            className="w-full sm:w-44"
            label="Sort by"
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
          />
        </div>

        {activeChips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line-soft pt-3">
            <span className="section-title mr-1">Active</span>
            {activeChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={chip.clear}
                className="inline-flex items-center gap-1.5 rounded-[3px] border border-line bg-panel px-2 py-1 text-[11px] text-mut transition-colors hover:border-[#333c49] hover:text-fg focus-visible:outline-2 focus-visible:outline-gold/70"
              >
                {chip.label}
                <X size={11} aria-hidden />
                <span className="sr-only">Clear this filter</span>
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}
      </section>

      <section className="panel min-w-0 overflow-hidden" aria-label="Scanner results">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0 text-[12px] text-mut" role="status" aria-live="polite">
            {loading ? (
              <span>Loading results…</span>
            ) : error ? (
              <span>Results unavailable</span>
            ) : (
              <>
                <span className="num font-semibold text-fg">{sorted.length}</span> of{' '}
                <span className="num">{instruments?.length ?? 0}</span> instruments match · demo
                signals only
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="gold">Demo</Badge>
            <InfoHint text="Strategy score (0–100) is a confluence metric, not a win probability. Signals are deterministic demonstration data generated per instrument and timeframe." />
          </div>
        </header>

        {error ? (
          <ErrorState
            title="Unable to load scanner results"
            message={error}
            onRetry={retry}
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <DataTable
                key={sort}
                columns={columns}
                rows={sorted}
                rowKey={(row) => row.instrument.id}
                caption="Global market scanner results with demo strategy signals"
                loading={loading}
                emptyTitle="No instruments match these filters"
                emptyDescription="Widen the market, sector or signal filters, or lower the minimum strategy score."
                emptyAction={emptyAction}
                onRowClick={openRow}
                initialSort={INITIAL_SORT[sort]}
              />
            </div>
            <div className="lg:hidden">
              {loading ? (
                <SkeletonTable rows={6} cols={3} />
              ) : sorted.length === 0 ? (
                <EmptyState
                  title="No instruments match these filters"
                  description="Widen the market, sector or signal filters, or lower the minimum strategy score."
                  action={emptyAction}
                />
              ) : (
                <div className="p-3">
                  <ScannerCardList rows={sorted} onOpen={openRow} />
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
