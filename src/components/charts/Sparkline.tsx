import { useMemo } from 'react';
import { cn } from '@/lib/cn';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Force a colour; otherwise derived from the first/last value. */
  tone?: 'auto' | 'gold' | 'positive' | 'negative';
  className?: string;
  strokeWidth?: number;
  showArea?: boolean;
}

/** Dependency-free SVG sparkline used inside tables and overview cards. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = 'auto',
  className,
  strokeWidth = 1.4,
  showArea = true,
}: SparklineProps) {
  const path = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 3) - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line = `M${points.join(' L')}`;
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [values, width, height]);

  const ascending = values.length > 1 && values[values.length - 1] >= values[0];
  const stroke =
    tone === 'gold'
      ? '#C6A15B'
      : tone === 'positive'
        ? '#24B47E'
        : tone === 'negative'
          ? '#E05252'
          : ascending
            ? '#24B47E'
            : '#E05252';

  if (values.length < 2) {
    return <span className={cn('text-[10px] text-mut-2', className)}>n/a</span>;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
      focusable="false"
    >
      {showArea && <path d={path.area} fill={stroke} fillOpacity={0.1} />}
      <path d={path.line} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
  );
}
