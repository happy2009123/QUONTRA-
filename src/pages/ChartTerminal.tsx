import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import {
  Badge,
  Button,
  DataBadge,
  ErrorState,
  MarketStatusPill,
  PageHeader,
  PriceChange,
  SearchInput,
  Select,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import type { SelectOption } from '@/components/ui';
import { INDICATOR_GROUPS, PriceChart } from '@/components/charts/PriceChart';
import type { ChartStyle, IndicatorKey } from '@/components/charts/PriceChart';
import { INSTRUMENTS, INSTRUMENT_BY_ID, MARKET_LABELS } from '@/data/universe';
import { TIMEFRAME_SECONDS } from '@/data/marketData';
import { TIMEFRAMES } from '@/models';
import type { Timeframe } from '@/models';
import { adx, atr, ema, rsi } from '@/lib/indicators';
import { formatNumber, formatPrice } from '@/lib/format';
import { cn } from '@/lib/cn';

type DateRange = '1D' | '5W' | '3M' | '6M' | '1Y' | 'MAX';

const DEFAULT_INDICATORS: IndicatorKey[] = ['EMA_9', 'EMA_20', 'VOLUME'];

const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = TIMEFRAMES.map((tf) => ({
  value: tf,
  label: tf,
}));

const CHART_STYLE_OPTIONS: { value: ChartStyle; label: string; title: string }[] = [
  { value: 'CANDLES', label: 'Candles', title: 'Candlestick chart' },
  { value: 'LINE', label: 'Line', title: 'Line chart' },
  { value: 'AREA', label: 'Area', title: 'Area chart' },
  { value: 'BARS', label: 'Bars', title: 'Bar chart' },
];

const RANGE_OPTIONS: SelectOption<DateRange>[] = [
  { value: '1D', label: '1D' },
  { value: '5W', label: '5W' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'MAX', label: 'MAX' },
];

const RANGE_SECONDS: Record<DateRange, number> = {
  '1D': 86_400,
  '5W': 45 * 86_400,
  '3M': 91 * 86_400,
  '6M': 182 * 86_400,
  '1Y': 365 * 86_400,
  MAX: Number.POSITIVE_INFINITY,
};

interface Readout {
  key: IndicatorKey;
  label: string;
  kind: 'price' | 'oscillator';
  value: number | null;
}

export default function ChartTerminal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawInstrument = searchParams.get('instrument');
  const matched = rawInstrument ? INSTRUMENT_BY_ID[rawInstrument] : undefined;
  const instrument = matched ?? INSTRUMENT_BY_ID['idx-nifty50'];
  const activeId = instrument.id;

  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [chartStyle, setChartStyle] = useState<ChartStyle>('CANDLES');
  const [range, setRange] = useState<DateRange>('MAX');
  const [indicators, setIndicators] = useState<IndicatorKey[]>(DEFAULT_INDICATORS);
  const [chartKey, setChartKey] = useState(0);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  const workspaceRef = useRef<HTMLDivElement>(null);
  const [cssMaximised, setCssMaximised] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled;

  // Normalise a malformed ?instrument= value back to the default series.
  useEffect(() => {
    if (rawInstrument && !INSTRUMENT_BY_ID[rawInstrument]) {
      const next = new URLSearchParams(searchParams);
      next.set('instrument', 'idx-nifty50');
      setSearchParams(next, { replace: true });
    }
  }, [rawInstrument, searchParams, setSearchParams]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!cssMaximised) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCssMaximised(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cssMaximised]);

  const selectInstrument = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('instrument', id);
    setSearchParams(next, { replace: true });
    setPickerOpen(false);
    setPickerQuery('');
  };

  const closePicker = () => {
    setPickerOpen(false);
    setPickerQuery('');
  };

  const toggleFullscreen = () => {
    if (fullscreenSupported) {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else if (workspaceRef.current) {
        void workspaceRef.current.requestFullscreen().catch(() => setCssMaximised(true));
      }
    } else {
      setCssMaximised((prev) => !prev);
    }
  };

  const expanded = isFullscreen || cssMaximised;

  const {
    data: quoteRows,
    loading: quoteLoading,
    error: quoteError,
    reload: reloadQuote,
  } = useAsync(() => api.market.getQuotes([activeId]), [activeId]);
  const quote = quoteRows?.[0]?.quote ?? null;

  const {
    data: candleData,
    loading: candlesLoading,
    error: candlesError,
    reload: reloadCandles,
  } = useAsync(() => api.market.getCandles(activeId, timeframe, 400), [activeId, timeframe]);
  const candles = candleData?.candles ?? [];
  const meta = candleData?.meta ?? null;

  const sliced = useMemo(() => {
    if (range === 'MAX') return candles;
    const step = TIMEFRAME_SECONDS[timeframe];
    const needed = Math.ceil(RANGE_SECONDS[range] / step);
    const count = Math.min(candles.length, Math.max(2, needed));
    return candles.slice(Math.max(0, candles.length - count));
  }, [candles, range, timeframe]);

  const toggleIndicator = (key: IndicatorKey) => {
    setIndicators((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const pickerResults = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    const source = query
      ? INSTRUMENTS.filter(
          (item) =>
            item.symbol.toLowerCase().includes(query) ||
            item.name.toLowerCase().includes(query) ||
            item.exchange.toLowerCase().includes(query),
        )
      : INSTRUMENTS;
    return source.slice(0, 40);
  }, [pickerQuery]);

  const readouts = useMemo<Readout[]>(() => {
    if (sliced.length === 0) return [];
    const closes = sliced.map((c) => c.close);
    const last = sliced.length - 1;
    const out: Readout[] = [];
    if (indicators.includes('RSI')) {
      out.push({ key: 'RSI', label: 'RSI 14', kind: 'oscillator', value: rsi(closes, 14)[last] ?? null });
    }
    if (indicators.includes('ATR')) {
      out.push({ key: 'ATR', label: 'ATR 14', kind: 'price', value: atr(sliced, 14)[last] ?? null });
    }
    if (indicators.includes('ADX')) {
      out.push({ key: 'ADX', label: 'ADX 14', kind: 'oscillator', value: adx(sliced, 14)[last] ?? null });
    }
    if (indicators.includes('EMA_9')) {
      out.push({ key: 'EMA_9', label: 'EMA 9', kind: 'price', value: ema(closes, 9)[last] ?? null });
    }
    if (indicators.includes('EMA_20')) {
      out.push({ key: 'EMA_20', label: 'EMA 20', kind: 'price', value: ema(closes, 20)[last] ?? null });
    }
    return out;
  }, [sliced, indicators]);

  const activeIndicatorLabels = useMemo(
    () =>
      INDICATOR_GROUPS.flatMap((group) => group.keys).filter((item) =>
        indicators.includes(item.key),
      ),
    [indicators],
  );

  const chartStyleLabel =
    CHART_STYLE_OPTIONS.find((option) => option.value === chartStyle)?.label ?? chartStyle;

  return (
    <div
      ref={workspaceRef}
      className={cn(
        'min-w-0 space-y-3 bg-ink',
        cssMaximised && 'fixed inset-0 z-[60] overflow-y-auto p-4',
      )}
    >
      <PageHeader
        eyebrow="QUANTORA"
        title="Charting Terminal"
        description="Multi-timeframe price charts with overlays, oscillators and a full-screen workspace. Series are labelled demonstration data."
      />

      {/* ---- Instrument, quote and provenance ---- */}
      <section className="panel flex min-w-0 flex-col gap-3 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div
            className="relative w-full min-w-0 sm:w-64"
            onFocus={() => setPickerOpen(true)}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (!(next instanceof Node) || !event.currentTarget.contains(next)) closePicker();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closePicker();
            }}
          >
            <SearchInput
              value={pickerQuery}
              onChange={(value) => {
                setPickerQuery(value);
                setPickerOpen(true);
              }}
              placeholder="Search instrument…"
              label="Instrument"
            />
            <div className="pointer-events-none absolute left-0 right-0 top-full mt-1">
              {pickerOpen && (
                <ul
                  role="listbox"
                  aria-label="Instrument results"
                  className="pointer-events-auto max-h-56 w-full overflow-y-auto rounded-[4px] border border-line bg-panel py-1 shadow-2xl"
                >
                  {pickerResults.length === 0 && (
                    <li role="presentation" className="px-2.5 py-2 text-[12px] text-mut">
                      No instruments match.
                    </li>
                  )}
                  {pickerResults.map((item) => {
                    const selected = item.id === activeId;
                    return (
                      <li key={item.id} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectInstrument(item.id)}
                          className={cn(
                            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[#1a2029]',
                            'focus-visible:outline-2 focus-visible:outline-gold/70',
                            selected && 'bg-gold/10',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-fg">
                              {item.symbol}
                            </span>
                            <span className="block truncate text-[10.5px] text-mut">{item.name}</span>
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-mut-2">
                            {item.exchange}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold leading-tight text-fg">
                {instrument.symbol}
              </span>
              <Badge tone="gold">{MARKET_LABELS[instrument.market]}</Badge>
              {instrument.restriction && (
                <Badge tone="warning" title={instrument.restriction.summary}>
                  Reference only
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11.5px] text-mut">
              {instrument.name} · {instrument.exchange} · {instrument.currency}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
          {quoteLoading ? (
            <Skeleton className="h-12 w-44" />
          ) : quoteError ? (
            <div className="flex items-center gap-2 text-[12px] text-neg">
              Quote unavailable
              <Button size="sm" variant="ghost" onClick={reloadQuote}>
                Retry
              </Button>
            </div>
          ) : quote ? (
            <>
              <div className="min-w-0">
                <p className="section-title mb-0.5">Last price</p>
                <PriceChange
                  value={quote.lastPrice}
                  change={quote.change}
                  changePercent={quote.changePercent}
                  currency={instrument.currency}
                  size="md"
                />
              </div>
              <div className="min-w-0">
                <p className="section-title mb-0.5">Session</p>
                <div className="flex items-center gap-2 pt-0.5">
                  <MarketStatusPill status={quote.marketStatus} />
                  <span className="num text-[11.5px] text-mut">
                    {formatPrice(quote.high, instrument.currency)} /{' '}
                    {formatPrice(quote.low, instrument.currency)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[12px] text-mut">No quote for this instrument.</p>
          )}

          <div className="min-w-0">
            <p className="section-title mb-0.5">Series</p>
            {candlesLoading ? (
              <Skeleton className="h-4 w-44" />
            ) : meta ? (
              <DataBadge freshness={meta.freshness} source={meta.source} updatedAt={meta.updatedAt} />
            ) : (
              <span className="text-[11.5px] text-mut">No series loaded.</span>
            )}
          </div>
        </div>
      </section>

      {/* ---- Controls ---- */}
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="w-full min-w-0 overflow-x-auto sm:w-auto">
          <SegmentedControl
            label="Timeframe"
            value={timeframe}
            onChange={setTimeframe}
            options={TIMEFRAME_OPTIONS}
          />
        </div>
        <SegmentedControl
          label="Chart style"
          value={chartStyle}
          onChange={setChartStyle}
          options={CHART_STYLE_OPTIONS}
        />
        <Select
          className="w-28"
          label="Date range"
          value={range}
          options={RANGE_OPTIONS}
          onChange={setRange}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCcw size={13} />}
            onClick={() => setChartKey((prev) => prev + 1)}
          >
            Reset view
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            aria-pressed={expanded}
            onClick={toggleFullscreen}
          >
            {expanded ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {/* ---- Indicators ---- */}
      <section className="panel-subtle min-w-0 p-3" aria-label="Indicator settings">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {INDICATOR_GROUPS.map((group) => (
              <div key={group.title} className="min-w-0">
                <p className="section-title mb-1.5">{group.title}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {group.keys.map(({ key, label }) => {
                    const checked = indicators.includes(key);
                    return (
                      <label
                        key={key}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 text-[12px] transition-colors',
                          checked ? 'text-fg' : 'text-mut hover:text-fg',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIndicator(key)}
                          className="h-3.5 w-3.5 rounded-[3px] accent-[#C6A15B] focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Badge tone="gold">{indicators.length} active</Badge>
        </div>
      </section>

      {/* ---- Chart ---- */}
      <section
        className="panel flex min-w-0 flex-col overflow-hidden lg:h-[calc(100vh-210px)]"
        aria-label="Price chart"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold text-fg">{instrument.symbol}</span>
            <Badge tone="gold">{timeframe}</Badge>
            <span className="text-mut">
              {chartStyleLabel} · {range} · <span className="num">{sliced.length}</span> bars
            </span>
          </div>
          <span className="text-[11px] text-mut">
            Demonstration series — reference only, not executable prices.
          </span>
        </header>

        <div className="relative flex min-h-[420px] min-w-0 flex-1">
          {candlesLoading ? (
            <div
              className="flex w-full flex-col gap-3 p-4"
              role="status"
              aria-label="Loading candles"
            >
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="min-h-[300px] flex-1" />
              <span className="sr-only">Loading candles</span>
            </div>
          ) : candlesError ? (
            <ErrorState
              title="Unable to load candles"
              message={candlesError}
              onRetry={reloadCandles}
              className="w-full"
            />
          ) : (
            <PriceChart
              key={chartKey}
              candles={sliced}
              style={chartStyle}
              indicators={indicators}
              minHeight={420}
              className="h-full"
            />
          )}
        </div>
      </section>

      {/* ---- Indicator readout ---- */}
      <section
        className="panel-subtle flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5"
        aria-label="Indicator readout"
      >
        <span className="section-title">Readout</span>
        {readouts.length === 0 ? (
          <span className="text-[11.5px] text-mut">
            No readout indicators enabled — turn on RSI, ATR, ADX, EMA 9 or EMA 20 above.
          </span>
        ) : (
          readouts.map((item) => (
            <span key={item.key} className="text-[11.5px] text-mut">
              {item.label}{' '}
              <span
                className={cn(
                  'num font-semibold',
                  item.value == null ? 'text-mut-2' : 'text-fg',
                )}
              >
                {item.value == null
                  ? '—'
                  : item.kind === 'price'
                    ? formatPrice(item.value, instrument.currency)
                    : formatNumber(item.value, 2)}
              </span>
            </span>
          ))
        )}

        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="section-title">Active</span>
          {activeIndicatorLabels.length === 0 ? (
            <span className="text-[11.5px] text-mut">None</span>
          ) : (
            activeIndicatorLabels.map((item) => (
              <Badge key={item.key} tone="neutral">
                {item.label}
              </Badge>
            ))
          )}
        </span>
      </section>

      <p className="text-[11px] text-mut-2">
        All quotes and series on this page are demonstration data with a SIMULATED origin —
        reference only, never executable prices. Full-screen uses the Fullscreen API where the
        browser supports it, otherwise a maximised in-page layout (press Escape to exit).
      </p>
    </div>
  );
}
