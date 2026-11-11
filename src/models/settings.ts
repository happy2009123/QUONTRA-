import type { MarketCategory, Timeframe } from './market';

export type ChartType = 'CANDLES' | 'LINE' | 'AREA' | 'BARS' | 'HEIKIN_ASHI';

export interface ChartPreferences {
  chartType: ChartType;
  showVolume: boolean;
  showGrid: boolean;
  showCrosshair: boolean;
  defaultIndicators: string[];
  theme: 'DARK' | 'LIGHT';
}

export interface AppSettings {
  displayName: string;
  email: string;
  role: string;
  defaultMarket: MarketCategory | 'ALL';
  defaultTimeframe: Timeframe;
  baseCurrency: 'INR' | 'USD';
  chart: ChartPreferences;
  compactTables: boolean;
  reduceMotion: boolean;
  timezone: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: 'Research Desk',
  email: 'desk@quantora.demo',
  role: 'Quantitative Analyst',
  defaultMarket: 'ALL',
  defaultTimeframe: '1D',
  baseCurrency: 'INR',
  chart: {
    chartType: 'CANDLES',
    showVolume: true,
    showGrid: true,
    showCrosshair: true,
    defaultIndicators: ['EMA_9', 'EMA_20', 'VOLUME'],
    theme: 'DARK',
  },
  compactTables: true,
  reduceMotion: false,
  timezone: 'Asia/Kolkata',
};
