import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/** Lightweight accessible tooltip: shows on hover and keyboard focus. */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-40 w-max max-w-[260px] -translate-x-1/2 rounded-[4px]',
            'border border-line bg-[#0c1016] px-2 py-1.5 text-[11px] leading-snug text-fg shadow-xl',
            side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label="More information"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[9px] font-bold text-mut hover:text-fg"
      >
        ?
      </button>
    </Tooltip>
  );
}
