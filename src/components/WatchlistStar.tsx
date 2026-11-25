import { Star } from 'lucide-react';
import { useWatchlist } from '@/state/WatchlistContext';
import { useToasts } from '@/state/ToastContext';
import { INSTRUMENT_BY_ID } from '@/data/universe';
import { cn } from '@/lib/cn';

export interface WatchlistStarProps {
  instrumentId: string;
  className?: string;
}

export function WatchlistStar({ instrumentId, className }: WatchlistStarProps) {
  const { has, toggle } = useWatchlist();
  const { push } = useToasts();
  const active = has(instrumentId);
  const symbol = INSTRUMENT_BY_ID[instrumentId]?.symbol ?? instrumentId;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      title={active ? 'Remove from watchlist' : 'Add to watchlist'}
      onClick={() => {
        toggle(instrumentId);
        push({
          tone: 'success',
          title: active ? 'Removed from watchlist' : 'Added to watchlist',
          message: symbol,
        });
      }}
      className={cn(
        'shrink-0 rounded p-0.5 transition-[color,scale] duration-150 ease-out',
        'motion-safe:active:scale-90 focus-visible:outline-2 focus-visible:outline-gold/70',
        active ? 'text-gold' : 'text-mut-2 hover:text-gold-2',
        className,
      )}
    >
      <Star size={13} fill={active ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}
