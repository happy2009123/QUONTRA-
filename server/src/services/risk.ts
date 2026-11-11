/**
 * Risk calculation service.
 *
 * Deterministic, side-effect free calculations for position sizing, reward to
 * risk and simulated portfolio exposure. Results can be persisted for audit.
 * Nothing here routes orders — the platform has no broker connection.
 */

import type { Db } from '../db/db.ts';
import { insertRiskCalculation, listPaperTrades, listRiskCalculations } from '../db/repoOps.ts';
import { getQuote } from '../db/repoSeries.ts';

export interface PositionSizerInput {
  accountBalance: number;
  riskPerTradePct: number;
  entryPrice: number;
  stopPrice: number;
  instrumentCurrency?: string;
}

export interface PositionSizerResult {
  riskAmount: number;
  riskPerUnit: number;
  positionSize: number;
  positionNotional: number;
  positionWeightPct: number;
  currency: string;
  validation: 'OK' | 'INVALID_STOP' | 'INVALID_BALANCE' | 'POSITION_TOO_LARGE' | 'ROUND_LOT_REQUIRED';
  message: string;
}

/** Sizes a position so a stop-out loses at most `riskPerTradePct` of equity. */
export function sizePosition(input: PositionSizerInput): PositionSizerResult {
  const currency = input.instrumentCurrency ?? 'INR';
  const riskAmount = (input.accountBalance * input.riskPerTradePct) / 100;
  const riskPerUnit = Math.abs(input.entryPrice - input.stopPrice);

  if (!(input.accountBalance > 0)) {
    return { riskAmount: 0, riskPerUnit, positionSize: 0, positionNotional: 0, positionWeightPct: 0, currency, validation: 'INVALID_BALANCE', message: 'Account balance must be positive.' };
  }
  if (riskPerUnit <= 0) {
    return { riskAmount, riskPerUnit: 0, positionSize: 0, positionNotional: 0, positionWeightPct: 0, currency, validation: 'INVALID_STOP', message: 'Stop price must differ from the entry price.' };
  }

  const rawSize = riskAmount / riskPerUnit;
  const positionSize = Math.floor(rawSize);
  const positionNotional = positionSize * input.entryPrice;
  const positionWeightPct = (positionNotional / input.accountBalance) * 100;

  if (positionSize < 1) {
    return { riskAmount, riskPerUnit, positionSize: 0, positionNotional: 0, positionWeightPct: 0, currency, validation: 'POSITION_TOO_LARGE', message: 'Stop distance is too wide for the account size at this risk budget.' };
  }
  if (positionWeightPct > 100) {
    return { riskAmount, riskPerUnit, positionSize, positionNotional, positionWeightPct, currency, validation: 'POSITION_TOO_LARGE', message: 'Calculated position exceeds 100% of the account — reduce size manually.' };
  }

  return {
    riskAmount,
    riskPerUnit,
    positionSize,
    positionNotional,
    positionWeightPct: Math.round(positionWeightPct * 100) / 100,
    currency,
    validation: 'OK',
    message: `Risking ₹${riskAmount.toFixed(2)} across a ${riskPerUnit.toFixed(2)} stop → ${positionSize} units.`,
  };
}

export interface RiskRewardInput {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  direction: 'LONG' | 'SHORT';
}

export interface RiskRewardResult {
  risk: number;
  reward: number;
  ratio: number;
  breakEvenPct: number;
  validation: 'OK' | 'INVALID_LEVELS';
  message: string;
}

/** Computes reward-to-risk for a planned trade. */
export function riskReward(input: RiskRewardInput): RiskRewardResult {
  const risk = Math.abs(input.entryPrice - input.stopPrice);
  const reward =
    input.direction === 'LONG' ? input.targetPrice - input.entryPrice : input.entryPrice - input.targetPrice;

  if (!(risk > 0) || !Number.isFinite(reward)) {
    return { risk, reward, ratio: 0, breakEvenPct: 0, validation: 'INVALID_LEVELS', message: 'Entry, stop and target must be distinct numbers.' };
  }
  const ratio = reward / risk;
  const breakEvenPct = risk > 0 ? (risk / input.entryPrice) * 100 : 0;
  return {
    risk,
    reward,
    ratio: Math.round(ratio * 100) / 100,
    breakEvenPct: Math.round(breakEvenPct * 1000) / 1000,
    validation: 'OK',
    message:
      ratio >= 1
        ? `Reward/Risk ${ratio.toFixed(2)} — the trade pays for itself if the stop is respected.`
        : `Reward/Risk ${ratio.toFixed(2)} — below 1:1; the edge must come from hit rate.`,
  };
}

export interface PortfolioMetrics {
  simulated: true;
  openPositions: number;
  closedPositions: number;
  grossExposure: number;
  netExposure: number;
  realizedPnl: number;
  unrealizedPnl: number;
  largestExposurePct: number;
  currency: string;
  note: string;
}

/** Exposure metrics over the simulated paper-trade book (never a real account). */
export function portfolioMetrics(db: Db): PortfolioMetrics {
  const open = listPaperTrades(db, 'OPEN');
  const closed = listPaperTrades(db, 'CLOSED');
  let gross = 0;
  let unrealized = 0;
  let largest = 0;
  let currency = 'INR';

  for (const trade of open) {
    const quote = getQuote(db, trade.instrument_id);
    const mark = quote?.last_price ?? trade.entry_price;
    const notional = Math.abs(trade.quantity * trade.entry_price);
    gross += notional;
    const instrument = db.prepare('SELECT currency FROM instruments WHERE id = ?').get(trade.instrument_id) as { currency: string } | undefined;
    currency = instrument?.currency ?? currency;
    const direction = trade.direction === 'LONG' ? 1 : -1;
    unrealized += direction * (mark - trade.entry_price) * trade.quantity;
    largest = Math.max(largest, notional);
  }

  let realized = 0;
  for (const trade of closed) {
    if (trade.exit_price === null) continue;
    const direction = trade.direction === 'LONG' ? 1 : -1;
    realized += direction * (trade.exit_price - trade.entry_price) * trade.quantity;
  }

  return {
    simulated: true,
    openPositions: open.length,
    closedPositions: closed.length,
    grossExposure: Math.round(gross * 100) / 100,
    netExposure: Math.round(gross * 100) / 100,
    realizedPnl: Math.round(realized * 100) / 100,
    unrealizedPnl: Math.round(unrealized * 100) / 100,
    largestExposurePct: gross > 0 ? Math.round((largest / gross) * 10000) / 100 : 0,
    currency,
    note: 'Simulated paper portfolio — no broker is connected and no orders are placed.',
  };
}

/** Persists a calculation for audit and returns it with an id. */
export function recordCalculation(
  db: Db,
  kind: 'POSITION_SIZE' | 'RISK_REWARD' | 'PORTFOLIO',
  input: unknown,
  result: unknown,
  instrumentId?: string,
): { id: string; kind: string; createdAt: string } {
  const id = `risk-${kind.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  insertRiskCalculation(db, {
    id,
    kind,
    instrument_id: instrumentId ?? null,
    input_json: JSON.stringify(input),
    result_json: JSON.stringify(result),
    data_quality: 'VERIFIED',
    created_at: createdAt,
  });
  return { id, kind, createdAt };
}

/** Recent persisted calculations (audit view). */
export function calculationHistory(db: Db, limit = 25): Array<{ id: string; kind: string; createdAt: string; input: unknown; result: unknown }> {
  return listRiskCalculations(db, limit).map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    input: JSON.parse(row.input_json) as unknown,
    result: JSON.parse(row.result_json) as unknown,
  }));
}
