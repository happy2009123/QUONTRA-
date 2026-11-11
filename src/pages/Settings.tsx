import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, Database, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConnectionStatusDot,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Toggle,
} from '@/components/ui';
import { api } from '@/api/client';
import { useAsync } from '@/state/useAsync';
import { useSettings } from '@/state/SettingsContext';
import { MARKET_LABELS, USD_INR_RESTRICTION } from '@/data/universe';
import { TIMEFRAMES } from '@/models';
import type { ChartType, MarketCategory } from '@/models';

const INDICATOR_CHOICES = ['EMA_9', 'EMA_20', 'EMA_50', 'EMA_200', 'RSI', 'MACD', 'BOLLINGER', 'VWAP', 'VOLUME'];

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'CANDLES', label: 'Candles' },
  { value: 'LINE', label: 'Line' },
  { value: 'AREA', label: 'Area' },
  { value: 'BARS', label: 'Bars' },
  { value: 'HEIKIN_ASHI', label: 'Heikin Ashi' },
];

export default function Settings() {
  const { settings, update, updateChart, reset } = useSettings();
  const providers = useAsync(() => api.data.getSnapshot(), []);
  const [confirmReset, setConfirmReset] = useState(false);
  const [providerModal, setProviderModal] = useState<string | null>(null);

  const toggleIndicator = (key: string, on: boolean) =>
    updateChart({
      defaultIndicators: on
        ? [...settings.chart.defaultIndicators, key]
        : settings.chart.defaultIndicators.filter((k) => k !== key),
    });

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Profile, defaults, chart preferences, notification routing, data-provider inventory and legal disclosures."
        actions={
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
            Reset all settings
          </Button>
        }
        meta={<Badge tone="gold" dot>Saved locally in this browser</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Profile" subtitle="Displayed across the terminal">
          <div className="space-y-3">
            <Input label="Display name" value={settings.displayName} onChange={(e) => update({ displayName: e.target.value })} />
            <Input label="Email" type="email" value={settings.email} onChange={(e) => update({ email: e.target.value })} />
            <Input label="Role" value={settings.role} onChange={(e) => update({ role: e.target.value })} />
            <p className="rounded-[4px] border border-line bg-panel p-2.5 text-[11.5px] text-mut">
              Demo session — authentication and account provisioning are handled by the backend integration.
            </p>
          </div>
        </Card>

        <Card title="Appearance & density">
          <div className="space-y-3">
            <Toggle
              checked={settings.compactTables}
              onChange={(v) => update({ compactTables: v })}
              label="Compact table rows"
              description="Reduces row height in dense data tables."
            />
            <Toggle
              checked={settings.reduceMotion}
              onChange={(v) => update({ reduceMotion: v })}
              label="Reduce motion"
              description="Minimises non-essential transitions and shimmer effects."
            />
            <Select
              label="Base currency"
              value={settings.baseCurrency}
              options={[{ value: 'INR', label: 'INR (₹)' }, { value: 'USD', label: 'USD ($)' }]}
              onChange={(v) => update({ baseCurrency: v as 'INR' | 'USD' })}
            />
            <Select
              label="Timezone"
              value={settings.timezone}
              options={[
                { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
                { value: 'UTC', label: 'UTC' },
                { value: 'America/New_York', label: 'America/New_York' },
                { value: 'Europe/London', label: 'Europe/London' },
              ]}
              onChange={(v) => update({ timezone: v })}
            />
            <p className="text-[11.5px] text-mut-2">
              The terminal ships a single dark institutional theme; accent colour is fixed to QUANTORA gold.
            </p>
          </div>
        </Card>

        <Card title="Defaults">
          <div className="space-y-3">
            <Select
              label="Default market"
              value={settings.defaultMarket}
              options={[
                { value: 'ALL', label: 'All markets' },
                ...(Object.keys(MARKET_LABELS) as MarketCategory[]).map((k) => ({ value: k, label: MARKET_LABELS[k] })),
              ]}
              onChange={(v) => update({ defaultMarket: v as MarketCategory | 'ALL' })}
            />
            <Select
              label="Default timeframe"
              value={settings.defaultTimeframe}
              options={TIMEFRAMES.map((t) => ({ value: t, label: t }))}
              onChange={(v) => update({ defaultTimeframe: v as (typeof TIMEFRAMES)[number] })}
            />
          </div>
        </Card>

        <Card title="Chart preferences">
          <div className="space-y-3">
            <Select
              label="Default chart type"
              value={settings.chart.chartType}
              options={CHART_TYPES}
              onChange={(v) => updateChart({ chartType: v as ChartType })}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <Toggle checked={settings.chart.showVolume} onChange={(v) => updateChart({ showVolume: v })} label="Show volume" />
              <Toggle checked={settings.chart.showGrid} onChange={(v) => updateChart({ showGrid: v })} label="Show grid" />
              <Toggle checked={settings.chart.showCrosshair} onChange={(v) => updateChart({ showCrosshair: v })} label="Crosshair" />
            </div>
            <div>
              <p className="section-title mb-2">Default indicators</p>
              <div className="flex flex-wrap gap-2">
                {INDICATOR_CHOICES.map((key) => {
                  const on = settings.chart.defaultIndicators.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleIndicator(key, !on)}
                      className={
                        on
                          ? 'rounded-[4px] border border-gold/45 bg-gold/10 px-2.5 py-1.5 text-[11.5px] text-gold-2'
                          : 'rounded-[4px] border border-line px-2.5 py-1.5 text-[11.5px] text-mut hover:text-fg'
                      }
                    >
                      {key.replace('_', ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Notifications"
          subtitle="Routing and severity thresholds"
          actions={
            <Link
              to="/notifications"
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line px-3 text-[12.5px] text-mut transition-colors hover:text-gold-2"
            >
              <Bell size={13} aria-hidden /> Open preferences
            </Link>
          }
        >
          <p className="text-[12.5px] leading-relaxed text-mut">
            Per-type enablement, delivery channels (in-app, email, push) and minimum severity are configured on the
            Notifications page and persist with your local settings.
          </p>
        </Card>

        <Card title="Data providers" subtitle="Read-only inventory of registered feeds">
          {providers.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : providers.error ? (
            <ErrorState message={providers.error} onRetry={providers.reload} />
          ) : !providers.data ? (
            <EmptyState title="No providers" description="Refresh to load the feed inventory." />
          ) : (
            <ul className="space-y-2.5">
              {providers.data.providers.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 border-b border-line-soft pb-2.5 last:border-0 last:pb-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[4px] bg-gold/10 text-gold">
                    <Database size={15} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{p.name}</span>
                    <span className="block truncate text-[11.5px] text-mut">{p.vendor}</span>
                  </span>
                  <ConnectionStatusDot status={p.status} />
                  <Button size="sm" variant="ghost" onClick={() => setProviderModal(p.name)}>
                    Configure
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Legal & risk disclosures">
        <div className="grid gap-4 md:grid-cols-2">
          <Disclosure
            icon={<AlertTriangle size={14} />}
            title="Demonstration data policy"
            body="Every price, signal, score, backtest and news item in this build is generated demonstration data produced by the QUANTORA Demo Engine. Values carry an explicit freshness label (DEMO, DELAYED, HISTORICAL, STALE) and a source stamp wherever they are displayed. Nothing shown here is a verified market price."
          />
          <Disclosure
            icon={<ShieldCheck size={14} />}
            title="No brokerage or execution"
            body="This frontend does not connect to any broker, exchange or order-routing system. No orders can be placed, modified or cancelled from this interface, and no portfolio here reflects a real account."
          />
          <Disclosure
            icon={<AlertTriangle size={14} />}
            title="Strategy-quality score"
            body="The strategy-quality score is a transparent confluence measure ranging from 0 to 100. It is NOT a win probability, expected return, forecast or guarantee. A high score describes agreement between configured conditions, nothing more."
          />
          <Disclosure
            icon={<AlertTriangle size={14} />}
            title="Simulated performance"
            body="Backtest and strategy-lab results are simulated with modelled transaction costs and slippage. Past or simulated performance does not indicate future results, and out-of-sample windows shown here are short by design of the demonstration dataset."
          />
          <Disclosure
            icon={<AlertTriangle size={14} />}
            title="Instrument eligibility"
            body={`${USD_INR_RESTRICTION.summary}. ${USD_INR_RESTRICTION.detail} Exchange-traded currency derivatives and other derivative instruments carry eligibility and suitability requirements that vary by jurisdiction.`}
          />
          <Disclosure
            icon={<AlertTriangle size={14} />}
            title="Not investment advice"
            body="QUANTORA is a research and interface demonstration. Nothing on this platform constitutes investment advice, a recommendation, or a solicitation to buy or sell any instrument. Consult a licensed adviser before making financial decisions."
          />
        </div>
      </Card>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all settings"
        description="Profile, defaults, chart preferences and density will return to factory values"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setConfirmReset(false);
              }}
            >
              Reset settings
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-mut">
          This clears the locally stored configuration for this browser only. Reports, notifications and demonstration
          data are unaffected.
        </p>
      </Modal>

      <Modal
        open={Boolean(providerModal)}
        onClose={() => setProviderModal(null)}
        title={providerModal ?? 'Provider'}
        description="Credentials are supplied by the backend integration"
        footer={<Button variant="primary" onClick={() => setProviderModal(null)}>Close</Button>}
      >
        <p className="text-[13px] leading-relaxed text-mut">
          Provider endpoints, API keys and websocket authentication are injected server-side. The browser never stores
          secrets, and until a provider is connected by an operator its status stays {''}
          <strong className="text-fg">DISCONNECTED</strong>, {''}
          <strong className="text-fg">STALE</strong> or {''}
          <strong className="text-fg">DELAYED</strong> in the Data Center.
        </p>
      </Modal>
    </div>
  );
}

function Disclosure({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="panel-subtle p-3.5">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold text-fg">
        <span className="text-warn">{icon}</span>
        {title}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-mut">{body}</p>
    </div>
  );
}
