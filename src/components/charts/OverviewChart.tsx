import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import type { MarketOverviewSeries } from '@/models';

const SERIES_COLORS = ['#C6A15B', '#5B9DE0', '#24B47E', '#E0C48A', '#8C97A6', '#E05252'];

export interface OverviewChartProps {
  series: MarketOverviewSeries[];
  height?: number;
  className?: string;
}

/**
 * Normalised multi-instrument comparison chart (base 100) rendered as SVG so it
 * stays lightweight and fully responsive.
 */
export function OverviewChart({ series, height = 260, className }: OverviewChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverX, setHoverX] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.instrumentId));
  const longest = Math.max(0, ...visible.map((s) => s.points.length));

  const geometry = useMemo(() => {
    if (visible.length === 0 || longest < 2) return null;
    // Normalise each series to base 100 using its own first point.
    const normalised = visible.map((s) => {
      const base = s.points[0]?.value || 1;
      return { ...s, values: s.points.map((p) => (p.value / base) * 100) };
    });
    const all = normalised.flatMap((s) => s.values);
    const min = Math.min(...all);
    const max = Math.max(...all);
    const pad = (max - min) * 0.12 || 1;
    const lo = min - pad;
    const hi = max + pad;
    return { normalised, lo, hi };
  }, [visible, longest]);

  if (!geometry || visible.length === 0) {
    return (
      <div className={cn('flex h-[220px] items-center justify-center text-[12px] text-mut', className)}>
        No series selected
      </div>
    );
  }

  const width = 1000;
  const heightPx = height;
  const x = (i: number) => (i / (longest - 1)) * width;
  const y = (v: number) => heightPx - ((v - geometry.lo) / (geometry.hi - geometry.lo)) * heightPx;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const value = geometry.hi - f * (geometry.hi - geometry.lo);
    return { value, y: f * heightPx };
  });

  const hoverIndex =
    hoverX == null ? null : Math.round((hoverX / width) * (longest - 1));

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((s, i) => {
          const isHidden = hidden.has(s.instrumentId);
          return (
            <button
              key={s.instrumentId}
              type="button"
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.instrumentId)) next.delete(s.instrumentId);
                  else next.add(s.instrumentId);
                  return next;
                })
              }
              aria-pressed={!isHidden}
              className={cn(
                'flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 text-[10.5px] transition-opacity',
                isHidden ? 'border-line opacity-45' : 'border-line bg-panel',
              )}
            >
              <span
                className="h-2 w-2 rounded-[1px]"
                style={{ background: isHidden ? '#6B7482' : SERIES_COLORS[i % SERIES_COLORS.length] }}
                aria-hidden
              />
              <span className="text-mut">{s.symbol}</span>
              <span className={cn('num font-medium', s.changePercent >= 0 ? 'text-pos' : 'text-neg')}>
                {formatPercent(s.changePercent, 1)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="relative w-full"
        onMouseLeave={() => setHoverX(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(((e.clientX - rect.left) / rect.width) * width);
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${heightPx}`}
          preserveAspectRatio="none"
          className="h-[240px] w-full sm:h-[260px]"
          role="img"
          aria-label="Normalised performance comparison chart"
        >
          {gridLines.map((g) => (
            <line
              key={g.value}
              x1={0}
              x2={width}
              y1={g.y}
              y2={g.y}
              stroke="#1c222b"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {geometry.normalised.map((s, i) => {
            const d = s.values
              .map((v, idx) => `${idx === 0 ? 'M' : 'L'}${x(idx).toFixed(2)},${y(v).toFixed(2)}`)
              .join(' ');
            return (
              <path
                key={s.instrumentId}
                d={d}
                fill="none"
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {hoverIndex != null && (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={0}
              y2={heightPx}
              stroke="#3a4453"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hoverIndex != null && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-[4px] border border-line bg-[#0e1218]/95 px-2 py-1.5 text-[10.5px]">
            {geometry.normalised.map((s, i) => (
              <div key={s.instrumentId} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-[1px]" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                <span className="text-mut">{s.symbol}</span>
                <span className="num ml-auto font-medium text-fg">{s.values[hoverIndex]?.toFixed(2)}</span>
              </div>
            ))}
            <p className="mt-1 border-t border-line pt-1 text-[9.5px] uppercase tracking-[0.07em] text-mut-2">
              Indexed to 100 · demo data
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
