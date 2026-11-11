import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import {
  Badge,
  Card,
  ConnectionStatusDot,
  DataBadge,
  EmptyState,
  ErrorState,
  SkeletonText,
} from '@/components/ui';
import type { Tone } from '@/components/ui';
import type { MarketRegime } from '@/models';
import { demoSource } from '@/data/universe';
import { formatDateTime, formatTimestamp } from '@/lib/format';

const REGIME_TONE: Record<MarketRegime, Tone> = {
  BULLISH: 'positive',
  BEARISH: 'negative',
  SIDEWAYS: 'neutral',
  HIGH_VOLATILITY: 'warning',
  LOW_VOLATILITY: 'info',
};

const REGIME_LABEL: Record<MarketRegime, string> = {
  BULLISH: 'Bullish',
  BEARISH: 'Bearish',
  SIDEWAYS: 'Sideways',
  HIGH_VOLATILITY: 'High volatility',
  LOW_VOLATILITY: 'Low volatility',
};

const VOL_TONE: Record<'LOW' | 'NORMAL' | 'ELEVATED' | 'EXTREME', Tone> = {
  LOW: 'info',
  NORMAL: 'neutral',
  ELEVATED: 'warning',
  EXTREME: 'negative',
};

/**
 * Right-hand intelligence column (xl+): market regime summary, data
 * connection status and the demonstration-data disclaimer.
 */
export function DashboardSideRail() {
  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="Market intelligence">
      <RegimeCard />
      <DataConnectionCard />
      <DisclaimerCard />
    </aside>
  );
}

function RegimeCard() {
  const { data, loading, error, reload } = useAsync(() => api.research.getRegime(), []);

  return (
    <Card title="Market regime" subtitle="Model assessment of the current tape">
      {loading && <SkeletonText lines={5} />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && !data && (
        <EmptyState title="No regime assessment" description="The regime model has not produced an assessment yet." />
      )}
      {!loading && !error && data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={REGIME_TONE[data.primary]} dot>
              {REGIME_LABEL[data.primary]}
            </Badge>
            <Badge tone={VOL_TONE[data.volatilityState]} title="Model volatility state">
              Vol {data.volatilityState.toLowerCase()}
            </Badge>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="section-title">Confidence</span>
              <span className="num text-[13px] font-semibold text-fg">{data.confidence}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1a2029]" aria-hidden>
              <div
                className="h-full rounded-full bg-gold transition-all"
                style={{ width: `${Math.min(100, Math.max(0, data.confidence))}%` }}
              />
            </div>
          </div>

          <p className="text-[11.5px] leading-relaxed text-mut">{data.explanation}</p>

          <div className="space-y-1.5 border-t border-line-soft pt-2">
            <p className="num text-[10.5px] text-mut-2">Updated {formatDateTime(data.updatedAt)}</p>
            <DataBadge freshness="DEMO" source={data.source} updatedAt={data.updatedAt} compact />
          </div>
        </div>
      )}
    </Card>
  );
}

function DataConnectionCard() {
  const { data, loading, error, reload } = useAsync(() => api.data.getSnapshot(), []);

  return (
    <Card
      title="Data connections"
      subtitle="Provider status for this session"
      actions={
        data ? (
          <DataBadge
            freshness={data.globalFreshness}
            source={demoSource()}
            updatedAt={data.updatedAt}
            compact
          />
        ) : undefined
      }
    >
      {loading && <SkeletonText lines={4} />}
      {!loading && error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && (!data || data.providers.length === 0) && (
        <EmptyState
          title="No providers registered"
          description="No data providers are configured for this session."
        />
      )}
      {!loading && !error && data && data.providers.length > 0 && (
        <ul className="space-y-2.5">
          {data.providers.map((provider) => (
            <li key={provider.id} className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-medium text-fg">{provider.name}</p>
                  <p className="truncate text-[10.5px] text-mut-2">
                    {provider.vendor} · last ok {formatTimestamp(provider.lastSuccessAt)}
                  </p>
                </div>
                <ConnectionStatusDot status={provider.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DisclaimerCard() {
  return (
    <Card title="Demonstration data" className="border-gold/30 bg-gold/[0.04]">
      <p className="text-[11.5px] leading-relaxed text-mut">
        Every price, series and signal on this page is generated demonstration data. Nothing here is
        connected to a broker or exchange, and no value should be treated as an executable quote.
        Strategy-quality scores are confluence metrics (0–100),{' '}
        <span className="text-fg">not win probabilities</span>.
      </p>
      <p className="num mt-2 text-[10.5px] text-mut-2">Reference only · simulated</p>
    </Card>
  );
}
