import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { useWatchlist } from '@/state/WatchlistContext';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PriceChange,
  SkeletonTable,
} from '@/components/ui';
import type { Column } from '@/components/ui';
import type { InstrumentQuote } from '@/models';
import { formatPrice } from '@/lib/format';
import { WatchlistStar } from './WatchlistStar';

export function WatchlistCard() {
  const { ids } = useWatchlist();
  const navigate = useNavigate();
  const joined = useMemo(() => [...ids].sort().join(','), [ids]);

  const { data, loading, error, reload } = useAsync(
    () => api.market.getQuotes(joined.split(',')),
    [joined],
    { enabled: joined !== '' },
  );

  const columns: Column<InstrumentQuote>[] = [
    {
      key: 'instrument',
      header: 'Instrument',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <WatchlistStar instrumentId={row.id} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-fg">{row.symbol}</span>
            <span className="block truncate text-[11px] text-mut">{row.name}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Last',
      align: 'right',
      cell: (row) => (
        <span className="num font-medium">{formatPrice(row.quote.lastPrice, row.currency)}</span>
      ),
    },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      cell: (row) => (
        <PriceChange
          value={row.quote.lastPrice}
          change={row.quote.change}
          changePercent={row.quote.changePercent}
          currency={row.currency}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/charts?instrument=${row.id}`)}>
          Chart
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="Watchlist"
      subtitle="Starred instruments — pinned across charts, scanner and search"
      actions={
        <Button variant="ghost" size="sm" onClick={reload} loading={loading && joined !== ''}>
          Refresh
        </Button>
      }
    >
      {ids.length === 0 ? (
        <EmptyState
          title="No watchlist yet"
          description="Star instruments from the charting terminal or the market scanner to pin them here."
        />
      ) : loading ? (
        <SkeletonTable />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(row) => row.id}
          caption="Watchlist instruments"
          dense
          emptyTitle="No quotes"
          emptyDescription="The provider returned no quotes for the starred instruments."
        />
      )}
    </Card>
  );
}
