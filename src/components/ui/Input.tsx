import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hideLabel?: boolean;
  icon?: ReactNode;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel = false, icon, className, id, wrapperClassName, ...rest },
  ref,
) {
  const inputId = id ?? `input-${(label ?? 'field').replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', wrapperClassName)}>
      {label && (
        <label htmlFor={inputId} className={cn('text-[10px] font-semibold uppercase tracking-[0.08em] text-mut', hideLabel && 'sr-only')}>
          {label}
        </label>
      )}
      <div className="relative min-w-0">
        {icon && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mut">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-8 w-full rounded-[4px] border border-line bg-panel text-fg placeholder:text-mut-2',
            'transition-colors hover:border-[#333c49] focus:border-gold/60 focus:outline-none',
            'disabled:opacity-50 disabled:pointer-events-none',
            icon ? 'pl-8 pr-2.5' : 'px-2.5',
            className,
          )}
          {...rest}
        />
      </div>
    </div>
  );
});

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search', className, autoFocus }: SearchInputProps) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <label htmlFor="global-search" className="sr-only">
        {label}
      </label>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mut" aria-hidden />
      <input
        id="global-search"
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-8 w-full rounded-[4px] border border-line bg-panel pl-8 pr-8 text-[13px] text-fg',
          'placeholder:text-mut-2 transition-colors hover:border-[#333c49] focus:border-gold/60 focus:outline-none',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-mut hover:text-fg"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
