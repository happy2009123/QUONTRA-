import type { Instrument, MarketCategory, Quote, DataFreshness } from '@/models';

const DEMO_SOURCE = {
  provider: 'QUANTORA Demo Engine',
  origin: 'SIMULATED',
  isDemo: true,
  reliability: 'PROVISIONAL' as const,
};

export const USD_INR_RESTRICTION = {
  code: 'FX-REF-01',
  summary: 'Reference rate only — not a tradable quote',
  detail:
    'USD/INR is displayed as a reference rate for research context. Retail trading in exchange-traded currency derivatives is subject to SEBI eligibility norms. No executable price is implied.',
};

type Seed = [
  id: string,
  symbol: string,
  name: string,
  market: MarketCategory,
  exchange: Instrument['exchange'],
  region: Instrument['region'],
  type: Instrument['type'],
  currency: Instrument['currency'],
  price: number,
  sector?: string,
];

const SEEDS: Seed[] = [
  ['idx-nifty50', 'NIFTY 50', 'Nifty 50 Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', 26412.35],
  ['idx-sensex', 'SENSEX', 'BSE Sensex', 'INDIAN_INDICES', 'BSE', 'IN', 'INDEX', 'INR', 86241.7],
  ['idx-niftybank', 'NIFTY BANK', 'Nifty Bank Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', 57890.15],
  ['idx-niftyit', 'NIFTY IT', 'Nifty IT Index', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', 43120.6],
  ['idx-niftymid', 'NIFTY MIDCAP 100', 'Nifty Midcap 100', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', 61240.9],
  ['idx-indiavix', 'INDIA VIX', 'India VIX', 'INDIAN_INDICES', 'NSE', 'IN', 'INDEX', 'INR', 13.42],

  ['eq-reliance', 'RELIANCE', 'Reliance Industries', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1428.55, 'Energy'],
  ['eq-tcs', 'TCS', 'Tata Consultancy Services', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 4112.8, 'Information Technology'],
  ['eq-hdfcbank', 'HDFCBANK', 'HDFC Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1987.4, 'Financials'],
  ['eq-infy', 'INFY', 'Infosys', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1876.25, 'Information Technology'],
  ['eq-icicibank', 'ICICIBANK', 'ICICI Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1421.9, 'Financials'],
  ['eq-sbin', 'SBIN', 'State Bank of India', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 892.35, 'Financials'],
  ['eq-bhartiartl', 'BHARTIARTL', 'Bharti Airtel', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1962.1, 'Telecom'],
  ['eq-itc', 'ITC', 'ITC Limited', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 468.7, 'Consumer Staples'],
  ['eq-lt', 'LT', 'Larsen & Toubro', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 3894.5, 'Industrials'],
  ['eq-axisbank', 'AXISBANK', 'Axis Bank', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1204.6, 'Financials'],
  ['eq-maruti', 'MARUTI', 'Maruti Suzuki', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 15420.75, 'Automobiles'],
  ['eq-tatamotors', 'TATAMOTORS', 'Tata Motors', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 712.45, 'Automobiles'],
  ['eq-sunpharma', 'SUNPHARMA', 'Sun Pharmaceutical', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 1782.3, 'Healthcare'],
  ['eq-wipro', 'WIPRO', 'Wipro', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 542.15, 'Information Technology'],
  ['eq-hindunilvr', 'HINDUNILVR', 'Hindustan Unilever', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 2438.9, 'Consumer Staples'],
  ['eq-asianpaint', 'ASIANPAINT', 'Asian Paints', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 2894.2, 'Consumer Discretionary'],
  ['eq-titan', 'TITAN', 'Titan Company', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 3612.5, 'Consumer Discretionary'],
  ['eq-bajfinance', 'BAJFINANCE', 'Bajaj Finance', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 9820.4, 'Financials'],
  ['eq-ntpc', 'NTPC', 'NTPC Limited', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 342.8, 'Utilities'],
  ['eq-powergrid', 'POWERGRID', 'Power Grid Corporation', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 286.45, 'Utilities'],
  ['eq-tatasteel', 'TATASTEEL', 'Tata Steel', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 168.75, 'Metals'],
  ['eq-adanient', 'ADANIENT', 'Adani Enterprises', 'INDIAN_EQUITIES', 'NSE', 'IN', 'EQUITY', 'INR', 2412.6, 'Industrials'],

  ['cd-usdinr', 'USDINR FUT', 'USD/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', 88.42],
  ['cd-eurinr', 'EURINR FUT', 'EUR/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', 95.68],
  ['cd-gbpinr', 'GBPINR FUT', 'GBP/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', 113.24],
  ['cd-jpyinr', 'JPYINR FUT', 'JPY/INR Currency Future (Dec)', 'IN_CURRENCY_DERIVATIVES', 'NSE', 'FX', 'CURRENCY_FUTURE', 'INR', 0.5784],

  ['fx-usdinr', 'USD/INR', 'US Dollar / Indian Rupee (reference)', 'OTHER', 'FOREX', 'FX', 'REFERENCE_RATE', 'INR', 88.41],

  ['idx-sp500', 'S&P 500', 'S&P 500 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', 6918.42],
  ['idx-nasdaq', 'NASDAQ 100', 'Nasdaq 100 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', 25842.16],
  ['idx-dow', 'DOW JONES', 'Dow Jones Industrial Average', 'INTERNATIONAL_INDICES', 'INDEX', 'US', 'INDEX', 'USD', 47120.88],
  ['idx-ftse', 'FTSE 100', 'FTSE 100 Index', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'GBP', 9842.5],
  ['idx-nikkei', 'NIKKEI 225', 'Nikkei 225', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'USD', 48210.3],
  ['idx-dax', 'DAX', 'DAX 40', 'INTERNATIONAL_INDICES', 'INDEX', 'GLOBAL', 'INDEX', 'EUR', 24118.7],

  ['intl-aapl', 'AAPL', 'Apple Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 268.42, 'Technology'],
  ['intl-msft', 'MSFT', 'Microsoft Corporation', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 512.36, 'Technology'],
  ['intl-nvda', 'NVDA', 'NVIDIA Corporation', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 184.72, 'Technology'],
  ['intl-amzn', 'AMZN', 'Amazon.com Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 232.18, 'Consumer Discretionary'],
  ['intl-googl', 'GOOGL', 'Alphabet Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 214.55, 'Technology'],
  ['intl-meta', 'META', 'Meta Platforms Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 612.9, 'Technology'],
  ['intl-tsla', 'TSLA', 'Tesla Inc.', 'INTERNATIONAL_EQUITIES', 'NASDAQ', 'US', 'EQUITY', 'USD', 342.65, 'Automobiles'],
  ['intl-jpm', 'JPM', 'JPMorgan Chase & Co.', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 292.14, 'Financials'],
  ['intl-xom', 'XOM', 'Exxon Mobil Corporation', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 122.48, 'Energy'],
  ['intl-jnj', 'JNJ', 'Johnson & Johnson', 'INTERNATIONAL_EQUITIES', 'NYSE', 'US', 'EQUITY', 'USD', 164.72, 'Healthcare'],

  ['oth-gold', 'GOLD MCX', 'Gold Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 102840, 'Commodities'],
  ['oth-silver', 'SILVER MCX', 'Silver Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 126480, 'Commodities'],
  ['oth-crude', 'CRUDEOIL MCX', 'Crude Oil Futures (MCX)', 'OTHER', 'MCX', 'GLOBAL', 'COMMODITY', 'INR', 6482, 'Commodities'],
];

export const INSTRUMENTS: Instrument[] = SEEDS.map(
  ([id, symbol, name, market, exchange, region, type, currency, , sector]) => ({
    id,
    symbol,
    name,
    market,
    exchange,
    region,
    type,
    currency,
    ...(sector ? { sector } : {}),
    ...(id === 'fx-usdinr' ? { restriction: USD_INR_RESTRICTION } : {}),
  }),
);

export const INSTRUMENT_BY_ID: Record<string, Instrument> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.id, i]),
);

/** Base reference price used by the demo candle generator. */
export const BASE_PRICE: Record<string, number> = Object.fromEntries(
  SEEDS.map(([id, , , , , , , , price]) => [id, price]),
);

export const MARKET_LABELS: Record<MarketCategory, string> = {
  INDIAN_EQUITIES: 'Indian Equities',
  INDIAN_INDICES: 'Indian Indices',
  IN_CURRENCY_DERIVATIVES: 'Currency Derivatives (IN)',
  INTERNATIONAL_EQUITIES: 'International Equities',
  INTERNATIONAL_INDICES: 'International Indices',
  OTHER: 'Other Instruments',
};

export function demoSource(): typeof DEMO_SOURCE {
  return { ...DEMO_SOURCE };
}

/** Market session windows (IST) used for status labelling in the demo build. */
export function marketStatusFor(market: MarketCategory, at: Date = new Date()): Quote['marketStatus'] {
  const ist = new Date(at.getTime() + (5.5 * 60 - at.getTimezoneOffset()) * 60000);
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const day = ist.getDay();
  const weekend = day === 0 || day === 6;

  if (market === 'INDIAN_EQUITIES' || market === 'INDIAN_INDICES' || market === 'IN_CURRENCY_DERIVATIVES') {
    if (weekend) return 'CLOSED';
    if (minutes >= 555 && minutes < 900) return 'OPEN';
    if (minutes >= 540 && minutes < 555) return 'PRE_OPEN';
    return 'CLOSED';
  }
  if (market === 'INTERNATIONAL_EQUITIES' || market === 'INTERNATIONAL_INDICES') {
    if (weekend) return 'CLOSED';
    if (minutes >= 1170 || minutes < 60) return 'AFTER_HOURS';
    return minutes >= 660 && minutes < 1170 ? 'OPEN' : 'CLOSED';
  }
  return 'OPEN';
}

export function freshnessFor(market: MarketCategory): DataFreshness {
  if (market === 'INTERNATIONAL_EQUITIES' || market === 'INTERNATIONAL_INDICES') return 'DELAYED';
  return 'DEMO';
}
