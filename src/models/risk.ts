import type { MarketCategory } from './market';

/** All risk figures are simulations. No broker connection exists in this build. */
export interface RiskAccount {
  simulatedBalance: number;
  currency: 'INR' | 'USD';
  riskPerTradePct: number;
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  openPositions: number;
  netExposure: number;
  updatedAt: string;
  isSimulation: true;
}

export interface RiskPosition {
  instrumentId: string;
  symbol: string;
  market: MarketCategory;
  side: 'LONG' | 'SHORT';
  quantity: number;
  notional: number;
  weightPct: number;
  unrealizedPnl: number;
  stopDistancePct: number;
}

export interface CorrelationCell {
  row: string;
  col: string;
  value: number;
}

export interface PortfolioRiskMetrics {
  portfolioVolatilityPct: number;
  valueAtRiskPct: number;
  expectedShortfallPct: number;
  betaToBenchmark: number;
  grossExposurePct: number;
  netExposurePct: number;
  diversificationRatio: number;
  updatedAt: string;
  isSimulation: true;
}

export interface PositionSizerInput {
  accountBalance: number;
  riskPerTradePct: number;
  entryPrice: number;
  stopPrice: number;
  instrumentCurrency: 'INR' | 'USD';
}

export interface PositionSizerResult {
  riskAmount: number;
  riskPerUnit: number;
  positionSize: number;
  positionNotional: number;
  positionWeightPct: number;
  validation: 'OK' | 'INVALID_STOP' | 'EXCEEDS_EXPOSURE_LIMIT' | 'BELOW_MIN_LOT';
  message: string;
}

export interface RiskRewardInput {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  direction: 'LONG' | 'SHORT';
}

export interface RiskRewardResult {
  riskPerUnit: number;
  rewardPerUnit: number;
  ratio: number;
  riskPct: number;
  rewardPct: number;
  valid: boolean;
}
