import { cn } from '@/lib/cn';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  hideLabel?: boolean;
  id?: string;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
}

/** Native select styled to the QUANTORA design system (keyboard accessible). */
export function Select<T extends string = string>({
  value,
  options,
  onChange,
  label,
  hideLabel = false,
  id,
  size = 'md',
  className,
  disabled,
}: SelectProps<T>) {
  const selectId = id ?? `sel-${label?.replace(/\s+/g, '-').toLowerCase() ?? 'select'}`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {label && (
        <label
          htmlFor={selectId}
          className={cn('text-[10px] font-semibold uppercase tracking-[0.08em] text-mut', hideLabel && 'sr-only')}
        >
          {label}
        </label>
      )}
      <div className="relative min-w-0">
        <select
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
          className={cn(
            'w-full appearance-none rounded-[4px] border border-line bg-panel text-fg',
            'pr-7 pl-2.5 transition-colors hover:border-[#333c49] focus:border-gold/60',
            'disabled:opacity-50 disabled:pointer-events-none',
            size === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[12.5px]',
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-mut"
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
