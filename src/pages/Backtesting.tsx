import { useMemo, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  Tabs,
} from '@/components/ui';
import { EquityCurve } from '@/components/charts/EquityCurve';
import { BarList } from '@/components/charts/BarList';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';
import { DEFAULT_COSTS } from '@/data/strategyData';
import type { CostModel, TestPhase } from '@/models';

const INSTRUMENTS = ['eq-reliance', 'eq-hdfcbank', 'intl-nvda'];
const COMPARE_POOL = ['str-ema-ribbon', 'str-vwap-reversion', 'str-squeeze-breakout', 'str-rsi-divergence', 'str-mtf-alignment'];

type TabId = 'performance' | 'comparison' | 'walkforward' | 'trades';

const PHASES: { value: TestPhase; label: string }[] = [
  { value: 'IN_SAMPLE', label: 'In-sample' },
  { value: 'OUT_OF_SAMPLE', label: 'Out-of-sample' },
  { value: 'WALK_FORWARD', label: 'Walk-forward' },
];

export default function Backtesting() {
  const [tab, setTab] = useState<TabId>('performance');
  const [strategyId, setStrategyId] = useState('str-ema-ribbon');
  const [phase, setPhase] = useState<TestPhase>('IN_SAMPLE');
  const [costs, setCosts] = useState<CostModel>({ ...DEFAULT_COSTS });
  const [selected, setSelected] = useState<string[]>(['str-ema-ribbon', 'str-vwap-reversion']);

  const strategies = useAsync(() => api.strategy.listStrategies(), []);
  const performance = useAsync(() => api.strategy.runBacktest(strategyId, INSTRUMENTS), [strategyId, phase]);
  const comparison = useAsync(() => api.strategy.compare(selected), [selected.join(',')], { enabled: selected.length >= 2 });

  const roundTripBps = useMemo(
    () => costs.brokerageBps + costs.slippageBps + costs.sttBps + costs.exchangeFeesBps,
    [costs],
  );
  const gstApplied = roundTripBps * (1 + costs.gstPct / 100);
  const costOfOnePctMove = (gstApplied / 100) * 100;

  const result = performance.data;

  const exportTrades = () => {
    if (!result) return;
    const header = ['id', 'symbol', 'direction', 'entryTime', 'exitTime', 'entryPrice', 'exitPrice', 'quantity', 'grossPnl', 'costs', 'netPnl', 'rMultiple', 'exitReason'];
    const rows = result.trades.map((t) =>
      [t.id, t.symbol, t.direction, t.entryTime, t.exitTime, t.entryPrice, t.exitPrice, t.quantity, t.grossPnl, t.costs, t.netPnl, t.rMultiple, t.exitReason].join(','),
    );
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quantora-backtest-${strategyId}-${phase}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Quantitative"
        title="Backtesting Dashboard"
        description="Historical performance, strategy comparison, out-of-sample and walk-forward testing with explicit cost and slippage modelling."
        actions={<Badge tone="gold" dot>Simulated — not live performance</Badge>}
      />

      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          label="Testing view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'performance', label: 'Performance' },
            { value: 'comparison', label: 'Comparison' },
            { value: 'walkforward', label: 'Walk-forward' },
            { value: 'trades', label: 'Trades' },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <SelectLike label="Strategy" value={strategyId} onChange={setStrategyId} options={(strategies.data ?? []).map((s) => ({ value: s.id, label: s.name }))} loading={strategies.loading} />
        </div>
      </div>

      <Tabs
        label="Backtest sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'performance', label: 'Performance' },
          { value: 'comparison', label: 'Comparison', badge: selected.length },
          { value: 'walkforward', label: 'Walk-forward' },
          { value: 'trades', label: 'Trades', badge: result?.trades.length },
        ]}
      />

      {tab === 'performance' && (
        <div className="space-y-4">
          {performance.loading ? (
            <Card><div className="space-y-3"><Skeleton className="h-5 w-52" /><Skeleton className="h-56 w-full" /></div></Card>
          ) : performance.error ? (
            <Card><ErrorState message={performance.error} onRetry={performance.reload} /></Card>
          ) : result ? (
            <>
              <Card
                title={`Historical performance — ${result.strategyName}`}
                subtitle={`${result.window.from} → ${result.window.to} · phase ${result.phase.replace('_', '- ').toLowerCase()}`}
                actions={<Badge tone="warning">Simulated</Badge>}
              >
                <EquityCurve points={result.equityCurve} initialCapital={result.initialCapital} />
              </Card>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile label="Net return after costs" value={formatPercent(result.metrics.netReturnPct)} sub={`Annualised ${formatPercent(result.metrics.annualizedReturnPct)}`} delta={result.metrics.netReturnPct} />
                <StatTile label="Win rate" value={`${result.metrics.winRatePct}%`} sub={`${result.metrics.tradeCount} trades`} />
                <StatTile label="Profit factor" value={result.metrics.profitFactor.toFixed(2)} sub={`Expectancy ${result.metrics.expectancyR.toFixed(2)}R`} />
                <StatTile label="Maximum drawdown" value={`-${result.metrics.maxDrawdownPct}%`} sub={`Sharpe ${result.metrics.sharpe.toFixed(2)} · Sortino ${result.metrics.sortino.toFixed(2)}`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Performance by market regime" dense flush>
                  <DataTable
                    caption="Breakdown by regime"
                    rows={result.regimeBreakdown}
                    rowKey={(r) => r.regime}
                    columns={[
                      { key: 'regime', header: 'Regime', cell: (r) => <Badge tone="neutral">{r.regime.replace('_', ' ')}</Badge> },
                      { key: 't', header: 'Trades', align: 'right', cell: (r) => <span className="num">{r.tradeCount}</span> },
                      { key: 'w', header: 'Win rate', align: 'right', cell: (r) => <span className="num">{r.winRatePct}%</span> },
                      { key: 'r', header: 'Net return', align: 'right', sortable: true, sortValue: (r) => r.netReturnPct, cell: (r) => <span className={cn('num', r.netReturnPct >= 0 ? 'text-pos' : 'text-neg')}>{formatPercent(r.netReturnPct)}</span> },
                      { key: 'd', header: 'Max DD', align: 'right', cell: (r) => <span className="num text-neg">-{r.maxDrawdownPct}%</span> },
                    ]}
                  />
                </Card>
                <Card title="Model risk warnings">
                  <ul className="space-y-2">
                    {result.warnings.map((w) => (
                      <li key={w} className="flex items-start gap-2 text-[12.5px] text-mut">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                        <span>{w}</span>
                      </li>
                    ))}
                    <li className="flex items-start gap-2 border-t border-line-soft pt-2 text-[12.5px] text-mut">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-neg" aria-hidden />
                      <span>Overfitting risk: parameter choices were reviewed on the same history used for evaluation. Treat the edge as provisional until validated on unseen data.</span>
                    </li>
                    <li className="flex items-start gap-2 text-[12.5px] text-mut">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                      <span>Insufficient historical data: regimes with fewer than 30 trades are statistically fragile.</span>
                    </li>
                  </ul>
                </Card>
              </div>
            </>
          ) : (
            <Card><EmptyState title="No results" description="Run a backtest to see performance." /></Card>
          )}
        </div>
      )}

      {tab === 'comparison' && (
        <div className="space-y-4">
          <Card title="Select strategies to compare" subtitle="Choose between two and five strategies">
            <div className="flex flex-wrap gap-2">
              {COMPARE_POOL.map((id) => {
                const active = selected.includes(id);
                const label = (strategies.data ?? []).find((s) => s.id === id)?.name ?? id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSelected((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 5 ? prev : [...prev, id],
                      )
                    }
                    className={cn(
                      'rounded-[4px] border px-2.5 py-1.5 text-[12px] transition-colors',
                      active ? 'border-gold/45 bg-gold/10 text-gold-2' : 'border-line text-mut hover:text-fg',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11.5px] text-mut-2">Select at least two strategies to render the comparison.</p>
          </Card>

          {selected.length < 2 ? (
            <Card><EmptyState title="Select at least two strategies" description="Comparison renders once two or more strategies are chosen." /></Card>
          ) : comparison.loading ? (
            <Card><SkeletonTable /></Card>
          ) : comparison.error ? (
            <Card><ErrorState message={comparison.error} onRetry={comparison.reload} /></Card>
          ) : comparison.data ? (
            <>
              <Card title="Net return comparison" subtitle="Simulated, after modelled costs">
                <BarList
                  items={comparison.data.rows.map((r) => ({
                    key: r.strategyId,
                    label: `${r.strategyName} · ${r.phase.replace('_', ' ').toLowerCase()}`,
                    value: r.metrics.netReturnPct,
                    tone: r.metrics.netReturnPct >= 0 ? 'positive' : 'negative',
                  }))}
                  valueFormatter={(v) => formatPercent(v)}
                />
              </Card>
              <Card title="Strategy comparison" dense flush>
                <DataTable
                  caption="Strategy comparison"
                  rows={comparison.data.rows}
                  rowKey={(r) => r.strategyId}
                  columns={[
                    { key: 'name', header: 'Strategy', cell: (r) => <span className="font-medium">{r.strategyName}</span> },
                    { key: 'phase', header: 'Phase', cell: (r) => <Badge tone="muted">{r.phase.replace('_', ' ')}</Badge> },
                    { key: 'ret', header: 'Net return', align: 'right', sortable: true, sortValue: (r) => r.metrics.netReturnPct, cell: (r) => <span className={cn('num', r.metrics.netReturnPct >= 0 ? 'text-pos' : 'text-neg')}>{formatPercent(r.metrics.netReturnPct)}</span> },
                    { key: 'win', header: 'Win rate', align: 'right', cell: (r) => <span className="num">{r.metrics.winRatePct}%</span> },
                    { key: 'pf', header: 'Profit factor', align: 'right', sortable: true, sortValue: (r) => r.metrics.profitFactor, cell: (r) => <span className="num">{r.metrics.profitFactor.toFixed(2)}</span> },
                    { key: 'dd', header: 'Max DD', align: 'right', cell: (r) => <span className="num text-neg">-{r.metrics.maxDrawdownPct}%</span> },
                    { key: 'sh', header: 'Sharpe', align: 'right', cell: (r) => <span className="num">{r.metrics.sharpe.toFixed(2)}</span> },
                    { key: 'n', header: 'Trades', align: 'right', cell: (r) => <span className="num">{r.metrics.tradeCount}</span> },
                  ]}
                />
              </Card>
            </>
          ) : null}
        </div>
      )}

      {tab === 'walkforward' && (
        <div className="space-y-4">
          <Card title="Testing methodology">
            <div className="grid gap-3 text-[12.5px] leading-relaxed text-mut md:grid-cols-3">
              <div className="panel-subtle p-3">
                <p className="section-title mb-1">In-sample</p>
                Parameters are optimised on the training window. Strong results here are expected and not evidence of a tradable edge.
              </div>
              <div className="panel-subtle p-3">
                <p className="section-title mb-1">Out-of-sample</p>
                The held-out window is never used for parameter selection. Degradation versus in-sample is the primary overfitting signal.
              </div>
              <div className="panel-subtle p-3">
                <p className="section-title mb-1">Walk-forward</p>
                The window rolls forward repeatedly; parameters are re-estimated each step and evaluated on the next unseen segment.
              </div>
            </div>
          </Card>

          <Card
            title="Phase results"
            actions={
              <SegmentedControl
                label="Test phase"
                value={phase}
                onChange={setPhase}
                options={PHASES.map((p) => ({ value: p.value, label: p.label }))}
              />
            }
          >
            {performance.loading ? (
              <Skeleton className="h-40 w-full" />
            ) : performance.error ? (
              <ErrorState message={performance.error} onRetry={performance.reload} />
            ) : result ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={phase === 'IN_SAMPLE' ? 'info' : phase === 'OUT_OF_SAMPLE' ? 'warning' : 'gold'}>
                    {phase.replace('_', ' ')}
                  </Badge>
                  <span className="text-[12.5px] text-mut">
                    {phase === 'OUT_OF_SAMPLE'
                      ? 'Held-out window results. Short sample — treat the edge as provisional.'
                      : phase === 'WALK_FORWARD'
                        ? 'Rolled re-optimisation across sequential windows.'
                        : 'Training window used for parameter selection.'}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatTile label="Net return" value={formatPercent(result.metrics.netReturnPct)} delta={result.metrics.netReturnPct} />
                  <StatTile label="Win rate" value={`${result.metrics.winRatePct}%`} sub={`${result.metrics.tradeCount} trades`} />
                  <StatTile label="Profit factor" value={result.metrics.profitFactor.toFixed(2)} sub={`Avg R:R ${result.metrics.averageRewardRisk.toFixed(2)}`} />
                  <StatTile label="Max drawdown" value={`-${result.metrics.maxDrawdownPct}%`} sub={`Sharpe ${result.metrics.sharpe.toFixed(2)}`} />
                </div>
                <EquityCurve points={result.equityCurve} initialCapital={result.initialCapital} height={180} />
              </div>
            ) : null}
          </Card>

          <Card title="Transaction cost & slippage configuration">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input label="Brokerage (bps)" type="number" value={costs.brokerageBps} onChange={(e) => setCosts({ ...costs, brokerageBps: Number(e.target.value) })} />
              <Input label="Slippage (bps)" type="number" value={costs.slippageBps} onChange={(e) => setCosts({ ...costs, slippageBps: Number(e.target.value) })} />
              <Input label="STT (bps)" type="number" value={costs.sttBps} onChange={(e) => setCosts({ ...costs, sttBps: Number(e.target.value) })} />
              <Input label="Exchange fees (bps)" type="number" value={costs.exchangeFeesBps} onChange={(e) => setCosts({ ...costs, exchangeFeesBps: Number(e.target.value) })} />
              <Input label="GST (%)" type="number" value={costs.gstPct} onChange={(e) => setCosts({ ...costs, gstPct: Number(e.target.value) })} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <StatTile label="Round-trip cost" value={`${gstApplied.toFixed(2)} bps`} sub={`${roundTripBps.toFixed(2)} bps before GST`} />
              <StatTile label="Cost of a 1% move" value={`${costOfOnePctMove.toFixed(3)}%`} sub="Drag per full round trip" />
              <div className="flex items-end">
                <Button variant="secondary" block onClick={() => performance.reload()} loading={performance.loading}>
                  Re-run with these costs
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-mut-2">
              Cost changes apply the next time the backtest runs. Figures are modelled estimates, not realised fills.
            </p>
          </Card>
        </div>
      )}

      {tab === 'trades' && (
        <Card
          title="Trade-by-trade history"
          subtitle={result ? `${result.trades.length} simulated trades` : 'Run a backtest first'}
          actions={
            <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={exportTrades} disabled={!result}>
              Export CSV
            </Button>
          }
          dense
          flush
        >
          {performance.loading ? (
            <SkeletonTable />
          ) : performance.error ? (
            <ErrorState message={performance.error} onRetry={performance.reload} />
          ) : !result ? (
            <EmptyState title="No trades yet" description="Run a backtest from the Performance tab." />
          ) : (
            <DataTable
              caption="Trade history"
              rows={result.trades}
              rowKey={(t) => t.id}
              dense
              columns={[
                { key: 'sym', header: 'Symbol', sortable: true, sortValue: (t) => t.symbol, cell: (t) => <span className="font-medium">{t.symbol}</span> },
                { key: 'dir', header: 'Side', cell: (t) => <Badge tone={t.direction === 'LONG' ? 'positive' : 'negative'}>{t.direction}</Badge> },
                { key: 'in', header: 'Entry time', sortable: true, sortValue: (t) => t.entryTime, cell: (t) => <span className="num text-mut">{t.entryTime.slice(0, 16).replace('T', ' ')}</span> },
                { key: 'out', header: 'Exit time', cell: (t) => <span className="num text-mut">{t.exitTime.slice(0, 16).replace('T', ' ')}</span> },
                { key: 'ep', header: 'Entry', align: 'right', cell: (t) => <span className="num">{formatNumber(t.entryPrice)}</span> },
                { key: 'xp', header: 'Exit', align: 'right', cell: (t) => <span className="num">{formatNumber(t.exitPrice)}</span> },
                { key: 'q', header: 'Qty', align: 'right', cell: (t) => <span className="num">{t.quantity}</span> },
                { key: 'g', header: 'Gross', align: 'right', cell: (t) => <span className={cn('num', t.grossPnl >= 0 ? 'text-pos' : 'text-neg')}>{formatNumber(t.grossPnl, 0)}</span> },
                { key: 'c', header: 'Costs', align: 'right', cell: (t) => <span className="num text-mut">{formatNumber(t.costs, 0)}</span> },
                { key: 'n', header: 'Net PnL', align: 'right', sortable: true, sortValue: (t) => t.netPnl, cell: (t) => <span className={cn('num font-medium', t.netPnl >= 0 ? 'text-pos' : 'text-neg')}>{formatNumber(t.netPnl, 0)}</span> },
                { key: 'r', header: 'R', align: 'right', cell: (t) => <span className="num">{t.rMultiple.toFixed(2)}</span> },
                { key: 'rs', header: 'Exit reason', cell: (t) => <span className="text-mut">{t.exitReason}</span> },
              ]}
            />
          )}
        </Card>
      )}
    </div>
  );
}

function SelectLike({
  label,
  value,
  onChange,
  options,
  loading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  loading?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mut">{label}</span>
      <select
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-[200px] rounded-[4px] border border-line bg-panel px-2.5 text-[12.5px] text-fg focus:border-gold/60 focus:outline-none"
      >
        {(loading ? [] : options).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function SkeletonTable() {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <span className="skeleton h-4 w-24" />
          <span className="skeleton h-4 flex-1" />
          <span className="skeleton h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
