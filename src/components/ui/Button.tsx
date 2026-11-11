import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gold text-[#141005] hover:bg-gold-2 active:bg-gold-2 border border-gold/70 font-semibold',
  secondary:
    'bg-card text-fg hover:bg-[#1b212b] border border-line hover:border-[#333c49]',
  ghost: 'bg-transparent text-mut hover:text-fg hover:bg-[#1a202a] border border-transparent',
  danger: 'bg-neg/12 text-neg hover:bg-neg/20 border border-neg/40',
  subtle: 'bg-panel text-mut hover:text-fg border border-line',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-10 px-4 text-sm gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[4px] font-medium transition-colors',
        'disabled:opacity-45 disabled:pointer-events-none',
        'focus-visible:outline-2 focus-visible:outline-gold/70 focus-visible:outline-offset-1',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
