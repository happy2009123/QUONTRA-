/**
 * QUANTORA frontend strategy domain types.
 *
 * Mirrors the backend strategy domain so the client can evaluate strategies
 * deterministically and display decisions without fabricating live prices.
 * Scores are 0-100 confluence metrics — never win probabilities.
 */

import type { DataFreshness, SignalAction } from '@/models';
export type { SignalAction };

export type StrategyCategory =
  | 'SCALPING'
  | 'ICT_SMART_MONEY'
  | 'PRICE_ACTION'
  | 'INDICATORS'
  | 'OTHER';

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
  timeframes: string[];
  parameters: StrategyParameter[];
  defaultStopLoss: { mode: StopLossMode; value: number };
  defaultTargets: { target1Pct: number; target2Pct: number };
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
  score: number;
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
  evaluatedAt: string;
  isDemo: boolean;
}

export interface CombinationConfig {
  operator: LogicOperator;
  minConfirmations: number;
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
  markets: string[];
  instruments: string[];
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
  freshness: DataFreshness;
  source: { provider: string; origin: string; isDemo: boolean; reliability: string };
  timeframe: string;
  primaryDecision: SignalAction;
  direction: SignalAction | null;
  strategyResults: StrategyResult[];
  combinationLogic: CombinationConfig;
  agreementCount: number;
  totalEnabled: number;
  entryTrigger: string | null;
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  strategyQualityScore: number;
  conditionsPassedTotal: number;
  conditionsFailedTotal: number;
  invalidationLevel: number | null;
  reason: string;
  risks: string[];
  evaluatedAt: string;
}

export interface StoredUserStrategyConfig {
  userId: string;
  combination: CombinationConfig;
  timeframes: string[];
  markets: string[];
  instruments: string[];
  minRiskReward: number;
  maxSpreadBps: number;
  minLiquidity: 'HIGH' | 'MEDIUM' | 'LOW';
  updatedAt: string;
  strategies: UserStrategyConfig[];
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
