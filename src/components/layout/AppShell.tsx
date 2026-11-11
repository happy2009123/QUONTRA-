import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { DesktopSidebar } from './DesktopSidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';

export function AppShell() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-gold focus:px-3 focus:py-2 focus:text-[#141005]"
      >
        Skip to content
      </a>
      <DesktopSidebar />
      <div className="lg:pl-[236px]">
        <TopBar />
        <main
          id="main-content"
          className="mx-auto min-h-[calc(100vh-56px)] w-full max-w-[1680px] px-3 pb-24 pt-4 sm:px-4 lg:px-6 lg:pb-8"
        >
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
      <ScrollRestoration />
    </div>
  );
}
