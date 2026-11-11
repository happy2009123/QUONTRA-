import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyState, SkeletonTable } from './States';

export type SortDirection = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  width?: string;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible description of the table contents. */
  caption: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedRowKey?: string;
  dense?: boolean;
  stickyHeader?: boolean;
  className?: string;
  /** Initial sort column key. */
  initialSort?: { key: string; direction: SortDirection };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  emptyTitle = 'No results',
  emptyDescription = 'Adjust the filters to widen the result set.',
  emptyAction,
  onRowClick,
  selectedRowKey,
  dense = false,
  stickyHeader = true,
  className,
  initialSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue!(a);
      const bv = column.sortValue!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, direction: 'desc' };
      if (prev.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
  };

  if (loading) {
    return (
      <div className={cn('overflow-hidden', className)}>
        <SkeletonTable rows={8} cols={Math.min(columns.length, 8)} />
        <span className="sr-only" role="status">
          Loading {caption}
        </span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn(className)}>
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </div>
    );
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr className="border-b border-line bg-panel/95 backdrop-blur">
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-mut',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.headerClassName,
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`Sort by ${typeof col.header === 'string' ? col.header : col.key}`}
                      className={cn(
                        'inline-flex items-center gap-1 uppercase tracking-[0.07em] transition-colors hover:text-fg',
                        active && 'text-gold-2',
                      )}
                    >
                      {col.header}
                      {active ? (
                        sort.direction === 'asc' ? (
                          <ArrowUp size={11} aria-hidden />
                        ) : (
                          <ArrowDown size={11} aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown size={11} className="opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const key = rowKey(row);
            const selected = selectedRowKey === key;
            return (
              <tr
                key={key}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-line-soft transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-[#1a2029] focus-visible:bg-[#1a2029] focus-visible:outline-none',
                  selected && 'bg-gold/8',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 align-middle text-[12.5px] text-fg',
                      dense ? 'py-1.5' : 'py-2.5',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      'num' === col.key && 'tabular-nums',
                      col.className,
                    )}
                  >
                    {col.cell(row, index)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
