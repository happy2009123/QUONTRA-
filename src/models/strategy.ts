import type { Timeframe } from './market';
import type { MarketRegime } from './research';

export type IndicatorId =
  | 'EMA'
  | 'SMA'
  | 'RSI'
  | 'MACD'
  | 'BOLLINGER'
  | 'VWAP'
  | 'ATR'
  | 'ADX'
  | 'VOLUME';

export interface IndicatorConfig {
  id: IndicatorId;
  label: string;
  enabled: boolean;
  params: Record<string, number>;
}

export type ConditionOperator =
  | 'CROSSES_ABOVE'
  | 'CROSSES_BELOW'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'WITHIN_RANGE';

export interface StrategyCondition {
  id: string;
  left: string;
  operator: ConditionOperator;
  right: string;
  lookback: number;
}

export type ExitMode = 'TARGET_STOP' | 'TRAILING' | 'TIME_BASED' | 'SIGNAL_FLIP';

export interface StrategyConfig {
  id: string;
  name: string;
  family: 'TREND' | 'MEAN_REVERSION' | 'BREAKOUT' | 'MOMENTUM' | 'VOLATILITY';
  description: string;
  timeframe: Timeframe;
  indicators: IndicatorConfig[];
  entryConditions: StrategyCondition[];
  exitConditions: StrategyCondition[];
  stopLoss: { mode: 'FIXED_PCT' | 'ATR_MULTIPLE'; value: number };
  targets: { target1Pct: number; target2Pct: number };
  exitMode: ExitMode;
}

export interface BacktestWindow {
  from: string;
  to: string;
}

export interface CostModel {
  brokerageBps: number;
  slippageBps: number;
  sttBps: number;
  exchangeFeesBps: number;
  gstPct: number;
}

export interface BacktestRequest {
  strategyId: string;
  instrumentIds: string[];
  window: BacktestWindow;
  costs: CostModel;
  initialCapital: number;
  riskPerTradePct: number;
  outOfSamplePct: number;
  walkForward: boolean;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface TradeRecord {
  id: string;
  instrumentId: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  rMultiple: number;
  exitReason: 'TARGET' | 'STOP' | 'SIGNAL' | 'TIME';
}

export type TestPhase = 'IN_SAMPLE' | 'OUT_OF_SAMPLE' | 'WALK_FORWARD';

export interface PerformanceMetrics {
  netReturnPct: number;
  annualizedReturnPct: number;
  winRatePct: number;
  profitFactor: number;
  averageRewardRisk: number;
  tradeCount: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  expectancyR: number;
  netProfitAfterCosts: number;
}

export interface RegimePerformance {
  regime: MarketRegime;
  tradeCount: number;
  winRatePct: number;
  netReturnPct: number;
  maxDrawdownPct: number;
}

export interface BacktestResult {
  id: string;
  strategyId: string;
  strategyName: string;
  instrumentIds: string[];
  window: BacktestWindow;
  costs: CostModel;
  initialCapital: number;
  /** Explicitly simulated — never presented as actual trading performance. */
  isSimulated: true;
  phase: TestPhase;
  metrics: PerformanceMetrics;
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  regimeBreakdown: RegimePerformance[];
  warnings: string[];
  generatedAt: string;
}

export interface StrategyComparison {
  rows: {
    strategyId: string;
    strategyName: string;
    metrics: PerformanceMetrics;
    phase: TestPhase;
  }[];
}

export interface OverfitWarning {
  code: 'OVERFIT_RISK' | 'INSUFFICIENT_DATA' | 'THIN_SAMPLE' | 'COST_SENSITIVE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
}
