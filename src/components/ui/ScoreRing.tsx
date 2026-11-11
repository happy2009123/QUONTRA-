import { cn } from '@/lib/cn';
import { InfoHint } from './Tooltip';

export interface ScoreRingProps {
  score: number;
  size?: number;
  label?: string;
  /** Render the numeric score in the middle. */
  showValue?: boolean;
  className?: string;
}

function toneFor(score: number): { stroke: string; text: string } {
  if (score >= 75) return { stroke: '#24b47e', text: 'text-pos' };
  if (score >= 60) return { stroke: '#c6a15b', text: 'text-gold-2' };
  if (score >= 45) return { stroke: '#e0a83b', text: 'text-warn' };
  return { stroke: '#e05252', text: 'text-neg' };
}

/** Visualises the 0–100 strategy-quality (confluence) score. Not a win probability. */
export function ScoreRing({ score, size = 72, label = 'Strategy quality', showValue = true, className }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const tone = toneFor(clamped);

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label={`${label}: ${clamped} out of 100`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#252C36" strokeWidth="5" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone.stroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        {showValue && (
          <span
            className={cn('absolute inset-0 flex items-center justify-center font-semibold tabular-nums', tone.text)}
            style={{ fontSize: size * 0.3 }}
          >
            {clamped}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-mut">
          {label}
          <InfoHint text="Strategy-quality score measures setup confluence from 0 to 100. It is NOT a win probability or a prediction of future performance." />
        </p>
        <p className="mt-1 text-[11px] leading-snug text-mut-2">
          Confluence metric · 0–100
          <br />
          <span className="text-[10px]">Not a win probability</span>
        </p>
      </div>
    </div>
  );
}
