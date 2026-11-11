import { cn } from '@/lib/cn';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, description, disabled, id }: ToggleProps) {
  const toggleId = id ?? `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={toggleId} className="cursor-pointer text-[13px] text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[11px] leading-relaxed text-mut">{description}</p>}
      </div>
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
          'focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-2',
          'disabled:opacity-40 disabled:pointer-events-none',
          checked ? 'border-gold/60 bg-gold/35' : 'border-line bg-[#1a2029]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            checked ? 'left-[18px] bg-gold-2' : 'left-0.5 bg-mut',
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}
