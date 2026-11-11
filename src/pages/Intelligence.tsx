import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, XCircle, Newspaper, Landmark, Wallet, CalendarClock } from 'lucide-react';
import {
  Badge,
  Card,
  DataBadge,
  EmptyState,
  ErrorState,
  PageHeader,
  ScoreRing,
  Select,
  Skeleton,
  StatTile,
} from '@/components/ui';
import { BarList } from '@/components/charts/BarList';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatNumber, formatTimestamp } from '@/lib/format';
import type { MarketRegime, NewsCategory, TrendDirection } from '@/models';

const REGIME_OPTIONS = [
  { value: 'BULLISH', label: 'Bullish' },
  { value: 'BEARISH', label: 'Bearish' },
  { value: 'SIDEWAYS', label: 'Sideways' },
  { value: 'HIGH_VOLATILITY', label: 'High volatility' },
  { value: 'LOW_VOLATILITY', label: 'Low volatility' },
] as const;

const REGIME_TONE: Record<MarketRegime, 'positive' | 'negative' | 'neutral' | 'warning' | 'info'> = {
  BULLISH: 'positive',
  BEARISH: 'negative',
  SIDEWAYS: 'neutral',
  HIGH_VOLATILITY: 'warning',
  LOW_VOLATILITY: 'info',
};

const TECH_INSTRUMENTS = [
  { value: 'idx-nifty50', label: 'NIFTY 50' },
  { value: 'eq-reliance', label: 'RELIANCE' },
  { value: 'eq-hdfcbank', label: 'HDFCBANK' },
  { value: 'intl-nvda', label: 'NVDA' },
  { value: 'cd-usdinr', label: 'USDINR FUT' },
];

const NEWS_FILTERS: { value: 'ALL' | NewsCategory; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'MARKET_HEADLINE', label: 'Market headlines' },
  { value: 'ECONOMIC_EVENT', label: 'Economic events' },
  { value: 'EARNINGS', label: 'Earnings' },
  { value: 'CENTRAL_BANK', label: 'Central bank' },
  { value: 'POLICY', label: 'Policy' },
];

const NEWS_ICON: Record<NewsCategory, typeof Newspaper> = {
  MARKET_HEADLINE: Newspaper,
  ECONOMIC_EVENT: CalendarClock,
  EARNINGS: Wallet,
  CENTRAL_BANK: Landmark,
  POLICY: AlertCircle,
};

function TrendBadge({ value }: { value: TrendDirection }) {
  const tone = value === 'UP' ? 'positive' : value === 'DOWN' ? 'negative' : 'neutral';
  return <Badge tone={tone}>{value === 'UP' ? 'Uptrend' : value === 'DOWN' ? 'Downtrend' : 'Sideways'}</Badge>;
}

function Section({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
        <p className="text-[11px] text-mut">{hint}</p>
      </div>
      {children}
    </section>
  );
}

export default function Intelligence() {
  const regime = useAsync(() => api.research.getRegime(), []);
  const [instrumentId, setInstrumentId] = useState('idx-nifty50');
  const tech = useAsync(() => api.research.getTechnicalIntel(instrumentId), [instrumentId]);
  const [newsFilter, setNewsFilter] = useState<'ALL' | NewsCategory>('ALL');
  const news = useAsync(() => api.research.getNews(14), []);
  const events = useAsync(() => api.market.getEconomicEvents(), []);
  const opps = useAsync(() => api.market.getRecentOpportunities(5), []);
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const explanation = useAsync(
    () => api.research.getAiExplanation(selectedOpp ?? opps.data?.[0]?.id ?? ''),
    [selectedOpp, opps.data],
    { enabled: Boolean(selectedOpp ?? opps.data?.[0]?.id) },
  );

  const filteredNews = (news.data ?? []).filter((n) => newsFilter === 'ALL' || n.category === newsFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Research"
        title="QUANTORA AI Intelligence"
        description="Regime detection, multi-timeframe technical intelligence, news intelligence and transparent setup explanations. All assessments are generated demonstration output."
        meta={<Badge tone="gold" dot>Model output — demo</Badge>}
      />

      <Section id="regime" title="A. Market regime detection" hint="Updated continuously from the demo regime model">
        <Card>
          {regime.loading ? (
            <div className="space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
          ) : regime.error ? (
            <ErrorState message={regime.error} onRetry={regime.reload} />
          ) : regime.data ? (
            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <div className="panel-subtle flex flex-col items-center justify-center gap-2 p-4 text-center">
                <span className="section-title">Primary regime</span>
                <Badge tone={REGIME_TONE[regime.data.primary]} className="px-3 py-1 text-[12px]">
                  {REGIME_OPTIONS.find((r) => r.value === regime.data!.primary)?.label}
                </Badge>
                <div className="mt-2 w-full">
                  <div className="mb-1 flex justify-between text-[10.5px] text-mut">
                    <span>Confidence</span>
                    <span className="num text-fg">{regime.data.confidence}/100</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a2029]">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${regime.data.confidence}%` }} />
                  </div>
                </div>
                <div className="mt-2 grid w-full grid-cols-2 gap-2 text-left">
                  <div>
                    <p className="section-title">Volatility</p>
                    <p className="num text-[13px] text-fg">{regime.data.volatilityState}</p>
                  </div>
                  <div>
                    <p className="section-title">Breadth</p>
                    <p className="num text-[13px] text-fg">{regime.data.breadth}%</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-mut">{regime.data.explanation}</p>
                <div className="flex flex-wrap gap-1.5">
                  {REGIME_OPTIONS.map((r) => (
                    <Badge key={r.value} tone={r.value === regime.data!.primary ? REGIME_TONE[r.value] : 'muted'}>
                      {r.label}
                    </Badge>
                  ))}
                </div>
                <DataBadge freshness="DEMO" source={regime.data.source} updatedAt={regime.data.updatedAt} />
              </div>
            </div>
          ) : null}
        </Card>
      </Section>

      <Section id="technical" title="B. Technical intelligence" hint="Multi-timeframe alignment, indicators and levels">
        <Card
          actions={
            <Select
              label="Instrument"
              hideLabel
              value={instrumentId}
              options={TECH_INSTRUMENTS}
              onChange={setInstrumentId}
            />
          }
        >
          {tech.loading ? (
            <div className="space-y-3"><Skeleton className="h-5 w-40" /><SkeletonTableLike /></div>
          ) : tech.error ? (
            <ErrorState message={tech.error} onRetry={tech.reload} />
          ) : tech.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <StatTile label="RSI (14)" value={formatNumber(tech.data.rsi, 1)} sub="Momentum oscillator" />
                <StatTile label="ATR (14)" value={formatNumber(tech.data.atr, 3)} sub="Average true range" />
                <StatTile label="ADX (14)" value={formatNumber(tech.data.adx, 1)} sub="Trend strength" />
                <StatTile
                  label="Volume confirmation"
                  value={tech.data.volumeConfirmation === 'CONFIRMED' ? 'Confirmed' : tech.data.volumeConfirmation === 'NEUTRAL' ? 'Neutral' : 'Divergent'}
                  sub="Relative participation"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="section-title mb-2">Multi-timeframe trend alignment</p>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-line text-[10px] uppercase tracking-[0.07em] text-mut">
                        <th className="py-1.5">Timeframe</th>
                        <th className="py-1.5">State</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12.5px]">
                      {(['15m', '1h', '1D'] as const).map((tf) => (
                        <tr key={tf} className="border-b border-line-soft last:border-0">
                          <td className="py-2 text-mut">{tf}</td>
                          <td className="py-2"><TrendBadge value={tech.data!.multiTimeframeTrend[tf]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2">
                    <Badge tone={tech.data.multiTimeframeTrend.alignment === 'ALIGNED' ? 'positive' : tech.data.multiTimeframeTrend.alignment === 'MIXED' ? 'warning' : 'negative'}>
                      {tech.data.multiTimeframeTrend.alignment}
                    </Badge>
                  </div>
                </div>

                <div>
                  <p className="section-title mb-2">Indicator summary</p>
                  <ul className="space-y-1.5">
                    {tech.data.indicatorSummary.map((i) => (
                      <li key={i.name} className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-1.5 last:border-0">
                        <span className="text-[12.5px] text-fg">{i.name}</span>
                        <span className="num text-[12.5px] text-gold-2">{i.value == null ? '—' : formatNumber(i.value, 2)}</span>
                        <span className="hidden max-w-[45%] truncate text-right text-[11px] text-mut sm:block">{i.reading}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="section-title mb-2">Support levels</p>
                  <BarList
                    items={tech.data.support.map((s) => ({
                      key: s.label,
                      label: `${s.label} · ${formatNumber(s.price)}`,
                      value: s.strength,
                      tone: 'positive',
                      sub: `Strength ${s.strength}`,
                    }))}
                    valueFormatter={(v) => `${v.toFixed(0)}`}
                  />
                </div>
                <div>
                  <p className="section-title mb-2">Resistance levels</p>
                  <BarList
                    items={tech.data.resistance.map((r) => ({
                      key: r.label,
                      label: `${r.label} · ${formatNumber(r.price)}`,
                      value: r.strength,
                      tone: 'negative',
                      sub: `Strength ${r.strength}`,
                    }))}
                    valueFormatter={(v) => `${v.toFixed(0)}`}
                  />
                </div>
              </div>
              <DataBadge freshness={tech.data.freshness} source={{ provider: 'QUANTORA Technical Engine', origin: 'SIMULATED', isDemo: true, reliability: 'PROVISIONAL' }} updatedAt={new Date().toISOString()} />
            </div>
          ) : null}
        </Card>
      </Section>

      <Section id="news" title="C. News intelligence" hint="Demonstration headlines — not a live news feed">
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Card>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {NEWS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setNewsFilter(f.value)}
                  aria-pressed={newsFilter === f.value}
                  className={cn(
                    'rounded-[4px] border px-2.5 py-1 text-[11.5px] transition-colors',
                    newsFilter === f.value ? 'border-gold/45 bg-gold/10 text-gold-2' : 'border-line text-mut hover:text-fg',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {news.loading ? (
              <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
            ) : news.error ? (
              <ErrorState message={news.error} onRetry={news.reload} />
            ) : filteredNews.length === 0 ? (
              <EmptyState title="No headlines in this category" description="Select a different category to widen the feed." />
            ) : (
              <ul className="space-y-2.5">
                {filteredNews.map((n) => {
                  const Icon = NEWS_ICON[n.category];
                  return (
                    <li key={n.id} className="panel-subtle p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon size={13} className="text-gold" aria-hidden />
                        <Badge tone="muted">{n.category.replace('_', ' ')}</Badge>
                        <Badge tone={n.sentiment === 'POSITIVE' ? 'positive' : n.sentiment === 'NEGATIVE' ? 'negative' : 'neutral'}>
                          {n.sentiment} {n.sentimentScore.toFixed(2)}
                        </Badge>
                        <span className="ml-auto text-[10.5px] text-mut">{formatTimestamp(n.publishedAt)}</span>
                      </div>
                      <p className="mt-1.5 text-[13px] font-medium leading-snug text-fg">{n.headline}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-mut">{n.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10.5px] text-mut-2">Source: {n.source}</span>
                        {n.instruments.map((id) => (
                          <Badge key={id} tone="muted">{id.replace(/^(eq|intl|idx|cd|oth|fx)-/, '').toUpperCase()}</Badge>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Upcoming economic events" subtitle="Calendar entries are demonstration data">
            {events.loading ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : events.error ? (
              <ErrorState message={events.error} onRetry={events.reload} />
            ) : (
              <ul className="space-y-2.5">
                {(events.data ?? []).map((e) => (
                  <li key={e.id} className="border-b border-line-soft pb-2.5 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12.5px] font-medium leading-snug text-fg">{e.title}</p>
                      <Badge tone={e.impact === 'HIGH' ? 'negative' : e.impact === 'MEDIUM' ? 'warning' : 'muted'}>{e.impact}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-mut">
                      {e.country} · {formatDateTime(e.scheduledAt)}
                    </p>
                    <p className="text-[11px] text-mut-2">Forecast {e.forecast ?? '—'} · Previous {e.previous ?? '—'}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      <Section id="explanation" title="D. AI explanation" hint="Why a setup qualifies or fails">
        <Card
          actions={
            <Select
              label="Opportunity"
              hideLabel
              value={selectedOpp ?? opps.data?.[0]?.id ?? ''}
              options={(opps.data ?? []).map((o) => ({ value: o.id, label: `${o.symbol} · ${o.strategyName}` }))}
              onChange={setSelectedOpp}
              disabled={!opps.data?.length}
            />
          }
        >
          {explanation.loading ? (
            <div className="space-y-3"><Skeleton className="h-6 w-64" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>
          ) : explanation.error ? (
            <ErrorState message={explanation.error} onRetry={explanation.reload} />
          ) : explanation.data ? (
            <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
              <div className="space-y-3">
                <ScoreRing score={explanation.data.quality.score} />
                <Badge tone={explanation.data.qualifies ? 'positive' : 'negative'}>
                  {explanation.data.qualifies ? 'Qualifies' : 'Fails threshold'}
                </Badge>
              </div>
              <div className="space-y-3">
                <p className="text-[13.5px] font-medium text-fg">{explanation.data.headline}</p>
                <BarList
                  items={explanation.data.quality.components.map((c) => ({
                    key: c.label,
                    label: c.label,
                    value: c.value,
                    tone: c.value >= 60 ? 'positive' : c.value >= 40 ? 'gold' : 'negative',
                    sub: `Weight ${(c.weight * 100).toFixed(0)}%`,
                  }))}
                  valueFormatter={(v) => `${v}`}
                />
                <ul className="space-y-1.5">
                  {explanation.data.reasons.map((r) => (
                    <li key={r.label} className="flex items-start gap-2 text-[12.5px]">
                      {r.passed ? (
                        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-pos" aria-hidden />
                      ) : (
                        <XCircle size={14} className="mt-0.5 shrink-0 text-neg" aria-hidden />
                      )}
                      <span className="text-fg">{r.label}</span>
                      <span className="ml-auto hidden max-w-[55%] text-right text-[11.5px] text-mut sm:block">{r.detail}</span>
                    </li>
                  ))}
                </ul>
                {explanation.data.failedConditions.length > 0 && (
                  <div className="rounded-[4px] border border-neg/40 bg-neg/10 p-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-neg">Failed conditions</p>
                    <ul className="mt-1 list-inside list-disc text-[12px] text-mut">
                      {explanation.data.failedConditions.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  </div>
                )}
                <p className="rounded-[4px] border border-line bg-panel p-2.5 text-[11.5px] leading-relaxed text-mut">
                  {explanation.data.quality.disclaimer}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState title="No opportunity selected" description="Recent qualifying setups will appear here." />
          )}
        </Card>
      </Section>

      <Section id="recent" title="Recent opportunities" hint="Feeds section D">
        <Card>
          {opps.loading ? (
            <SkeletonTableLike />
          ) : opps.error ? (
            <ErrorState message={opps.error} onRetry={opps.reload} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(opps.data ?? []).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedOpp(o.id)}
                  className={cn(
                    'panel-subtle flex flex-col items-start gap-1 p-3 text-left transition-colors hover:border-gold/40',
                    (selectedOpp ?? opps.data?.[0]?.id) === o.id && 'border-gold/50',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-fg">{o.symbol}</span>
                    <Badge tone={o.direction === 'BUY' ? 'positive' : o.direction === 'SELL' ? 'negative' : 'neutral'}>{o.direction}</Badge>
                  </span>
                  <span className="text-[11.5px] text-mut">{o.strategyName}</span>
                  <span className="num text-[11px] text-mut">Score {o.strategyScore} · {o.timeframe}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <p className="text-[11px] text-mut-2">
        Generated {formatDate(new Date().toISOString())} · Demonstration research output. Not investment advice.
      </p>
    </div>
  );
}

function SkeletonTableLike() {
  return (
    <div className="space-y-2" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
