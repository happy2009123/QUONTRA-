import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import type { EquityPoint } from '@/models';

export interface EquityCurveProps {
  points: EquityPoint[];
  initialCapital: number;
  height?: number;
  className?: string;
}

/** Simulated equity + drawdown curve rendered as SVG. */
export function EquityCurve({ points, initialCapital, height = 220, className }: EquityCurveProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.equity);
    const min = Math.min(...values, initialCapital);
    const max = Math.max(...values, initialCapital);
    const pad = (max - min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }, [points, initialCapital]);

  if (!geometry || points.length < 2) {
    return (
      <div className={cn('flex h-[180px] items-center justify-center text-[12px] text-mut', className)}>
        Not enough data to plot the equity curve.
      </div>
    );
  }

  const width = 1000;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => height - ((v - geometry.min) / (geometry.max - geometry.min)) * height;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`).join(' ');
  const baseline = y(initialCapital);
  const active = hoverIndex != null ? points[hoverIndex] : points[points.length - 1];
  const totalReturn = ((points[points.length - 1].equity - initialCapital) / initialCapital) * 100;

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
        <span className="text-mut">
          Final equity <span className="num font-semibold text-fg">{active.equity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        </span>
        <span className={cn('num font-semibold', totalReturn >= 0 ? 'text-pos' : 'text-neg')}>
          {formatPercent(totalReturn)} net
        </span>
        <span className="num text-mut">Max DD {Math.min(...points.map((p) => p.drawdown)).toFixed(2)}%</span>
        <span className="ml-auto uppercase tracking-[0.07em] text-mut-2">Simulated</span>
      </div>
      <div
        className="relative"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          setHoverIndex(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-[200px] w-full sm:h-[220px]"
          role="img"
          aria-label="Simulated equity curve"
        >
          <line x1={0} x2={width} y1={baseline} y2={baseline} stroke="#3a4453" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={`${linePath} L${width},${height} L0,${height} Z`} fill="#C6A15B" fillOpacity={0.09} />
          <path d={linePath} fill="none" stroke="#C6A15B" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
          {hoverIndex != null && (
            <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={0} y2={height} stroke="#3a4453" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {active && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-[4px] border border-line bg-[#0e1218]/95 px-2 py-1 text-[10.5px]">
            <span className="text-mut">Equity </span>
            <span className="num font-medium text-fg">{active.equity.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            <span className="ml-2 text-mut">DD </span>
            <span className="num font-medium text-neg">{active.drawdown.toFixed(2)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
