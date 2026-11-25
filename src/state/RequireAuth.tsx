import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/state/AuthContext';
import { Skeleton } from '@/components/ui';

/**
 * Route guard for the authenticated shell: restores the session first,
 * then either renders the app or redirects to /login.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink" role="status" aria-label="Restoring session">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-9 w-56" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
