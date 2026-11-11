import type { DataFreshness } from './market';

export type ConnectionStatus =
  | 'CONNECTED'
  | 'DELAYED'
  | 'STALE'
  | 'DISCONNECTED'
  | 'DEMO DATA';

export type DataIssueType =
  | 'MISSING_CANDLES'
  | 'DUPLICATE_RECORDS'
  | 'GAP_DETECTED'
  | 'SCHEMA_MISMATCH'
  | 'RATE_LIMIT';

export interface DataIssue {
  id: string;
  type: DataIssueType;
  instrumentId: string;
  symbol: string;
  detail: string;
  detectedAt: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CoverageRange {
  instrumentId: string;
  symbol: string;
  from: string;
  to: string;
  candleCount: number;
  completenessPct: number;
  freshness: DataFreshness;
}

export interface DataProviderStatus {
  id: string;
  name: string;
  vendor: string;
  status: ConnectionStatus;
  lastSuccessAt: string;
  latencyMs: number;
  freshnessSeconds: number;
  reliabilityPct: number;
  isDemo: boolean;
  rateLimit: {
    used: number;
    limit: number;
    resetsAt: string;
  };
  apiUsage: {
    requestsToday: number;
    requestsMonth: number;
    quotaPct: number;
  };
  supportedMarkets: string[];
}

export interface DataCenterSnapshot {
  providers: DataProviderStatus[];
  issues: DataIssue[];
  coverage: CoverageRange[];
  globalFreshness: DataFreshness;
  updatedAt: string;
}
