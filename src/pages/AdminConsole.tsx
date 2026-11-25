import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ApiEnvelope } from '@/api';
import { useAsync } from '@/state/useAsync';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  Skeleton,
  StatTile,
} from '@/components/ui';
import type { Column, Tone } from '@/components/ui';

interface ProviderRow {
  id: string;
  name: string;
  vendor: string;
  status: string;
  lastSuccessAt?: string;
  lastError?: string;
  latencyMs: number;
  reliabilityPct: number;
  isDemo: boolean;
}

interface AdminOverview {
  service: {
    name: string;
    version: string;
    env: string;
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    startedAt: string;
  };
  schema: {
    version: number;
    applied: Array<{ version: number; appliedAt: string }>;
  };
  database: {
    path: string;
    counts: Record<string, number>;
  };
  security: {
    cookieName: string;
    sessionTtlDays: number;
    sessionSecret: 'SET' | 'DEV_DEFAULT';
    adminTokenConfigured: boolean;
    corsOrigins: string[];
    rateLimit: { windowMs: number; max: number };
  };
  config: {
    logLevel: string;
    quoteCacheTtlMs: number;
    providers: {
      enabled: string[];
      demoEnabled: boolean;
      yahoo: { enabled: boolean; ratePerMinute: number; apiKeyConfigured: boolean };
      binance: { enabled: boolean; ratePerMinute: number; apiKeyConfigured: boolean };
    };
  };
  providers: ProviderRow[];
  routes: string[];
  users: Array<{ email: string; displayName: string | null; createdAt: string; lastLoginAt: string | null }>;
  recentLogs: Array<{ id: number; ts: string; level: string; source: string; message: string }>;
}

const COUNT_LABELS: Record<string, string> = {
  instruments: 'Instruments',
  candles: 'Candles',
  quotes: 'Quotes',
  strategies: 'Strategies',
  opportunities: 'Opportunities',
  backtests: 'Backtests',
  users: 'Users',
  paperAccounts: 'Paper accounts',
  paperOrders: 'Paper orders',
  paperPositions: 'Paper positions',
  paperTrades: 'Paper trades',
  paperTransactions: 'Paper transactions',
  systemLogs: 'System logs',
};

async function fetchOverview(): Promise<ApiEnvelope<AdminOverview>> {
  const res = await fetch('/api/admin/overview');
  const payload = (await res.json().catch(() => ({}))) as Partial<ApiEnvelope<AdminOverview>> & {
    error?: { message?: string };
  };
  if (!res.ok || !payload.data) {
    throw new Error(payload.error?.message ?? 'Unable to load the system overview.');
  }
  return payload as ApiEnvelope<AdminOverview>;
}

function formatUptime(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function providerTone(status: string): Tone {
  if (status === 'CONNECTED') return 'positive';
  if (status === 'DISCONNECTED') return 'negative';
  if (status === 'DELAYED' || status === 'STALE') return 'warning';
  return 'info';
}

function logTone(level: string): Tone {
  if (level === 'error') return 'negative';
  if (level === 'warn') return 'warning';
  return 'neutral';
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line-soft py-1.5 last:border-0">
      <span className="shrink-0 text-[11.5px] text-mut">{label}</span>
      <span className="min-w-0 break-words text-right text-[12px] text-fg">{children}</span>
    </div>
  );
}

export default function AdminConsole() {
  const { data, loading, error, fetchedAt, reload } = useAsync<AdminOverview>(fetchOverview, []);
  const [routeFilter, setRouteFilter] = useState('');

  const filteredRoutes = useMemo(() => {
    const q = routeFilter.trim().toLowerCase();
    const routes = data?.routes ?? [];
    if (!q) return routes;
    return routes.filter((r) => r.toLowerCase().includes(q));
  }, [data?.routes, routeFilter]);

  const providerColumns: Column<ProviderRow>[] = [
    {
      key: 'provider',
      header: 'Provider',
      cell: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-fg">{row.name}</span>
          <span className="num block truncate text-[10.5px] text-mut-2">
            {row.id} · {row.vendor}
          </span>
        </span>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={providerTone(row.status)} dot title={row.lastError ?? row.status}>
          {row.status}
        </Badge>
      ),
      sortValue: (row) => row.status,
    },
    {
      key: 'kind',
      header: 'Type',
      cell: (row) => (row.isDemo ? <Badge tone="muted">DEMO</Badge> : <Badge tone="info">LIVE</Badge>),
      sortValue: (row) => (row.isDemo ? 0 : 1),
    },
    {
      key: 'latency',
      header: 'Latency',
      align: 'right',
      cell: (row) => <span className="num">{row.latencyMs} ms</span>,
      sortValue: (row) => row.latencyMs,
    },
    {
      key: 'reliability',
      header: 'Reliability',
      align: 'right',
      cell: (row) => <span className="num">{row.reliabilityPct}%</span>,
      sortValue: (row) => row.reliabilityPct,
    },
    {
      key: 'lastError',
      header: 'Last error',
      cell: (row) =>
        row.lastError ? (
          <span className="block max-w-[260px] truncate text-[11.5px] text-neg" title={row.lastError}>
            {row.lastError}
          </span>
        ) : (
          <span className="text-[11.5px] text-mut-2">—</span>
        ),
    },
  ];

  const userColumns: Column<AdminOverview['users'][number]>[] = [
    {
      key: 'email',
      header: 'Email',
      cell: (row) => <span className="num text-[12px] text-fg">{row.email}</span>,
      sortValue: (row) => row.email,
    },
    {
      key: 'displayName',
      header: 'Display name',
      cell: (row) => row.displayName ?? <span className="text-mut-2">—</span>,
      sortValue: (row) => row.displayName ?? '',
    },
    {
      key: 'createdAt',
      header: 'Registered',
      cell: (row) => <span className="num text-[11.5px] text-mut">{formatDateTime(row.createdAt)}</span>,
      sortValue: (row) => row.createdAt,
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="num text-[11.5px] text-mut">{formatDateTime(row.lastLoginAt)}</span>
        ) : (
          <span className="text-[11.5px] text-mut-2">Never</span>
        ),
      sortValue: (row) => row.lastLoginAt ?? '',
    },
  ];

  const logColumns: Column<AdminOverview['recentLogs'][number]>[] = [
    {
      key: 'ts',
      header: 'Time',
      cell: (row) => <span className="num text-[11.5px] text-mut">{formatDateTime(row.ts)}</span>,
      sortValue: (row) => row.ts,
    },
    {
      key: 'level',
      header: 'Level',
      cell: (row) => <Badge tone={logTone(row.level)}>{row.level.toUpperCase()}</Badge>,
      sortValue: (row) => row.level,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (row) => <span className="num text-[11.5px] text-mut">{row.source}</span>,
      sortValue: (row) => row.source,
    },
    {
      key: 'message',
      header: 'Message',
      cell: (row) => <span className="block min-w-[220px] text-[12px] text-fg">{row.message}</span>,
    },
  ];

  const booting = loading && !data && !error;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administration"
        title="System Admin"
        description="Read-only operational overview of the backend, data stores, providers and accounts. Secrets are shown as configured flags only."
        meta={fetchedAt ? <span className="text-[11px] text-mut">As of {formatDateTime(fetchedAt)}</span> : undefined}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={reload}
            loading={loading && !!data}
          >
            Refresh
          </Button>
        }
      />

      {error && !data && (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      )}

      {error && data && (
        <p role="alert" className="rounded-[4px] border border-neg/40 bg-neg/10 px-3 py-2 text-[12px] text-neg">
          Refresh failed — showing the last loaded snapshot. {error}
        </p>
      )}

      {booting && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Environment" value={data.service.env} sub={`QUANTORA ${data.service.version}`} />
            <StatTile label="Runtime" value={data.service.nodeVersion} sub={data.service.platform} />
            <StatTile
              label="Uptime"
              value={formatUptime(data.service.uptimeSeconds)}
              sub={`since ${formatDateTime(data.service.startedAt)}`}
            />
            <StatTile
              label="Schema"
              value={`v${data.schema.version}`}
              sub={`${data.schema.applied.length} migration${data.schema.applied.length === 1 ? '' : 's'}`}
            />
            <StatTile label="API routes" value={String(data.routes.length)} sub="registered handlers" />
            <StatTile label="Accounts" value={String(data.database.counts.users ?? 0)} sub="registered users" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Runtime & security">
              <div className="px-4 pb-3 pt-1">
                <InfoRow label="Service">{data.service.name}</InfoRow>
                <InfoRow label="Process started">{formatDateTime(data.service.startedAt)}</InfoRow>
                <InfoRow label="Database">{data.database.path}</InfoRow>
                <InfoRow label="Session cookie">
                  <span className="num">{data.security.cookieName}</span>
                </InfoRow>
                <InfoRow label="Session lifetime">{data.security.sessionTtlDays} days</InfoRow>
                <InfoRow label="Session secret">
                  {data.security.sessionSecret === 'SET' ? (
                    <Badge tone="positive">configured</Badge>
                  ) : (
                    <Badge tone="warning" title="Set SESSION_SECRET for production">
                      dev default
                    </Badge>
                  )}
                </InfoRow>
                <InfoRow label="Admin token">
                  {data.security.adminTokenConfigured ? (
                    <Badge tone="positive">configured</Badge>
                  ) : (
                    <Badge tone="muted">not set</Badge>
                  )}
                </InfoRow>
                <InfoRow label="Rate limit">
                  <span className="num">
                    {data.security.rateLimit.max} req / {Math.round(data.security.rateLimit.windowMs / 1000)}s per IP
                  </span>
                </InfoRow>
                <InfoRow label="CORS origins">
                  <span className="num text-[11px]">{data.security.corsOrigins.join(', ') || '—'}</span>
                </InfoRow>
                <InfoRow label="Migrations applied">
                  <span className="num text-[11px]">
                    {data.schema.applied.map((m) => `v${m.version}`).join(', ') || '—'}
                  </span>
                </InfoRow>
              </div>
            </Card>

            <Card title="Configuration">
              <div className="px-4 pb-3 pt-1">
                <InfoRow label="Log level">{data.config.logLevel}</InfoRow>
                <InfoRow label="Quote cache TTL">
                  <span className="num">{Math.round(data.config.quoteCacheTtlMs / 1000)}s</span>
                </InfoRow>
                <InfoRow label="Enabled providers">
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {data.config.providers.enabled.map((p) => (
                      <Badge key={p} tone="gold">
                        {p}
                      </Badge>
                    ))}
                  </span>
                </InfoRow>
                <InfoRow label="Demo provider">
                  {data.config.providers.demoEnabled ? <Badge tone="info">enabled</Badge> : <Badge tone="muted">disabled</Badge>}
                </InfoRow>
                <InfoRow label="Yahoo Finance">
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {data.config.providers.yahoo.enabled ? (
                      <Badge tone="positive">{data.config.providers.yahoo.ratePerMinute}/min</Badge>
                    ) : (
                      <Badge tone="muted">disabled</Badge>
                    )}
                    <Badge tone={data.config.providers.yahoo.apiKeyConfigured ? 'neutral' : 'muted'}>
                      key {data.config.providers.yahoo.apiKeyConfigured ? 'set' : 'none'}
                    </Badge>
                  </span>
                </InfoRow>
                <InfoRow label="Binance">
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {data.config.providers.binance.enabled ? (
                      <Badge tone="positive">{data.config.providers.binance.ratePerMinute}/min</Badge>
                    ) : (
                      <Badge tone="muted">disabled</Badge>
                    )}
                    <Badge tone={data.config.providers.binance.apiKeyConfigured ? 'neutral' : 'muted'}>
                      key {data.config.providers.binance.apiKeyConfigured ? 'set' : 'none'}
                    </Badge>
                  </span>
                </InfoRow>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Database" subtitle={`SQLite — ${data.database.path}`}>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2 px-4 pb-4 pt-1 sm:grid-cols-3">
                {Object.entries(COUNT_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2 border-b border-line-soft py-1">
                    <span className="text-[11.5px] text-mut">{label}</span>
                    <span className="num text-[12.5px] font-semibold text-fg">{data.database.counts[key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Providers" subtitle="Live health snapshot from the provider registry">
              <DataTable
                columns={providerColumns}
                rows={data.providers}
                rowKey={(row) => row.id}
                caption="Provider health"
                dense
                emptyTitle="No providers registered"
                emptyDescription="The provider registry returned no adapters for this instance."
              />
            </Card>
          </div>

          <Card title="Registered accounts" subtitle={`${data.users.length} user${data.users.length === 1 ? '' : 's'} on this instance`}>
            <DataTable
              columns={userColumns}
              rows={data.users}
              rowKey={(row) => row.email}
              caption="Registered user accounts"
              dense
              emptyTitle="No accounts yet"
              emptyDescription="Accounts appear here after the first registration."
            />
          </Card>

          <Card
            title="API routes"
            subtitle={`${filteredRoutes.length} of ${data.routes.length} shown`}
            actions={
              <div className="w-full sm:w-56">
                <SearchInput value={routeFilter} onChange={setRouteFilter} placeholder="Filter routes…" label="Filter routes" />
              </div>
            }
          >
            {filteredRoutes.length === 0 ? (
              <EmptyState
                title="No matching routes"
                description="No route matches the current filter."
                action={
                  routeFilter ? (
                    <Button variant="secondary" size="sm" onClick={() => setRouteFilter('')}>
                      Clear filter
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="max-h-[300px] divide-y divide-line-soft overflow-y-auto px-4 pb-3 pt-1">
                {filteredRoutes.map((route) => (
                  <li key={route} className="num flex items-center gap-2 py-1.5 text-[11.5px]">
                    <span
                      className={
                        route.startsWith('GET')
                          ? 'w-12 shrink-0 text-pos'
                          : route.startsWith('POST')
                            ? 'w-12 shrink-0 text-info'
                            : 'w-12 shrink-0 text-warn'
                      }
                    >
                      {route.split(' ')[0]}
                    </span>
                    <span className="truncate text-mut">{route.slice(route.indexOf(' ') + 1)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent system logs" subtitle="Newest 25 entries from this instance">
            <DataTable
              columns={logColumns}
              rows={data.recentLogs}
              rowKey={(row) => String(row.id)}
              caption="Recent system log entries"
              dense
              emptyTitle="No system logs yet"
              emptyDescription="Operational events (backtests, admin actions, ingestion) will appear here."
            />
          </Card>
        </>
      )}
    </div>
  );
}
