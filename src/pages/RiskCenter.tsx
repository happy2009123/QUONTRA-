import { useMemo, useState } from 'react';
import { Calculator, Info, ShieldAlert } from 'lucide-react';
import {
  Badge,
  Card,
  DataBadge,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatTile,
} from '@/components/ui';
import { BarList } from '@/components/charts/BarList';
import { CorrelationMatrix } from '@/components/charts/CorrelationMatrix';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatNumber, formatPrice } from '@/lib/format';
import type { PositionSizerInput, PositionSizerResult, RiskRewardInput, RiskRewardResult } from '@/models';

function sizePosition(input: PositionSizerInput): PositionSizerResult {
  const riskAmount = (input.accountBalance * input.riskPerTradePct) / 100;
  const riskPerUnit = Math.abs(input.entryPrice - input.stopPrice);
  if (riskPerUnit <= 0) {
    return {
      riskAmount,
      riskPerUnit: 0,
      positionSize: 0,
      positionNotional: 0,
      positionWeightPct: 0,
      validation: 'INVALID_STOP',
      message: 'Stop price must differ from the entry price.',
    };
  }
  const positionSize = Math.floor(riskAmount / riskPerUnit);
  const positionNotional = positionSize * input.entryPrice;
  const positionWeightPct = (positionNotional / input.accountBalance) * 100;
  if (positionSize < 1) {
    return {
      riskAmount,
      riskPerUnit,
      positionSize: 0,
      positionNotional: 0,
      positionWeightPct: 0,
      validation: 'BELOW_MIN_LOT',
      message: 'Calculated size rounds down to zero — reduce risk distance or increase balance.',
    };
  }
  if (positionWeightPct > 100) {
    return {
      riskAmount,
      riskPerUnit,
      positionSize,
      positionNotional,
      positionWeightPct,
      validation: 'EXCEEDS_EXPOSURE_LIMIT',
      message: 'Position notional exceeds the account balance. Reduce size.',
    };
  }
  return {
    riskAmount,
    riskPerUnit,
    positionSize,
    positionNotional,
    positionWeightPct,
    validation: 'OK',
    message: 'Position size is within the configured risk budget.',
  };
}

function riskReward(input: RiskRewardInput): RiskRewardResult {
  const riskPerUnit =
    input.direction === 'LONG' ? input.entryPrice - input.stopPrice : input.stopPrice - input.entryPrice;
  const rewardPerUnit =
    input.direction === 'LONG' ? input.targetPrice - input.entryPrice : input.entryPrice - input.targetPrice;
  const valid = riskPerUnit > 0 && rewardPerUnit > 0;
  return {
    riskPerUnit: Math.abs(riskPerUnit),
    rewardPerUnit: Math.abs(rewardPerUnit),
    ratio: valid ? rewardPerUnit / riskPerUnit : 0,
    riskPct: input.entryPrice > 0 ? (Math.abs(riskPerUnit) / input.entryPrice) * 100 : 0,
    rewardPct: input.entryPrice > 0 ? (Math.abs(rewardPerUnit) / input.entryPrice) * 100 : 0,
    valid,
  };
}

export default function RiskCenter() {
  const account = useAsync(() => api.risk.getAccount(), []);
  const positions = useAsync(() => api.risk.getPositions(), []);
  const correlation = useAsync(() => api.risk.getCorrelation(), []);
  const metrics = useAsync(() => api.risk.getPortfolioMetrics(), []);

  const [sizer, setSizer] = useState<PositionSizerInput>({
    accountBalance: 2_500_000,
    riskPerTradePct: 1,
    entryPrice: 1428.55,
    stopPrice: 1400,
    instrumentCurrency: 'INR',
  });
  const [rr, setRr] = useState<RiskRewardInput>({ entryPrice: 1428.55, stopPrice: 1400, targetPrice: 1480, direction: 'LONG' });

  const sizerResult = useMemo(() => sizePosition(sizer), [sizer]);
  const rrResult = useMemo(() => riskReward(rr), [rr]);

  const exposureItems = (positions.data ?? []).map((p) => ({
    key: p.instrumentId,
    label: `${p.symbol} · ${p.side}`,
    value: p.weightPct,
    tone: (p.weightPct > 20 ? 'negative' : p.side === 'LONG' ? 'positive' : 'negative') as 'positive' | 'negative',
    sub: `Notional ${formatNumber(p.notional, 0)} · PnL ${formatNumber(p.unrealizedPnl, 0)} · stop ${p.stopDistancePct}%`,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Risk"
        title="Risk Management Center"
        description="Institutional monitoring of a simulated account: exposure, correlation, portfolio risk and sizing calculators."
        actions={<Badge tone="gold" dot>Simulation only</Badge>}
      />

      <div className="flex items-start gap-2 rounded-[5px] border border-info/40 bg-info/10 px-3.5 py-2.5 text-[12.5px] text-info" role="note">
        <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
        <span>Simulation only — no broker connection exists in this build and no orders are transmitted. All figures are modelled.</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Card
            title="Simulated account"
            subtitle={account.data ? `Updated ${new Date(account.data.updatedAt).toLocaleString('en-IN')} · simulation` : 'Loading account state'}
          >
            {account.loading ? (
              <Skeleton className="h-24 w-full" />
            ) : account.error ? (
              <ErrorState message={account.error} onRetry={account.reload} />
            ) : account.data ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile label="Simulated balance" value={formatPrice(account.data.simulatedBalance, account.data.currency, 0)} sub="Base currency INR" />
                  <StatTile label="Risk per trade" value={`${account.data.riskPerTradePct}%`} sub={`≈ ${formatPrice((account.data.simulatedBalance * account.data.riskPerTradePct) / 100, account.data.currency, 0)} at risk`} />
                  <StatTile label="Daily loss limit" value={`${account.data.dailyLossLimitPct}%`} sub="Hard stop for the session" />
                  <StatTile label="Open positions" value={account.data.openPositions} sub={`Net exposure ${account.data.netExposure}%`} />
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className="text-mut">Current drawdown vs maximum allowed</span>
                    <span className="num text-fg">{account.data.currentDrawdownPct}% / {account.data.maxDrawdownPct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#1a2029]">
                    <div
                      className={cn('h-full rounded-full', (account.data.currentDrawdownPct / account.data.maxDrawdownPct) > 0.75 ? 'bg-neg' : 'bg-gold')}
                      style={{ width: `${Math.min(100, (account.data.currentDrawdownPct / account.data.maxDrawdownPct) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <DataBadge freshness="DEMO" source={{ provider: 'QUANTORA Risk Engine', origin: 'SIMULATED', isDemo: true, reliability: 'PROVISIONAL' }} updatedAt={account.data.updatedAt} />
                </div>
              </>
            ) : null}
          </Card>

          <Card title="Portfolio risk metrics">
            {metrics.loading ? (
              <Skeleton className="h-24 w-full" />
            ) : metrics.error ? (
              <ErrorState message={metrics.error} onRetry={metrics.reload} />
            ) : metrics.data ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile label="Portfolio volatility" value={`${metrics.data.portfolioVolatilityPct}%`} sub="Annualised" />
                <StatTile label="Value at risk (95%)" value={`${metrics.data.valueAtRiskPct}%`} sub="1-day horizon" />
                <StatTile label="Expected shortfall" value={`${metrics.data.expectedShortfallPct}%`} sub="Tail average beyond VaR" />
                <StatTile label="Beta to benchmark" value={metrics.data.betaToBenchmark.toFixed(2)} sub={`Diversification ${metrics.data.diversificationRatio.toFixed(2)}`} />
                <StatTile label="Gross exposure" value={`${metrics.data.grossExposurePct}%`} sub="Long + short notional" />
                <StatTile label="Net exposure" value={`${metrics.data.netExposurePct}%`} sub="Directional tilt" />
              </div>
            ) : null}
          </Card>

          <Card title="Exposure by instrument" subtitle="Concentration warning threshold at 20%">
            {positions.loading ? (
              <Skeleton className="h-40 w-full" />
            ) : positions.error ? (
              <ErrorState message={positions.error} onRetry={positions.reload} />
            ) : positions.data?.length ? (
              <BarList
                items={exposureItems}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
              />
            ) : (
              <EmptyState title="No open positions" description="Simulated positions will appear here." />
            )}
          </Card>

          <Card title="Correlation matrix" subtitle="Pairwise correlation of held and benchmark instruments">
            {correlation.loading ? (
              <Skeleton className="h-56 w-full" />
            ) : correlation.error ? (
              <ErrorState message={correlation.error} onRetry={correlation.reload} />
            ) : correlation.data ? (
              <>
                <CorrelationMatrix symbols={correlation.data.symbols} values={correlation.data.values} />
                <p className="mt-3 text-[11.5px] leading-relaxed text-mut">
                  Highest observed pair correlation indicates concentrated systematic risk; values near ±1 mean the
                  hedge benefit of holding both is limited. Demonstration matrix.
                </p>
              </>
            ) : null}
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card title="Position-sizing calculator">
            <div className="space-y-3">
              <Input label="Account balance" type="number" value={sizer.accountBalance} onChange={(e) => setSizer({ ...sizer, accountBalance: Number(e.target.value) })} />
              <Input label="Risk per trade (%)" type="number" step="0.1" value={sizer.riskPerTradePct} onChange={(e) => setSizer({ ...sizer, riskPerTradePct: Number(e.target.value) })} />
              <Input label="Entry price" type="number" step="0.01" value={sizer.entryPrice} onChange={(e) => setSizer({ ...sizer, entryPrice: Number(e.target.value) })} />
              <Input label="Stop price" type="number" step="0.01" value={sizer.stopPrice} onChange={(e) => setSizer({ ...sizer, stopPrice: Number(e.target.value) })} />
              <Select
                label="Instrument currency"
                value={sizer.instrumentCurrency}
                options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]}
                onChange={(v) => setSizer({ ...sizer, instrumentCurrency: v as 'INR' | 'USD' })}
              />
            </div>
            <div className={cn('mt-3 rounded-[4px] border p-3', sizerResult.validation === 'OK' ? 'border-pos/40 bg-pos/10' : 'border-warn/40 bg-warn/10')}>
              <div className="flex items-center gap-2">
                <Calculator size={14} className={sizerResult.validation === 'OK' ? 'text-pos' : 'text-warn'} aria-hidden />
                <Badge tone={sizerResult.validation === 'OK' ? 'positive' : 'warning'}>{sizerResult.validation.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-2 text-[11.5px] text-mut">{sizerResult.message}</p>
              <dl className="mt-2 space-y-1 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-mut">Risk amount</dt><dd className="num text-fg">{formatNumber(sizerResult.riskAmount, 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Risk per unit</dt><dd className="num text-fg">{formatNumber(sizerResult.riskPerUnit, 2)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Position size</dt><dd className="num text-gold-2">{formatNumber(sizerResult.positionSize, 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Notional</dt><dd className="num text-fg">{formatNumber(sizerResult.positionNotional, 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Account weight</dt><dd className="num text-fg">{sizerResult.positionWeightPct.toFixed(2)}%</dd></div>
              </dl>
            </div>
          </Card>

          <Card title="Risk / reward calculator">
            <div className="space-y-3">
              <Select
                label="Direction"
                value={rr.direction}
                options={[{ value: 'LONG', label: 'Long' }, { value: 'SHORT', label: 'Short' }]}
                onChange={(v) => setRr({ ...rr, direction: v as 'LONG' | 'SHORT' })}
              />
              <Input label="Entry price" type="number" step="0.01" value={rr.entryPrice} onChange={(e) => setRr({ ...rr, entryPrice: Number(e.target.value) })} />
              <Input label="Stop price" type="number" step="0.01" value={rr.stopPrice} onChange={(e) => setRr({ ...rr, stopPrice: Number(e.target.value) })} />
              <Input label="Target price" type="number" step="0.01" value={rr.targetPrice} onChange={(e) => setRr({ ...rr, targetPrice: Number(e.target.value) })} />
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#1a2029]">
                {rrResult.valid ? (
                  <>
                    <div className="h-full bg-neg" style={{ width: `${(1 / (1 + rrResult.ratio)) * 100}%` }} />
                    <div className="h-full bg-pos" style={{ width: `${(rrResult.ratio / (1 + rrResult.ratio)) * 100}%` }} />
                  </>
                ) : null}
              </div>
              <dl className="space-y-1 text-[12.5px]">
                <div className="flex justify-between"><dt className="text-mut">Risk per unit</dt><dd className="num text-neg">{formatNumber(rrResult.riskPerUnit, 2)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Reward per unit</dt><dd className="num text-pos">{formatNumber(rrResult.rewardPerUnit, 2)}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Ratio</dt><dd className="num text-gold-2">{rrResult.valid ? `1 : ${rrResult.ratio.toFixed(2)}` : 'Invalid geometry'}</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Risk %</dt><dd className="num text-fg">{rrResult.riskPct.toFixed(2)}%</dd></div>
                <div className="flex justify-between"><dt className="text-mut">Reward %</dt><dd className="num text-fg">{rrResult.rewardPct.toFixed(2)}%</dd></div>
              </dl>
              {!rrResult.valid && (
                <p className="flex items-start gap-1.5 text-[11.5px] text-neg">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                  Stop and target must sit on the correct side of the entry for the selected direction.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
      <p className="text-[11px] text-mut-2">
        Current drawdown {account.data ? `${account.data.currentDrawdownPct.toFixed(2)}%` : '—'} · all values simulated · not investment advice.
      </p>
    </div>
  );
}
