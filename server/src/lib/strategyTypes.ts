/**
 * Shared strategy domain types for the QUANTORA strategy engine.
 *
 * All strategy evaluation is deterministic: given the same candles,
 * quote and user configuration, the same decision is produced every time.
 * Scores are 0-100 confluence metrics — never win probabilities.
 */

export type StrategyCategory =
  | 'SCALPING'
  | 'ICT_SMART_MONEY'
  | 'PRICE_ACTION'
  | 'INDICATORS'
  | 'OTHER';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE' | 'WATCH';

export type LogicOperator = 'AND' | 'OR';

export type ExitMode = 'TARGET_STOP' | 'TRAILING' | 'TIME_BASED' | 'SIGNAL_FLIP';

export type StopLossMode = 'FIXED_PCT' | 'ATR_MULTIPLE';

export interface StrategyParameter {
  id: string;
  label: string;
  type: 'number' | 'select' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  timeframes: string[]; // supported timeframes
  parameters: StrategyParameter[];
  defaultStopLoss: { mode: StopLossMode; value: number };
  defaultTargets: { target1Pct: number; target2Pct: number };
  /** Human-readable rationale for how the strategy decides. */
  rationale: string;
}

export interface StrategyConditionResult {
  id: string;
  description: string;
  passed: boolean;
  leftValue: number | null;
  rightValue: number | null;
}

export interface StrategyResult {
  strategyId: string;
  strategyName: string;
  category: StrategyCategory;
  direction: SignalAction;
  score: number; // 0-100 confluence
  timeframe: string;
  conditionsPassed: StrategyConditionResult[];
  conditionsFailed: StrategyConditionResult[];
  entryTrigger: string | null;
  entryZone: { low: number; high: number } | null;
  invalidationLevel: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  rationale: string;
  /** ISO timestamp of the bar this result was computed on. */
  evaluatedAt: string;
  isDemo: boolean;
}

export interface CombinationConfig {
  operator: LogicOperator; // AND | OR
  minConfirmations: number; // 0..N, how many strategies must agree
  requireHigherTimeframeConfirmation: boolean;
}

export interface UserStrategyConfig {
  strategyId: string;
  enabled: boolean;
  parameters: Record<string, number | boolean>;
  stopLoss: { mode: StopLossMode; value: number };
  targets: { target1Pct: number; target2Pct: number };
}

export interface UserStrategyPreset {
  id: string;
  name: string;
  userId: string;
  combination: CombinationConfig;
  strategies: UserStrategyConfig[];
  markets: string[]; // market categories
  instruments: string[]; // instrument ids (empty = all in markets)
  timeframes: string[];
  minRiskReward: number;
  minLiquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  maxSpreadBps: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentDecision {
  instrumentId: string;
  symbol: string;
  market: string;
  exchange: string;
  lastPrice: number;
  freshness: string;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  timeframe: string;
  primaryDecision: SignalAction;
  direction: SignalAction | null;
  strategyResults: StrategyResult[];
  combinationLogic: CombinationConfig;
  agreementCount: number; // strategies agreeing with primary direction
  totalEnabled: number;
  entryTrigger: string | null;
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  strategyQualityScore: number; // 0-100 aggregate
  conditionsPassedTotal: number;
  conditionsFailedTotal: number;
  invalidationLevel: number | null;
  reason: string;
  risks: string[];
  evaluatedAt: string;
}

export interface StrategyComparisonRow {
  strategyId: string;
  strategyName: string;
  category: StrategyCategory;
  direction: SignalAction;
  score: number;
  signal: SignalAction;
  entry: number | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
}
