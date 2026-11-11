import type {
  BacktestResult,
  CostModel,
  EquityPoint,
  IndicatorConfig,
  PerformanceMetrics,
  RegimePerformance,
  StrategyComparison,
  StrategyConfig,
  TradeRecord,
} from '@/models';
import { INSTRUMENTS } from './universe';
import { seededRandom } from '@/lib/rng';

const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { id: 'EMA', label: 'EMA 9 / 20 / 50', enabled: true, params: { fast: 9, mid: 20, slow: 50 } },
  { id: 'RSI', label: 'RSI (14)', enabled: true, params: { period: 14 } },
  { id: 'MACD', label: 'MACD (12,26,9)', enabled: true, params: { fast: 12, slow: 26, signal: 9 } },
  { id: 'BOLLINGER', label: 'Bollinger Bands (20,2)', enabled: false, params: { period: 20, dev: 2 } },
  { id: 'VWAP', label: 'VWAP', enabled: false, params: {} },
  { id: 'ATR', label: 'ATR (14)', enabled: true, params: { period: 14 } },
  { id: 'ADX', label: 'ADX (14)', enabled: false, params: { period: 14 } },
  { id: 'VOLUME', label: 'Volume', enabled: true, params: {} },
];

function cond(id: string, left: string, operator: StrategyConfig['entryConditions'][number]['operator'], right: string, lookback = 1) {
  return { id, left, operator, right, lookback };
}

export const STRATEGIES: StrategyConfig[] = [
  {
    id: 'str-ema-ribbon',
    name: 'EMA Ribbon Continuation',
    family: 'TREND',
    description:
      'Enters on a stacked EMA pullback continuation when higher-timeframe trend and momentum agree.',
    timeframe: '1h',
    indicators: DEFAULT_INDICATORS.map((i) => ({ ...i })),
    entryConditions: [
      cond('c1', 'EMA9', 'CROSSES_ABOVE', 'EMA20'),
      cond('c2', 'EMA20', 'GREATER_THAN', 'EMA50'),
      cond('c3', 'RSI14', 'GREATER_THAN', '52'),
      cond('c4', 'Close', 'GREATER_THAN', 'VWAP'),
    ],
    exitConditions: [
      cond('e1', 'EMA9', 'CROSSES_BELOW', 'EMA20'),
      cond('e2', 'RSI14', 'GREATER_THAN', '72'),
    ],
    stopLoss: { mode: 'ATR_MULTIPLE', value: 1.8 },
    targets: { target1Pct: 1.6, target2Pct: 3.2 },
    exitMode: 'TARGET_STOP',
  },
  {
    id: 'str-vwap-reversion',
    name: 'VWAP Mean Reversion',
    family: 'MEAN_REVERSION',
    description:
      'Fades statistically stretched moves back toward the session VWAP when volatility is contained.',
    timeframe: '15m',
    indicators: DEFAULT_INDICATORS.map((i) =>
      i.id === 'BOLLINGER' || i.id === 'VWAP' ? { ...i, enabled: true } : { ...i },
    ),
    entryConditions: [
      cond('c1', 'Close', 'LESS_THAN', 'BBLower'),
      cond('c2', 'RSI14', 'LESS_THAN', '32'),
      cond('c3', 'ADX14', 'LESS_THAN', '28'),
    ],
    exitConditions: [cond('e1', 'Close', 'GREATER_THAN', 'VWAP'), cond('e2', 'RSI14', 'GREATER_THAN', '58')],
    stopLoss: { mode: 'FIXED_PCT', value: 1.1 },
    targets: { target1Pct: 0.9, target2Pct: 1.8 },
    exitMode: 'TARGET_STOP',
  },
  {
    id: 'str-squeeze-breakout',
    name: 'Bollinger Squeeze Breakout',
    family: 'BREAKOUT',
    description:
      'Waits for band contraction then trades the expansion leg with an ATR-scaled stop.',
    timeframe: '30m',
    indicators: DEFAULT_INDICATORS.map((i) =>
      i.id === 'BOLLINGER' || i.id === 'ATR' ? { ...i, enabled: true } : { ...i },
    ),
    entryConditions: [
      cond('c1', 'BandWidth', 'LESS_THAN', 'BandWidthPercentile30', 20),
      cond('c2', 'Close', 'CROSSES_ABOVE', 'BBUpper'),
      cond('c3', 'Volume', 'GREATER_THAN', 'VolumeSMA20'),
    ],
    exitConditions: [cond('e1', 'Close', 'CROSSES_BELOW', 'EMA20')],
    stopLoss: { mode: 'ATR_MULTIPLE', value: 2.2 },
    targets: { target1Pct: 2.1, target2Pct: 4.4 },
    exitMode: 'TRAILING',
  },
  {
    id: 'str-rsi-divergence',
    name: 'RSI Divergence Reversal',
    family: 'MOMENTUM',
    description:
      'Identifies price/RSI divergence at established levels and enters on confirmation bar.',
    timeframe: '1h',
    indicators: DEFAULT_INDICATORS.map((i) => (i.id === 'RSI' ? { ...i, enabled: true } : i)),
    entryConditions: [
      cond('c1', 'PriceLow', 'LESS_THAN', 'PriorPriceLow', 40),
      cond('c2', 'RSILow', 'GREATER_THAN', 'PriorRSILow', 40),
      cond('c3', 'Close', 'GREATER_THAN', 'PriorBarHigh'),
    ],
    exitConditions: [cond('e1', 'Close', 'GREATER_THAN', 'ResistancePrimary')],
    stopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
    targets: { target1Pct: 1.4, target2Pct: 2.9 },
    exitMode: 'TARGET_STOP',
  },
  {
    id: 'str-mtf-alignment',
    name: 'Multi-Timeframe Trend Alignment',
    family: 'TREND',
    description:
      'Only trades when 15m, 1h and 1D trend states agree and the daily regime filter is permissive.',
    timeframe: '4h',
    indicators: DEFAULT_INDICATORS.map((i) => ({ ...i })),
    entryConditions: [
      cond('c1', 'Trend1D', 'GREATER_THAN', '0'),
      cond('c2', 'Trend1h', 'GREATER_THAN', '0'),
      cond('c3', 'Trend15m', 'GREATER_THAN', '0'),
      cond('c4', 'ADX14', 'GREATER_THAN', '22'),
    ],
    exitConditions: [cond('e1', 'Trend1h', 'LESS_THAN', '0')],
    stopLoss: { mode: 'FIXED_PCT', value: 2.4 },
    targets: { target1Pct: 3.0, target2Pct: 6.0 },
    exitMode: 'SIGNAL_FLIP',
  },
];

export const DEFAULT_COSTS: CostModel = {
  brokerageBps: 2.5,
  slippageBps: 1.5,
  sttBps: 1.0,
  exchangeFeesBps: 0.5,
  gstPct: 18,
};

function metricsFrom(rand: () => number): PerformanceMetrics {
  const tradeCount = Math.round(42 + rand() * 180);
  const winRatePct = Math.round((41 + rand() * 24) * 10) / 10;
  const profitFactor = Math.round((0.95 + rand() * 1.45) * 100) / 100;
  const netReturnPct = Math.round((4 + rand() * 38) * 100) / 100;
  return {
    netReturnPct,
    annualizedReturnPct: Math.round((netReturnPct * 1.7 + rand() * 6) * 100) / 100,
    winRatePct,
    profitFactor,
    averageRewardRisk: Math.round((1.1 + rand() * 1.4) * 100) / 100,
    tradeCount,
    maxDrawdownPct: Math.round((4 + rand() * 16) * 100) / 100,
    sharpe: Math.round((0.4 + rand() * 1.9) * 100) / 100,
    sortino: Math.round((0.6 + rand() * 2.6) * 100) / 100,
    expectancyR: Math.round((0.05 + rand() * 0.45) * 100) / 100,
    netProfitAfterCosts: Math.round((40_000 + rand() * 480_000) * 100) / 100,
  };
}

function equityCurve(rand: () => number, points: number, initial: number, netReturnPct: number): EquityPoint[] {
  const out: EquityPoint[] = [];
  let equity = initial;
  let peak = initial;
  const now = Math.floor(Date.now() / 1000);
  const drift = (netReturnPct / 100) / points;
  for (let i = 0; i < points; i += 1) {
    const shock = (rand() - 0.48) * 0.016;
    equity = equity * (1 + drift + shock);
    peak = Math.max(peak, equity);
    const drawdown = ((equity - peak) / peak) * 100;
    out.push({ time: now - (points - i) * 86_400, equity: Math.round(equity * 100) / 100, drawdown: Math.round(drawdown * 100) / 100 });
  }
  return out;
}

function trades(rand: () => number, count: number, symbols: string[]): TradeRecord[] {
  return Array.from({ length: count }).map((_, idx) => {
    const symbol = symbols[idx % symbols.length];
    const long = rand() > 0.42;
    const entryPrice = Math.round((800 + rand() * 4200) * 100) / 100;
    const r = rand();
    const win = r > 0.42;
    const movePct = win ? 0.4 + rand() * 2.6 : -(0.3 + rand() * 1.6);
    const exitPrice = Math.round(entryPrice * (1 + (long ? movePct : -movePct) / 100) * 100) / 100;
    const quantity = Math.round(5 + rand() * 180);
    const gross = Math.round((exitPrice - entryPrice) * quantity * (long ? 1 : -1) * 100) / 100;
    const costs = Math.round(Math.abs(gross) * 0.06 * 100) / 100;
    const net = Math.round((gross - costs) * 100) / 100;
    const entryDate = new Date(Date.now() - (count - idx) * 86_400_000);
    const exitDate = new Date(entryDate.getTime() + (2 + Math.floor(rand() * 5)) * 86_400_000);
    return {
      id: `trade-${idx}`,
      instrumentId: symbol,
      symbol,
      direction: long ? 'LONG' : 'SHORT',
      entryTime: entryDate.toISOString(),
      exitTime: exitDate.toISOString(),
      entryPrice,
      exitPrice,
      quantity,
      grossPnl: gross,
      costs,
      netPnl: net,
      rMultiple: Math.round((net / (entryPrice * quantity * 0.012) + 0.05) * 100) / 100,
      exitReason: win ? (rand() > 0.5 ? 'TARGET' : 'SIGNAL') : rand() > 0.5 ? 'STOP' : 'SIGNAL',
    } satisfies TradeRecord;
  });
}

const REGIMES: RegimePerformance['regime'][] = ['BULLISH', 'BEARISH', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LOW_VOLATILITY'];

function regimeBreakdown(rand: () => number): RegimePerformance[] {
  return REGIMES.map((regime) => {
    const tradeCount = Math.round(6 + rand() * 48);
    return {
      regime,
      tradeCount,
      winRatePct: Math.round((38 + rand() * 30) * 10) / 10,
      netReturnPct: Math.round((rand() * 18 - 5) * 100) / 100,
      maxDrawdownPct: Math.round((2 + rand() * 12) * 100) / 100,
    };
  });
}

export function buildBacktestResult(
  strategyId: string,
  instrumentIds: string[],
  phase: BacktestResult['phase'] = 'IN_SAMPLE',
): BacktestResult {
  const strategy = STRATEGIES.find((s) => s.id === strategyId) ?? STRATEGIES[0];
  const rand = seededRandom(`bt:${strategyId}:${phase}:${instrumentIds.join(',')}`);
  const initialCapital = 1_000_000;
  const metrics = metricsFrom(rand);
  const sampleSymbols = instrumentIds.length
    ? instrumentIds.map((id) => INSTRUMENTS.find((i) => i.id === id)?.symbol ?? id)
    : INSTRUMENTS.slice(0, 3).map((i) => i.symbol);

  const warnings: BacktestResult['warnings'] = [
    'Simulated results. Costs and slippage are modelled estimates, not realised fills.',
    'Past or simulated performance does not indicate future results.',
  ];
  if (metrics.tradeCount < 60) warnings.push('Trade sample is thin â€” metrics are statistically fragile.');
  if (metrics.winRatePct > 78) warnings.push('Unusually high win rate may indicate overfitting or asymmetric exit bias.');
  if (phase === 'OUT_OF_SAMPLE') warnings.push('Out-of-sample window is short; treat the edge as provisional.');

  return {
    id: `bt-${strategyId}-${phase}`,
    strategyId,
    strategyName: strategy.name,
    instrumentIds,
    window: { from: '2023-01-02', to: '2026-06-30' },
    costs: DEFAULT_COSTS,
    initialCapital,
    isSimulated: true,
    phase,
    metrics,
    equityCurve: equityCurve(rand, 420, initialCapital, metrics.netReturnPct),
    trades: trades(rand, Math.min(metrics.tradeCount, 80), sampleSymbols),
    regimeBreakdown: regimeBreakdown(rand),
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

export function buildComparison(strategyIds: string[]): StrategyComparison {
  return {
    rows: strategyIds.map((id, idx) => {
      const strategy = STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
      const rand = seededRandom(`cmp:${id}`);
      return {
        strategyId: id,
        strategyName: strategy.name,
        metrics: metricsFrom(rand),
        phase: (['IN_SAMPLE', 'OUT_OF_SAMPLE', 'WALK_FORWARD'] as const)[idx % 3],
      };
    }),
  };
}
