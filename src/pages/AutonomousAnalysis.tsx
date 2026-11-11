import { useCallback, useState } from 'react';
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
import { cn } from '@/lib/cn';
import { formatPrice } from '@/lib/format';
import {
  evaluateInstrument,
  STRATEGY_DEFINITIONS,
  type InstrumentDecision,
  type StrategyResult,
} from '@/lib/strategyEngine';
import type { Candle, Timeframe } from '@/models';
import { PriceChart } from '@/components/charts/PriceChart';
import { DataBadge } from '@/components/ui';

function conditionChip(c: { description: string; passed: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-1 rounded text-[10px]', c.passed ? 'bg-pos/10 text-pos border border-pos/20' : 'bg-neg/10 text-neg border border-neg/20')}>
      {c.passed ? '✓' : '✗'} {c.description}
    </span>
  );
}

function StrategyResultRow({ result }: { result: StrategyResult }) {
  return (
    <Card className="border-line-soft p-2 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge tone={result.direction === 'BUY' ? 'positive' : result.direction === 'SELL' ? 'negative' : 'muted'}>
              {result.direction}
            </Badge>
            <Badge tone="neutral">{result.category}</Badge>
            <span className="text-[10px] text-mut-2">{result.timeframe}</span>
          </div>
          <h4 className="text-sm font-semibold text-fg">{result.strategyName}</h4>
          <p className="text-[11px] text-mut">{result.rationale}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-mono text-fg">{result.score}</div>
          <span className="text-[10px] text-mut">Score /100</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {result.conditionsPassed.map((c) => conditionChip(c))}
        {result.conditionsFailed.map((c) => conditionChip(c))}
      </div>
      {result.entryTrigger && (
        <p className="mt-1 text-[10px] text-mut-2">Trigger: {result.entryTrigger}</p>
      )}
    </Card>
  );
}

export default function AutonomousAnalysis() {
  const instruments = useAsync(() => api.market.listInstruments(), []);
  const [instrumentId, setInstrumentId] = useState<string>('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
const [decision, setDecision] = useState<InstrumentDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [candlesState, setCandlesState] = useState<Candle[]>([]);

const selectedInstrument = instruments.data?.find((i) => i.id === instrumentId) ?? null;

const runAnalysis = useCallback(async () => {
  if (!instrumentId) return;
  setRunning(true);
  setError(null);
  try {
    const candlesResp = await api.market.getCandles(instrumentId, timeframe, 400);
    const quotesResp = await api.market.getQuotes([instrumentId]);
    const quote = quotesResp.data[0]?.quote ?? { lastPrice: 0, instrumentId };
    const candles: Candle[] = candlesResp.data.candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    setCandlesState(candles);
    const userConfig = {
        combination: { operator: 'OR' as const, minConfirmations: 1, requireHigherTimeframeConfirmation: false },
      strategies: STRATEGY_DEFINITIONS.map((d) => ({
        strategyId: d.id,
        enabled: true,
        parameters: Object.fromEntries(d.parameters.map((p) => [p.id, p.default])),
        stopLoss: d.defaultStopLoss,
        targets: d.defaultTargets,
      })),
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
}, [instrumentId, timeframe, selectedInstrument]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Autonomous Analysis"
        title="Chart Investigation"
        description="QUANTORA automatically investigates the selected instrument, runs every enabled strategy, and generates a combined BUY / SELL / HOLD / NO TRADE / WATCH decision."
        actions={
          <Button variant="primary" icon={<Play size={14} />} loading={running} disabled={!instrumentId} onClick={runAnalysis}>
            Run autonomous analysis
          </Button>
        }
        meta={<Badge tone="gold" dot>Simulation only</Badge>}
      />

      <InfoHint text="Every price and signal is labelled with its source and freshness. Demo values are marked DEMO and are never presented as live market data. No orders are sent to any broker." />

      {error && <ErrorState message={error} onRetry={runAnalysis} />}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2 space-y-4">
          <Card title="Instrument selection">
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
          </Card>

          {instruments.loading ? (
            <Card><Skeleton className="h-56 w-full" /></Card>
          ) : instruments.error ? (
            <Card><ErrorState message={instruments.error} onRetry={instruments.reload} /></Card>
          ) : selectedInstrument ? (
            <Card title={`Chart — ${selectedInstrument.symbol}`} subtitle={`Market: ${selectedInstrument.market} · Exchange: ${selectedInstrument.exchange}`}>
              <PriceChart
                candles={candlesState}
                style="CANDLES"
                indicators={['EMA_9', 'EMA_20', 'SMA_20', 'VWAP', 'RSI', 'MACD']}
                className="mb-2"
                minHeight={400}
              />
              <DataBadge
                freshness="DEMO"
                source={{ provider: 'QUANTORA', origin: 'SIMULATED', isDemo: true, reliability: 'PROVISIONAL' }}
                updatedAt={new Date().toISOString()}
              />
            </Card>
          ) : (
            <EmptyState title="Select an instrument" description="Choose an instrument from the dropdown to begin autonomous analysis." />
          )}
        </div>

        <div className="md:col-span-2 space-y-4">
          {!decision ? (
            <EmptyState title="No analysis yet" description="Select an instrument and run autonomous analysis to see the combined decision." />
          ) : (
            <>
              <Card title="Primary decision" subtitle={decision.reason}>
                <div className="flex items-center justify-between gap-4 p-3">
                  <div>
                    <div className="text-[11px] uppercase text-mut-2 tracking-wider">Decision</div>
                    <div className={cn('text-2xl font-bold mt-1', decision.primaryDecision === 'BUY' ? 'text-pos' : decision.primaryDecision === 'SELL' ? 'text-neg' : 'text-mut')}>
                      {decision.primaryDecision}
                    </div>
                    {decision.direction && (
                      <div className="text-[11px] text-mut">Direction: {decision.direction}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase text-mut-2 tracking-wider">Quality score</div>
                    <div className="text-xl font-mono text-fg">{decision.strategyQualityScore}</div>
                    <span className="text-[10px] text-mut">Confluence, not probability</span>
                  </div>
                </div>
                {decision.entryTrigger && (
                  <div className="p-2 border border-line-soft bg-panel/30">
                    <div className="text-[11px] uppercase text-mut-2 tracking-wider mb-1">Entry trigger</div>
                    <div className="text-sm text-fg">{decision.entryTrigger}</div>
                    {decision.entryZone && (
                      <div className="mt-1 text-[11px] text-mut">
                        Zone: {formatPrice(decision.entryZone.low)} → {formatPrice(decision.entryZone.high)}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-3 p-2 border border-line-soft bg-panel/30">
                  <StatTile label="Stop loss" value={decision.stopLoss != null ? formatPrice(decision.stopLoss) : '—'} />
                  <StatTile label="Target 1" value={decision.target1 != null ? formatPrice(decision.target1) : '—'} />
                  <StatTile label="Target 2" value={decision.target2 != null ? formatPrice(decision.target2) : '—'} />
                </div>
                {decision.riskReward != null && (
                  <div className="p-2 border border-line-soft bg-panel/30">
                    <div className="text-[11px] uppercase text-mut-2 tracking-wider mb-1">Risk / reward</div>
                    <div className="text-sm text-fg">{decision.riskReward.toFixed(2)}</div>
                  </div>
                )}
                {decision.risks.length > 0 && (
                  <div className="p-2 border border-neg/20 bg-neg/5">
                    <div className="text-[11px] uppercase text-neg tracking-wider mb-1">Risks</div>
                    <ul className="text-[11px] text-neg space-y-1">
                      {decision.risks.map((r) => ( <li key={r}>• {r}</li> ))}
                    </ul>
                  </div>
                )}
              </Card>

              <Card title={`Strategy results (${decision.strategyResults.length})`} subtitle={`${decision.agreementCount} of ${decision.totalEnabled} enabled strategies agree`} dense flush>
                <DataTable
                  caption="Per-strategy evaluation"
                  rows={decision.strategyResults}
                  rowKey={(r) => r.strategyId}
                  columns={[
                    { key: 'name', header: 'Strategy', cell: (r) => <span className="font-medium">{r.strategyName}</span> },
                    { key: 'dir', header: 'Signal', align: 'center', cell: (r) => <Badge tone={r.direction === 'BUY' ? 'positive' : r.direction === 'SELL' ? 'negative' : r.direction === 'WATCH' ? 'warning' : 'muted'}>{r.direction}</Badge> },
                    { key: 'score', header: 'Score', align: 'right', cell: (r) => <span className="num font-mono">{r.score}</span> },
                    { key: 'passed', header: 'Passed', align: 'right', cell: (r) => <span className="num text-pos">{r.conditionsPassed.filter((p) => p.passed).length}</span> },
                    { key: 'failed', header: 'Failed', align: 'right', cell: (r) => <span className="num text-neg">{r.conditionsFailed.filter((f) => !f.passed).length}</span> },
                  ]}
                />
              </Card>

              <Card title="Strategy details" dense flush>
                <div className="space-y-2">
                  {decision.strategyResults.map((r) => (
                    <StrategyResultRow key={r.strategyId} result={r} />
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
