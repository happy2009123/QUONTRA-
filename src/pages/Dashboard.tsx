import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  DataBadge,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  SegmentedControl,
  Skeleton,
  StatTile,
} from '@/components/ui';
import type { Tone } from '@/components/ui';
import { Heatmap } from '@/components/charts/Heatmap';
import { OverviewChart } from '@/components/charts/OverviewChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { DashboardQuotes } from '@/components/DashboardQuotes';
import { DashboardSideRail } from '@/components/DashboardSideRail';
import { WatchlistCard } from '@/components/WatchlistCard';
import { PriceTicker } from '@/components/PriceTicker';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { useToasts } from '@/state/ToastContext';
import type {
  EconomicEvent,
  InstrumentQuote,
  OpportunitySummary,
  SignalAction,
  VolatilityGauge,
} from '@/models';
import { buildCandles } from '@/data/marketData';
import { demoSource, INSTRUMENT_BY_ID } from '@/data/universe';
import { formatDateTime, formatPercent, formatPrice } from '@/lib/format';
import { cn } from '@/lib/cn';

const OVERVIEW_TFS = [
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
] as const;

type OverviewTf = (typeof OVERVIEW_TFS)[number]['value'];

const IMPACT_TONE: Record<EconomicEvent['impact'], Tone> = {
  HIGH: 'negative',
  MEDIUM: 'warning',
  LOW: 'muted',
};

const REGIME_TONE: Record<VolatilityGauge['regime'], Tone> = {
  LOW: 'info',
  NORMAL: 'neutral',
  ELEVATED: 'warning',
  EXTREME: 'negative',
};

const DIRECTION_TONE: Record<SignalAction, Tone> = {
  BUY: 'positive',
  SELL: 'negative',
  WATCH: 'info',
  NO_TRADE: 'muted',
};

export default function Dashboard() {
  const [pageLoadedAt] = useState(() => new Date().toISOString());

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Overview"
        title="Global Markets"
        description="Cross-asset snapshot of benchmark indices, session movers, volatility regimes and macro events. All values are demonstration data."
        meta={
          <>
            <DataBadge freshness="DEMO" source={demoSource()} updatedAt={pageLoadedAt} />
            <span className="text-[10.5px] text-mut-2">Reference overview · not a live feed</span>
          </>
        }
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DashboardQuotes />

          <PriceTicker />

          <WatchlistCard />

          <OverviewSection />
          <HeatmapSection />
          <MoversSection />

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <VolatilitySection />
            <EventsSection />
          </div>

          <OpportunitiesSection />
          <PaperPortfolioSection />
        </div>

        <OrderPlacementSection />
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <div className="col-span-2 text-right">
            <span className="text-[10px] text-mut-2">Simulated trading only</span>
          </div>
        </div>

        <DashboardSideRail />
      </div>
    </div>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <>
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading {label}
      </span>
    </>
  );
}

function OverviewSection() {
  const [timeframe, setTimeframe] = useState<OverviewTf>('1D');
  const { data, loading, error, fetchedAt, reload } = useAsync(
    () => api.market.getOverviewSeries(timeframe),
    [timeframe],
  );

  return (
    <Card
      title="Global market overview"
      subtitle="Normalised multi-instrument performance, indexed to 100"
      actions={
        <SegmentedControl
          options={OVERVIEW_TFS}
          value={timeframe}
          onChange={setTimeframe}
          label="Overview timeframe"
        />
      }
    >
      {loading && (
        <>
          <Skeleton className="h-[260px] w-full" />
          <span className="sr-only" role="status">
            Loading overview series
          </span>
        </>
      )}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState
          title="No series available"
          description="The overview model has not produced series for this timeframe yet."
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <>
          <OverviewChart series={data} />
          {fetchedAt && (
            <div className="mt-3 border-t border-line-soft pt-2">
              <DataBadge freshness={data[0].freshness} source={demoSource()} updatedAt={fetchedAt} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function HeatmapSection() {
  const navigate = useNavigate();
  const { data, loading, error, fetchedAt, reload } = useAsync(() => api.market.getHeatmap(), []);

  return (
    <Card
      title="Market heatmap"
      subtitle="Session change by instrument — select a cell to open the charting terminal"
      actions={
        fetchedAt ? (
          <DataBadge freshness="DEMO" source={demoSource()} updatedAt={fetchedAt} compact />
        ) : undefined
      }
    >
      {loading && (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8" aria-hidden>
          {Array.from({ length: 16 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] w-full" />
          ))}
        </div>
      )}
      {loading && (
        <span className="sr-only" role="status">
          Loading market heatmap
        </span>
      )}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState
          title="No heatmap cells"
          description="No instruments are available for the heatmap right now."
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <Heatmap
          cells={data}
          onSelect={(cell) => navigate(`/charts?instrument=${encodeURIComponent(cell.instrumentId)}`)}
        />
      )}
    </Card>
  );
}

function MoversSection() {
  const { data, loading, error, reload } = useAsync(() => api.market.getMovers(), []);

  const gainers = data?.gainers ?? [];
  const losers = data?.losers ?? [];

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <Card
        title="Top gainers"
        subtitle="Strongest session moves"
        actions={<Badge tone="gold">DEMO</Badge>}
      >
        {loading && <SectionLoading label="top gainers" />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && gainers.length === 0 && (
          <EmptyState title="No gainers" description="No advancing instruments in this session." />
        )}
        {!loading && !error && gainers.length > 0 && (
          <>
            <ul>
              {gainers.map((quote) => (
                <MoverRow key={quote.id} quote={quote} />
              ))}
            </ul>
            <div className="mt-3 border-t border-line-soft pt-2">
              <DataBadge
                freshness={gainers[0].quote.freshness}
                source={gainers[0].quote.source}
                updatedAt={gainers[0].quote.updatedAt}
              />
            </div>
          </>
        )}
      </Card>

      <Card
        title="Top losers"
        subtitle="Weakest session moves"
        actions={<Badge tone="gold">DEMO</Badge>}
      >
        {loading && <SectionLoading label="top losers" />}
        {!loading && error && <ErrorState message={error} onRetry={reload} />}
        {!loading && !error && losers.length === 0 && (
          <EmptyState title="No losers" description="No declining instruments in this session." />
        )}
        {!loading && !error && losers.length > 0 && (
          <>
            <ul>
              {losers.map((quote) => (
                <MoverRow key={quote.id} quote={quote} />
              ))}
            </ul>
            <div className="mt-3 border-t border-line-soft pt-2">
              <DataBadge
                freshness={losers[0].quote.freshness}
                source={losers[0].quote.source}
                updatedAt={losers[0].quote.updatedAt}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function MoverRow({ quote }: { quote: InstrumentQuote }) {
  const values = useMemo(
    () => buildCandles(quote.id, '1D', 30).map((c) => c.close),
    [quote.id],
  );
  const pct = quote.quote.changePercent;
  const positive = pct >= 0;

  return (
    <li className="border-b border-line-soft last:border-0">
      <Link
        to={`/charts?instrument=${encodeURIComponent(quote.id)}`}
        className="flex items-center gap-3 py-2 transition-colors hover:bg-[#1a2029]"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-fg">{quote.symbol}</p>
          <p className="num truncate text-[11px] text-mut">
            {formatPrice(quote.quote.lastPrice, quote.currency)}
          </p>
        </div>
        <Sparkline
          values={values}
          width={72}
          height={24}
          tone={positive ? 'positive' : 'negative'}
          className="shrink-0"
        />
        <span
          className={cn(
            'num w-16 shrink-0 text-right text-[12.5px] font-medium',
            positive ? 'text-pos' : 'text-neg',
          )}
        >
          {formatPercent(pct)}
        </span>
      </Link>
    </li>
  );
}

function VolatilitySection() {
  const { data, loading, error, fetchedAt, reload } = useAsync(() => api.market.getVolatility(), []);

  return (
    <Card title="Market volatility" subtitle="Realised volatility vs. own history">
      {loading && <SectionLoading label="volatility panel" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState title="No volatility readings" description="Volatility gauges are unavailable." />
      )}
      {!loading && !error && data && data.length > 0 && (
        <>
          <ul>
            {data.map((gauge) => (
              <li key={gauge.instrumentId} className="border-b border-line-soft py-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] text-fg">{gauge.symbol}</span>
                  <Badge tone={REGIME_TONE[gauge.regime]}>{gauge.regime}</Badge>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="num w-14 shrink-0 text-[11.5px] text-mut">
                    {gauge.volatility.toFixed(2)}%
                  </span>
                  <div
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#1a2029]"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-gold"
                      style={{ width: `${Math.min(100, Math.max(0, gauge.percentile))}%` }}
                    />
                  </div>
                  <span className="num w-10 shrink-0 text-right text-[10.5px] text-mut-2">
                    p{gauge.percentile}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {fetchedAt && (
            <div className="mt-3 border-t border-line-soft pt-2">
              <DataBadge freshness={data[0].freshness} source={demoSource()} updatedAt={fetchedAt} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function EventsSection() {
  const { data, loading, error, fetchedAt, reload } = useAsync(
    () => api.market.getEconomicEvents(),
    [],
  );

  return (
    <Card title="Upcoming economic events" subtitle="Macro calendar, scheduled releases">
      {loading && <SectionLoading label="economic events" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState
          title="No upcoming events"
          description="The calendar has no scheduled releases in this window."
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <>
          <ul>
            {data.map((event) => (
              <li key={event.id} className="border-b border-line-soft py-2 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium text-fg">{event.title}</p>
                    <p className="num truncate text-[11px] text-mut">
                      {event.country} · {formatDateTime(event.scheduledAt)}
                    </p>
                  </div>
                  <Badge tone={IMPACT_TONE[event.impact]}>{event.impact}</Badge>
                </div>
                <p className="mt-0.5 truncate text-[10.5px] text-mut-2">
                  Source: {event.source.origin}
                </p>
              </li>
            ))}
          </ul>
          {fetchedAt && (
            <div className="mt-3 border-t border-line-soft pt-2">
              <DataBadge freshness="DEMO" source={demoSource()} updatedAt={fetchedAt} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function OpportunitiesSection() {
  const navigate = useNavigate();
  const { data, loading, error, fetchedAt, reload } = useAsync(
    () => api.market.getRecentOpportunities(),
    [],
  );

  return (
    <Card
      title="Recently generated opportunities"
      subtitle="Strategy score (0–100) is a confluence metric, not a win probability"
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigate('/reports')}>
          View reports
        </Button>
      }
    >
      {loading && <SectionLoading label="recent opportunities" />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState
          title="No recent opportunities"
          description="No setups cleared the qualification threshold recently."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/reports')}>
              View reports
            </Button>
          }
        />
      )}
      {!loading && !error && data && data.length > 0 && (
        <>
          <ul>
            {data.map((opp) => (
              <OpportunityRow key={opp.id} opportunity={opp} />
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2">
            <span className="text-[10.5px] text-mut-2">Simulated research output</span>
            {fetchedAt && (
              <DataBadge freshness="DEMO" source={demoSource()} updatedAt={fetchedAt} compact />
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function OpportunityRow({ opportunity }: { opportunity: OpportunitySummary }) {
  return (
    <li className="border-b border-line-soft py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to={`/charts?instrument=${encodeURIComponent(opportunity.instrumentId)}`}
          className="num truncate text-[12.5px] font-medium text-fg hover:text-gold-2"
        >
          {opportunity.symbol}
        </Link>
        <Badge tone={DIRECTION_TONE[opportunity.direction]}>{opportunity.direction}</Badge>
        <span className="min-w-0 flex-1 truncate text-[12px] text-mut">
          {opportunity.strategyName}
        </span>
        <span className="num shrink-0 text-[12.5px] font-semibold text-fg">
          {opportunity.strategyScore}
          <span className="text-[10px] font-normal text-mut-2">/100</span>
        </span>
        <span className="num shrink-0 text-[11px] text-mut-2">{opportunity.timeframe}</span>
        <span className="num shrink-0 text-[11px] text-mut-2">
          {formatDateTime(opportunity.createdAt)}
        </span>
      </div>
    </li>
  );
}

function OrderPlacementSection() {
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LOSS' | 'TAKE_PROFIT'>('MARKET');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [instrumentId, setInstrumentId] = useState('eq-reliance');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { push } = useToasts();

  const instruments = [
    { value: 'eq-reliance', label: 'RELIANCE EQ' },
    { value: 'eq-tcs', label: 'TCS EQ' },
    { value: 'fx-usdinr', label: 'USD/INR' },
  ] as const;

  const orderTypeOptions = [
    { value: 'MARKET', label: 'Market' },
    { value: 'LIMIT', label: 'Limit' },
    { value: 'STOP', label: 'Stop' },
    { value: 'STOP_LOSS', label: 'Stop-loss' },
    { value: 'TAKE_PROFIT', label: 'Take-profit' },
  ] as const;

  const protective = orderType === 'STOP_LOSS' || orderType === 'TAKE_PROFIT';
  const needsPrice = orderType !== 'MARKET';

  const handleTypeChange = (t: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LOSS' | 'TAKE_PROFIT') => {
    setOrderType(t);
    if (t === 'STOP_LOSS' || t === 'TAKE_PROFIT') setDirection('SELL');
  };

  const handlePlaceOrder = async () => {
    setLoading(true);
    setFeedback(null);

    if (needsPrice && !(price > 0)) {
      setFeedback({ kind: 'error', text: `A positive ${orderType === 'LIMIT' ? 'limit' : 'trigger'} price is required` });
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/paper-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instrumentId,
          direction,
          orderType,
          quantity: Number(quantity),
          price: needsPrice ? Number(price) : undefined,
        }),
      });

      const payload = await response.json();

      if (response.ok && payload.data) {
        const order = payload.data;
        setQuantity(1);
        if (needsPrice) setPrice(0);
        // Refresh portfolio summary
        const portfolioResp = await fetch('/api/paper-portfolio');
        const portfolioPayload = await portfolioResp.json();
        const available = portfolioPayload.data?.available_capital;
        const priceLabel = order.price ? ` @ ₹${Number(order.price).toLocaleString()}` : '';
        const restingNote = order.status === 'PENDING' ? ` (${order.orderType} resting)` : '';
        setFeedback({
          kind: 'success',
          text: `Order ${order.status}: ${order.direction} ${order.quantity}${priceLabel}${restingNote}. Available: ₹${Number(available ?? 0).toLocaleString()}`,
        });
        push({
          tone: 'success',
          title: `Order ${order.status}`,
          message: `${order.direction} ${order.quantity}${priceLabel}${restingNote}`,
        });
        setTimeout(() => setFeedback(null), 5000);
        window.dispatchEvent(new Event('paper-updated'));
      } else {
        const message = payload.error?.message ?? 'Failed to place order';
        setFeedback({ kind: 'error', text: message });
        push({ tone: 'error', title: 'Order failed', message });
      }
    } catch {
      setFeedback({ kind: 'error', text: 'Network error placing order' });
      push({ tone: 'error', title: 'Order failed', message: 'Network error placing order' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="Paper Order Placement"
      subtitle="Simulated trading — no real broker connection"
      actions={
        <>
          <Button
            variant="primary"
            onClick={handlePlaceOrder}
            loading={loading}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            {loading ? 'Sending...' : 'Place Order'}
          </Button>
          {!protective && (
            <>
              <Button variant="ghost" onClick={() => setDirection('BUY')}>
                BUY
              </Button>
              <Button variant="ghost" onClick={() => setDirection('SELL')}>
                SELL
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <div>
          <label className="text-[11px] uppercase text-mut-2 mb-1">Instrument</label>
          <Select
            value={instrumentId}
            onChange={setInstrumentId}
            label="Instrument"
            options={instruments.map((i) => ({ value: i.value, label: i.label }))}
            size="sm"
          />
        </div>
        {protective ? (
          <p className="text-[11px] text-mut-2">
            {orderType === 'STOP_LOSS'
              ? 'Stop-loss: sells your open position when the trigger price is hit.'
              : 'Take-profit: sells your open position when the target price is hit.'}
          </p>
        ) : (
          <div>
            <label className="text-[11px] uppercase text-mut-2 mb-1">Direction</label>
            <SegmentedControl
              options={[{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]}
              value={direction}
              onChange={setDirection}
              label="Direction"
            />
          </div>
        )}
        <div>
          <label className="text-[11px] uppercase text-mut-2 mb-1">Order Type</label>
          <Select
            value={orderType}
            onChange={handleTypeChange}
            label="Order Type"
            options={orderTypeOptions.map((o) => ({ value: o.value, label: o.label }))}
            size="sm"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase text-mut-2 mb-1">Quantity</label>
          <Input
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
            type="number"
            placeholder="Qty"
          />
        </div>
        {needsPrice && (
          <div>
            <label className="text-[11px] uppercase text-mut-2 mb-1">
              {orderType === 'LIMIT' ? 'Limit Price' : 'Trigger Price'}
            </label>
            <Input
              value={price}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
              type="number"
              placeholder="Price"
            />
          </div>
        )}
      </div>
      {feedback?.kind === 'error' && <ErrorState message={feedback.text} />}
      {feedback?.kind === 'success' && (
        <p className="rounded-md border border-line bg-pos/10 px-3 py-2 text-[13px] text-pos" role="status">
          {feedback.text}
        </p>
      )}
    </Card>
  );
}

interface PaperPortfolio {
  available_capital: number;
  used_capital: number;
  total_portfolio_value: number;
  realised_pnl: number;
  unrealised_pnl: number;
}

interface PaperPosition {
  instrument_id: string;
  quantity: number;
  avg_price: number;
  market_value: number;
  unrealised_pnl: number;
}

interface PaperOrder {
  id: string;
  instrument_id: string;
  direction: string;
  order_type: string;
  quantity: number;
  price: number;
  status: string;
  created_at: string;
}

const ORDER_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  FILLED: 'positive',
  CANCELLED: 'muted',
  REJECTED: 'negative',
};

const inr = (value: number) =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedInr = (value: number) =>
  `${value >= 0 ? '+' : '−'}₹${Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PaperPortfolioSection() {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [modifying, setModifying] = useState<PaperOrder | null>(null);
  const [modPrice, setModPrice] = useState('');
  const [modQty, setModQty] = useState('');
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const { push } = useToasts();

  const load = useCallback(async () => {
    try {
      const [pfRes, posRes, ordRes] = await Promise.all([
        fetch('/api/paper-portfolio'),
        fetch('/api/paper-positions'),
        fetch('/api/paper-orders'),
      ]);
      const pf = (await pfRes.json()) as { data?: PaperPortfolio; error?: { message?: string } };
      const pos = (await posRes.json()) as { data?: PaperPosition[]; error?: { message?: string } };
      const ord = (await ordRes.json()) as { data?: PaperOrder[]; error?: { message?: string } };
      if (!pfRes.ok || !posRes.ok || !ordRes.ok) {
        throw new Error(
          pf.error?.message ?? pos.error?.message ?? ord.error?.message ?? 'Failed to load paper portfolio',
        );
      }
      setPortfolio(pf.data ?? null);
      setPositions(Array.isArray(pos.data) ? pos.data : []);
      setOrders(Array.isArray(ord.data) ? ord.data : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load paper portfolio');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onUpdate = () => void load();
    window.addEventListener('paper-updated', onUpdate);
    return () => window.removeEventListener('paper-updated', onUpdate);
  }, [load]);

  const cancelOrder = async (orderId: string) => {
    setCancelling(orderId);
    try {
      const res = await fetch('/api/paper-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const payload = (await res.json()) as { data?: { capitalReturned?: number }; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? 'Cancel failed');
      push({ tone: 'success', title: 'Order cancelled', message: 'Reserved capital was released.' });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Cancel failed';
      setError(message);
      push({ tone: 'error', title: 'Cancel failed', message });
    } finally {
      setCancelling(null);
    }
  };

  const closePosition = async (row: PaperPosition) => {
    setClosing(row.instrument_id);
    try {
      const res = await fetch('/api/paper-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrumentId: row.instrument_id,
          direction: 'SELL',
          orderType: 'MARKET',
          quantity: row.quantity,
        }),
      });
      const payload = (await res.json()) as { data?: { status?: string }; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? 'Close failed');
      push({
        tone: 'success',
        title: 'Position closed',
        message: `${INSTRUMENT_BY_ID[row.instrument_id]?.symbol ?? row.instrument_id} sold at market`,
      });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Close failed';
      setError(message);
      push({ tone: 'error', title: 'Close failed', message });
    } finally {
      setClosing(null);
    }
  };

  const openModify = (row: PaperOrder) => {
    setModifying(row);
    setModPrice(String(row.price));
    setModQty(String(row.quantity));
    setModError(null);
  };

  const submitModify = async () => {
    if (!modifying) return;
    setModBusy(true);
    setModError(null);
    try {
      const res = await fetch('/api/paper-order/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: modifying.id,
          price: Number(modPrice),
          quantity: Number(modQty),
        }),
      });
      const payload = (await res.json()) as { data?: unknown; error?: { message?: string } };
      if (!res.ok) throw new Error(payload.error?.message ?? 'Modify failed');
      setModifying(null);
      push({ tone: 'success', title: 'Order updated', message: `Quantity ${modQty} · price ${modPrice}` });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Modify failed';
      setModError(message);
      push({ tone: 'error', title: 'Modify failed', message });
    } finally {
      setModBusy(false);
    }
  };

  const positionColumns = [
    {
      key: 'instrument',
      header: 'Instrument',
      cell: (row: PaperPosition) => INSTRUMENT_BY_ID[row.instrument_id]?.symbol ?? row.instrument_id,
    },
    { key: 'qty', header: 'Qty', align: 'right' as const, cell: (row: PaperPosition) => row.quantity },
    {
      key: 'avg',
      header: 'Avg price',
      align: 'right' as const,
      cell: (row: PaperPosition) => formatPrice(row.avg_price),
    },
    {
      key: 'value',
      header: 'Market value',
      align: 'right' as const,
      cell: (row: PaperPosition) => inr(row.market_value),
    },
    {
      key: 'pnl',
      header: 'Unrealised P&L',
      align: 'right' as const,
      cell: (row: PaperPosition) => (
        <span className={row.unrealised_pnl >= 0 ? 'text-pos' : 'text-neg'}>{signedInr(row.unrealised_pnl)}</span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right' as const,
      cell: (row: PaperPosition) => (
        <Button
          variant="secondary"
          size="sm"
          loading={closing === row.instrument_id}
          onClick={() => void closePosition(row)}
        >
          Close
        </Button>
      ),
    },
  ];

  const orderColumns = [
    {
      key: 'time',
      header: 'Time',
      cell: (row: PaperOrder) => <span className="num text-mut">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: 'side',
      header: 'Side',
      cell: (row: PaperOrder) => (
        <Badge tone={row.direction === 'BUY' ? 'positive' : 'negative'}>{row.direction}</Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row: PaperOrder) => <span className="text-mut">{row.order_type}</span>,
    },
    { key: 'qty', header: 'Qty', align: 'right' as const, cell: (row: PaperOrder) => row.quantity },
    {
      key: 'price',
      header: 'Price',
      align: 'right' as const,
      cell: (row: PaperOrder) => (row.price ? formatPrice(row.price) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: PaperOrder) => (
        <Badge tone={ORDER_STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right' as const,
      cell: (row: PaperOrder) =>
        row.status === 'PENDING' ? (
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => openModify(row)}>
              Modify
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={cancelling === row.id}
              onClick={() => void cancelOrder(row.id)}
            >
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
    <Card
      title="Paper Portfolio"
      subtitle="Simulated positions and orders — refreshed on every trade"
      actions={
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      }
    >
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {loading && !portfolio && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {!loading && !portfolio && !error && (
        <EmptyState
          title="No portfolio data"
          description="The paper portfolio endpoint returned no data."
        />
      )}
      {portfolio && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Equity" value={inr(portfolio.total_portfolio_value)} />
            <StatTile label="Cash" value={inr(portfolio.available_capital)} />
            <StatTile label="In positions" value={inr(portfolio.used_capital)} />
            <StatTile
              label="Realised P&L"
              value={<span className={portfolio.realised_pnl >= 0 ? 'text-pos' : 'text-neg'}>{signedInr(portfolio.realised_pnl)}</span>}
            />
            <StatTile
              label="Unrealised P&L"
              value={<span className={portfolio.unrealised_pnl >= 0 ? 'text-pos' : 'text-neg'}>{signedInr(portfolio.unrealised_pnl)}</span>}
            />
          </div>

          <div className="space-y-2">
            <h3 className="section-title">Open positions</h3>
            <DataTable
              columns={positionColumns}
              rows={positions}
              rowKey={(row) => row.instrument_id}
              caption="Open paper trading positions"
              loading={loading}
              dense
              emptyTitle="No open positions"
              emptyDescription="Place a paper order to open a simulated position."
            />
          </div>

          <div className="space-y-2">
            <h3 className="section-title">Recent orders</h3>
            <DataTable
              columns={orderColumns}
              rows={orders}
              rowKey={(row) => row.id}
              caption="Recent paper trading orders"
              loading={loading}
              dense
              emptyTitle="No orders yet"
              emptyDescription="Orders you place appear here with fill status, modification and cancellation."
            />
          </div>
        </>
      )}
    </Card>
    <Modal
      open={modifying !== null}
      onClose={() => setModifying(null)}
      title="Modify pending order"
      description={
        modifying
          ? `${modifying.direction} ${modifying.quantity} ${INSTRUMENT_BY_ID[modifying.instrument_id]?.symbol ?? modifying.instrument_id} · ${modifying.order_type}`
          : undefined
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setModifying(null)} disabled={modBusy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submitModify()} loading={modBusy}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <div>
          <label className="text-[11px] uppercase text-mut-2 mb-1">Price</label>
          <Input value={modPrice} onChange={(e) => setModPrice(e.target.value)} type="number" placeholder="Price" />
        </div>
        <div>
          <label className="text-[11px] uppercase text-mut-2 mb-1">Quantity</label>
          <Input value={modQty} onChange={(e) => setModQty(e.target.value)} type="number" placeholder="Qty" />
        </div>
        {modError && <ErrorState message={modError} />}
      </div>
    </Modal>
    </>
  );
}
