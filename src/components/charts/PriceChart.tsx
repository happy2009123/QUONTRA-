import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@/models';
import { cn } from '@/lib/cn';
import { adx, atr, bollinger, ema, macd, rsi, sma, vwap } from '@/lib/indicators';
import type { Series } from '@/lib/indicators';
import { formatNumber } from '@/lib/format';

export type ChartStyle = 'CANDLES' | 'LINE' | 'AREA' | 'BARS';

export type IndicatorKey =
  | 'EMA_9'
  | 'EMA_20'
  | 'EMA_50'
  | 'EMA_200'
  | 'SMA_20'
  | 'SMA_50'
  | 'BOLLINGER'
  | 'VWAP'
  | 'VOLUME'
  | 'RSI'
  | 'MACD'
  | 'ATR'
  | 'ADX';

export const INDICATOR_GROUPS: { title: string; keys: { key: IndicatorKey; label: string }[] }[] = [
  {
    title: 'Moving averages',
    keys: [
      { key: 'EMA_9', label: 'EMA 9' },
      { key: 'EMA_20', label: 'EMA 20' },
      { key: 'EMA_50', label: 'EMA 50' },
      { key: 'EMA_200', label: 'EMA 200' },
      { key: 'SMA_20', label: 'SMA 20' },
      { key: 'SMA_50', label: 'SMA 50' },
    ],
  },
  {
    title: 'Overlays',
    keys: [
      { key: 'BOLLINGER', label: 'Bollinger Bands' },
      { key: 'VWAP', label: 'VWAP' },
      { key: 'ATR', label: 'ATR 14' },
    ],
  },
  {
    title: 'Oscillators',
    keys: [
      { key: 'RSI', label: 'RSI 14' },
      { key: 'MACD', label: 'MACD' },
      { key: 'ADX', label: 'ADX 14' },
      { key: 'VOLUME', label: 'Volume' },
    ],
  },
];

export interface HoverState {
  index: number;
  candle: Candle;
  values: Record<string, number | null>;
}

export interface PriceChartProps {
  candles: Candle[];
  style: ChartStyle;
  indicators: IndicatorKey[];
  onHover?: (state: HoverState | null) => void;
  className?: string;
  minHeight?: number;
}

type AnySeries = ISeriesApi<SeriesType>;

const COLORS = {
  bg: '#151A22',
  grid: '#1c222b',
  text: '#929BA8',
  border: '#252C36',
  gold: '#C6A15B',
  goldLight: '#E0C48A',
  up: '#24B47E',
  down: '#E05252',
  info: '#5B9DE0',
};

const MA_COLORS: Record<string, string> = {
  EMA_9: '#E0C48A',
  EMA_20: '#C6A15B',
  EMA_50: '#5B9DE0',
  EMA_200: '#8C97A6',
  SMA_20: '#B3894F',
  SMA_50: '#7FA8C9',
  VWAP: '#7FA8C9',
  ATR: '#8C97A6',
  ADX: '#B3894F',
  BB_U: '#4d5867',
  BB_M: '#3f4a59',
  BB_L: '#4d5867',
};

const toUtc = (time: number): UTCTimestamp => time as UTCTimestamp;

function lineData(candles: Candle[], values: Series) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  candles.forEach((c, i) => {
    const v = values[i];
    if (v != null && Number.isFinite(v)) out.push({ time: toUtc(c.time), value: v });
  });
  return out;
}

function hoverValues(computed: Record<string, Series>, index: number): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, series] of Object.entries(computed)) out[key] = series[index] ?? null;
  return out;
}

export function PriceChart({
  candles,
  style,
  indicators,
  onHover,
  className,
  minHeight = 340,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, AnySeries>>(new Map());
  const candlesRef = useRef<Candle[]>(candles);
  const computedRef = useRef<Record<string, Series>>({});
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  candlesRef.current = candles;

  const [hover, setHover] = useState<HoverState | null>(null);

  const computed = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const map: Record<string, Series> = {};
    if (indicators.includes('EMA_9')) map.EMA_9 = ema(closes, 9);
    if (indicators.includes('EMA_20')) map.EMA_20 = ema(closes, 20);
    if (indicators.includes('EMA_50')) map.EMA_50 = ema(closes, 50);
    if (indicators.includes('EMA_200')) map.EMA_200 = ema(closes, 200);
    if (indicators.includes('SMA_20')) map.SMA_20 = sma(closes, 20);
    if (indicators.includes('SMA_50')) map.SMA_50 = sma(closes, 50);
    if (indicators.includes('BOLLINGER')) {
      const bb = bollinger(closes, 20, 2);
      map.BB_U = bb.upper;
      map.BB_M = bb.middle;
      map.BB_L = bb.lower;
    }
    if (indicators.includes('VWAP')) map.VWAP = vwap(candles);
    if (indicators.includes('RSI')) map.RSI = rsi(closes, 14);
    if (indicators.includes('MACD')) {
      const m = macd(closes, 12, 26, 9);
      map.MACD = m.macd;
      map.MACD_SIGNAL = m.signal;
      map.MACD_HIST = m.histogram;
    }
    if (indicators.includes('ATR')) map.ATR = atr(candles, 14);
    if (indicators.includes('ADX')) map.ADX = adx(candles, 14);
    return map;
  }, [candles, indicators]);
  computedRef.current = computed;

  // Create the chart instance once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = createChart(container, {
      autoSize: true,
      height: Math.max(minHeight, 340),
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontSize: 11,
        fontFamily: "'Inter Variable', Inter, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a4453', labelBackgroundColor: '#252C36' },
        horzLine: { color: '#3a4453', labelBackgroundColor: '#252C36' },
      },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 7,
      },
      localization: { locale: 'en-IN' },
    });
    chartRef.current = chart;

    const handleMove = (param: {
      time?: unknown;
      point?: { x: number; y: number } | null;
    }) => {
      if (param.time == null || param.point == null) {
        setHover(null);
        onHoverRef.current?.(null);
        return;
      }
      const time = param.time as number;
      const index = candlesRef.current.findIndex((c) => c.time === time);
      if (index < 0) {
        setHover(null);
        onHoverRef.current?.(null);
        return;
      }
      const state: HoverState = {
        index,
        candle: candlesRef.current[index],
        values: hoverValues(computedRef.current, index),
      };
      setHover(state);
      onHoverRef.current?.(state);
    };
    chart.subscribeCrosshairMove(handleMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
    };
  }, [minHeight]);

  // Rebuild series whenever data, style or indicators change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const map = seriesRef.current;

    map.forEach((series) => {
      try {
        chart.removeSeries(series);
      } catch {
        /* series already detached */
      }
    });
    map.clear();

    if (candles.length === 0) return;

    const paneIndex = { volume: 0, rsi: 0, macd: 0, adx: 0 };
    let nextPane = 1;
    if (indicators.includes('VOLUME')) paneIndex.volume = nextPane++;
    if (indicators.includes('RSI')) paneIndex.rsi = nextPane++;
    if (indicators.includes('MACD')) paneIndex.macd = nextPane++;
    if (indicators.includes('ADX')) paneIndex.adx = nextPane++;

    // Price series
    if (style === 'CANDLES') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: COLORS.up,
        downColor: COLORS.down,
        borderUpColor: COLORS.up,
        borderDownColor: COLORS.down,
        wickUpColor: COLORS.up,
        wickDownColor: COLORS.down,
        priceLineColor: COLORS.gold,
      });
      series.setData(
        candles.map((c) => ({
          time: toUtc(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
      map.set('main', series);
    } else if (style === 'BARS') {
      const series = chart.addSeries(BarSeries, {
        upColor: COLORS.up,
        downColor: COLORS.down,
        thinBars: true,
        priceLineColor: COLORS.gold,
      });
      series.setData(
        candles.map((c) => ({
          time: toUtc(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );
      map.set('main', series);
    } else if (style === 'AREA') {
      const series = chart.addSeries(AreaSeries, {
        lineColor: COLORS.gold,
        topColor: 'rgba(198,161,91,0.22)',
        bottomColor: 'rgba(198,161,91,0.02)',
        lineWidth: 2,
        priceLineColor: COLORS.gold,
      });
      series.setData(candles.map((c) => ({ time: toUtc(c.time), value: c.close })));
      map.set('main', series);
    } else {
      const series = chart.addSeries(LineSeries, {
        color: COLORS.gold,
        lineWidth: 2,
        priceLineColor: COLORS.gold,
      });
      series.setData(candles.map((c) => ({ time: toUtc(c.time), value: c.close })));
      map.set('main', series);
    }

    const addLine = (key: string, data: Series, color: string, lineWidth: 1 | 2 = 1, dashed = false) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
      });
      series.setData(lineData(candles, data));
      map.set(key, series);
    };

    (['EMA_9', 'EMA_20', 'EMA_50', 'EMA_200', 'SMA_20', 'SMA_50'] as IndicatorKey[]).forEach((key) => {
      if (indicators.includes(key) && computed[key]) addLine(key, computed[key], MA_COLORS[key]);
    });
    if (indicators.includes('VWAP') && computed.VWAP) addLine('VWAP', computed.VWAP, MA_COLORS.VWAP, 2);
    if (indicators.includes('BOLLINGER')) {
      if (computed.BB_U) addLine('BB_U', computed.BB_U, MA_COLORS.BB_U, 1, true);
      if (computed.BB_M) addLine('BB_M', computed.BB_M, MA_COLORS.BB_M, 1);
      if (computed.BB_L) addLine('BB_L', computed.BB_L, MA_COLORS.BB_L, 1, true);
    }
    if (indicators.includes('ATR') && computed.ATR) addLine('ATR', computed.ATR, MA_COLORS.ATR, 1);

    if (indicators.includes('VOLUME')) {
      const series = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          lastValueVisible: false,
          priceLineVisible: false,
        },
        paneIndex.volume,
      );
      series.setData(
        candles.map((c) => ({
          time: toUtc(c.time),
          value: c.volume,
          color: c.close >= c.open ? 'rgba(36,180,126,0.45)' : 'rgba(224,82,82,0.45)',
        })),
      );
      map.set('VOLUME', series);
    }

    if (indicators.includes('RSI') && computed.RSI) {
      const series = chart.addSeries(
        LineSeries,
        { color: COLORS.goldLight, lineWidth: 1, priceLineVisible: false, lastValueVisible: true },
        paneIndex.rsi,
      );
      series.setData(lineData(candles, computed.RSI));
      series.createPriceLine({
        color: '#3a4453',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        price: 70,
        title: '70',
      });
      series.createPriceLine({
        color: '#3a4453',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        price: 30,
        title: '30',
      });
      map.set('RSI', series);
    }

    if (indicators.includes('MACD')) {
      const hist = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false, priceScaleId: '' },
        paneIndex.macd,
      );
      hist.setData(
        candles.map((c, i) => {
          const v = computed.MACD_HIST?.[i] ?? 0;
          return {
            time: toUtc(c.time),
            value: v,
            color: v >= 0 ? 'rgba(36,180,126,0.6)' : 'rgba(224,82,82,0.6)',
          };
        }),
      );
      map.set('MACD_HIST', hist);

      const macdLine = chart.addSeries(
        LineSeries,
        { color: COLORS.info, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: '' },
        paneIndex.macd,
      );
      macdLine.setData(lineData(candles, computed.MACD ?? []));
      map.set('MACD', macdLine);

      const signal = chart.addSeries(
        LineSeries,
        { color: COLORS.gold, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceScaleId: '' },
        paneIndex.macd,
      );
      signal.setData(lineData(candles, computed.MACD_SIGNAL ?? []));
      map.set('MACD_SIGNAL', signal);
    }

    if (indicators.includes('ADX') && computed.ADX) {
      const series = chart.addSeries(
        LineSeries,
        { color: '#B3894F', lineWidth: 1, priceLineVisible: false, lastValueVisible: true },
        paneIndex.adx,
      );
      series.setData(lineData(candles, computed.ADX));
      series.createPriceLine({
        color: '#3a4453',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        price: 25,
        title: '25',
      });
      map.set('ADX', series);
    }

    chart.panes().forEach((pane, i) => {
      if (i === 0) return;
      pane.setHeight(i === 1 && indicators.includes('VOLUME') ? 64 : 84);
    });

    chart.timeScale().fitContent();
  }, [candles, style, indicators, computed]);

  const legendIndex = hover?.index ?? candles.length - 1;
  const legendCandle = hover?.candle ?? candles[candles.length - 1];
  const legendValues = hoverValues(computed, legendIndex);

  if (candles.length === 0) {
    return (
      <div
        className={cn(
          'flex min-h-[300px] flex-col items-center justify-center rounded-[5px] border border-dashed border-line bg-card text-center',
          className,
        )}
      >
        <p className="text-sm font-medium text-fg">No candle data available</p>
        <p className="mt-1 max-w-sm px-4 text-[12px] text-mut">
          Historical series for this instrument and timeframe are unavailable. The chart populates once labelled
          data is loaded.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('relative w-full', className)} style={{ minHeight }}>
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-0.5 rounded-[4px] border border-line bg-[#0e1218]/90 px-2 py-1.5 text-[10.5px] backdrop-blur">
        <span className="font-semibold uppercase tracking-[0.07em] text-gold-2">OHLC</span>
        <span className="num text-mut">O {formatNumber(legendCandle.open)}</span>
        <span className="num text-mut">H {formatNumber(legendCandle.high)}</span>
        <span className="num text-mut">L {formatNumber(legendCandle.low)}</span>
        <span className={cn('num font-medium', legendCandle.close >= legendCandle.open ? 'text-pos' : 'text-neg')}>
          C {formatNumber(legendCandle.close)}
        </span>
        <span className="num text-mut">V {formatNumber(legendCandle.volume, 0)}</span>
        {Object.entries(legendValues)
          .filter(([key, v]) => v != null && !key.startsWith('MACD'))
          .slice(0, 8)
          .map(([key, v]) => (
            <span key={key} className="num" style={{ color: MA_COLORS[key] ?? COLORS.text }}>
              {key.replace('_', ' ')} {v == null ? '—' : formatNumber(v)}
            </span>
          ))}
      </div>
      <div ref={containerRef} className="h-full w-full" role="img" aria-label="Interactive price chart" />
    </div>
  );
}
