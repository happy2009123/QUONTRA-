import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { NAV_GROUPS } from './nav';
import { Logo } from './Logo';
import { Badge } from '@/components/ui/Badge';

export function DesktopSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r border-line bg-panel lg:flex">
      <div className="flex h-14 items-center border-b border-line px-4">
        <Logo />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="mb-4 last:mb-0">
            <p className="px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-mut-2">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-center gap-2.5 rounded-[4px] px-2 py-[7px] text-[12.5px] transition-colors',
                        isActive
                          ? 'bg-gold/10 font-medium text-gold-2'
                          : 'text-mut hover:bg-[#1a2029] hover:text-fg',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          size={15}
                          className={cn('shrink-0', isActive ? 'text-gold' : 'text-mut group-hover:text-fg')}
                          aria-hidden
                        />
                        <span className="truncate">{item.label}</span>
                        {isActive && <span className="ml-auto h-1 w-1 rounded-full bg-gold" aria-hidden />}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <div className="rounded-[4px] border border-gold/25 bg-gold/[0.05] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gold-2">Demonstration build</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-mut">
            All prices and signals are generated demo data. No broker or live market connection.
          </p>
          <div className="mt-2">
            <Badge tone="gold" dot>
              Demo data only
            </Badge>
          </div>
        </div>
      </div>
    </aside>
  );
}
