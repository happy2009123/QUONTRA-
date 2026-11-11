import { useCallback, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { formatPrice } from '@/lib/format';
import {
  evaluateInstrument,
  STRATEGY_DEFINITIONS,
  type InstrumentDecision,
} from '@/lib/strategyEngine';
import type { Candle, MarketCategory, Timeframe } from '@/models';

export default function PersonalizedScannerPage() {
  const instruments = useAsync(() => api.market.listInstruments(), []);
  const [marketFilter, setMarketFilter] = useState<MarketCategory | 'ALL'>('ALL');
  const [timeframe, setTimeframe] = useState<Timeframe>('1h');
  const [minScore, setMinScore] = useState(40);
  const [results, setResults] = useState<InstrumentDecision[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
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

      const list = instruments.data ?? [];
      const decisions: InstrumentDecision[] = [];

      for (const inst of list) {
        if (marketFilter !== 'ALL' && inst.market !== marketFilter) continue;

        try {
          const candlesResp = await api.market.getCandles(inst.id, timeframe, 400);
          const quotesResp = await api.market.getQuotes([inst.id]);
          const candles: Candle[] = candlesResp.data.candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
          const quote = quotesResp.data[0]?.quote ?? { lastPrice: 0, instrumentId: inst.id };

          const d = evaluateInstrument(
            inst.id,
            inst.symbol,
            inst.market,
            inst.exchange,
            candles,
            quote,
            userConfig,
          );
          if (d.primaryDecision !== 'NO_TRADE' && d.strategyQualityScore >= minScore) {
            decisions.push(d);
          }
        } catch {}
      }

      decisions.sort((a, b) => b.strategyQualityScore - a.strategyQualityScore);
      setResults(decisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [instruments.data, marketFilter, timeframe, minScore]);

  if (instruments.loading) return <Skeleton className="h-48 w-full" />;
  if (instruments.error) return <ErrorState message={instruments.error} onRetry={instruments.reload} />;
  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;

  const markets = useMemo(
    () => [...new Set((instruments.data ?? []).map((i) => i.market))] as MarketCategory[],
    [instruments.data],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Personalized Scanner"
        title="Global Market Scan"
        description="Scan all supported instruments using your selected strategies and configuration. Ranked by transparent strategy-quality criteria. If no setup qualifies, NO QUALIFIED SETUPS is shown."
        actions={
          <Button variant="primary" icon={<Play size={14} />} loading={scanning} disabled={!instruments.data} onClick={runScan}>
            Scan markets
          </Button>
        }
        meta={<Badge tone="gold" dot>Simulation only</Badge>}
      />

      <InfoHint text="Every instrument is evaluated independently with the same deterministic rules. Results are ranked by strategy-quality score (0–100 confluence, not probability). Demo values are labelled DEMO." />

      <div className="grid gap-4 sm:grid-cols-4">
        <Select
          label="Market"
          value={marketFilter}
          options={[{ value: 'ALL', label: 'All markets' }, ...markets.map((m) => ({ value: m, label: m }))]}
          onChange={setMarketFilter}
          size="sm"
        />
        <Select
          label="Timeframe"
          value={timeframe}
          options={['1m', '5m', '15m', '30m', '1h', '4h', '1D'].map((t) => ({ value: t, label: t }))}
          onChange={(v) => setTimeframe(v as Timeframe)}
          size="sm"
        />
        <Input
          label="Min score"
          type="number"
          min={0}
          max={100}
          value={minScore}
          onChange={(e) => setMinScore(Number(e.target.value))}
          wrapperClassName="w-32"
        />
        <StatTile label="Instruments" value={(instruments.data ?? []).length} sub="Scanned" />
      </div>

      {results.length === 0 && !scanning ? (
        <EmptyState
          title="NO QUALIFIED SETUPS"
          description="No instruments met your configured strategy and score thresholds. Adjust min score, market filter, or timeframe and scan again."
          action={
            <Button variant="primary" icon={<Play size={14} />} onClick={runScan}>
              Scan again
            </Button>
          }
        />
      ) : (
        <DataTable
          caption={results.length === 0 ? 'Scanning…' : `Qualified opportunities (${results.length})`}
          rows={results}
          rowKey={(r) => r.instrumentId}
          columns={[
            { key: 'symbol', header: 'Symbol', cell: (r) => <span className="font-medium">{r.symbol}</span> },
            { key: 'market', header: 'Market', cell: (r) => <Badge tone="neutral">{r.market}</Badge> },
            { key: 'price', header: 'Price', align: 'right', cell: (r) => <span className="num">{formatPrice(r.lastPrice)}</span> },
            { key: 'decision', header: 'Decision', align: 'center', cell: (r) => <Badge tone={r.primaryDecision === 'BUY' ? 'positive' : r.primaryDecision === 'SELL' ? 'negative' : 'muted'}>{r.primaryDecision}</Badge> },
            { key: 'score', header: 'Score', align: 'right', cell: (r) => <span className="num font-mono">{r.strategyQualityScore}</span> },
            { key: 'agree', header: 'Agreement', align: 'right', cell: (r) => <span className="num">{r.agreementCount} / {r.totalEnabled}</span> },
          ]}
          emptyTitle="No qualified setups"
          emptyDescription="No instruments cleared the score threshold."
        />
      )}
    </div>
  );
}
