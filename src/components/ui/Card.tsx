import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Renders a denser card for table-like panels. */
  dense?: boolean;
  flush?: boolean;
}

export function Card({
  title,
  subtitle,
  actions,
  dense = false,
  flush = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <section
      className={cn('panel flex min-w-0 flex-col', dense ? '' : 'p-4', className)}
      {...rest}
    >
      {(title || actions) && (
        <header
          className={cn(
            'flex items-start justify-between gap-3',
            dense ? 'px-4 pt-3 pb-2' : 'mb-3',
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 text-[11px] text-mut">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', flush ? '' : dense ? 'px-4 pb-4' : '')}>{children}</div>
    </section>
  );
}
