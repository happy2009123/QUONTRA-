import { useEffect, useMemo } from 'react';
import { useAsync } from '@/state/useAsync';
import { api } from '@/api/client';
import { useToasts } from '@/state/ToastContext';
import { INSTRUMENT_BY_ID } from '@/data/universe';
import { formatPrice } from '@/lib/format';
import { Badge } from '@/components/ui';

const TICKER_IDS = ['idx-nifty50', 'idx-sensex', 'idx-sp500', 'idx-nasdaq', 'idx-dow', 'fx-usdinr'];
const TICKER_REFRESH_MS = 5_000;

export function PriceTicker() {
  const { push } = useToasts();
  const { data, loading, error, reload } = useAsync(
    () => api.market.getQuotes(TICKER_IDS),
    [],
    { enabled: true },
  );

  const quotes = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.map((q) => [q.id, q]));
    return TICKER_IDS.map((id) => {
      const inst = INSTRUMENT_BY_ID[id];
      const q = byId.get(id);
      if (!q) return null;
      return {
        id: q.id,
        lastPrice: q.quote.lastPrice,
        changePercent: q.quote.changePercent,
        symbol: inst?.symbol ?? id,
      };
    }).filter((q): q is { id: string; lastPrice: number; changePercent: number; symbol: string } => q != null);
}, [data]);

  useEffect(() => {
    if (quotes.length === 0) return;
    const id = setInterval(reload, TICKER_REFRESH_MS);
    return () => clearInterval(id);
  }, [quotes.length]);

  if (loading || quotes.length === 0) return null;

  if (error) {
    push({ tone: 'error', title: 'Ticker error', message: error });
    return null;
  }

  return (
    <div className="border-b border-line bg-panel/95 backdrop-blur px-3 py-2 flex items-center gap-3 sm:gap-6 lg:gap-8">
      {quotes.map((q) => {
        const tone = q.changePercent >= 0 ? 'positive' : 'negative';
        return (
          <div key={q.id} className="flex items-center gap-2">
            <span className="font-semibold text-fg truncate">{q.symbol}</span>
            <span className="num font-medium">{formatPrice(q.lastPrice, 'INR')}</span>
            <Badge tone={tone} className="mx-2 text-[10px]">
              {q.changePercent >= 0 ? '▲' : '▼'} {Math.abs(q.changePercent).toFixed(1)}%
            </Badge>
          </div>
        );
      })}
    </div>
  );
}