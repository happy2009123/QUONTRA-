import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Settings as SettingsIcon, User } from 'lucide-react';
import { marketStatusFor } from '@/data/universe';
import { formatClock, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useNotifications } from '@/state/NotificationsContext';
import { ConnectionStatusDot } from '@/components/ui/StatusIndicator';
import { Dropdown, DropdownItem, DropdownLabel } from '@/components/ui/Dropdown';
import { Logo } from './Logo';

const MARKET_GROUPS = [
  { label: 'India', market: 'INDIAN_EQUITIES' as const },
  { label: 'US', market: 'INTERNATIONAL_EQUITIES' as const },
  { label: 'FX', market: 'OTHER' as const },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function TopBar() {
  const now = useClock();
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-panel/95 backdrop-blur">
      <div className="flex h-full items-center gap-3 px-3 sm:px-4 lg:px-5">
        {/* Mobile brand */}
        <Link to="/" className="flex items-center lg:hidden" aria-label="QUANTORA home">
          <Logo size="sm" />
        </Link>

        {/* Desktop market status strip */}
        <div className="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mut-2">Markets</span>
          <div className="flex items-center gap-3">
            {MARKET_GROUPS.map((g) => {
              const status = marketStatusFor(g.market, now);
              return (
                <span key={g.label} className="flex items-center gap-1.5 text-[11.5px]">
                  <span className="text-mut">{g.label}</span>
                  <span
                    className={cn(
                      'rounded-[3px] border px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[0.07em]',
                      status === 'OPEN'
                        ? 'border-pos/40 bg-pos/10 text-pos'
                        : status === 'PRE_OPEN'
                          ? 'border-warn/40 bg-warn/10 text-warn'
                          : 'border-line bg-[#1a2029] text-mut',
                    )}
                  >
                    {status === 'AFTER_HOURS' ? 'After hrs' : status}
                  </span>
                </span>
              );
            })}
          </div>
          <span className="h-4 w-px bg-line" aria-hidden />
          <ConnectionStatusDot status="DEMO DATA" />
          <span className="text-[10px] uppercase tracking-[0.08em] text-mut-2">Feed</span>
        </div>

        {/* Mobile connection chip */}
        <div className="flex-1 lg:hidden">
          <ConnectionStatusDot status="DEMO DATA" />
        </div>

        {/* Clock */}
        <div className="hidden text-right sm:block">
          <p className="num text-[12.5px] font-medium leading-tight text-fg">{formatClock(now)} IST</p>
          <p className="text-[10px] leading-tight text-mut">{formatDate(now.toISOString())}</p>
        </div>

        {/* Notifications */}
        <Link
          to="/notifications"
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          className="relative rounded-[4px] border border-line bg-card p-1.5 text-mut transition-colors hover:text-fg"
        >
          <Bell size={15} aria-hidden />
          {unreadCount > 0 && (
            <span className="num absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#141005]">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Profile */}
        <Dropdown
          label="Account"
          trigger={(props) => (
            <button
              type="button"
              {...props}
              className="flex items-center gap-2 rounded-[4px] border border-line bg-card py-1 pl-1 pr-1.5 transition-colors hover:border-[#333c49]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-gold/15 text-[10.5px] font-bold text-gold-2">
                RD
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-[12px] font-medium text-fg">Research Desk</span>
                <span className="block text-[9.5px] uppercase tracking-[0.08em] text-mut-2">Demo session</span>
              </span>
              <ChevronDown size={13} className="text-mut" aria-hidden />
            </button>
          )}
        >
          <DropdownLabel>Signed in (demo)</DropdownLabel>
          <div className="border-b border-line px-2.5 pb-2 pt-1">
            <p className="text-[12.5px] font-medium text-fg">Research Desk</p>
            <p className="text-[11px] text-mut">desk@quantora.demo</p>
          </div>
          <DropdownItem onClick={() => navigate('/settings')}>
            <SettingsIcon size={14} aria-hidden /> Settings
          </DropdownItem>
          <DropdownItem onClick={() => navigate('/settings')}>
            <User size={14} aria-hidden /> Profile
          </DropdownItem>
          <DropdownItem disabled>
            <LogOut size={14} aria-hidden /> Sign out unavailable in demo
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
