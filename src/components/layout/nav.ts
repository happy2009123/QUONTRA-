import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Bell,
  Beaker,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  Radar,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Short label used by the mobile bottom bar. */
  shortLabel?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, shortLabel: 'Home' },
      { to: '/scanner', label: 'Market Scanner', icon: Radar, shortLabel: 'Scanner' },
      { to: '/charts', label: 'Charting Terminal', icon: LineChart, shortLabel: 'Charts' },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    items: [
      { to: '/intelligence', label: 'AI Intelligence', icon: Sparkles },
      { to: '/reports', label: 'Opportunity Reports', icon: ScrollText, shortLabel: 'Reports' },
    ],
  },
  {
    id: 'quant',
    label: 'Quantitative',
    items: [
      { to: '/strategy-lab', label: 'Strategy Lab', icon: Beaker },
      { to: '/backtesting', label: 'Backtesting', icon: FlaskConical },
      { to: '/risk', label: 'Risk Center', icon: ShieldCheck },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { to: '/data', label: 'Data Center', icon: Database },
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Five destinations pinned to the mobile bottom bar (last opens the sheet). */
export const MOBILE_PRIMARY: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, shortLabel: 'Home' },
  { to: '/scanner', label: 'Scanner', icon: Radar, shortLabel: 'Scanner' },
  { to: '/charts', label: 'Charts', icon: LineChart, shortLabel: 'Charts' },
  { to: '/reports', label: 'Reports', icon: ScrollText, shortLabel: 'Reports' },
];

export const MOBILE_MORE_PATHS = NAV_GROUPS.flatMap((g) => g.items).filter(
  (i) => !MOBILE_PRIMARY.some((m) => m.to === i.to),
);

export const QUICK_LINKS: NavItem[] = [
  { to: '/intelligence', label: 'Intelligence', icon: Sparkles },
  { to: '/strategy-lab', label: 'Strategy Lab', icon: Beaker },
  { to: '/backtesting', label: 'Backtesting', icon: FlaskConical },
  { to: '/risk', label: 'Risk', icon: ShieldCheck },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/notifications', label: 'Alerts', icon: AlertTriangle },
];
