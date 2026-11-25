import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { NAV_GROUPS } from './nav';
import { Logo } from './Logo';
import { X, Menu } from 'lucide-react';

export interface DesktopSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const SIDEBARcollapsedClass = 'hidden';
const SIDEBARexpandedClass = 'w-[236px] lg:flex';

export function DesktopSidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const sidebarClass = collapsed ? SIDEBARcollapsedClass : SIDEBARexpandedClass;

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 transform transition-transform duration-300 ease-out',
        sidebarClass,
        'flex-col border-r border-line bg-panel lg:flex',
      )}
      aria-label="Primary navigation"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label="Toggle sidebar"
        className="hidden lg:block lg:ml-4 p-1 rounded-md hover:bg-panel/20"
      >
        {collapsed ? <Menu size={18} aria-hidden /> : <X size={18} aria-hidden />}
      </button>
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
                    className={cn(
                      'group flex items-center gap-2.5 rounded-[4px] px-2 py-[7px] text-[12.5px]',
                      'transition-[background-color,color,scale] duration-150 ease-out',
                      'motion-safe:active:scale-[0.98]',
                      'bg-gold/10',
                      'text-gold-2',
                      'text-mut hover:bg-[#1a2029] hover:text-fg',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          size={15}
                          className={cn('shrink-0', isActive ? 'text-gold' : 'text-mut', 'group-hover:text-fg')}
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
    </aside>
  );
}