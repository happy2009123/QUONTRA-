import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatPercent, formatSigned } from '@/lib/format';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number;
  deltaFormat?: 'percent' | 'signed';
  tone?: 'default' | 'gold';
  className?: string;
}

export function StatTile({ label, value, sub, delta, deltaFormat = 'percent', tone = 'default', className }: StatTileProps) {
  const deltaPositive = (delta ?? 0) > 0;
  const deltaZero = delta === undefined || delta === 0;
  return (
    <div className={cn('panel flex min-w-0 flex-col gap-1 p-3', tone === 'gold' && 'border-gold/30 bg-gold/[0.04]', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="section-title truncate">{label}</span>
        {delta !== undefined && (
          <span
            className={cn(
              'num text-[11.5px] font-semibold',
              deltaZero ? 'text-mut' : deltaPositive ? 'text-pos' : 'text-neg',
            )}
          >
            {deltaFormat === 'percent' ? formatPercent(delta) : formatSigned(delta)}
          </span>
        )}
      </div>
      <div className="truncate text-[19px] font-semibold leading-tight tabular-nums text-fg">{value}</div>
      {sub && <div className="truncate text-[11px] text-mut">{sub}</div>}
    </div>
  );
}

export interface PriceChangeProps {
  value: number;
  change: number;
  changePercent: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function PriceChange({ value, change, changePercent, currency, size = 'md', className }: PriceChangeProps) {
  const positive = change >= 0;
  const sizeClass = size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-base' : 'text-[13px]';
  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('font-semibold tabular-nums leading-tight text-fg', sizeClass)}>
        <PriceValue value={value} currency={currency} />
      </div>
      <div className={cn('num mt-0.5 text-[11.5px] font-medium', positive ? 'text-pos' : 'text-neg')}>
        {positive ? '▲' : '▼'} {formatSigned(change)} ({formatPercent(changePercent)})
      </div>
    </div>
  );
}

function PriceValue({ value, currency }: { value: number; currency?: string }) {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'INR' ? '₹' : '';
  return (
    <span>
      {symbol}
      {value.toLocaleString('en-IN', {
        minimumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 4,
        maximumFractionDigits: value >= 100 ? 2 : value >= 1 ? 3 : 4,
      })}
    </span>
  );
}
