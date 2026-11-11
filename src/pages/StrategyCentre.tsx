import { useMemo, useState } from 'react';
import { Save } from 'lucide-react';
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
  Toggle,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import {
  STRATEGY_DEFINITIONS,
  getStrategyDefinitionsByCategory,
  type StrategyCategory,
  type StrategyDefinition,
} from '@/lib/strategyEngine';

const CATEGORIES: StrategyCategory[] = [
  'SCALPING',
  'ICT_SMART_MONEY',
  'PRICE_ACTION',
  'INDICATORS',
  'OTHER',
];

const CATEGORY_LABELS: Record<StrategyCategory, string> = {
  SCALPING: 'Scalping',
  ICT_SMART_MONEY: 'ICT / Smart Money',
  PRICE_ACTION: 'Price Action',
  INDICATORS: 'Indicators',
  OTHER: 'Other',
};

function StrategyCard({
  definition,
  enabled,
  onToggle,
}: {
  definition: StrategyDefinition;
  enabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  return (
    <Card className="border-line-soft">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge tone={enabled ? 'positive' : 'muted'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
            <Badge tone="neutral">{definition.category}</Badge>
          </div>
          <h3 className="text-sm font-semibold text-fg">{definition.name}</h3>
          <p className="text-[12px] text-mut">{definition.description}</p>
          <p className="mt-1 text-[11px] text-mut-2">{definition.rationale}</p>
          <p className="mt-1 text-[11px] text-mut-2">
            Timeframes: {definition.timeframes.join(', ')}
          </p>
        </div>
        <Toggle
          checked={enabled}
          onChange={(checked) => onToggle(definition.id, checked)}
          label="Enable"
        />
      </div>
    </Card>
  );
}

export default function StrategyCentre() {
  const strategies = useAsync(() => api.strategy.listStrategies(), []);
  const [categoryFilter, setCategoryFilter] = useState<StrategyCategory | 'ALL'>('ALL');
  const [enabledStrategies, setEnabledStrategies] = useState<Set<string>>(new Set());

  const defs = useMemo(
    () => (categoryFilter === 'ALL' ? STRATEGY_DEFINITIONS : getStrategyDefinitionsByCategory(categoryFilter)),
    [categoryFilter],
  );

  useMemo(() => {
    if (enabledStrategies.size === 0) {
      const starter = ['ema-crossover', 'rsi', 'support-resistance', 'breakout-retest'];
      setEnabledStrategies(new Set(starter));
    }
  }, []);

  const toggle = (id: string, enabled: boolean) => {
    setEnabledStrategies((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(id); else next.delete(id);
      return next;
    });
  };

  if (strategies.loading) return <Skeleton className="h-56 w-full" />;
  if (strategies.error) return <ErrorState message={strategies.error} onRetry={strategies.reload} />;

  const enabledDefs = STRATEGY_DEFINITIONS.filter((d) => enabledStrategies.has(d.id));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Strategy Centre"
        title="Strategy Selection"
        description="Choose which strategies QUANTORA evaluates autonomously. Enable or disable each strategy, then configure combination rules in the Strategy Builder."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Save size={14} />} onClick={() => {}}>
              Save configuration
            </Button>
          </div>
        }
        meta={<Badge tone="gold" dot>Deterministic evaluation</Badge>}
      />

      <InfoHint text="Strategies are evaluated on completed candles only. Scores are 0–100 confluence metrics, not win probabilities. All results are simulation and demonstration data." />

      <div className="flex items-center gap-2 mb-3">
        <p className="text-[12px] text-mut">Category</p>
        <Select
          value={categoryFilter === 'ALL' ? 'ALL' : categoryFilter}
          options={[
            { value: 'ALL', label: 'All categories' },
            ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
          ]}
          onChange={(v) => setCategoryFilter(v as StrategyCategory | 'ALL')}
          size="sm"
        />
      </div>

      {defs.length === 0 ? (
        <EmptyState title="No strategies" description="No strategies found for this category." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {defs.map((d) => (
            <StrategyCard key={d.id} definition={d} enabled={enabledStrategies.has(d.id)} onToggle={toggle} />
          ))}
        </div>
      )}

      <Card title="Enabled strategy summary" subtitle={`${enabledDefs.length} of ${STRATEGY_DEFINITIONS.length} strategies active`} dense flush>
        <DataTable
          caption="Currently enabled strategies"
          rows={enabledDefs}
          rowKey={(d) => d.id}
          columns={[
            { key: 'name', header: 'Strategy', cell: (d: StrategyDefinition) => <span className="font-medium">{d.name}</span> },
            { key: 'cat', header: 'Category', cell: (d: StrategyDefinition) => <Badge tone="neutral">{d.category}</Badge> },
            { key: 'tf', header: 'Timeframes', cell: (d: StrategyDefinition) => <span className="text-mut text-[11px]">{d.timeframes.join(', ')}</span> },
          ]}
          emptyTitle="No strategies enabled"
          emptyDescription="Enable strategies above to build your autonomous configuration."
        />
      </Card>
    </div>
  );
}
