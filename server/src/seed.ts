/**
 * Reference-data seed: markets, instruments, sessions and strategies.
 *
 * Idempotent — safe to run on every boot. Instrument ids match the frontend
 * universe so API responses line up with the existing UI. Instruments whose
 * venue has no configured live provider (currency futures, MCX, FX reference
 * rates) are routed to the demo adapter and are labelled as demonstration
 * data everywhere they appear.
 */

import type { Db } from './db/db.ts';
import { upsertInstrument, upsertMarket, upsertSession } from './db/repoReference.ts';
import { insertConditions, insertStrategyConfig, upsertStrategy } from './db/repoOps.ts';
import { withTx } from './db/tx.ts';
import { DEMO_BASE_PRICES } from './providers/registry.ts';
import { zonedWallClockToUtc } from './lib/time.ts';

interface MarketSeed {
  id: string;
  category: string;
  name: string;
  region: string;
  timezone: string;
  open: number;
  close: number;
  weekdays: number[];
  currency: string;
}

const MARKETS: MarketSeed[] = [
  { id: 'mkt-in-equities', category: 'INDIAN_EQUITIES', name: 'Indian Equities', region: 'IN', timezone: 'Asia/Kolkata', open: 555, close: 900, weekdays: [1, 2, 3, 4, 5], currency: 'INR' },
  { id: 'mkt-in-indices', category: 'INDIAN_INDICES', name: 'Indian Indices', region: 'IN', timezone: 'Asia/Kolkata', open: 555, close: 900, weekdays: [1, 2, 3, 4, 5], currency: 'INR' },
  { id: 'mkt-in-cd', category: 'IN_CURRENCY_DERIVATIVES', name: 'Currency Derivatives (IN)', region: 'IN', timezone: 'Asia/Kolkata', open: 540, close: 1020, weekdays: [1, 2, 3, 4, 5], currency: 'INR' },
  { id: 'mkt-intl-equities', category: 'INTERNATIONAL_EQUITIES', name: 'International Equities', region: 'US', timezone: 'America/New_York', open: 570, close: 960, weekdays: [1, 2, 3, 4, 5], currency: 'USD' },
  { id: 'mkt-intl-indices', category: 'INTERNATIONAL_INDICES', name: 'International Indices', region: 'GLOBAL', timezone: 'America/New_York', open: 570, close: 960, weekdays: [1, 2, 3, 4, 5], currency: 'USD' },
  { id: 'mkt-other', category: 'OTHER', name: 'Other Instruments', region: 'GLOBAL', timezone: 'Asia/Kolkata', open: 540, close: 1410, weekdays: [1, 2, 3, 4, 5], currency: 'INR' },
  { id: 'mkt-crypto', category: 'CRYPTO', name: 'Crypto Spot', region: 'GLOBAL', timezone: 'UTC', open: 0, close: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6], currency: 'USD' },
];

type InstrumentSeed = [
  id: string,
  symbol: string,
  name: string,
  market: string,
  exchange: string,
  region: string,
  type: string,
  currency: string,
  sector: string | undefined,
  providerId: string | null,
  providerSymbol: string | null,
];

const RESTRICTION_USDINR = {
  code: 'FX-REF-01',
  summary: 'Reference rate only — not a tradable quote',
  detail:
    'USD/INR is displayed as a reference rate for research context. Retail trading in exchange-traded currency derivatives is subject to SEBI eligibility norms. No executable price is implied.',
};

function ns(symbol: string): string {
  return `${symbol}.NS`;
}

const INSTRUMENTS: InstrumentSeed[] = [
  // Indian indices — Yahoo symbol mappings
  ['idx-nifty50', 'NIFTY 50', 'Nifty 50 Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^NSEI'],
  ['idx-sensex', 'SENSEX', 'BSE Sensex', 'INDIAN_INDICES', 'BSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^BSESN'],
  ['idx-niftybank', 'NIFTY BANK', 'Nifty Bank Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^NSEBANK'],
  ['idx-niftyit', 'NIFTY IT', 'Nifty IT Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^CNXIT'],
  ['idx-niftymid', 'NIFTY MIDCAP 100', 'Nifty Midcap 100', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^NSEMDCP50'],
  ['idx-indiavix', 'INDIA VIX', 'India VIX', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', undefined, 'yahoo', '^INDIAVIX'],

  // Indian equities — NSE via Yahoo
  ['eq-reliance', 'RELIANCE', 'Reliance Industries', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Energy', 'yahoo', ns('RELIANCE')],
  ['eq-tcs', 'TCS', 'Tata Consultancy Services', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Information Technology', 'yahoo', ns('TCS')],
  ['eq-hdfcbank', 'HDFCBANK', 'HDFC Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Financials', 'yahoo', ns('HDFCBANK')],
  ['eq-infy', 'INFY', 'Infosys', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Information Technology', 'yahoo', ns('INFY')],
  ['eq-icicibank', 'ICICIBANK', 'ICICI Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Financials', 'yahoo', ns('ICICIBANK')],
  ['eq-sbin', 'SBIN', 'State Bank of India', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Financials', 'yahoo', ns('SBIN')],
  ['eq-bhartiartl', 'BHARTIARTL', 'Bharti Airtel', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Telecom', 'yahoo', ns('BHARTIARTL')],
  ['eq-itc', 'ITC', 'ITC Limited', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Consumer Staples', 'yahoo', ns('ITC')],
  ['eq-lt', 'LT', 'Larsen & Toubro', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Industrials', 'yahoo', ns('LT')],
  ['eq-axisbank', 'AXISBANK', 'Axis Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Financials', 'yahoo', ns('AXISBANK')],
  ['eq-maruti', 'MARUTI', 'Maruti Suzuki', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Automobiles', 'yahoo', ns('MARUTI')],
  ['eq-tatamotors', 'TATAMOTORS', 'Tata Motors', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Automobiles', 'yahoo', ns('TATAMOTORS')],
  ['eq-sunpharma', 'SUNPHARMA', 'Sun Pharmaceutical', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Healthcare', 'yahoo', ns('SUNPHARMA')],
  ['eq-wipro', 'WIPRO', 'Wipro', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Information Technology', 'yahoo', ns('WIPRO')],
  ['eq-hindunilvr', 'HINDUNILVR', 'Hindustan Unilever', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Consumer Staples', 'yahoo', ns('HINDUNILVR')],
  ['eq-asianpaint', 'ASIANPAINT', 'Asian Paints', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Consumer Discretionary', 'yahoo', ns('ASIANPAINT')],
  ['eq-titan', 'TITAN', 'Titan Company', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Consumer Discretionary', 'yahoo', ns('TITAN')],
  ['eq-bajfinance', 'BAJFINANCE', 'Bajaj Finance', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Financials', 'yahoo', ns('BAJFINANCE')],
  ['eq-ntpc', 'NTPC', 'NTPC Limited', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Utilities', 'yahoo', ns('NTPC')],
  ['eq-powergrid', 'POWERGRID', 'Power Grid Corporation', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Utilities', 'yahoo', ns('POWERGRID')],
  ['eq-tatasteel', 'TATASTEEL', 'Tata Steel', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Metals', 'yahoo', ns('TATASTEEL')],
  ['eq-adanient', 'ADANIENT', 'Adani Enterprises', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 'Industrials', 'yahoo', ns('ADANIENT')],

  // Currency derivatives + FX reference — no live adapter configured → demo
  ['cd-usdinr', 'USDINR FUT', 'USD/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', undefined, 'demo', null],
  ['cd-eurinr', 'EURINR FUT', 'EUR/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', undefined, 'demo', null],
  ['cd-gbpinr', 'GBPINR FUT', 'GBP/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', undefined, 'demo', null],
  ['cd-jpyinr', 'JPYINR FUT', 'JPY/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', undefined, 'demo', null],
  ['fx-usdinr', 'USD/INR', 'US Dollar / Indian Rupee (reference)', 'OTHER', 'FOREX', 'FX', 'REFERENCE_RATE', 'INR', undefined, 'demo', null],

  // International indices
  ['idx-sp500', 'S&P 500', 'S&P 500 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', undefined, 'yahoo', '^GSPC'],
  ['idx-nasdaq', 'NASDAQ 100', 'Nasdaq 100 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', undefined, 'yahoo', '^NDX'],
  ['idx-dow', 'DOW JONES', 'Dow Jones Industrial Average', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', undefined, 'yahoo', '^DJI'],
  ['idx-ftse', 'FTSE 100', 'FTSE 100 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'GBP', undefined, 'yahoo', '^FTSE'],
  ['idx-nikkei', 'NIKKEI 225', 'Nikkei 225', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'USD', undefined, 'yahoo', '^N225'],
  ['idx-dax', 'DAX', 'DAX 40', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'EUR', undefined, 'yahoo', '^GDAXI'],

  // International equities
  ['intl-aapl', 'AAPL', 'Apple Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Technology', 'yahoo', 'AAPL'],
  ['intl-msft', 'MSFT', 'Microsoft Corporation', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Technology', 'yahoo', 'MSFT'],
  ['intl-nvda', 'NVDA', 'NVIDIA Corporation', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Technology', 'yahoo', 'NVDA'],
  ['intl-amzn', 'AMZN', 'Amazon.com Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Consumer Discretionary', 'yahoo', 'AMZN'],
  ['intl-googl', 'GOOGL', 'Alphabet Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Technology', 'yahoo', 'GOOGL'],
  ['intl-meta', 'META', 'Meta Platforms Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Technology', 'yahoo', 'META'],
  ['intl-tsla', 'TSLA', 'Tesla Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 'Automobiles', 'yahoo', 'TSLA'],
  ['intl-jpm', 'JPM', 'JPMorgan Chase & Co.', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 'Financials', 'yahoo', 'JPM'],
  ['intl-xom', 'XOM', 'Exxon Mobil Corporation', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 'Energy', 'yahoo', 'XOM'],
  ['intl-jnj', 'JNJ', 'Johnson & Johnson', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 'Healthcare', 'yahoo', 'JNJ'],

  // Commodities (MCX) — no live adapter → demo
  ['oth-gold', 'GOLD MCX', 'Gold Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 'Commodities', 'demo', null],
  ['oth-silver', 'SILVER MCX', 'Silver Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 'Commodities', 'demo', null],
  ['oth-crude', 'CRUDEOIL MCX', 'Crude Oil Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 'Commodities', 'demo', null],
];

interface StrategySeed {
  id: string;
  name: string;
  family: string;
  description: string;
  timeframe: string;
  config: Record<string, unknown>;
  entry: Array<[string, string, string, number]>;
  exit: Array<[string, string, string, number]>;
}

const STRATEGIES: StrategySeed[] = [
  {
    id: 'str-ema-pullback',
    name: 'EMA Trend Pullback',
    family: 'TREND',
    description: 'Buys a pullback to the 20 EMA while price holds above the 200 EMA and RSI stays in the bullish band.',
    timeframe: '15m',
    config: {
      indicators: [
        { id: 'EMA', label: 'EMA 20', enabled: true, params: { period: 20 } },
        { id: 'EMA', label: 'EMA 200', enabled: true, params: { period: 200 } },
        { id: 'RSI', label: 'RSI 14', enabled: true, params: { period: 14 } },
        { id: 'ATR', label: 'ATR 14', enabled: true, params: { period: 14 } },
      ],
      stopLoss: { mode: 'ATR_MULTIPLE', value: 1.5 },
      targets: { target1Pct: 1.2, target2Pct: 2.5 },
      exitMode: 'TARGET_STOP',
    },
    entry: [
      ['close', 'CROSSES_ABOVE', 'ema_20', 1],
      ['close', 'GREATER_THAN', 'ema_200', 1],
      ['rsi_14', 'WITHIN_RANGE', '45..65', 1],
    ],
    exit: [
      ['close', 'CROSSES_BELOW', 'ema_20', 1],
      ['rsi_14', 'GREATER_THAN', '75', 1],
    ],
  },
  {
    id: 'str-rsi-reversion',
    name: 'RSI Mean Reversion',
    family: 'MEAN_REVERSION',
    description: 'Fades statistically stretched moves: buys when RSI(14) leaves oversold territory above a support level.',
    timeframe: '30m',
    config: {
      indicators: [
        { id: 'RSI', label: 'RSI 14', enabled: true, params: { period: 14 } },
        { id: 'BOLLINGER', label: 'Bollinger 20/2', enabled: true, params: { period: 20, mult: 2 } },
        { id: 'VOLUME', label: 'Volume', enabled: true, params: { period: 20 } },
      ],
      stopLoss: { mode: 'FIXED_PCT', value: 1.0 },
      targets: { target1Pct: 1.0, target2Pct: 2.0 },
      exitMode: 'TARGET_STOP',
    },
    entry: [
      ['rsi_14', 'CROSSES_ABOVE', '30', 1],
      ['close', 'LESS_THAN', 'bb_lower', 1],
      ['relative_volume', 'GREATER_THAN', '1.1', 1],
    ],
    exit: [
      ['rsi_14', 'CROSSES_ABOVE', '65', 1],
      ['close', 'CROSSES_ABOVE', 'bb_middle', 1],
    ],
  },
  {
    id: 'str-bollinger-squeeze',
    name: 'Bollinger Squeeze Breakout',
    family: 'BREAKOUT',
    description: 'Enters on an expansion of range out of a narrow Bollinger band squeeze with volume confirmation.',
    timeframe: '1h',
    config: {
      indicators: [
        { id: 'BOLLINGER', label: 'Bollinger 20/2', enabled: true, params: { period: 20, mult: 2 } },
        { id: 'ATR', label: 'ATR 14', enabled: true, params: { period: 14 } },
        { id: 'VOLUME', label: 'Volume', enabled: true, params: { period: 20 } },
      ],
      stopLoss: { mode: 'ATR_MULTIPLE', value: 2 },
      targets: { target1Pct: 1.8, target2Pct: 3.6 },
      exitMode: 'SIGNAL_FLIP',
    },
    entry: [
      ['bb_width', 'LESS_THAN', '0.02', 5],
      ['close', 'CROSSES_ABOVE', 'bb_upper', 1],
      ['relative_volume', 'GREATER_THAN', '1.5', 1],
    ],
    exit: [
      ['close', 'CROSSES_BELOW', 'bb_middle', 1],
    ],
  },
  {
    id: 'str-macd-momentum',
    name: 'MACD Momentum Continuation',
    family: 'MOMENTUM',
    description: 'Rides confirmed momentum: MACD line above signal with expanding histogram while ADX confirms trend strength.',
    timeframe: '1h',
    config: {
      indicators: [
        { id: 'MACD', label: 'MACD 12/26/9', enabled: true, params: { fast: 12, slow: 26, signal: 9 } },
        { id: 'ADX', label: 'ADX 14', enabled: true, params: { period: 14 } },
        { id: 'EMA', label: 'EMA 50', enabled: true, params: { period: 50 } },
      ],
      stopLoss: { mode: 'FIXED_PCT', value: 1.25 },
      targets: { target1Pct: 1.5, target2Pct: 3.0 },
      exitMode: 'TRAILING',
    },
    entry: [
      ['macd', 'CROSSES_ABOVE', 'macd_signal', 1],
      ['histogram', 'GREATER_THAN', '0', 1],
      ['adx', 'GREATER_THAN', '25', 1],
    ],
    exit: [
      ['macd', 'CROSSES_BELOW', 'macd_signal', 1],
      ['adx', 'LESS_THAN', '20', 1],
    ],
  },
  {
    id: 'str-vol-expansion',
    name: 'ATR Volatility Expansion',
    family: 'VOLATILITY',
    description: 'Waits for volatility contraction then enters on an ATR expansion bar breaking the prior range.',
    timeframe: '4h',
    config: {
      indicators: [
        { id: 'ATR', label: 'ATR 14', enabled: true, params: { period: 14 } },
        { id: 'SMA', label: 'SMA 20', enabled: true, params: { period: 20 } },
        { id: 'VOLUME', label: 'Volume', enabled: true, params: { period: 20 } },
      ],
      stopLoss: { mode: 'ATR_MULTIPLE', value: 1.75 },
      targets: { target1Pct: 2.0, target2Pct: 4.0 },
      exitMode: 'TIME_BASED',
    },
    entry: [
      ['atr', 'GREATER_THAN', 'atr_sma_14', 1],
      ['close', 'GREATER_THAN', 'sma_20', 1],
      ['range_breakout', 'CROSSES_ABOVE', 'prior_high', 1],
    ],
    exit: [
      ['close', 'CROSSES_BELOW', 'sma_20', 1],
    ],
  },
];

/** Seeds markets, instruments, sessions and strategies (idempotent). */
export function seedReferenceData(db: Db): void {
  const now = new Date().toISOString();
  withTx(db, () => {
    for (const m of MARKETS) {
      upsertMarket(db, {
        id: m.id,
        category: m.category,
        name: m.name,
        region: m.region,
        timezone: m.timezone,
        weekday_open_min: m.open,
        weekday_close_min: m.close,
        weekdays: JSON.stringify(m.weekdays),
        currency: m.currency,
        created_at: now,
      });
    }

    for (const row of INSTRUMENTS) {
      const [id, symbol, name, market, exchange, region, type, currency, sector, providerId, providerSymbol] = row;
      const restriction = id === 'fx-usdinr' ? RESTRICTION_USDINR : undefined;
      upsertInstrument(db, {
        id,
        symbol,
        name,
        market_category: market,
        exchange,
        region,
        type,
        currency,
        sector: sector ?? null,
        provider_id: providerId,
        provider_symbol: providerSymbol,
        restriction_code: restriction?.code ?? null,
        restriction_summary: restriction?.summary ?? null,
        restriction_detail: restriction?.detail ?? null,
        is_active: 1,
        created_at: now,
      });
    }

    seedSessions(db);

    for (const strategy of STRATEGIES) {
      upsertStrategy(db, {
        id: strategy.id,
        name: strategy.name,
        family: strategy.family,
        description: strategy.description,
        timeframe: strategy.timeframe,
        config_json: JSON.stringify(strategy.config),
        created_at: now,
      });
      insertStrategyConfig(db, `cfg-${strategy.id}-v1`, strategy.id, 1, JSON.stringify(strategy.config), true);
      insertConditions(
        db,
        [
          ...strategy.entry.map(([left, operator, right, lookback], i) => ({
            id: `${strategy.id}-entry-${i}`,
            strategyId: strategy.id,
            kind: 'ENTRY' as const,
            ordinal: i,
            leftExpr: left,
            operator,
            rightExpr: right,
            lookback,
          })),
          ...strategy.exit.map(([left, operator, right, lookback], i) => ({
            id: `${strategy.id}-exit-${i}`,
            strategyId: strategy.id,
            kind: 'EXIT' as const,
            ordinal: i,
            leftExpr: left,
            operator,
            rightExpr: right,
            lookback,
          })),
        ],
      );
    }

  });
}

/** Generates ±10 calendar days of scheduled sessions per market (weekdays only). */
function seedSessions(db: Db): void {
  const today = new Date();
  for (const market of MARKETS) {
    for (let offset = -10; offset <= 10; offset += 1) {
      const day = new Date(today.getTime() + offset * 86_400_000);
      // Exchange-local calendar date for that instant.
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: market.timezone }).format(day);
      const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
      const isTradingDay = market.weekdays.includes(weekday);
      const openUtc = zonedWallClockToUtc(dateStr, market.open, market.timezone);
      const closeUtc = zonedWallClockToUtc(dateStr, market.close, market.timezone);
      upsertSession(db, {
        id: `sess-${market.id}-${dateStr}`,
        market_id: market.id,
        session_date: dateStr,
        open_at_utc: new Date(openUtc).toISOString(),
        close_at_utc: new Date(closeUtc).toISOString(),
        status: isTradingDay ? 'SCHEDULED' : 'HOLIDAY',
        is_holiday: isTradingDay ? 0 : 1,
        note: isTradingDay ? null : 'Non-trading day — market closed',
        created_at: new Date().toISOString(),
      });
    }
  }
}

/** Base reference prices shared with the demo adapter. */
export function demoBasePrices(): Record<string, number> {
  return { ...DEMO_BASE_PRICES };
}
