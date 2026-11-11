export type NotificationKind =
  | 'REPORT_READY'
  | 'NEW_SETUP'
  | 'DATA_FAILURE'
  | 'MARKET_EVENT'
  | 'STRATEGY_WARNING'
  | 'SYSTEM';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  href?: string;
}

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'PUSH';

export interface NotificationPreference {
  kind: NotificationKind;
  enabled: boolean;
  channels: NotificationChannel[];
  minSeverity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface ReportArchiveEntry {
  id: string;
  date: string;
  title: string;
  market: string;
  opportunityCount: number;
  noQualifiedSetups: boolean;
  generatedAt: string;
  format: 'PDF' | 'CSV' | 'JSON';
  sizeKb: number;
}
