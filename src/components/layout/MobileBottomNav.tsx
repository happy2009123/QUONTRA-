import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MOBILE_MORE_PATHS, MOBILE_PRIMARY, NAV_GROUPS } from './nav';
import { useNotifications } from '@/state/NotificationsContext';
import { Logo } from './Logo';

export function MobileBottomNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { unreadCount } = useNotifications();
  const moreActive = MOBILE_MORE_PATHS.some((i) => i.to === pathname);

  return (
    <>
      <nav
        aria-label="Primary mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/97 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid h-[60px] grid-cols-5">
          {MOBILE_PRIMARY.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-1 text-[9.5px] font-medium transition-colors',
                    isActive ? 'text-gold-2' : 'text-mut',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={17} aria-hidden className={isActive ? 'text-gold' : ''} />
                    <span>{item.shortLabel ?? item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-label="More navigation"
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 text-[9.5px] font-medium transition-colors',
                moreActive ? 'text-gold-2' : 'text-mut',
              )}
            >
              <Menu size={17} aria-hidden />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="All sections">
          <div className="absolute inset-0 bg-black/65" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-lg border-t border-line bg-card pb-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-card px-4 py-3">
              <Logo size="sm" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded p-1.5 text-mut hover:bg-panel hover:text-fg"
              >
                <X size={17} aria-hidden />
              </button>
            </div>
            <div className="px-3 py-3">
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className="mb-3">
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-mut-2">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-3 rounded-[4px] px-2.5 py-2.5 text-[13.5px] transition-colors',
                              isActive ? 'bg-gold/10 font-medium text-gold-2' : 'text-mut hover:bg-panel hover:text-fg',
                            )
                          }
                        >
                          <item.icon size={16} aria-hidden />
                          <span>{item.label}</span>
                          {item.to === '/notifications' && unreadCount > 0 && (
                            <span className="num ml-auto rounded-full bg-gold px-1.5 text-[10px] font-bold text-[#141005]">
                              {unreadCount}
                            </span>
                          )}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
