import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="section-title mb-1">{eyebrow}</p>}
        <h1 className="text-lg font-semibold tracking-tight text-fg sm:text-xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-mut">{description}</p>
        )}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
