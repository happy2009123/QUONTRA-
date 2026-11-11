import { useEffect, useMemo, useState } from 'react';
import { Play, RotateCcw, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
} from '@/components/ui';
import { EquityCurve } from '@/components/charts/EquityCurve';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatNumber, formatPercent } from '@/lib/format';
import { TIMEFRAMES } from '@/models';
import type { ConditionOperator, StrategyConfig, StrategyCondition, Timeframe } from '@/models';

const OPERATORS: ConditionOperator[] = [
  'CROSSES_ABOVE',
  'CROSSES_BELOW',
  'GREATER_THAN',
  'LESS_THAN',
  'WITHIN_RANGE',
];

const TIMEFRAME_OPTIONS = TIMEFRAMES.map((t) => ({ value: t, label: t }));
const DEFAULT_INSTRUMENTS = ['eq-reliance', 'eq-hdfcbank', 'intl-nvda'];

let conditionSeq = 0;
function newCondition(left = 'Close', operator: ConditionOperator = 'CROSSES_ABOVE', right = 'EMA20'): StrategyCondition {
  conditionSeq += 1;
  return { id: `c-${conditionSeq}`, left, operator, right, lookback: 1 };
}

function ConditionEditor({
  title,
  conditions,
  onChange,
}: {
  title: string;
  conditions: StrategyCondition[];
  onChange: (next: StrategyCondition[]) => void;
}) {
  const update = (id: string, patch: Partial<StrategyCondition>) =>
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="section-title">{title}</p>
        <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => onChange([...conditions, newCondition()])}>
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {conditions.length === 0 && (
          <p className="text-[12px] text-mut-2">No conditions — the strategy will trigger on every bar.</p>
        )}
        {conditions.map((c) => (
          <div key={c.id} className="panel-subtle flex flex-wrap items-end gap-2 p-2">
            <Input label="Left" hideLabel value={c.left} onChange={(e) => update(c.id, { left: e.target.value })} wrapperClassName="min-w-[110px] flex-1" />
            <Select
              label="Operator"
              hideLabel
              value={c.operator}
              options={OPERATORS.map((o) => ({ value: o, label: o.replace(/_/g, ' ') }))}
              onChange={(v) => update(c.id, { operator: v as ConditionOperator })}
              size="sm"
            />
            <Input label="Right" hideLabel value={c.right} onChange={(e) => update(c.id, { right: e.target.value })} wrapperClassName="min-w-[110px] flex-1" />
            <Input
              label="Lookback"
              hideLabel
              type="number"
              min={1}
              value={c.lookback}
              onChange={(e) => update(c.id, { lookback: Number(e.target.value) })}
              wrapperClassName="w-20"
            />
            <button
              type="button"
              aria-label="Remove condition"
              onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
              className="mb-1 rounded p-1.5 text-mut transition-colors hover:bg-neg/10 hover:text-neg"
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StrategyLab() {
  const strategies = useAsync(() => api.strategy.listStrategies(), []);
  const [strategyId, setStrategyId] = useState('str-ema-ribbon');
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [from, setFrom] = useState('2023-01-02');
  const [to, setTo] = useState('2026-06-30');
  const [capital, setCapital] = useState(1_000_000);
  const [riskPerTrade, setRiskPerTrade] = useState(1);
  const [dateError, setDateError] = useState<string | null>(null);
  const [runTick, setRunTick] = useState(0);

  const selectedStrategy = useMemo(
    () => strategies.data?.find((s) => s.id === strategyId) ?? null,
    [strategies.data, strategyId],
  );

  useEffect(() => {
    if (selectedStrategy) {
      setConfig(structuredClone(selectedStrategy));
      setTimeframe(selectedStrategy.timeframe);
    }
  }, [selectedStrategy]);

  useEffect(() => {
    setDateError(from >= to ? 'The start date must be before the end date.' : null);
  }, [from, to]);

  const backtest = useAsync(
    () => api.strategy.runBacktest(strategyId, DEFAULT_INSTRUMENTS),
    [strategyId, runTick],
    { enabled: runTick > 0 && !dateError },
  );

  const patch = (p: Partial<StrategyConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

  const result = backtest.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Quantitative"
        title="Quantitative Strategy Lab"
        description="Configure indicators, entry and exit logic, risk geometry and the historical test window, then run a simulated backtest."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<RotateCcw size={14} />}
              onClick={() => selectedStrategy && setConfig(structuredClone(selectedStrategy))}
              disabled={!selectedStrategy}
            >
              Reset defaults
            </Button>
            <Button
              variant="primary"
              icon={<Play size={14} />}
              loading={backtest.loading}
              disabled={Boolean(dateError) || !config}
              onClick={() => setRunTick((t) => t + 1)}
            >
              Run simulated backtest
            </Button>
          </div>
        }
        meta={<Badge tone="gold" dot>Simulated results only</Badge>}
      />

      <div className="rounded-[5px] border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn" role="note">
        All results below are simulated with modelled costs and slippage. No orders are sent to any broker and these
        figures are not actual trading performance.
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="min-w-0 space-y-4">
          <Card title="Strategy" subtitle={config?.description}>
            {strategies.loading ? (
              <Skeleton className="h-8 w-full" />
            ) : strategies.error ? (
              <ErrorState message={strategies.error} onRetry={strategies.reload} />
            ) : (
              <Select
                label="Strategy"
                hideLabel
                value={strategyId}
                options={(strategies.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.family}` }))}
                onChange={setStrategyId}
              />
            )}
          </Card>

          {config && (
            <>
              <Card title="Indicator configuration">
                <div className="space-y-2">
                  {config.indicators.map((ind) => (
                    <div key={ind.id} className="flex flex-wrap items-center gap-2 border-b border-line-soft pb-2 last:border-0 last:pb-0">
                      <label className="flex min-w-[150px] flex-1 cursor-pointer items-center gap-2 text-[12.5px] text-fg">
                        <input
                          type="checkbox"
                          checked={ind.enabled}
                          onChange={(e) =>
                            patch({
                              indicators: config.indicators.map((i) =>
                                i.id === ind.id ? { ...i, enabled: e.target.checked } : i,
                              ),
                            })
                          }
                          className="h-3.5 w-3.5 accent-[#C6A15B]"
                        />
                        {ind.label}
                      </label>
                      {Object.entries(ind.params).map(([key, value]) => (
                        <Input
                          key={key}
                          label={key}
                          hideLabel
                          type="number"
                          value={value}
                          wrapperClassName="w-20"
                          onChange={(e) =>
                            patch({
                              indicators: config.indicators.map((i) =>
                                i.id === ind.id ? { ...i, params: { ...i.params, [key]: Number(e.target.value) } } : i,
                              ),
                            })
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Entry conditions">
                <ConditionEditor
                  title="Long/short entry"
                  conditions={config.entryConditions}
                  onChange={(next) => patch({ entryConditions: next })}
                />
              </Card>

              <Card title="Exit conditions">
                <ConditionEditor
                  title="Exit triggers"
                  conditions={config.exitConditions}
                  onChange={(next) => patch({ exitConditions: next })}
                />
              </Card>

              <Card title="Risk geometry & test window">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Stop-loss mode"
                    value={config.stopLoss.mode}
                    options={[
                      { value: 'FIXED_PCT', label: 'Fixed %' },
                      { value: 'ATR_MULTIPLE', label: 'ATR multiple' },
                    ]}
                    onChange={(v) => patch({ stopLoss: { ...config.stopLoss, mode: v as 'FIXED_PCT' | 'ATR_MULTIPLE' } })}
                  />
                  <Input
                    label="Stop value"
                    type="number"
                    step="0.1"
                    value={config.stopLoss.value}
                    onChange={(e) => patch({ stopLoss: { ...config.stopLoss, value: Number(e.target.value) } })}
                  />
                  <Input
                    label="Target 1 (%)"
                    type="number"
                    step="0.1"
                    value={config.targets.target1Pct}
                    onChange={(e) => patch({ targets: { ...config.targets, target1Pct: Number(e.target.value) } })}
                  />
                  <Input
                    label="Target 2 (%)"
                    type="number"
                    step="0.1"
                    value={config.targets.target2Pct}
                    onChange={(e) => patch({ targets: { ...config.targets, target2Pct: Number(e.target.value) } })}
                  />
                  <Select label="Timeframe" value={timeframe} options={TIMEFRAME_OPTIONS} onChange={(v) => setTimeframe(v as Timeframe)} />
                  <Select
                    label="Exit mode"
                    value={config.exitMode}
                    options={[
                      { value: 'TARGET_STOP', label: 'Target / stop' },
                      { value: 'TRAILING', label: 'Trailing stop' },
                      { value: 'TIME_BASED', label: 'Time based' },
                      { value: 'SIGNAL_FLIP', label: 'Signal flip' },
                    ]}
                    onChange={(v) => patch({ exitMode: v as StrategyConfig['exitMode'] })}
                  />
                  <Input label="Test from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  <Input label="Test to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  <Input
                    label="Initial capital"
                    type="number"
                    value={capital}
                    onChange={(e) => setCapital(Number(e.target.value))}
                  />
                  <Input
                    label="Risk per trade (%)"
                    type="number"
                    step="0.1"
                    value={riskPerTrade}
                    onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                  />
                </div>
                {dateError && <p className="mt-2 text-[12px] text-neg">{dateError}</p>}
                <p className="mt-3 text-[11.5px] text-mut-2">
                  Window {from} → {to} · capital {formatNumber(capital, 0)} · risk {riskPerTrade}% per trade · {timeframe} bars
                </p>
              </Card>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {runTick === 0 ? (
            <Card>
              <EmptyState
                title="No backtest run yet"
                description="Configure the strategy on the left, then run a simulated backtest to see the equity curve, metrics and trade history."
                action={
                  <Button variant="primary" icon={<Play size={14} />} onClick={() => setRunTick(1)}>
                    Run simulated backtest
                  </Button>
                }
              />
            </Card>
          ) : backtest.loading ? (
            <Card><div className="space-y-3"><Skeleton className="h-5 w-56" /><Skeleton className="h-56 w-full" /><Skeleton className="h-40 w-full" /></div></Card>
          ) : backtest.error ? (
            <Card><ErrorState message={backtest.error} onRetry={backtest.reload} /></Card>
          ) : result ? (
            <>
              <Card
                title={`Simulated equity — ${result.strategyName}`}
                subtitle={`${result.window.from} → ${result.window.to} · ${result.phase.replace('_', '-')} · initial capital ${formatNumber(result.initialCapital, 0)}`}
                actions={<Badge tone="warning">Simulated</Badge>}
              >
                <EquityCurve points={result.equityCurve} initialCapital={result.initialCapital} />
              </Card>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile label="Net return (after costs)" value={formatPercent(result.metrics.netReturnPct)} sub={`Net profit ${formatNumber(result.metrics.netProfitAfterCosts, 0)}`} delta={result.metrics.netReturnPct} />
                <StatTile label="Win rate" value={`${result.metrics.winRatePct}%`} sub={`${result.metrics.tradeCount} trades`} />
                <StatTile label="Profit factor" value={result.metrics.profitFactor.toFixed(2)} sub={`Avg R:R ${result.metrics.averageRewardRisk.toFixed(2)}`} />
                <StatTile label="Maximum drawdown" value={`-${result.metrics.maxDrawdownPct}%`} sub={`Sharpe ${result.metrics.sharpe.toFixed(2)}`} />
              </div>

              <Card title="Model risk & warnings">
                <ul className="space-y-1.5">
                  {result.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-[12.5px] text-mut">
                      <Badge tone="warning">Note</Badge>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Performance by market regime" dense flush>
                <DataTable
                  caption="Simulated performance by regime"
                  rows={result.regimeBreakdown}
                  rowKey={(r) => r.regime}
                  columns={[
                    { key: 'regime', header: 'Regime', cell: (r) => <Badge tone="neutral">{r.regime.replace('_', ' ')}</Badge> },
                    { key: 'trades', header: 'Trades', align: 'right', cell: (r) => <span className="num">{r.tradeCount}</span> },
                    { key: 'win', header: 'Win rate', align: 'right', cell: (r) => <span className="num">{r.winRatePct}%</span> },
                    { key: 'ret', header: 'Net return', align: 'right', sortable: true, sortValue: (r) => r.netReturnPct, cell: (r) => <span className={cn('num', r.netReturnPct >= 0 ? 'text-pos' : 'text-neg')}>{formatPercent(r.netReturnPct)}</span> },
                    { key: 'dd', header: 'Max DD', align: 'right', cell: (r) => <span className="num text-neg">-{r.maxDrawdownPct}%</span> },
                  ]}
                />
              </Card>

              <Card title="Simulated trade history" subtitle={`${result.trades.length} most recent trades`} dense flush>
                <DataTable
                  caption="Simulated trades"
                  rows={result.trades}
                  rowKey={(t) => t.id}
                  dense
                  columns={[
                    { key: 'sym', header: 'Symbol', cell: (t) => <span className="font-medium">{t.symbol}</span> },
                    { key: 'dir', header: 'Side', cell: (t) => <Badge tone={t.direction === 'LONG' ? 'positive' : 'negative'}>{t.direction}</Badge> },
                    { key: 'entry', header: 'Entry', align: 'right', cell: (t) => <span className="num">{formatNumber(t.entryPrice)}</span> },
                    { key: 'exit', header: 'Exit', align: 'right', cell: (t) => <span className="num">{formatNumber(t.exitPrice)}</span> },
                    { key: 'qty', header: 'Qty', align: 'right', cell: (t) => <span className="num">{t.quantity}</span> },
                    { key: 'net', header: 'Net PnL', align: 'right', sortable: true, sortValue: (t) => t.netPnl, cell: (t) => <span className={cn('num', t.netPnl >= 0 ? 'text-pos' : 'text-neg')}>{formatNumber(t.netPnl, 0)}</span> },
                    { key: 'r', header: 'R', align: 'right', cell: (t) => <span className="num">{t.rMultiple.toFixed(2)}</span> },
                    { key: 'reason', header: 'Exit reason', cell: (t) => <span className="text-mut">{t.exitReason}</span> },
                  ]}
                />
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
