import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  DataBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
} from '@/components/ui';
import type { Tone } from '@/components/ui';
import { Heatmap } from '@/components/charts/Heatmap';
import { OverviewChart } from '@/components/charts/OverviewChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { DashboardQuotes } from '@/components/DashboardQuotes';
import { DashboardSideRail } from '@/components/DashboardSideRail';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import type {
  EconomicEvent,
  InstrumentQuote,
  OpportunitySummary,
  SignalAction,
  VolatilityGauge,
} from '@/models';
import { buildCandles } from '@/data/marketData';
import { demoSource } from '@/data/universe';
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

          <OverviewSection />
          <HeatmapSection />
          <MoversSection />

          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <VolatilitySection />
            <EventsSection />
          </div>

          <OpportunitiesSection />
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
