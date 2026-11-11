import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  FlaskConical,
  FileText,
  Radio,

  Sparkles,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,

  PageHeader,
  Select,
  Skeleton,
  Toggle,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { useNotifications } from '@/state/NotificationsContext';
import { cn } from '@/lib/cn';
import { formatTimestamp } from '@/lib/format';
import type { NotificationKind } from '@/models';

type TabId = 'alerts' | 'archive' | 'preferences';

const KINDS: { value: NotificationKind | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'REPORT_READY', label: 'Report ready' },
  { value: 'NEW_SETUP', label: 'New setup' },
  { value: 'DATA_FAILURE', label: 'Data failure' },
  { value: 'MARKET_EVENT', label: 'Market event' },
  { value: 'STRATEGY_WARNING', label: 'Strategy warning' },
  { value: 'SYSTEM', label: 'System' },
];

const KIND_ICON: Record<NotificationKind, typeof Bell> = {
  REPORT_READY: FileText,
  NEW_SETUP: Sparkles,
  DATA_FAILURE: AlertTriangle,
  MARKET_EVENT: CalendarClock,
  STRATEGY_WARNING: FlaskConical,
  SYSTEM: Radio,
};

const KIND_LABEL: Record<NotificationKind, string> = {
  REPORT_READY: 'Report ready',
  NEW_SETUP: 'New setup',
  DATA_FAILURE: 'Data failure',
  MARKET_EVENT: 'Market event',
  STRATEGY_WARNING: 'Strategy warning',
  SYSTEM: 'System',
};

const CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;

export default function Notifications() {
  const { items, preferences, loading, error, unreadCount, markRead, markAllRead, savePreferences, refresh } =
    useNotifications();
  const archive = useAsync(() => api.notifications.getArchive(), []);
  const [tab, setTab] = useState<TabId>('alerts');
  const [kindFilter, setKindFilter] = useState<NotificationKind | 'ALL'>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [archiveRange, setArchiveRange] = useState<'ALL' | '7' | '30'>('ALL');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState(preferences);

  const visible = useMemo(
    () =>
      items.filter(
        (n) => (kindFilter === 'ALL' || n.kind === kindFilter) && (!unreadOnly || !n.read),
      ),
    [items, kindFilter, unreadOnly],
  );

  const archiveRows = useMemo(() => {
    const rows = archive.data ?? [];
    if (archiveRange === 'ALL') return rows;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(archiveRange));
    return rows.filter((r) => new Date(r.date) >= cutoff);
  }, [archive.data, archiveRange]);

  const save = async () => {
    setSaving(true);
    await savePreferences(draftPrefs);
    setSaving(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const exportArchive = () => {
    const header = ['date', 'title', 'market', 'opportunityCount', 'noQualifiedSetups', 'generatedAt', 'format', 'sizeKb'];
    const rows = archiveRows.map((r) =>
      [r.date, r.title, r.market, r.opportunityCount, r.noQualifiedSetups, r.generatedAt, r.format, r.sizeKb].join(','),
    );
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quantora-report-archive.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Notifications & Report History"
        description="Qualifying-setup alerts, data failures, market events, strategy warnings and the historical report archive."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Bell size={14} />} onClick={refresh} loading={loading}>
              Refresh
            </Button>
            <Button
              variant="secondary"
              icon={<CheckCheck size={14} />}
              onClick={markAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </div>
        }
        meta={unreadCount > 0 ? <Badge tone="gold" dot>{unreadCount} unread</Badge> : <Badge tone="neutral">All caught up</Badge>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { value: 'alerts', label: 'Alerts' },
            { value: 'archive', label: 'Report archive' },
            { value: 'preferences', label: 'Preferences' },
          ] as { value: TabId; label: string }[]
        ).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            aria-pressed={tab === t.value}
            className={cn(
              'rounded-[4px] border px-3 py-1.5 text-[12.5px] transition-colors',
              tab === t.value ? 'border-gold/45 bg-gold/10 font-medium text-gold-2' : 'border-line text-mut hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <Card
          title="Alerts"
          subtitle={`${visible.length} shown · ${unreadCount} unread`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label="Kind"
                hideLabel
                value={kindFilter}
                options={KINDS}
                onChange={(v) => setKindFilter(v as NotificationKind | 'ALL')}
                size="sm"
              />
              <Toggle checked={unreadOnly} onChange={setUnreadOnly} label="Unread only" />
            </div>
          }
        >
          {loading ? (
            <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : error ? (
            <ErrorState message={error} onRetry={refresh} />
          ) : visible.length === 0 ? (
            <EmptyState title="Nothing here" description="No notifications match the current filter." />
          ) : (
            <ul className="space-y-2">
              {visible.map((n) => {
                const Icon = KIND_ICON[n.kind];
                return (
                  <li
                    key={n.id}
                    className={cn(
                      'panel-subtle flex flex-wrap items-start gap-3 p-3',
                      !n.read && 'border-l-2 border-l-gold',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]',
                        n.severity === 'CRITICAL' ? 'bg-neg/15 text-neg' : n.severity === 'WARNING' ? 'bg-warn/15 text-warn' : 'bg-gold/10 text-gold',
                      )}
                    >
                      <Icon size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="muted">{KIND_LABEL[n.kind]}</Badge>
                        <Badge tone={n.severity === 'CRITICAL' ? 'negative' : n.severity === 'WARNING' ? 'warning' : 'info'}>
                          {n.severity}
                        </Badge>
                        {!n.read && <Badge tone="gold">Unread</Badge>}
                        <span className="ml-auto text-[10.5px] text-mut">{formatTimestamp(n.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-[13px] font-medium text-fg">{n.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-mut">{n.body}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!n.read && (
                          <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>
                            Mark read
                          </Button>
                        )}
                        {n.href && (
                          <Link
                            to={n.href}
                            className="inline-flex h-7 items-center rounded-[4px] border border-line px-2.5 text-[12px] text-mut transition-colors hover:text-gold-2"
                          >
                            Open
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === 'archive' && (
        <Card
          title="Historical report archive"
          subtitle={`${archiveRows.length} entries`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label="Range"
                hideLabel
                value={archiveRange}
                options={[
                  { value: 'ALL', label: 'All time' },
                  { value: '7', label: 'Last 7 days' },
                  { value: '30', label: 'Last 30 days' },
                ]}
                onChange={(v) => setArchiveRange(v as 'ALL' | '7' | '30')}
                size="sm"
              />
              <Button size="sm" variant="secondary" onClick={exportArchive} disabled={archiveRows.length === 0}>
                Export CSV
              </Button>
            </div>
          }
          dense
          flush
        >
          {archive.loading ? (
            <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : archive.error ? (
            <ErrorState message={archive.error} onRetry={archive.reload} />
          ) : (
            <DataTable
              caption="Report archive"
              rows={archiveRows}
              rowKey={(r) => r.id}
              emptyTitle="No archived reports"
              emptyDescription="Adjust the date range to see more entries."
              columns={[
                { key: 'date', header: 'Date', sortable: true, sortValue: (r) => r.date, cell: (r) => <span className="num">{r.date}</span> },
                { key: 'title', header: 'Report', cell: (r) => <span className="font-medium">{r.title}</span> },
                { key: 'market', header: 'Market', cell: (r) => <span className="text-mut">{r.market === 'ALL' ? 'All markets' : r.market.replace(/_/g, ' ')}</span> },
                {
                  key: 'count',
                  header: 'Setups',
                  align: 'right',
                  sortable: true,
                  sortValue: (r) => r.opportunityCount,
                  cell: (r) =>
                    r.noQualifiedSetups ? <Badge tone="warning">No setups</Badge> : <span className="num text-gold-2">{r.opportunityCount}</span>,
                },
                { key: 'fmt', header: 'Format', cell: (r) => <Badge tone="muted">{r.format}</Badge> },
                { key: 'size', header: 'Size', align: 'right', cell: (r) => <span className="num text-mut">{r.sizeKb} KB</span> },
                { key: 'gen', header: 'Generated', align: 'right', cell: (r) => <span className="num text-mut">{formatTimestamp(r.generatedAt)}</span> },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'preferences' && (
        <Card
          title="Notification preferences"
          subtitle="Delivery channels activate once a backend notification service is connected"
          actions={
            <div className="flex items-center gap-2">
              {saved && <Badge tone="positive">Saved</Badge>}
              <Button variant="primary" size="sm" onClick={save} loading={saving}>
                Save preferences
              </Button>
            </div>
          }
        >
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="hidden gap-3 border-b border-line pb-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-mut md:flex">
                <span className="flex-1">Notification type</span>
                <span className="w-24">Enabled</span>
                <span className="w-56">Channels</span>
                <span className="w-40">Minimum severity</span>
              </div>
              {(draftPrefs.length ? draftPrefs : preferences).map((p, idx) => {
                const next = (patch: Partial<typeof p>) =>
                  setDraftPrefs((prev) => {
                    const base = prev.length ? prev : preferences;
                    return base.map((x) => (x.kind === p.kind ? { ...x, ...patch } : x));
                  });
                return (
                  <div key={p.kind} className="flex flex-col gap-3 border-b border-line-soft pb-3 last:border-0 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">{KIND_LABEL[p.kind as NotificationKind]}</p>
                      <p className="text-[11.5px] text-mut">{describeKind(p.kind as NotificationKind)}</p>
                    </div>
                    <div className="w-24">
                      <Toggle checked={p.enabled} onChange={(v) => next({ enabled: v })} label="Enabled" />
                    </div>
                    <div className="flex w-56 flex-wrap gap-2">
                      {CHANNELS.map((c) => {
                        const on = p.channels.includes(c);
                        return (
                          <label
                            key={c}
                            className={cn(
                              'flex cursor-pointer items-center gap-1.5 rounded-[3px] border px-2 py-1 text-[11px] transition-colors',
                              on ? 'border-gold/45 bg-gold/10 text-gold-2' : 'border-line text-mut',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                next({
                                  channels: on ? p.channels.filter((x) => x !== c) : [...p.channels, c],
                                })
                              }
                              className="h-3 w-3 accent-[#C6A15B]"
                            />
                            {c.replace('_', ' ')}
                          </label>
                        );
                      })}
                    </div>
                    <div className="w-40">
                      <Select
                        label="Minimum severity"
                        hideLabel
                        value={p.minSeverity}
                        options={[
                          { value: 'INFO', label: 'Info and above' },
                          { value: 'WARNING', label: 'Warning and above' },
                          { value: 'CRITICAL', label: 'Critical only' },
                        ]}
                        onChange={(v) => next({ minSeverity: v as 'INFO' | 'WARNING' | 'CRITICAL' })}
                        size="sm"
                        disabled={!p.enabled}
                      />
                    </div>
                    <span className="hidden text-[10px] text-mut-2 lg:block">#{idx + 1}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function describeKind(kind: NotificationKind): string {
  switch (kind) {
    case 'REPORT_READY':
      return 'Daily opportunity report published.';
    case 'NEW_SETUP':
      return 'A setup cleared the confluence threshold.';
    case 'DATA_FAILURE':
      return 'A feed stopped updating or returned gaps.';
    case 'MARKET_EVENT':
      return 'High-impact economic or central-bank event.';
    case 'STRATEGY_WARNING':
      return 'Thin samples or degraded simulated performance.';
    default:
      return 'Platform and demonstration environment notices.';
  }
}
