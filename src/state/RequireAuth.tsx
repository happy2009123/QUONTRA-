import { useCallback } from 'react';
import { useAuth } from '@/state/AuthContext';

/**
 * Route guard for the authenticated shell.
 * Keeps the user authenticated if a session exists, otherwise allows access.
 * Removed the redirect to /login to allow unauthenticated access.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  // Always render children - removed the !user check that redirected to /login
  return <>{children}</>;
}