import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'positive' | 'negative' | 'neutral' | 'gold' | 'warning' | 'info' | 'muted';

const TONES: Record<Tone, string> = {
  positive: 'text-pos bg-pos/10 border-pos/30',
  negative: 'text-neg bg-neg/10 border-neg/30',
  neutral: 'text-mut bg-[#1a2029] border-line',
  gold: 'text-gold-2 bg-gold/10 border-gold/30',
  warning: 'text-warn bg-warn/10 border-warn/30',
  info: 'text-info bg-info/10 border-info/30',
  muted: 'text-mut-2 bg-transparent border-line',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  /** Small filled dot rendered before the label. */
  dot?: boolean;
  title?: string;
}

export function Badge({ children, tone = 'neutral', className, dot = false, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px]',
        'text-[10px] font-semibold uppercase tracking-[0.06em]',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
