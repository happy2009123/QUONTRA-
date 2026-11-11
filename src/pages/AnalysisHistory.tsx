import { useState } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  InfoHint,
  PageHeader,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

type HistoryEntry = {
  id: string;
  instrumentId: string;
  symbol: string;
  decision: string;
  score: number;
  createdAt: string;
};

const DEFAULT_USER_ID = 'desk@quantora.demo';

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(`quantora:analysis-history:${DEFAULT_USER_ID}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(`quantora:analysis-history:${DEFAULT_USER_ID}`, JSON.stringify(entries));
  } catch {}
}

export default function AnalysisHistory() {
const [entries, setEntries] = useState<HistoryEntry[]>(loadHistory());
const [error, setError] = useState<string | null>(null);

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  };

  const clearAll = () => {
    setEntries([]);
    saveHistory([]);
  };

  if (error) return <ErrorState message={error} onRetry={() => setError(null)} />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analysis History"
        title="Analysis History"
        description="Review past autonomous analysis results. History is stored locally in your browser and is not shared with any server."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => setEntries(loadHistory())}>
              Refresh
            </Button>
            {entries.length > 0 && (
              <Button variant="danger" icon={<Trash2 size={14} />} onClick={clearAll}>
                Clear all
              </Button>
            )}
          </div>
        }
        meta={<Badge tone="gold" dot>Local storage only</Badge>}
      />

      <InfoHint text="Analysis history persists in your browser's local storage. It is never transmitted to a server and is not linked to any broker account." />

      {entries.length === 0 ? (
        <EmptyState
          title="No analysis history"
          description="Run an autonomous analysis to see results appear here."
          action={
            <Button variant="primary">Run analysis</Button>
          }
        />
      ) : (
        <Card title="Past analyses" dense flush>
          <DataTable
            caption={`${entries.length} analysis${entries.length === 1 ? '' : 's'}`}
            rows={entries}
            rowKey={(e) => e.id}
            columns={[
              { key: 'time', header: 'Time', cell: (e) => <span className="text-mut text-[11px]">{formatDateTime(e.createdAt)}</span> },
              { key: 'symbol', header: 'Instrument', cell: (e) => <span className="font-medium">{e.symbol}</span> },
              { key: 'decision', header: 'Decision', align: 'center', cell: (e) => <Badge tone={e.decision === 'BUY' ? 'positive' : e.decision === 'SELL' ? 'negative' : 'muted'}>{e.decision}</Badge> },
              { key: 'score', header: 'Score', align: 'right', cell: (e) => <span className="num font-mono">{e.score}</span> },
              { key: 'actions', header: '', align: 'right', cell: (e) => (
                <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => removeEntry(e.id)} aria-label={`Remove ${e.symbol}`} />
              )},
            ]}
          />
        </Card>
      )}
    </div>
  );
}
