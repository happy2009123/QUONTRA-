import type { DataFreshness, DataSourceRef } from '@/models';
import { cn } from '@/lib/cn';
import { formatTimestamp } from '@/lib/format';

const FRESHNESS_TONE: Record<DataFreshness, string> = {
  LIVE: 'border-pos/40 bg-pos/10 text-pos',
  DELAYED: 'border-warn/40 bg-warn/10 text-warn',
  HISTORICAL: 'border-info/40 bg-info/10 text-info',
  STALE: 'border-neg/40 bg-neg/10 text-neg',
  MISSING: 'border-neg/40 bg-neg/10 text-neg',
  DEMO: 'border-gold/40 bg-gold/10 text-gold-2',
};

const FRESHNESS_LABEL: Record<DataFreshness, string> = {
  LIVE: 'Live',
  DELAYED: 'Delayed',
  HISTORICAL: 'Historical',
  STALE: 'Stale',
  MISSING: 'No data',
  DEMO: 'Demo',
};

export interface DataBadgeProps {
  freshness: DataFreshness;
  source: DataSourceRef;
  updatedAt: string;
  /** Hide the ISO timestamp (used in dense table cells). */
  compact?: boolean;
  className?: string;
}

/**
 * Every price or series value in the UI is rendered alongside this badge so
 * demonstration data can never be mistaken for verified market data.
 */
export function DataBadge({ freshness, source, updatedAt, compact = false, className }: DataBadgeProps) {
  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-mut', className)}
      title={`${source.provider} · origin ${source.origin} · ${updatedAt}`}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-[1px] font-semibold uppercase tracking-[0.07em]',
          FRESHNESS_TONE[freshness],
        )}
      >
        {freshness === 'LIVE' && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
        {FRESHNESS_LABEL[freshness]}
      </span>
      <span className="num">{source.origin}</span>
      {!compact && (
        <>
          <span aria-hidden className="text-mut-2">
            ·
          </span>
          <span className="num">{formatTimestamp(updatedAt)}</span>
        </>
      )}
    </span>
  );
}
