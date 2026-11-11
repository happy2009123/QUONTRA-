import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Tabs<T extends string>({ items, value, onChange, label, size = 'md', className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex min-w-0 items-center gap-1 overflow-x-auto', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative shrink-0 rounded-[4px] border font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1',
              'disabled:opacity-40 disabled:pointer-events-none',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[12.5px]',
              active
                ? 'border-gold/45 bg-gold/10 text-gold-2'
                : 'border-transparent text-mut hover:border-line hover:bg-panel hover:text-fg',
            )}
          >
            {item.label}
            {item.badge != null && (
              <span className="ml-1.5 num text-[10px] text-mut">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'sm', className }: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex min-w-0 rounded-[4px] border border-line bg-panel p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'shrink-0 rounded-[3px] font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-gold/70',
              size === 'xs' ? 'h-5.5 px-2 text-[11px]' : 'h-6.5 px-2.5 text-[12px]',
              active ? 'bg-gold/15 text-gold-2' : 'text-mut hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
