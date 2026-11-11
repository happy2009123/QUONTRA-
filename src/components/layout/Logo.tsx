import { cn } from '@/lib/cn';

export function Logo({ size = 'md', showWordmark = true }: { size?: 'sm' | 'md'; showWordmark?: boolean }) {
  const mark = size === 'sm' ? 18 : 22;
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg width={mark} height={mark} viewBox="0 0 24 24" aria-hidden focusable="false">
        <rect x="1.5" y="1.5" width="21" height="21" rx="3" fill="none" stroke="#C6A15B" strokeWidth="1.4" />
        <path d="M6 15.5 10 10l3 3 5-6.5" fill="none" stroke="#E0C48A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="6.5" r="1.6" fill="#C6A15B" />
      </svg>
      {showWordmark && (
        <span
          className={cn(
            'font-semibold tracking-[0.2em] text-fg',
            size === 'sm' ? 'text-[13px]' : 'text-[14.5px]',
          )}
        >
          QUANTORA
        </span>
      )}
    </span>
  );
}
