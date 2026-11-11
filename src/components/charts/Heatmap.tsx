import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import type { HeatmapCell } from '@/models';

function cellStyle(changePercent: number): { background: string; color: string } {
  const intensity = Math.min(Math.abs(changePercent) / 3, 1);
  const alpha = 0.12 + intensity * 0.55;
  if (changePercent >= 0) return { background: `rgba(36,180,126,${alpha})`, color: '#dff5ec' };
  return { background: `rgba(224,82,82,${alpha})`, color: '#fbe4e4' };
}

export interface HeatmapProps {
  cells: HeatmapCell[];
  onSelect?: (cell: HeatmapCell) => void;
  className?: string;
}

export function Heatmap({ cells, onSelect, className }: HeatmapProps) {
  if (cells.length === 0) {
    return <p className={cn('py-8 text-center text-[12px] text-mut', className)}>No instruments to display.</p>;
  }

  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8',
        className,
      )}
      role="list"
      aria-label="Market heatmap"
    >
      {cells.map((cell) => {
        const style = cellStyle(cell.changePercent);
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <Wrapper
            key={cell.instrumentId}
            {...(onSelect
              ? {
                  type: 'button' as const,
                  onClick: () => onSelect(cell),
                  'aria-label': `${cell.symbol}, ${formatPercent(cell.changePercent)}. Open in charts.`,
                }
              : {})}
            className={cn(
              'flex h-[54px] flex-col items-center justify-center rounded-[3px] border border-black/20 px-1 text-center transition-transform',
              onSelect && 'cursor-pointer hover:z-10 hover:scale-[1.03] hover:border-gold/50',
            )}
            style={{ background: style.background }}
          >
            <span
              className="w-full truncate text-[10.5px] font-semibold uppercase tracking-[0.04em]"
              style={{ color: style.color }}
            >
              {cell.symbol}
            </span>
            <span className="num text-[11px] font-medium" style={{ color: style.color }}>
              {formatPercent(cell.changePercent, 2)}
            </span>
          </Wrapper>
        );
      })}
    </div>
  );
}
