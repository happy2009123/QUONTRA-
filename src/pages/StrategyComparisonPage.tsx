import { useState } from 'react';
import { Play } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { formatPrice } from '@/lib/format';
import {
  STRATEGY_DEFINITIONS,
  evaluateInstrument,
  type InstrumentDecision,
  type StrategyResult,
  type UserStrategyConfig,
} from '@/lib/strategyEngine';
import type { Candle, Timeframe } from '@/models';

export default function StrategyComparisonPage() {
  const instruments = useAsync(() => api.market.listInstruments(), []);
  const [instrumentId, setInstrumentId] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([]);
  const [decision, setDecision] = useState<InstrumentDecision | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedInstrument = instruments.data?.find((i) => i.id === instrumentId) ?? null;
  const allSelected = STRATEGY_DEFINITIONS.length > 0 && selectedStrategyIds.length === STRATEGY_DEFINITIONS.length;

  const toggleStrategy = (id: string) => {
    setSelectedStrategyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (allSelected) setSelectedStrategyIds([]);
    else setSelectedStrategyIds(STRATEGY_DEFINITIONS.map((d) => d.id));
  };

  const runComparison = async () => {
    if (!instrumentId || selectedStrategyIds.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const candlesResp = await api.market.getCandles(instrumentId, timeframe, 400);
      const quotesResp = await api.market.getQuotes([instrumentId]);
      const candles: Candle[] = candlesResp.data.candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      const quote = quotesResp.data[0]?.quote ?? { lastPrice: 0, instrumentId };

      const userConfig = {
        combination: { operator: 'OR' as const, minConfirmations: 1, requireHigherTimeframeConfirmation: false },
        strategies: STRATEGY_DEFINITIONS.map((d) => ({
          strategyId: d.id,
          enabled: selectedStrategyIds.includes(d.id),
          parameters: Object.fromEntries(d.parameters.map((p) => [p.id, p.default])),
          stopLoss: d.defaultStopLoss,
          targets: d.defaultTargets,
        })) as UserStrategyConfig[],
        timeframes: [timeframe],
        minRiskReward: 1,
        maxSpreadBps: 20,
        minLiquidity: 'MEDIUM' as const,
      };

      const d = evaluateInstrument(
        instrumentId,
        selectedInstrument?.symbol ?? instrumentId,
        selectedInstrument?.market ?? 'OTHER',
        selectedInstrument?.exchange ?? 'OTHER',
        candles,
        quote,
        userConfig,
      );
      setDecision(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  if (instruments.loading) return <Skeleton className="h-48 w-full" />;
  if (instruments.error) return <ErrorState message={instruments.error} onRetry={instruments.reload} />;
  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;

  const comparable = decision ? decision.strategyResults.filter((r) => selectedStrategyIds.includes(r.strategyId)) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Strategy Comparison"
        title="Compare Strategies"
        description="Compare multiple strategies on the same instrument. Shows signals, agreement/disagreement, and per-strategy quality scores. No strategy is claimed superior without validated evidence."
        actions={
          <Button variant="primary" icon={<Play size={14} />} loading={running} disabled={!instrumentId || selectedStrategyIds.length === 0} onClick={runComparison}>
            Run comparison
          </Button>
        }
        meta={<Badge tone="gold" dot>Simulation only</Badge>}
      />

      <InfoHint text="Select two or more strategies to compare. Agreement shows where strategies align; disagreement highlights conflicting signals on the same chart." />

      <div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2 space-y-4">
          <Card title="Instrument & strategy selection">
            <Select
              label="Instrument"
              value={instrumentId}
              options={(instruments.data ?? []).map((i) => ({ value: i.id, label: `${i.symbol} · ${i.name}` }))}
              onChange={setInstrumentId}
              size="md"
            />
            <Select
              label="Timeframe"
              value={timeframe}
              options={['1m', '5m', '15m', '30m', '1h', '4h', '1D'].map((t) => ({ value: t, label: t }))}
              onChange={(v) => setTimeframe(v as Timeframe)}
              size="md"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              className="w-full text-left"
            >
              {allSelected ? 'Deselect all' : 'Select all'} ({selectedStrategyIds.length} of {STRATEGY_DEFINITIONS.length})
            </Button>
            <div className="grid gap-2 sm:grid-cols-2 mt-3">
              {STRATEGY_DEFINITIONS.map((d) => (
                <label key={d.id} className="flex items-center gap-2 p-1.5 rounded border border-line-soft hover:bg-panel cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedStrategyIds.includes(d.id)}
                    onChange={() => toggleStrategy(d.id)}
                    className="h-3.5 w-3.5 accent-[#C6A15B]"
                  />
                  <span className="text-[11.5px] text-fg">{d.name}</span>
                </label>
              ))}
            </div>
          </Card>
        </div>

        <div className="md:col-span-2 space-y-4">
          {!decision ? (
            <EmptyState title="No comparison yet" description="Select an instrument and at least one strategy, then run the comparison." />
          ) : (
            <>
              <Card title={`Comparison — ${selectedInstrument?.symbol ?? instrumentId}`} subtitle={`${comparable.length} strategies evaluated`}>
                <div className="grid gap-3 sm:grid-cols-4 p-2 border border-line-soft bg-panel/30">
                  <StatTile label="Agreement" value={`${decision.agreementCount} / ${decision.totalEnabled}`} sub={`${decision.primaryDecision} decision`} />
                  <StatTile label="Quality score" value={decision.strategyQualityScore} sub="Confluence /100" />
                  <StatTile label="Passed" value={decision.conditionsPassedTotal} sub="Conditions met" />
                  <StatTile label="Failed" value={decision.conditionsFailedTotal} sub="Conditions not met" />
                </div>
              </Card>

              <Card title="Strategy signals" dense flush>
                <DataTable
                  caption="Per-strategy signals on same instrument"
                  rows={comparable}
                  rowKey={(r: StrategyResult) => r.strategyId}
                  columns={[
                    { key: 'name', header: 'Strategy', cell: (r: StrategyResult) => <span className="font-medium">{r.strategyName}</span> },
                    { key: 'cat', header: 'Category', cell: (r: StrategyResult) => <Badge tone="neutral">{r.category}</Badge> },
                    { key: 'dir', header: 'Signal', align: 'center', cell: (r: StrategyResult) => <Badge tone={r.direction === 'BUY' ? 'positive' : r.direction === 'SELL' ? 'negative' : r.direction === 'WATCH' ? 'warning' : 'muted'}>{r.direction}</Badge> },
                    { key: 'score', header: 'Score', align: 'right', cell: (r: StrategyResult) => <span className="num font-mono">{r.score}</span> },
                    { key: 'entry', header: 'Entry', align: 'right', cell: (r: StrategyResult) => (r.entryZone ? <span className="num">{formatPrice((r.entryZone.low + r.entryZone.high) / 2)}</span> : <span className="text-mut">—</span>) },
                  ]}
                />
              </Card>

              {comparable.some((r) => r.direction === 'BUY') && comparable.some((r) => r.direction === 'SELL') && (
                <Card title="Signal conflict" subtitle="Strategies disagree on direction">
                  <div className="p-2 border border-neg/20 bg-neg/5">
                    <div className="text-[11px] uppercase text-neg tracking-wider mb-1">Conflicting signals detected</div>
                    <p className="text-[11px] text-neg">
                      Some strategies signal BUY while others signal SELL. The combined decision follows your
                      configured combination logic. Review individual strategy results before acting.
                    </p>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
