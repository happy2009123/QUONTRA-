import { cn } from '@/lib/cn';

export interface CorrelationMatrixProps {
  symbols: string[];
  values: number[][];
  className?: string;
}

function cellColor(value: number): string {
  if (value >= 0) {
    const alpha = 0.08 + Math.min(value, 1) * 0.55;
    return `rgba(36,180,126,${alpha})`;
  }
  const alpha = 0.08 + Math.min(Math.abs(value), 1) * 0.55;
  return `rgba(224,82,82,${alpha})`;
}

export function CorrelationMatrix({ symbols, values, className }: CorrelationMatrixProps) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[520px] border-collapse text-center">
        <caption className="sr-only">Pairwise correlation matrix</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-card px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-mut">
              Pair
            </th>
            {symbols.map((s) => (
              <th
                key={s}
                scope="col"
                className="px-1 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-mut"
              >
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((row, i) => (
            <tr key={row}>
              <th
                scope="row"
                className="sticky left-0 bg-card px-2 py-1 text-left text-[11.5px] font-medium text-fg"
              >
                {row}
              </th>
              {symbols.map((col, j) => {
                const value = values[i][j];
                return (
                  <td
                    key={col}
                    className="num border border-[#1a2029] px-1 py-1.5 text-[11px] font-medium text-fg"
                    style={{ background: cellColor(value) }}
                    title={`${row} × ${col}: ${value.toFixed(2)}`}
                  >
                    {value.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
