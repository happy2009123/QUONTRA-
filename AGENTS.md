# QUANTORA — frontend build guide (for contributors & agents)

Institutional quantitative research terminal. React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 + React Router v7 + lightweight-charts v5 + lucide-react.

Run checks from the project root:

```
npx tsc --noEmit -p tsconfig.json     # typecheck (must be clean)
npm run build                          # production build
npm run dev                            # dev server on :5173
```

## Hard rules

1. **No hardcoded market data in components.** Fetch through the API layer (`@/api/client`) or the mock helpers in `src/data/*`.
2. **Every price/series must show provenance.** Use `DataBadge` (freshness + source + timestamp). Demo values must be labelled `DEMO`.
3. **Every async surface needs loading, error and empty states** (`Skeleton*`, `ErrorState`, `EmptyState` from `@/components/ui`).
4. **No non-functional buttons.** Every control must do something real (filter, sort, navigate, open a modal, toggle state). Remove placeholder actions.
5. **No horizontal page overflow.** Wide tables live inside `overflow-x-auto` containers (the `DataTable` does this). On mobile, prefer stacked cards over shrunken tables.
6. **Strict TypeScript.** `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (use `import type`), no `any`, no `console.*`.
7. **Do not edit files you do not own.** Only touch your assigned page files (plus new files you create). Never edit `src/components/ui/*`, `src/components/layout/*`, `src/components/charts/*`, `src/data/*`, `src/api/*`, `src/models/*`, `src/state/*`, `src/styles/*`, `src/App.tsx`.
8. Keyboard accessible: real `<button>`/`<a>`, `aria-label` on icon-only controls, visible `:focus-visible` styles (already themed).

## Design tokens (Tailwind v4, defined in `src/styles/index.css`)

| Token | Class examples |
| --- | --- |
| `--color-ink` #080A0E | `bg-ink` (page background) |
| `--color-panel` #10141B | `bg-panel` (top bar, sidebar, inputs) |
| `--color-card` #151A22 | `bg-card` (cards) |
| `--color-line` #252C36 | `border-line`, `border-line-soft` |
| `--color-gold` #C6A15B / `--color-gold-2` #E0C48A | `text-gold`, `text-gold-2`, `bg-gold/10` |
| `--color-fg` #F3F4F6 | `text-fg` |
| `--color-mut` #929BA8 / `--color-mut-2` #6B7482 | `text-mut`, `text-mut-2` |
| `--color-pos` #24B47E / `--color-neg` #E05252 | `text-pos`, `text-neg`, `bg-pos/10` |
| `--color-warn` #E0A83B / `--color-info` #5B9DE0 | `text-warn`, `text-info` |

Utility classes defined in CSS: `panel`, `panel-subtle`, `section-title` (11px uppercase label), `num` (tabular numerals), `hairline`, `skeleton`, `live-dot`.

Never use gradients/neon. Gold is an accent, not a fill for large areas.

## UI kit — `@/components/ui` (barrel export)

```ts
import { Button, Card, Badge, DataBadge, MarketStatusPill, ConnectionStatusDot,
  Skeleton, SkeletonText, SkeletonTable, EmptyState, ErrorState,
  Select, Input, SearchInput, Tabs, SegmentedControl, Toggle, Modal,
  Tooltip, InfoHint, PageHeader, DataTable, ScoreRing, StatTile, PriceChange } from '@/components/ui';
```

- `<PageHeader eyebrow title description meta actions />` — page heading, always first element of a page.
- `<Card title subtitle actions dense flush>` — panel container.
- `<DataTable columns rows rowKey caption loading emptyTitle emptyDescription emptyAction onRowClick selectedRowKey dense initialSort />` — column: `{ key, header, cell(row,i), align, sortable, sortValue(row), width, className }`. Handles sorting, sticky header, horizontal scroll, loading skeleton and empty state.
- `<DataBadge freshness source updatedAt compact />` — `freshness` ∈ LIVE | DELAYED | HISTORICAL | STALE | MISSING | DEMO.
- `<ScoreRing score label />` — 0–100 strategy-quality ring (explicitly not a win probability).
- `<StatTile label value sub delta deltaFormat />`, `<PriceChange value change changePercent currency size />`.
- `<Button variant="primary|secondary|ghost|danger|subtle" size="sm|md|lg" loading icon block />`.
- `<Select value options onChange label size />`, `<Input label icon …/>`, `<SearchInput value onChange placeholder />`.
- `<Tabs items value onChange label />`, `<SegmentedControl options value onChange label />`, `<Toggle checked onChange label description />`, `<Modal open onClose title description footer size headerActions />`, `<Tooltip content>`, `<InfoHint text />`.
- `<Badge tone="positive|negative|neutral|gold|warning|info|muted" dot />`.

## Chart kit — `@/components/charts`

- `<PriceChart candles style indicators onHover minHeight />` — `style`: `CANDLES|LINE|AREA|BARS`; `indicators`: array of `IndicatorKey` (`EMA_9|EMA_20|EMA_50|EMA_200|SMA_20|SMA_50|BOLLINGER|VWAP|VOLUME|RSI|MACD|ATR|ADX`); export `INDICATOR_GROUPS` for building an indicator panel. Renders its own OHLC hover legend and an empty state when `candles` is `[]`.
- `<Sparkline values width height tone showArea />`
- `<OverviewChart series height />` — normalised multi-instrument comparison, clickable legend.
- `<Heatmap cells onSelect />`
- `<EquityCurve points initialCapital />` — simulated equity curve.
- `<CorrelationMatrix symbols values />`
- `<BarList items max valueFormatter onSelect />`

## Data / state

```ts
import { api } from '@/api/client';                 // QuantoraApi: market | research | strategy | risk | data | notifications
import { useAsync } from '@/state/useAsync';
import { useSettings } from '@/state/SettingsContext';
import { useNotifications } from '@/state/NotificationsContext';
import type { InstrumentQuote, Opportunity, Candle, Timeframe } from '@/models';
```

```tsx
const { data, loading, error, fetchedAt, isDemo, reload } = useAsync(
  () => api.market.getQuotes(),
  [/* deps */],
);
```

Every `api.*` call returns `ApiEnvelope<T> = { data, fetchedAt, isDemo }` after a simulated 160–420 ms delay. `useAsync` exposes `loading | error | data | reload` — map them to `SkeletonTable`/`ErrorState`/`EmptyState`/content.

Helpers worth knowing:
- `src/data/universe.ts` → `INSTRUMENTS`, `INSTRUMENT_BY_ID`, `MARKET_LABELS`, `marketStatusFor()`, `USD_INR_RESTRICTION`.
- `src/data/marketData.ts` → `buildCandles(instrumentId, timeframe, count)`, `buildQuote(instrumentId)`.
- `src/data/researchData.ts`, `src/data/strategyData.ts`, `src/data/opsData.ts` → report/news/strategy/risk/data-centre generators.
- `src/lib/format.ts` → `formatPrice`, `formatPercent`, `formatSigned`, `formatCompact`, `formatDate`, `formatDateTime`, `formatTime`, `formatTimestamp`, `isoDate`.
- `src/lib/indicators.ts` → `ema, sma, rsi, macd, bollinger, vwap, atr, adx`.
- `src/lib/cn.ts` → `cn(...)` class joiner.

## Routes

`/` Dashboard · `/scanner` Market Scanner · `/charts` Charting Terminal · `/intelligence` AI Intelligence · `/reports` Opportunity Reports · `/strategy-lab` Strategy Lab · `/backtesting` Backtesting · `/risk` Risk Center · `/data` Data Center · `/notifications` Notifications · `/settings` Settings · `*` NotFound.

Page files export **default** components from `src/pages/<Name>.tsx`.

## Layout expectations

- The shell already provides: fixed desktop sidebar (≥1024px), sticky top bar with market status/clock/notifications/profile, mobile bottom nav with a “More” sheet, `max-w-[1680px]` content column, and bottom padding for mobile.
- Desktop: dense multi-column grids (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3` etc.).
- Mobile: single column, cards stacked, filters wrap, touch targets ≥ 36px, no `overflow-x` on `<body>`.

## Copy rules

- Never imply live trading, broker connections or verified data. Use wording such as “demonstration data”, “simulated”, “reference only”.
- Always state that the strategy-quality score (0–100) is a confluence metric, **not a win probability**.
- Risk/backtest numbers are simulations; label them `Simulated`.
