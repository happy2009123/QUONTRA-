import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InfoHint,
  Input,
  PageHeader,
  Select,
  SegmentedControl,
  Toggle,
} from '@/components/ui';
import {
  STRATEGY_DEFINITIONS,
  getStrategyDefinitionsByCategory,
  type StrategyCategory,
  type CombinationConfig,
  type UserStrategyConfig,
  type UserStrategyPreset,
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
  OTHER: 'OTHER',
};

const DEFAULT_USER_ID = 'desk@quantora.demo';

function defaultConfig(): { combination: CombinationConfig; strategies: UserStrategyConfig[] } {
  return {
    combination: { operator: 'OR', minConfirmations: 1, requireHigherTimeframeConfirmation: false },
    strategies: STRATEGY_DEFINITIONS.map((d) => ({
      strategyId: d.id,
      enabled: false,
      parameters: Object.fromEntries(d.parameters.map((p) => [p.id, p.default])),
      stopLoss: d.defaultStopLoss,
      targets: d.defaultTargets,
    })),
  };
}

export default function StrategyBuilder() {
  const [config, setConfig] = useState(defaultConfig());
  const [categoryFilter, setCategoryFilter] = useState<StrategyCategory | 'ALL'>('ALL');
  const [presets, setPresets] = useState<UserStrategyPreset[]>([]);

  // Persist to localStorage
  useMemo(() => {
    try {
      localStorage.setItem(`quantora:strategy-config:${DEFAULT_USER_ID}`, JSON.stringify(config));
    } catch {}
  }, [config]);

  const loadPresets = useCallback(() => {
    try {
      const raw = localStorage.getItem(`quantora:presets:${DEFAULT_USER_ID}`);
      setPresets(raw ? JSON.parse(raw) : []);
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const defs = useMemo(
    () => (categoryFilter === 'ALL' ? STRATEGY_DEFINITIONS : getStrategyDefinitionsByCategory(categoryFilter)),
    [categoryFilter],
  );

  const totalEnabled = config.strategies.filter((s) => s.enabled);

  const toggleStrategy = (id: string, enabled: boolean) => {
    setConfig((c) => ({
      ...c,
      strategies: c.strategies.map((s) => (s.strategyId === id ? { ...s, enabled } : s)),
    }));
  };

  const setCombination = (key: keyof CombinationConfig, value: unknown) => {
    setConfig((c) => ({ ...c, combination: { ...c.combination, [key]: value } }));
  };

  const savePreset = (name: string) => {
    const id = `preset-${Date.now()}`;
    const preset: UserStrategyPreset = {
      id,
      name,
      userId: DEFAULT_USER_ID,
      combination: config.combination,
      strategies: config.strategies,
      markets: [],
      instruments: [],
      timeframes: ['1h'],
      minRiskReward: 1,
      minLiquidity: 'MEDIUM',
      maxSpreadBps: 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPresets((prev) => [...prev, preset]);
    try {
      localStorage.setItem(`quantora:presets:${DEFAULT_USER_ID}`, JSON.stringify([...presets, preset]));
    } catch {}
  };

  const deletePreset = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    try {
      localStorage.setItem(`quantora:presets:${DEFAULT_USER_ID}`, JSON.stringify(presets.filter((p) => p.id !== id)));
    } catch {}
  };

  const loadPreset = (preset: UserStrategyPreset) => {
    setConfig({ combination: preset.combination, strategies: preset.strategies });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Strategy Builder"
        title="Strategy Combination"
        description="Combine multiple strategies using AND / OR logic, set minimum confirmation thresholds, and save personal presets. Rules are never silently changed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={<Save size={14} />} onClick={() => {}}>
              Save configuration
            </Button>
            <Button variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfig(defaultConfig())}>
              Reset defaults
            </Button>
          </div>
        }
        meta={<Badge tone="gold" dot>User configuration</Badge>}
      />

      <InfoHint text="Combination rules are applied exactly as configured. With AND logic, every enabled strategy must agree on the same direction. With OR logic, any strategy meeting the minimum confirmation threshold can drive the decision." />

      <div className="grid gap-4 md:grid-cols-12">
        <div className="md:col-span-4 space-y-4">
          <Card title="Combination logic">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg">Logic operator</span>
                <SegmentedControl
                  label=""
                  options={[
                    { value: 'AND', label: 'AND' },
                    { value: 'OR', label: 'OR' },
                  ]}
                  value={config.combination.operator as CombinationConfig['operator']}
                  onChange={(v) => setCombination('operator', v as CombinationConfig['operator'])}
                  size="sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-mut">Min confirmations</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, totalEnabled.length)}
                  value={config.combination.minConfirmations}
                  onChange={(e) => setCombination('minConfirmations', Number(e.target.value))}
                  className="w-full h-2 bg-line-soft rounded-lg appearance-none cursor-pointer accent-[#C6A15B]"
                />
                <span className="text-[11px] text-mut w-12">{config.combination.minConfirmations}</span>
              </div>
              <Toggle
                checked={config.combination.requireHigherTimeframeConfirmation}
                onChange={(v) => setCombination('requireHigherTimeframeConfirmation', v)}
                label="Require higher-timeframe confirmation"
                description="Only act when higher timeframe aligns"
              />
            </div>
          </Card>

          <Card title="Risk & filters">
            <div className="space-y-3">
              <Input
                label="Min risk/reward"
                type="number"
                step="0.1"
                defaultValue="1"
                wrapperClassName="w-32"
              />
              <Select
                label="Min liquidity"
                value="MEDIUM"
                options={['HIGH', 'MEDIUM', 'LOW'].map((v) => ({ value: v, label: v }))}
                onChange={() => {}}
                size="sm"
              />
              <Input
                label="Max spread (bps)"
                type="number"
                defaultValue="10"
                wrapperClassName="w-32"
              />
            </div>
          </Card>
        </div>

        <div className="md:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-fg">Strategy category</p>
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

          <div className="grid gap-2 sm:grid-cols-3">
            {defs.map((d) => {
              const s = config.strategies.find((x) => x.strategyId === d.id);
              return (
                <Card key={d.id} className="border-line-soft p-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Toggle
                        checked={s?.enabled ?? false}
                        onChange={(checked) => toggleStrategy(d.id, checked)}
                        label=""
                      />
                      <span className="text-sm font-medium">{d.name}</span>
                    </div>
                    <Badge tone="neutral">{d.category}</Badge>
                  </div>
                  <p className="text-[10.5px] text-mut">{d.description}</p>
                  <p className="text-[10px] text-mut-2">TF: {d.timeframes.join(', ')}</p>
                </Card>
              );
            })}
          </div>
          {defs.length === 0 && <EmptyState title="No strategies" description="No strategies found for this category." />}
        </div>
      </div>

      <Card title="Saved presets" subtitle={presets.length ? `${presets.length} saved` : 'No saved presets yet'}>
        <div className="space-y-2">
          {presets.length === 0 ? (
            <EmptyState title="No presets" description="Create a preset to save your current strategy combination." />
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {presets.map((p) => (
                <Card key={p.id} className="border-line-soft p-2">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-semibold text-fg">{p.name}</h4>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => deletePreset(p.id)} aria-label="Delete preset" />
                  </div>
                  <p className="text-[10px] text-mut">
                    {p.strategies.filter((s) => s.enabled).length} of {p.strategies.length} strategies enabled · {p.combination.operator} logic
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => loadPreset(p)}>
                    Load preset
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Input label="Preset name" placeholder="My strategy preset" wrapperClassName="flex-1" />
          <Button variant="primary" icon={<Trash2 size={14} />} onClick={() => savePreset('New preset')}>
            Save
          </Button>
        </div>
      </Card>
    </div>
  );
}
