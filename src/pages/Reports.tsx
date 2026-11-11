import { useMemo, useState } from 'react';
import { Download, FileJson, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataBadge,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  ScoreRing,
  Select,
  Skeleton,
} from '@/components/ui';
import { BarList } from '@/components/charts/BarList';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber, formatTimestamp, isoDate } from '@/lib/format';
import { MARKET_LABELS } from '@/data/universe';
import type { MarketCategory, Opportunity } from '@/models';

const MARKET_OPTIONS = [
  { value: 'ALL', label: 'All markets' },
  ...(Object.keys(MARKET_LABELS) as MarketCategory[]).map((k) => ({ value: k, label: MARKET_LABELS[k] })),
];

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function OpportunityCard({
  opportunity,
  onExplain,
}: {
  opportunity: Opportunity;
  onExplain: (opp: Opportunity) => void;
}) {
  const o = opportunity;
  const long = o.direction === 'LONG';
  return (
    <article className="panel flex min-w-0 flex-col p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-fg">{o.symbol}</h3>
            <Badge tone={long ? 'positive' : 'negative'}>{o.direction}</Badge>
            <Badge tone={o.signal === 'BUY' ? 'positive' : o.signal === 'SELL' ? 'negative' : 'neutral'}>{o.signal}</Badge>
            <Badge tone="muted">{o.timeframe}</Badge>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-mut">{o.instrumentName}</p>
        </div>
        <div className="text-right">
          <p className="num text-[16px] font-semibold text-fg">
            {o.priceCurrency === 'INR' ? '₹' : '$'}
            {formatNumber(o.lastPrice, o.lastPrice >= 100 ? 2 : 4)}
          </p>
          <p className="text-[10.5px] text-mut">{o.market.replace(/_/g, ' ').toLowerCase()}</p>
        </div>
      </header>

      <div className="my-3 border-t border-line-soft" />

      <div className="mb-3">
        <p className="section-title mb-1">Strategy</p>
        <p className="text-[13px] text-fg">{o.strategyName}</p>
        <div className="mt-1.5">
          <DataBadge freshness="DEMO" source={o.source} updatedAt={o.observedAt} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
        <div className="panel-subtle p-2">
          <p className="section-title">Entry zone</p>
          <p className="num text-fg">{formatNumber(o.entryZone.low)} – {formatNumber(o.entryZone.high)}</p>
        </div>
        <div className="panel-subtle p-2">
          <p className="section-title">Stop-loss</p>
          <p className="num text-neg">{formatNumber(o.stopLoss)}</p>
        </div>
        <div className="panel-subtle p-2">
          <p className="section-title">Target 1</p>
          <p className="num text-pos">{formatNumber(o.targets[0])}</p>
        </div>
        <div className="panel-subtle p-2">
          <p className="section-title">Target 2</p>
          <p className="num text-pos">{formatNumber(o.targets[1])}</p>
        </div>
        <div className="panel-subtle p-2">
          <p className="section-title">Planned R:R</p>
          <p className="num text-gold-2">1 : {o.plannedRiskReward.toFixed(2)}</p>
        </div>
        <div className="panel-subtle p-2">
          <p className="section-title">Liquidity / spread</p>
          <p className="num text-fg">{o.liquidity} · {o.spreadBps} bps</p>
        </div>
      </div>

      <div className="mb-3">
        <p className="section-title mb-1">Entry trigger</p>
        <p className="text-[12.5px] leading-relaxed text-mut">{o.entryTrigger}</p>
      </div>

      <div className="mb-3">
        <p className="section-title mb-1">Technical explanation</p>
        <p className="text-[12.5px] leading-relaxed text-mut">{o.technicalExplanation}</p>
      </div>

      <div className="mb-3">
        <p className="section-title mb-1">Upcoming events</p>
        <div className="flex flex-wrap gap-1.5">
          {o.upcomingEvents.length === 0 ? (
            <span className="text-[11.5px] text-mut-2">None scheduled</span>
          ) : (
            o.upcomingEvents.map((e) => <Badge key={e} tone="warning">{e}</Badge>)
          )}
        </div>
      </div>

      <div className="mb-3">
        <p className="section-title mb-1">Risk factors</p>
        <ul className="list-inside list-disc space-y-1 text-[12px] text-mut">
          {o.riskFactors.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      <div className="mt-auto border-t border-line-soft pt-3">
        <div className="flex flex-wrap items-center gap-4">
          <ScoreRing score={o.quality.score} size={64} />
          <div className="min-w-0 flex-1">
            <BarList
              items={o.quality.components.map((c) => ({
                key: c.label,
                label: c.label,
                value: c.value,
                tone: c.value >= 60 ? 'positive' : c.value >= 40 ? 'gold' : 'negative',
              }))}
              valueFormatter={(v) => `${v}`}
            />
          </div>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-mut-2">{o.quality.disclaimer}</p>
        <Button className="mt-3" size="sm" variant="secondary" icon={<Sparkles size={13} />} onClick={() => onExplain(o)}>
          Full AI explanation
        </Button>
      </div>
    </article>
  );
}

export default function Reports() {
  const [date, setDate] = useState(isoDate());
  const [market, setMarket] = useState<MarketCategory | 'ALL'>('ALL');
  const report = useAsync(() => api.research.getReport(date, market), [date, market]);
  const history = useAsync(() => api.research.getReportHistory(), []);
  const [explainOpp, setExplainOpp] = useState<Opportunity | null>(null);
  const explanation = useAsync(
    () => api.research.getAiExplanation(explainOpp?.id ?? ''),
    [explainOpp],
    { enabled: Boolean(explainOpp) },
  );

  const reportData = report.data;
  const fileName = `quantora-report-${date}.json`;

  const exportJson = () => {
    if (!reportData) return;
    download(fileName, JSON.stringify(reportData, null, 2), 'application/json');
  };

  const exportCsv = () => {
    if (!reportData) return;
    const header = ['symbol', 'market', 'strategy', 'direction', 'signal', 'timeframe', 'lastPrice', 'entryLow', 'entryHigh', 'stopLoss', 'target1', 'target2', 'plannedRR', 'liquidity', 'spreadBps', 'score'];
    const rows = reportData.opportunities.map((o) =>
      [o.symbol, o.market, o.strategyName, o.direction, o.signal, o.timeframe, o.lastPrice, o.entryZone.low, o.entryZone.high, o.stopLoss, o.targets[0], o.targets[1], o.plannedRiskReward, o.liquidity, o.spreadBps, o.quality.score]
        .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)))
        .join(','),
    );
    download(`quantora-report-${date}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv');
  };

  const filteredHistory = useMemo(
    () => (history.data ?? []).filter((h) => market === 'ALL' || h.market === market || h.market === 'ALL'),
    [history.data, market],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Research"
        title="Opportunity Reports"
        description="Daily quantitative research reports. Only setups that clear the confluence threshold are published — everything else is explicitly marked as no qualified setup."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Report date"
              type="date"
              value={date}
              max={isoDate()}
              onChange={(e) => setDate(e.target.value || isoDate())}
            />
            <Select label="Market" value={market} options={MARKET_OPTIONS} onChange={(v) => setMarket(v as MarketCategory | 'ALL')} />
            <Button variant="secondary" size="md" icon={<FileJson size={14} />} onClick={exportJson} disabled={!reportData}>
              JSON
            </Button>
            <Button variant="secondary" size="md" icon={<Download size={14} />} onClick={exportCsv} disabled={!reportData}>
              CSV
            </Button>
          </div>
        }
        meta={<Badge tone="gold" dot>Demonstration reports</Badge>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {report.loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-96 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : report.error ? (
            <Card><ErrorState message={report.error} onRetry={report.reload} /></Card>
          ) : !reportData ? (
            <Card><EmptyState title="No report available" description="Select a different date or market." /></Card>
          ) : reportData.noQualifiedSetups ? (
            <Card>
              <div className="rounded-[5px] border border-dashed border-gold/50 bg-gold/[0.05] px-5 py-8 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-2">No qualified setups</p>
                <h2 className="mt-2 text-lg font-semibold text-fg">No setups cleared the threshold on {reportData.date}</h2>
                <p className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed text-mut">{reportData.regimeSummary}</p>
                <ul className="mx-auto mt-4 max-w-lg space-y-1.5 text-left text-[12.5px] text-mut">
                  {reportData.notes.map((n) => <li key={n} className="border-b border-line-soft pb-1.5 last:border-0">{n}</li>)}
                </ul>
                <div className="mt-4 flex justify-center">
                  <Badge tone="neutral">Report {reportData.date} · 0 opportunities</Badge>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] text-fg">{reportData.title} · {formatDateOnly(reportData.generatedAt)}</p>
                  <p className="text-[12px] text-mut">{reportData.regimeSummary}</p>
                </div>
                <Badge tone="positive">{reportData.opportunities.length} qualified</Badge>
              </div>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {reportData.opportunities.map((o) => (
                  <OpportunityCard key={o.id} opportunity={o} onExplain={setExplainOpp} />
                ))}
              </div>
              <Card title="Report notes">
                <ul className="list-inside list-disc space-y-1 text-[12.5px] text-mut">
                  {reportData.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
                <div className="mt-3">
                  <DataBadge freshness="DEMO" source={reportData.source} updatedAt={reportData.generatedAt} />
                </div>
              </Card>
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card title="Report history" subtitle="Select a row to load that report">
            {history.loading ? (
              <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : history.error ? (
              <ErrorState message={history.error} onRetry={history.reload} />
            ) : filteredHistory.length === 0 ? (
              <EmptyState title="No history" description="No reports match this market." />
            ) : (
              <ul className="space-y-1.5">
                {filteredHistory.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDate(h.date);
                        setMarket(h.market as MarketCategory | 'ALL');
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-[4px] border px-2.5 py-2 text-left transition-colors',
                        h.date === date ? 'border-gold/45 bg-gold/10' : 'border-line hover:border-[#333c49]',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="num block text-[12.5px] text-fg">{h.date}</span>
                        <span className="block truncate text-[11px] text-mut">
                          {h.market === 'ALL' ? 'All markets' : MARKET_LABELS[h.market as MarketCategory]}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {h.noQualifiedSetups ? (
                          <Badge tone="warning">No setups</Badge>
                        ) : (
                          <span className="num text-[12px] text-gold-2">{h.opportunityCount}</span>
                        )}
                        <span className="mt-0.5 block text-[10px] text-mut-2">{formatTimestamp(h.generatedAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <Modal
        open={Boolean(explainOpp)}
        onClose={() => setExplainOpp(null)}
        title={explainOpp ? `${explainOpp.symbol} — AI explanation` : 'AI explanation'}
        description="Transparent reasoning behind the strategy-quality score"
        size="lg"
      >
        {explanation.loading ? (
          <div className="space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>
        ) : explanation.error ? (
          <ErrorState message={explanation.error} onRetry={explanation.reload} />
        ) : explanation.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <ScoreRing score={explanation.data.quality.score} />
              <Badge tone={explanation.data.qualifies ? 'positive' : 'negative'}>
                {explanation.data.qualifies ? 'Qualifies' : 'Fails threshold'}
              </Badge>
              <p className="min-w-0 flex-1 text-[13px] text-fg">{explanation.data.headline}</p>
            </div>
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
                <li key={r.label} className="text-[12.5px]">
                  <span className={r.passed ? 'text-pos' : 'text-neg'}>{r.passed ? '✓' : '✕'}</span>{' '}
                  <span className="text-fg">{r.label}</span>{' '}
                  <span className="text-mut">{r.detail}</span>
                </li>
              ))}
            </ul>
            <p className="rounded-[4px] border border-line bg-panel p-3 text-[11.5px] leading-relaxed text-mut">
              {explanation.data.quality.disclaimer}
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function formatDateOnly(iso: string): string {
  return formatDateTime(iso);
}
