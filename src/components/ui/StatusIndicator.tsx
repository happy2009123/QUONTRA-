import type { ConnectionStatus, MarketStatus } from '@/models';
import { cn } from '@/lib/cn';

const CONNECTION_STYLE: Record<ConnectionStatus, { dot: string; text: string }> = {
  CONNECTED: { dot: 'bg-pos live-dot', text: 'text-pos' },
  DELAYED: { dot: 'bg-warn', text: 'text-warn' },
  STALE: { dot: 'bg-neg', text: 'text-neg' },
  DISCONNECTED: { dot: 'bg-mut-2', text: 'text-mut' },
  'DEMO DATA': { dot: 'bg-gold live-dot', text: 'text-gold-2' },
};

export function ConnectionStatusDot({ status, label = true }: { status: ConnectionStatus; label?: boolean }) {
  const style = CONNECTION_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-medium', style.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden />
      {label && <span className="uppercase tracking-[0.08em]">{status}</span>}
    </span>
  );
}

const MARKET_STYLE: Record<MarketStatus, string> = {
  OPEN: 'text-pos border-pos/40 bg-pos/10',
  PRE_OPEN: 'text-warn border-warn/40 bg-warn/10',
  AFTER_HOURS: 'text-info border-info/40 bg-info/10',
  CLOSED: 'text-mut border-line bg-[#1a2029]',
  UNKNOWN: 'text-mut-2 border-line bg-transparent',
};

const MARKET_LABEL: Record<MarketStatus, string> = {
  OPEN: 'Open',
  PRE_OPEN: 'Pre-open',
  AFTER_HOURS: 'After hours',
  CLOSED: 'Closed',
  UNKNOWN: 'Unknown',
};

export function MarketStatusPill({ status }: { status: MarketStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.07em]',
        MARKET_STYLE[status],
      )}
    >
      {status === 'OPEN' && <span className="live-dot h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {MARKET_LABEL[status]}
    </span>
  );
}
