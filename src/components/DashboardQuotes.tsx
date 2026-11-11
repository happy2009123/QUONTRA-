import { useMemo } from 'react';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import {
  Badge,
  Button,
  DataBadge,
  EmptyState,
  ErrorState,
  MarketStatusPill,
  PriceChange,
  Skeleton,
} from '@/components/ui';
import type { InstrumentQuote } from '@/models';
import { USD_INR_RESTRICTION } from '@/data/universe';
import { formatDateTime } from '@/lib/format';

const QUOTE_IDS = ['idx-nifty50', 'idx-sensex', 'idx-sp500', 'idx-nasdaq', 'idx-dow', 'fx-usdinr'];

export function DashboardQuotes() {
  const { data, loading, error, reload } = useAsync(() => api.market.getQuotes(QUOTE_IDS), []);

  const quotes = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.map((q) => [q.id, q]));
    return QUOTE_IDS.flatMap((id) => {
      const quote = byId.get(id);
      return quote ? [quote] : [];
    });
  }, [data]);

  if (loading) {
    return (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[164px] w-full" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading market overview quotes
        </span>
      </>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <ErrorState title="Unable to load market quotes" message={error} onRetry={reload} />
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No quotes available"
          description="The demonstration provider returned no instruments for this snapshot."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {quotes.map((quote) => (
        <QuoteCard key={quote.id} quote={quote} />
      ))}
    </div>
  );
}

function QuoteCard({ quote }: { quote: InstrumentQuote }) {
  const isFxReference = quote.id === 'fx-usdinr';
  const restriction = isFxReference ? (quote.restriction ?? USD_INR_RESTRICTION) : undefined;

  return (
    <article className="panel flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-fg">{quote.name}</p>
          <p className="num mt-0.5 truncate text-[10.5px] uppercase tracking-[0.07em] text-mut-2">
            {quote.symbol} · {quote.exchange}
          </p>
        </div>
        <MarketStatusPill status={quote.quote.marketStatus} />
      </div>

      <PriceChange
        value={quote.quote.lastPrice}
        change={quote.quote.change}
        changePercent={quote.quote.changePercent}
        currency={quote.currency}
      />

      {restriction && (
        <div className="rounded-[4px] border border-warn/40 bg-warn/10 p-2">
          <Badge tone="warning">Reference rate only — not tradable</Badge>
          <p className="mt-1.5 text-[11.5px] font-medium leading-snug text-warn">{restriction.summary}</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-mut">{restriction.detail}</p>
        </div>
      )}

      <div className="mt-auto space-y-1.5 border-t border-line-soft pt-2">
        <p className="num text-[10.5px] text-mut-2">Last updated {formatDateTime(quote.quote.updatedAt)}</p>
        <DataBadge
          freshness={quote.quote.freshness}
          source={quote.quote.source}
          updatedAt={quote.quote.updatedAt}
        />
      </div>
    </article>
  );
}
