import { cn } from '@/lib/cn';

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  sub?: string;
  tone?: 'positive' | 'negative' | 'gold' | 'neutral';
}

export interface BarListProps {
  items: BarListItem[];
  /** Maximum absolute value used to scale the bars. Defaults to the max item. */
  max?: number;
  valueFormatter?: (value: number) => string;
  onSelect?: (item: BarListItem) => void;
  className?: string;
}

const TONES: Record<NonNullable<BarListItem['tone']>, string> = {
  positive: 'bg-pos',
  negative: 'bg-neg',
  gold: 'bg-gold',
  neutral: 'bg-info',
};

export function BarList({ items, max, valueFormatter, onSelect, className }: BarListProps) {
  const scale = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1);

  if (items.length === 0) {
    return <p className={cn('py-6 text-center text-[12px] text-mut', className)}>Nothing to display.</p>;
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((item) => {
        const width = Math.min(100, (Math.abs(item.value) / scale) * 100);
        const tone = item.tone ?? 'gold';
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <li key={item.key}>
            <Wrapper
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(item) } : {})}
              className={cn('w-full text-left', onSelect && 'group')}
            >
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-[12.5px] text-fg group-hover:text-gold-2">{item.label}</span>
                <span className="num shrink-0 text-[12px] font-medium text-fg">
                  {valueFormatter ? valueFormatter(item.value) : item.value}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a2029]">
                <div
                  className={cn('h-full rounded-full transition-all', TONES[tone])}
                  style={{ width: `${width}%` }}
                />
              </div>
              {item.sub && <p className="mt-0.5 text-[10.5px] text-mut">{item.sub}</p>}
            </Wrapper>
          </li>
        );
      })}
    </ul>
  );
}
