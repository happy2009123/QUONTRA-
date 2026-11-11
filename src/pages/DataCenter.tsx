import { useState } from 'react';
import { RefreshCw, Settings2, Wifi } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConnectionStatusDot,
  DataBadge,
  DataTable,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { cn } from '@/lib/cn';
import { formatCompact, formatNumber, formatTimestamp } from '@/lib/format';
import type { DataIssueType } from '@/models';

const ISSUE_OPTIONS = [
  { value: 'ALL', label: 'All issue types' },
  { value: 'MISSING_CANDLES', label: 'Missing candles' },
  { value: 'DUPLICATE_RECORDS', label: 'Duplicate records' },
  { value: 'RATE_LIMIT', label: 'Rate limit' },
  { value: 'GAP_DETECTED', label: 'Gaps' },
  { value: 'SCHEMA_MISMATCH', label: 'Schema mismatch' },
];

const LEGEND = ['CONNECTED', 'DELAYED', 'STALE', 'DISCONNECTED', 'DEMO DATA'] as const;

export default function DataCenter() {
  const snapshot = useAsync(() => api.data.getSnapshot(), []);
  const [issueFilter, setIssueFilter] = useState<'ALL' | DataIssueType>('ALL');
  const [configureOpen, setConfigureOpen] = useState(false);

  const data = snapshot.data;
  const issues = (data?.issues ?? []).filter((i) => issueFilter === 'ALL' || i.type === issueFilter);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Infrastructure"
        title="Data Center"
        description="Provider health, freshness, coverage and data-quality monitoring for every feed backing the terminal."
        actions={
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={snapshot.reload} loading={snapshot.loading}>
            Refresh
          </Button>
        }
        meta={
          data ? (
            <DataBadge freshness={data.globalFreshness} source={{ provider: 'QUANTORA Data Hub', origin: 'MONITOR', isDemo: true, reliability: 'PROVISIONAL' }} updatedAt={data.updatedAt} />
          ) : undefined
        }
      />

      <Card title="Connection state legend" subtitle="Every feed in the platform reports one of these states">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {LEGEND.map((s) => (
            <ConnectionStatusDot key={s} status={s} />
          ))}
        </div>
      </Card>

      {snapshot.loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : snapshot.error ? (
        <Card><ErrorState message={snapshot.error} onRetry={snapshot.reload} /></Card>
      ) : !data ? (
        <Card><EmptyState title="No data snapshot" description="Refresh to load provider status." /></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.providers.map((p) => (
              <Card key={p.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[13.5px] font-semibold text-fg">{p.name}</h3>
                    <p className="truncate text-[11px] text-mut">{p.vendor}</p>
                  </div>
                  {p.isDemo && <Badge tone="gold">Demo</Badge>}
                </div>
                <div className="mt-2"><ConnectionStatusDot status={p.status} /></div>

                <dl className="mt-3 space-y-1.5 text-[12px]">
                  <Row label="Last successful update" value={formatTimestamp(p.lastSuccessAt)} />
                  <Row label="Latency" value={p.latencyMs > 0 ? `${p.latencyMs} ms` : '—'} />
                  <Row label="Data freshness" value={p.freshnessSeconds > 0 ? `${formatCompact(p.freshnessSeconds)} s` : '—'} />
                  <Row label="Source reliability" value={p.reliabilityPct > 0 ? `${p.reliabilityPct}%` : 'Unavailable'} />
                  <Row label="Requests today" value={formatNumber(p.apiUsage.requestsToday, 0)} />
                  <Row label="Requests this month" value={formatNumber(p.apiUsage.requestsMonth, 0)} />
                </dl>

                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-mut">Monthly quota</span>
                    <span className="num text-fg">{p.apiUsage.quotaPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a2029]">
                    <div
                      className={cn('h-full rounded-full', p.apiUsage.quotaPct > 75 ? 'bg-neg' : p.apiUsage.quotaPct > 50 ? 'bg-warn' : 'bg-gold')}
                      style={{ width: `${Math.min(100, p.apiUsage.quotaPct)}%` }}
                    />
                  </div>
                  {p.rateLimit.used / Math.max(1, p.rateLimit.limit) > 0.75 && (
                    <p className="mt-1.5 text-[11px] text-warn">Rate-limit threshold approached — backoff scheduling engaged.</p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {p.supportedMarkets.map((m) => (
                    <Badge key={m} tone="muted">{m}</Badge>
                  ))}
                </div>

                <div className="mt-3 border-t border-line-soft pt-2.5">
                  <Button size="sm" variant="ghost" block icon={<Settings2 size={13} />} onClick={() => setConfigureOpen(true)}>
                    Configure provider
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card
              title="Data quality issues"
              subtitle={`${issues.length} issue${issues.length === 1 ? '' : 's'} detected`}
              actions={
                <Select
                  label="Filter"
                  hideLabel
                  value={issueFilter}
                  options={ISSUE_OPTIONS}
                  onChange={(v) => setIssueFilter(v as 'ALL' | DataIssueType)}
                  size="sm"
                />
              }
              dense
              flush
            >
              <DataTable
                caption="Data quality issues"
                rows={issues}
                rowKey={(i) => i.id}
                emptyTitle="No matching issues"
                emptyDescription="No data-quality issues match this filter."
                columns={[
                  {
                    key: 'type',
                    header: 'Type',
                    cell: (i) => (
                      <Badge tone={i.severity === 'HIGH' ? 'negative' : i.severity === 'MEDIUM' ? 'warning' : 'muted'}>
                        {i.type.replace(/_/g, ' ')}
                      </Badge>
                    ),
                  },
                  { key: 'sym', header: 'Instrument', cell: (i) => <span className="font-medium">{i.symbol}</span> },
                  { key: 'detail', header: 'Detail', cell: (i) => <span className="text-mut">{i.detail}</span> },
                  {
                    key: 'sev',
                    header: 'Severity',
                    cell: (i) => (
                      <Badge tone={i.severity === 'HIGH' ? 'negative' : i.severity === 'MEDIUM' ? 'warning' : 'info'}>
                        {i.severity}
                      </Badge>
                    ),
                  },
                  { key: 'at', header: 'Detected', align: 'right', cell: (i) => <span className="num text-mut">{formatTimestamp(i.detectedAt)}</span> },
                ]}
              />
            </Card>

            <Card title="Historical coverage" subtitle="Candle completeness by instrument">
              <ul className="space-y-3">
                {data.coverage.map((c) => (
                  <li key={c.instrumentId} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-fg">{c.symbol}</span>
                      <span className="num text-[12px] text-gold-2">{c.completenessPct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#1a2029]">
                      <div
                        className={cn('h-full rounded-full', c.completenessPct >= 99 ? 'bg-pos' : c.completenessPct >= 97 ? 'bg-gold' : 'bg-warn')}
                        style={{ width: `${c.completenessPct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="num text-[11px] text-mut">{c.from} → {c.to}</span>
                      <span className="num text-[11px] text-mut-2">{formatCompact(c.candleCount)} candles</span>
                      <Badge tone={c.freshness === 'DELAYED' ? 'warning' : c.freshness === 'HISTORICAL' ? 'info' : 'neutral'}>
                        {c.freshness}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Feed status summary">
            <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-mut">
              <span className="inline-flex items-center gap-2"><Wifi size={14} className="text-gold" aria-hidden /> Global freshness</span>
              <Badge tone={data.globalFreshness === 'DEMO' ? 'gold' : data.globalFreshness === 'DELAYED' ? 'warning' : 'neutral'}>
                {data.globalFreshness}
              </Badge>
              <span>Last snapshot {formatTimestamp(data.updatedAt)}</span>
              <span className="text-mut-2">Demonstration environment — no external market data provider is connected.</span>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        title="Provider configuration"
        description="Credentials and endpoints are supplied by the backend integration"
        footer={<Button variant="primary" onClick={() => setConfigureOpen(false)}>Understood</Button>}
      >
        <div className="space-y-3 text-[13px] leading-relaxed text-mut">
          <p>
            This frontend build ships with the built-in QUANTORA Demo Engine only. Third-party provider credentials,
            endpoints and websocket keys are injected by the backend service layer once an operator connects an account.
          </p>
          <p>
            Until then the corresponding feeds remain <strong className="text-fg">DISCONNECTED</strong>,{' '}
            <strong className="text-fg">STALE</strong> or <strong className="text-fg">DELAYED</strong> and every value
            derived from them is labelled accordingly. No credentials are stored in the browser.
          </p>
          <p className="rounded-[4px] border border-line bg-panel p-3 text-[12px]">
            See Settings → Data providers for the read-only inventory of registered feeds.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-mut">{label}</dt>
      <dd className="num text-right text-fg">{value}</dd>
    </div>
  );
}
