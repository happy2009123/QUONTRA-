import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataBadge,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  Input,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatTile,
  Tabs,
} from '@/components/ui';
import type { Tone } from '@/components/ui';
import { INSTRUMENT_BY_ID, demoSource } from '@/data/universe';
import { formatDateTime, formatPrice } from '@/lib/format';

type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LOSS' | 'TAKE_PROFIT';
type Direction = 'BUY' | 'SELL';
type Tab = 'portfolio' | 'strategies' | 'assist';

interface PaperPortfolio {
  available_capital: number;
  used_capital: number;
  total_portfolio_value: number;
  realised_pnl: number;
  unrealised_pnl: number;
}

interface PaperPosition {
  instrument_id: string;
  quantity: number;
  avg_price: number;
  market_value: number;
  unrealised_pnl: number;
}

interface PaperOrder {
  id: string;
  instrument_id: string;
  strategy_id: string | null;
  strategy_name: string | null;
  direction: string;
  order_type: string;
  quantity: number;
  price: number;
  status: string;
  created_at: string;
}

interface StrategySummary {
  id: string;
  name: string;
  family: string;
  description: string;
  timeframe: string;
  stopLoss: { mode: string; value: number };
  targets: { target1Pct: number; target2Pct: number };
  exitMode: string;
  indicators: Array<{ id: string; label: string }>;
  entryConditions: unknown[];
  exitConditions: unknown[];
  disclaimer: string;
}

interface StrategyPerformanceRow {
  strategyId: string;
  name: string;
  family: string;
  orders: number;
  filled: number;
  trades: number;
  closed: number;
  wins: number;
  realisedPnl: number;
  winRatePct: number | null;
}

interface Envelope<T> {
  data?: T;
  error?: { message?: string };
}

interface QuoteRow {
  id: string;
  quote: { lastPrice: number };
}

interface Prefill {
  instrumentId?: string;
  direction?: Direction;
  orderType?: OrderType;
  quantity?: number;
  price?: number;
}

interface Insight {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

const ORDER_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'warning',
  FILLED: 'positive',
  CANCELLED: 'muted',
  REJECTED: 'negative',
};

const FAMILY_TONE: Record<string, Tone> = {
  TREND: 'info',
  MEAN_REVERSION: 'neutral',
  BREAKOUT: 'gold',
  MOMENTUM: 'positive',
  VOLATILITY: 'warning',
};

const INSTRUMENT_OPTIONS = [
  { value: 'eq-reliance', label: 'RELIANCE EQ' },
  { value: 'eq-tcs', label: 'TCS EQ' },
  { value: 'fx-usdinr', label: 'USD/INR' },
];

const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 'MARKET', label: 'Market' },
  { value: 'LIMIT', label: 'Limit' },
  { value: 'STOP', label: 'Stop' },
  { value: 'STOP_LOSS', label: 'Stop-loss' },
  { value: 'TAKE_PROFIT', label: 'Take-profit' },
];

const QUOTE_IDS = 'eq-reliance,eq-tcs,fx-usdinr';

const inr = (value: number) =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signedInr = (value: number) =>
  `${value >= 0 ? '+' : '−'}₹${Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function stopLossLabel(s: { stopLoss: { mode: string; value: number } }): string {
  if (s.stopLoss.mode === 'FIXED_PCT') return `${s.stopLoss.value}%`;
  if (s.stopLoss.mode === 'ATR_MULTIPLE') return `${s.stopLoss.value}× ATR`;
  return `${s.stopLoss.value}`;
}

function condLabel(c: unknown): string {
  if (c && typeof c === 'object') {
    const r = c as Record<string, unknown>;
    const left = String(r.left_expr ?? r.leftExpr ?? '?');
    const op = String(r.operator ?? '');
    const right = String(r.right_expr ?? r.rightExpr ?? '');
    return `${left} ${op} ${right}`;
  }
  return String(c);
}

/** Preferred stop distance for protection suggestions: active playbook if it uses a fixed %, else any fixed %, else 1%. */
function suggestStopPct(playbook: StrategySummary | null, strategies: StrategySummary[]): number {
  if (playbook && playbook.stopLoss.mode === 'FIXED_PCT') return playbook.stopLoss.value;
  const fixed = strategies.find((s) => s.stopLoss.mode === 'FIXED_PCT');
  return fixed ? fixed.stopLoss.value : 1;
}

export default function PaperTrading() {
  const [tab, setTab] = useState<Tab>('portfolio');

  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [perf, setPerf] = useState<StrategyPerformanceRow[]>([]);
  const [quotes, setQuotes] = useState<Record<string, number>>({});
  const [fetchedAt, setFetchedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Order ticket
  const [direction, setDirection] = useState<Direction>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [instrumentId, setInstrumentId] = useState('eq-reliance');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [playbook, setPlaybook] = useState<StrategySummary | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);

  // Orders table actions
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [modifying, setModifying] = useState<PaperOrder | null>(null);
  const [modPrice, setModPrice] = useState('');
  const [modQty, setModQty] = useState('');
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pfRes, posRes, ordRes, stRes, qRes, perfRes] = await Promise.all([
        fetch('/api/paper-portfolio'),
        fetch('/api/paper-positions'),
        fetch('/api/paper-orders'),
        fetch('/api/strategies'),
        fetch(`/api/quotes?ids=${QUOTE_IDS}`),
        fetch('/api/paper-strategy-performance'),
      ]);
      const pf = (await pfRes.json()) as Envelope<PaperPortfolio>;
      const pos = (await posRes.json()) as Envelope<PaperPosition[]>;
      const ord = (await ordRes.json()) as Envelope<PaperOrder[]>;
      if (!pfRes.ok || !posRes.ok || !ordRes.ok) {
        throw new Error(
          pf.error?.message ?? pos.error?.message ?? ord.error?.message ?? 'Failed to load paper trading data',
        );
      }
      setPortfolio(pf.data ?? null);
      setPositions(Array.isArray(pos.data) ? pos.data : []);
      setOrders(Array.isArray(ord.data) ? ord.data : []);

      // Strategies, quotes and playbook performance enrich the desk but are not required to trade.
      try {
        const st = (await stRes.json()) as Envelope<StrategySummary[]>;
        setStrategies(Array.isArray(st.data) ? st.data : []);
      } catch {
        setStrategies([]);
      }
      try {
        const pf2 = (await perfRes.json()) as Envelope<StrategyPerformanceRow[]>;
        setPerf(Array.isArray(pf2.data) ? pf2.data : []);
      } catch {
        setPerf([]);
      }
      try {
        const q = (await qRes.json()) as Envelope<QuoteRow[]>;
        const map: Record<string, number> = {};
        for (const row of Array.isArray(q.data) ? q.data : []) {
          if (row.quote && Number.isFinite(row.quote.lastPrice)) map[row.id] = row.quote.lastPrice;
        }
        setQuotes(map);
      } catch {
        setQuotes({});
      }

      setFetchedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load paper trading data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPrefill = useCallback((p: Prefill, note: string) => {
    if (p.instrumentId) setInstrumentId(p.instrumentId);
    if (p.orderType) {
      setOrderType(p.orderType);
      if (p.orderType === 'STOP_LOSS' || p.orderType === 'TAKE_PROFIT') setDirection('SELL');
      else if (p.direction) setDirection(p.direction);
    } else if (p.direction) {
      setDirection(p.direction);
    }
    if (p.quantity !== undefined) setQuantity(p.quantity);
    if (p.price !== undefined) setPrice(p.price);
    setPrefillNote(note);
    setFeedback(null);
  }, []);

  const handleTypeChange = (t: OrderType) => {
    setOrderType(t);
    if (t === 'STOP_LOSS' || t === 'TAKE_PROFIT') setDirection('SELL');
    setPrefillNote(null);
  };

  const protective = orderType === 'STOP_LOSS' || orderType === 'TAKE_PROFIT';
  const needsPrice = orderType !== 'MARKET';

  const placeOrder = async () => {
    setTicketBusy(true);
    setFeedback(null);
    if (needsPrice && !(price > 0)) {
      setFeedback({ kind: 'error', text: `A positive ${orderType === 'LIMIT' ? 'limit' : 'trigger'} price is required` });
      setTicketBusy(false);
      return;
    }
    try {
      const response = await fetch('/api/paper-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'desk@quantora.demo',
          instrumentId,
          direction,
          orderType,
          quantity: Number(quantity),
          price: needsPrice ? Number(price) : undefined,
          strategyId: playbook?.id,
        }),
      });
      const payload = (await response.json()) as Envelope<{
        status: string;
        direction: string;
        quantity: number;
        price: number;
        orderType: string;
      }>;
      if (response.ok && payload.data) {
        const order = payload.data;
        setQuantity(1);
        if (needsPrice) setPrice(0);
        setPrefillNote(null);
        const priceLabel = order.price ? ` @ ${inr(order.price)}` : '';
        const restingNote = order.status === 'PENDING' ? ` (${order.orderType} resting)` : '';
        const playbookNote = playbook ? ` · ${playbook.name}` : '';
        setFeedback({
          kind: 'success',
          text: `Order ${order.status}: ${order.direction} ${order.quantity}${priceLabel}${restingNote}${playbookNote}.`,
        });
        setTimeout(() => setFeedback(null), 6000);
        await load();
      } else {
        setFeedback({ kind: 'error', text: payload.error?.message ?? 'Failed to place order' });
      }
    } catch {
      setFeedback({ kind: 'error', text: 'Network error placing order' });
    } finally {
      setTicketBusy(false);
    }
  };

  const closePosition = async (row: PaperPosition) => {
    setClosing(row.instrument_id);
    try {
      const res = await fetch('/api/paper-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'desk@quantora.demo',
          instrumentId: row.instrument_id,
          direction: 'SELL',
          orderType: 'MARKET',
          quantity: row.quantity,
          strategyId: playbook?.id,
        }),
      });
      const payload = (await res.json()) as Envelope<unknown>;
      if (!res.ok) throw new Error(payload.error?.message ?? 'Close failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setClosing(null);
    }
  };

  const cancelOrder = async (orderId: string) => {
    setCancelling(orderId);
    try {
      const res = await fetch('/api/paper-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const payload = (await res.json()) as Envelope<unknown>;
      if (!res.ok) throw new Error(payload.error?.message ?? 'Cancel failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(null);
    }
  };

  const openModify = (row: PaperOrder) => {
    setModifying(row);
    setModPrice(String(row.price));
    setModQty(String(row.quantity));
    setModError(null);
  };

  const submitModify = async () => {
    if (!modifying) return;
    setModBusy(true);
    setModError(null);
    try {
      const res = await fetch('/api/paper-order/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: modifying.id, price: Number(modPrice), quantity: Number(modQty) }),
      });
      const payload = (await res.json()) as Envelope<unknown>;
      if (!res.ok) throw new Error(payload.error?.message ?? 'Modify failed');
      setModifying(null);
      await load();
    } catch (e) {
      setModError(e instanceof Error ? e.message : 'Modify failed');
    } finally {
      setModBusy(false);
    }
  };

  const selectPlaybook = (s: StrategySummary) => {
    setPlaybook((current) => (current?.id === s.id ? null : s));
    setPrefillNote(null);
  };

  const pendingOrders = orders.filter((o) => o.status === 'PENDING');

  const insights = useMemo<Insight[]>(() => {
    if (!portfolio) return [];
    const out: Insight[] = [];
    const protectedInstruments = new Set(
      orders
        .filter(
          (o) =>
            o.status === 'PENDING' &&
            o.direction === 'SELL' &&
            (o.order_type === 'STOP_LOSS' || o.order_type === 'TAKE_PROFIT' || o.order_type === 'STOP'),
        )
        .map((o) => o.instrument_id),
    );
    const stopPct = suggestStopPct(playbook, strategies);
    const equity = portfolio.total_portfolio_value > 0 ? portfolio.total_portfolio_value : 1;

    for (const p of positions) {
      const symbol = INSTRUMENT_BY_ID[p.instrument_id]?.symbol ?? p.instrument_id;
      if (!protectedInstruments.has(p.instrument_id)) {
        const trigger = Math.round(p.avg_price * (1 - stopPct / 100) * 100) / 100;
        out.push({
          id: `protect-${p.instrument_id}`,
          tone: 'warning',
          title: `No protection on ${symbol}`,
          detail: `${p.quantity} @ ${inr(p.avg_price)} is uncovered. Playbook stop ${stopLossLabel(
            playbook ?? { stopLoss: { mode: 'FIXED_PCT', value: stopPct } },
          )} suggests a trigger near ${inr(trigger)}.`,
          actionLabel: 'Set stop-loss',
          onAction: () =>
            applyPrefill(
              { instrumentId: p.instrument_id, direction: 'SELL', orderType: 'STOP_LOSS', quantity: p.quantity, price: trigger },
              `AI assist · stop-loss for ${symbol}`,
            ),
        });
      }
      const last = quotes[p.instrument_id];
      if (last && last > 0) {
        const movePct = ((last - p.avg_price) / p.avg_price) * 100;
        if (movePct <= -1.5) {
          const trailTrigger = Math.round(last * (1 - stopPct / 100) * 100) / 100;
          out.push({
            id: `drawdown-${p.instrument_id}`,
            tone: 'negative',
            title: `${symbol} down ${Math.abs(movePct).toFixed(1)}%`,
            detail: `Last ${inr(last)} vs average ${inr(p.avg_price)}. Review the thesis or trail the stop to ${inr(trailTrigger)}.`,
            actionLabel: 'Trail stop',
            onAction: () =>
              applyPrefill(
                { instrumentId: p.instrument_id, direction: 'SELL', orderType: 'STOP_LOSS', quantity: p.quantity, price: trailTrigger },
                `AI assist · trailed stop for ${symbol}`,
              ),
          });
        }
      }
      const weight = p.market_value / equity;
      if (weight > 0.4 && positions.length > 1) {
        out.push({
          id: `concentration-${p.instrument_id}`,
          tone: 'warning',
          title: `Concentration in ${symbol}`,
          detail: `${(weight * 100).toFixed(0)}% of equity sits in this position (${inr(p.market_value)} of ${inr(equity)}).`,
          actionLabel: 'Trim 1',
          onAction: () =>
            applyPrefill(
              { instrumentId: p.instrument_id, direction: 'SELL', orderType: 'MARKET', quantity: 1 },
              `AI assist · trim ${symbol}`,
            ),
        });
      }
    }

    if (positions.length === 0) {
      const last = quotes['eq-reliance'];
      if (last && last > 0) {
        const dipLimit = Math.max(1, Math.floor(last * 0.97));
        out.push({
          id: 'idle-cash',
          tone: 'info',
          title: 'Capital idle',
          detail: `All ${inr(portfolio.available_capital)} is in cash. A resting limit at ${inr(dipLimit)} (3% below the last quote) keeps entries selective.`,
          actionLabel: 'Preload dip limit',
          onAction: () =>
            applyPrefill(
              { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'LIMIT', quantity: 1, price: dipLimit },
              'AI assist · dip limit below quote',
            ),
        });
      }
    }

    if (pendingOrders.length > 0) {
      out.push({
        id: 'pending',
        tone: 'info',
        title: `${pendingOrders.length} resting order${pendingOrders.length === 1 ? '' : 's'}`,
        detail: 'Orders are waiting for their limit or trigger price. Review them before they fire.',
        actionLabel: 'View orders',
        onAction: () => setTab('portfolio'),
      });
    }

    if (portfolio.realised_pnl !== 0) {
      out.push({
        id: 'realised',
        tone: portfolio.realised_pnl >= 0 ? 'positive' : 'negative',
        title: `Realised P&L ${signedInr(portfolio.realised_pnl)}`,
        detail: 'Net result across closed trades, including brokerage on entry and exit.',
      });
    }

    if (out.length === 0) {
      out.push({
        id: 'orderly',
        tone: 'positive',
        title: 'Book looks orderly',
        detail: 'Positions are protected, no concentration flags and no resting orders awaiting review.',
      });
    }
    return out;
  }, [portfolio, positions, orders, quotes, strategies, playbook, pendingOrders, applyPrefill]);

  const positionColumns = [
    {
      key: 'instrument',
      header: 'Instrument',
      cell: (row: PaperPosition) => INSTRUMENT_BY_ID[row.instrument_id]?.symbol ?? row.instrument_id,
    },
    { key: 'qty', header: 'Qty', align: 'right' as const, cell: (row: PaperPosition) => row.quantity },
    {
      key: 'avg',
      header: 'Avg price',
      align: 'right' as const,
      cell: (row: PaperPosition) => formatPrice(row.avg_price),
    },
    {
      key: 'value',
      header: 'Market value',
      align: 'right' as const,
      cell: (row: PaperPosition) => inr(row.market_value),
    },
    {
      key: 'pnl',
      header: 'Unrealised P&L',
      align: 'right' as const,
      cell: (row: PaperPosition) => (
        <span className={row.unrealised_pnl >= 0 ? 'text-pos' : 'text-neg'}>{signedInr(row.unrealised_pnl)}</span>
      ),
    },
    {
      key: 'action',
      header: '',
      align: 'right' as const,
      cell: (row: PaperPosition) => (
        <Button
          variant="secondary"
          size="sm"
          loading={closing === row.instrument_id}
          onClick={() => void closePosition(row)}
        >
          Close
        </Button>
      ),
    },
  ];

  const orderColumns = [
    {
      key: 'time',
      header: 'Time',
      cell: (row: PaperOrder) => <span className="num text-mut">{formatDateTime(row.created_at)}</span>,
    },
    {
      key: 'instrument',
      header: 'Instrument',
      cell: (row: PaperOrder) => INSTRUMENT_BY_ID[row.instrument_id]?.symbol ?? row.instrument_id,
    },
    {
      key: 'side',
      header: 'Side',
      cell: (row: PaperOrder) => (
        <Badge tone={row.direction === 'BUY' ? 'positive' : 'negative'}>{row.direction}</Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row: PaperOrder) => <span className="text-mut">{row.order_type}</span>,
    },
    {
      key: 'playbook',
      header: 'Playbook',
      cell: (row: PaperOrder) =>
        row.strategy_name ? (
          <span className="block max-w-[150px] truncate text-mut" title={row.strategy_name}>
            {row.strategy_name}
          </span>
        ) : (
          <span className="text-mut-2">—</span>
        ),
    },
    { key: 'qty', header: 'Qty', align: 'right' as const, cell: (row: PaperOrder) => row.quantity },
    {
      key: 'price',
      header: 'Price',
      align: 'right' as const,
      cell: (row: PaperOrder) => (row.price ? formatPrice(row.price) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: PaperOrder) => <Badge tone={ORDER_STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>,
    },
    {
      key: 'action',
      header: '',
      align: 'right' as const,
      cell: (row: PaperOrder) =>
        row.status === 'PENDING' ? (
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => openModify(row)}>
              Modify
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={cancelling === row.id}
              onClick={() => void cancelOrder(row.id)}
            >
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  const perfColumns = [
    {
      key: 'playbook',
      header: 'Playbook',
      cell: (row: StrategyPerformanceRow) => (
        <div className="min-w-0">
          <span className="block truncate text-fg">{row.name}</span>
          <Badge tone={FAMILY_TONE[row.family] ?? 'neutral'}>{row.family || '—'}</Badge>
        </div>
      ),
    },
    { key: 'orders', header: 'Orders', align: 'right' as const, cell: (row: StrategyPerformanceRow) => row.orders },
    { key: 'filled', header: 'Filled', align: 'right' as const, cell: (row: StrategyPerformanceRow) => row.filled },
    { key: 'trades', header: 'Trades', align: 'right' as const, cell: (row: StrategyPerformanceRow) => row.trades },
    { key: 'closed', header: 'Closed', align: 'right' as const, cell: (row: StrategyPerformanceRow) => row.closed },
    {
      key: 'winRate',
      header: 'Win rate',
      align: 'right' as const,
      cell: (row: StrategyPerformanceRow) =>
        row.winRatePct !== null ? <span className="num">{row.winRatePct}%</span> : <span className="text-mut-2">—</span>,
    },
    {
      key: 'realised',
      header: 'Realised P&L',
      align: 'right' as const,
      cell: (row: StrategyPerformanceRow) => (
        <span className={`num ${row.realisedPnl >= 0 ? 'text-pos' : 'text-neg'}`}>{signedInr(row.realisedPnl)}</span>
      ),
    },
  ];

  const refPrice = needsPrice ? price : quotes[instrumentId] ?? 0;
  const notional = refPrice * quantity;
  const estimate = direction === 'BUY' ? notional * 1.0005 : notional * 0.9995;

  if (loading && !portfolio) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Workspace"
          title="Paper Trading"
          description="Simulated order desk with strategy playbooks and rule-based AI assist."
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-[480px] w-full" />
        </div>
        <span className="sr-only" role="status">
          Loading paper trading workspace
        </span>
      </div>
    );
  }

  if (error && !portfolio) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Workspace"
          title="Paper Trading"
          description="Simulated order desk with strategy playbooks and rule-based AI assist."
        />
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Paper Trading"
        description="Simulated order desk with strategy playbooks and rule-based AI assist. Orders execute against quoted prices in a paper account — nothing is sent to a broker."
        meta={
          <>
            <DataBadge freshness="DEMO" source={demoSource()} updatedAt={fetchedAt} />
            <span className="text-[10.5px] text-mut-2">Simulated trading only</span>
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => void load()} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {portfolio && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <StatTile label="Equity" value={inr(portfolio.total_portfolio_value)} />
              <StatTile label="Cash" value={inr(portfolio.available_capital)} />
              <StatTile label="In positions" value={inr(portfolio.used_capital)} />
              <StatTile
                label="Realised P&L"
                value={
                  <span className={portfolio.realised_pnl >= 0 ? 'text-pos' : 'text-neg'}>
                    {signedInr(portfolio.realised_pnl)}
                  </span>
                }
              />
              <StatTile
                label="Unrealised P&L"
                value={
                  <span className={portfolio.unrealised_pnl >= 0 ? 'text-pos' : 'text-neg'}>
                    {signedInr(portfolio.unrealised_pnl)}
                  </span>
                }
              />
            </div>
          )}

          <Tabs
            items={[
              { value: 'portfolio', label: 'Portfolio', badge: positions.length || undefined },
              { value: 'strategies', label: 'Strategy Playbooks', badge: strategies.length || undefined },
              { value: 'assist', label: 'AI Assist', badge: insights.length || undefined },
            ]}
            value={tab}
            onChange={setTab}
            label="Paper trading sections"
          />

          {tab === 'portfolio' && (
            <div className="space-y-4">
              <Card title="Open positions" subtitle="Marked to the latest quoted prices" dense>
                <DataTable
                  columns={positionColumns}
                  rows={positions}
                  rowKey={(row) => row.instrument_id}
                  caption="Open paper trading positions"
                  loading={loading}
                  dense
                  emptyTitle="No open positions"
                  emptyDescription="Place a paper order or apply an AI assist suggestion to open a simulated position."
                />
              </Card>
              <Card
                title="Orders"
                subtitle="Resting orders can be modified or cancelled until they trigger"
                dense
              >
                <DataTable
                  columns={orderColumns}
                  rows={orders}
                  rowKey={(row) => row.id}
                  caption="Recent paper trading orders"
                  loading={loading}
                  dense
                  emptyTitle="No orders yet"
                  emptyDescription="Orders you place appear here with fill status, modification and cancellation."
                />
              </Card>
              <Card
                title="Performance by playbook"
                subtitle="Attributed to the playbook active when each order was placed"
                dense
              >
                <DataTable
                  columns={perfColumns}
                  rows={perf}
                  rowKey={(row) => row.strategyId}
                  caption="Per-playbook paper trading performance"
                  loading={loading}
                  dense
                  emptyTitle="No playbook activity yet"
                  emptyDescription="Select a playbook in Strategy Playbooks before placing an order to track its performance here."
                />
              </Card>
            </div>
          )}

          {tab === 'strategies' && (
            <div className="space-y-3">
              <InfoHint text="Playbooks are seeded strategy definitions. Selecting one sets the active playbook used by AI Assist and tags orders you place so their performance is attributed in the Portfolio tab. Signals and backtests are simulated and are not trade recommendations." />
              {strategies.length === 0 ? (
                <Card>
                  <EmptyState
                    title="No playbooks available"
                    description="Strategy playbooks will appear here once they are seeded into the workspace."
                  />
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {strategies.map((s) => {
                    const active = playbook?.id === s.id;
                    return (
                      <Card
                        key={s.id}
                        title={s.name}
                        subtitle={`${s.timeframe} · exit ${s.exitMode.replace(/_/g, ' ').toLowerCase()}`}
                        actions={<Badge tone={FAMILY_TONE[s.family] ?? 'neutral'}>{s.family}</Badge>}
                      >
                        <div className="space-y-3">
                          <p className="text-[12.5px] leading-relaxed text-mut">{s.description}</p>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="muted">SL {stopLossLabel(s)}</Badge>
                            <Badge tone="muted">T1 {s.targets.target1Pct}%</Badge>
                            <Badge tone="muted">T2 {s.targets.target2Pct}%</Badge>
                            {s.stopLoss.mode === 'FIXED_PCT' && s.stopLoss.value > 0 && (
                              <Badge tone="gold">
                                RR {Math.round((s.targets.target1Pct / s.stopLoss.value) * 10) / 10}:1
                              </Badge>
                            )}
                          </div>
                          {s.indicators.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {s.indicators.map((ind) => (
                                <span
                                  key={ind.id}
                                  className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-mut-2"
                                >
                                  {ind.label}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="space-y-1">
                            <span className="section-title">Entry</span>
                            <div className="flex flex-wrap gap-1.5">
                              {s.entryConditions.slice(0, 3).map((c, i) => (
                                <span
                                  key={i}
                                  className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-mut-2"
                                >
                                  {condLabel(c)}
                                </span>
                              ))}
                              {s.entryConditions.length > 3 && (
                                <span className="text-[10.5px] text-mut-2">+{s.entryConditions.length - 3} more</span>
                              )}
                            </div>
                          </div>
                          {s.exitConditions.length > 0 && (
                            <div className="space-y-1">
                              <span className="section-title">Exit</span>
                              <div className="flex flex-wrap gap-1.5">
                                {s.exitConditions.slice(0, 3).map((c, i) => (
                                  <span
                                    key={i}
                                    className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-mut-2"
                                  >
                                    {condLabel(c)}
                                  </span>
                                ))}
                                {s.exitConditions.length > 3 && (
                                  <span className="text-[10.5px] text-mut-2">+{s.exitConditions.length - 3} more</span>
                                )}
                              </div>
                            </div>
                          )}
                          <Button
                            variant={active ? 'primary' : 'secondary'}
                            size="sm"
                            block
                            onClick={() => selectPlaybook(s)}
                          >
                            {active ? 'Active playbook — click to clear' : 'Use in ticket'}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'assist' && (
            <Card
              title="AI Assist"
              subtitle="Rule-based analysis of your simulated book and latest quotes"
              actions={
                <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading} icon={<Sparkles className="h-3.5 w-3.5" />}>
                  Re-analyse
                </Button>
              }
            >
              <div className="space-y-3">
                <InfoHint text="Insights are generated by deterministic rules over portfolio state, resting orders and playbook settings — no language model is involved, and nothing here is investment advice. Suggestions preload the order ticket; you still review and place every order." />
                {insights.map((i) => (
                  <div key={i.id} className="flex items-start gap-3 rounded-md border border-line bg-card/60 p-3">
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        i.tone === 'warning'
                          ? 'bg-warn'
                          : i.tone === 'negative'
                            ? 'bg-neg'
                            : i.tone === 'positive'
                              ? 'bg-pos'
                              : i.tone === 'gold'
                                ? 'bg-gold'
                                : 'bg-info'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">{i.title}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-mut">{i.detail}</p>
                    </div>
                    {i.actionLabel && i.onAction && (
                      <Button variant="secondary" size="sm" onClick={i.onAction} className="shrink-0">
                        {i.actionLabel}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card title="Order Ticket" subtitle="Simulated execution — no broker connection">
          <div className="space-y-3">
            {playbook && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-gold/30 bg-gold/[0.06] px-2.5 py-1.5">
                <span className="truncate text-[11.5px] text-gold-2">Playbook: {playbook.name}</span>
                <button
                  type="button"
                  aria-label="Clear active playbook"
                  onClick={() => setPlaybook(null)}
                  className="rounded p-0.5 text-mut hover:text-fg focus-visible:outline-2 focus-visible:outline-gold/70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {prefillNote && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-info/30 bg-info/[0.07] px-2.5 py-1.5">
                <span className="truncate text-[11.5px] text-info">{prefillNote}</span>
                <button
                  type="button"
                  aria-label="Clear prefill note"
                  onClick={() => setPrefillNote(null)}
                  className="rounded p-0.5 text-mut hover:text-fg focus-visible:outline-2 focus-visible:outline-gold/70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] uppercase text-mut-2">Instrument</label>
              <Select
                value={instrumentId}
                onChange={setInstrumentId}
                label="Instrument"
                options={INSTRUMENT_OPTIONS}
                size="sm"
              />
            </div>

            {protective ? (
              <p className="text-[11px] leading-relaxed text-mut-2">
                {orderType === 'STOP_LOSS'
                  ? 'Stop-loss: sells your open position when the trigger price is hit.'
                  : 'Take-profit: sells your open position when the target price is hit.'}
              </p>
            ) : (
              <div>
                <label className="mb-1 block text-[11px] uppercase text-mut-2">Direction</label>
                <SegmentedControl
                  options={[
                    { value: 'BUY', label: 'BUY' },
                    { value: 'SELL', label: 'SELL' },
                  ]}
                  value={direction}
                  onChange={setDirection}
                  label="Direction"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] uppercase text-mut-2">Order Type</label>
              <Select
                value={orderType}
                onChange={handleTypeChange}
                label="Order Type"
                options={ORDER_TYPE_OPTIONS}
                size="sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] uppercase text-mut-2">Quantity</label>
              <div className="flex gap-1.5">
                <Input
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                  type="number"
                  placeholder="Qty"
                  className="min-w-0 flex-1"
                />
                {[1, 5, 10].map((n) => (
                  <Button
                    key={n}
                    variant={quantity === n ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setQuantity(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>

            {needsPrice && (
              <div>
                <label className="mb-1 block text-[11px] uppercase text-mut-2">
                  {orderType === 'LIMIT' ? 'Limit Price' : 'Trigger Price'}
                </label>
                <Input
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value) || 0)}
                  type="number"
                  placeholder="Price"
                />
              </div>
            )}

            {refPrice > 0 && (
              <p className="text-[11.5px] text-mut">
                Est. {direction === 'BUY' ? 'cost' : 'proceeds'}{' '}
                <span className="num font-medium text-fg">{inr(estimate)}</span>{' '}
                {needsPrice ? 'at trigger/limit' : 'at last quote'} · incl. 0.05% brokerage
              </p>
            )}

            <Button block variant="primary" onClick={() => void placeOrder()} loading={ticketBusy}>
              Place Order
            </Button>

            {feedback?.kind === 'error' && <ErrorState message={feedback.text} />}
            {feedback?.kind === 'success' && (
              <p className="rounded-md border border-line bg-pos/10 px-3 py-2 text-[13px] text-pos" role="status">
                {feedback.text}
              </p>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={modifying !== null}
        onClose={() => setModifying(null)}
        title="Modify pending order"
        description={
          modifying
            ? `${modifying.direction} ${modifying.quantity} ${
                INSTRUMENT_BY_ID[modifying.instrument_id]?.symbol ?? modifying.instrument_id
              } · ${modifying.order_type}`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModifying(null)} disabled={modBusy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submitModify()} loading={modBusy}>
              Save changes
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase text-mut-2">Price</label>
            <Input value={modPrice} onChange={(e) => setModPrice(e.target.value)} type="number" placeholder="Price" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase text-mut-2">Quantity</label>
            <Input value={modQty} onChange={(e) => setModQty(e.target.value)} type="number" placeholder="Qty" />
          </div>
          {modError && <ErrorState message={modError} />}
        </div>
      </Modal>
    </div>
  );
}
