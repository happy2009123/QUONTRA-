import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Button, Input, SegmentedControl } from '@/components/ui';
import { Logo } from '@/components/layout/Logo';
import { useAuth } from '@/state/AuthContext';

type Mode = 'signin' | 'signup';

export default function Login() {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or just signed in) — leave the login screen.
  useEffect(() => {
    if (!loading && user) navigate(from, { replace: true });
  }, [loading, user, from, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') {
        await login(email, password);
      } else {
        await register(email, password, displayName.trim() || undefined);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed — please try again');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo />
          <p className="text-[12px] leading-relaxed text-mut">
            Institutional research terminal — paper trading only
          </p>
        </div>

        <div className="rounded-[6px] border border-line bg-card p-5 sm:p-6">
          <SegmentedControl
            label="Authentication mode"
            className="mb-5 w-full"
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'signup', label: 'Create account' },
            ]}
            value={mode}
            onChange={switchMode}
          />

          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              icon={<Mail size={14} aria-hidden />}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <Input
              label="Password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signup' ? 8 : undefined}
              icon={<KeyRound size={14} aria-hidden />}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            {mode === 'signup' && (
              <Input
                label="Display name (optional)"
                autoComplete="name"
                maxLength={60}
                icon={<UserRound size={14} aria-hidden />}
                placeholder="How should we address you?"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={busy}
              />
            )}

            {error && (
              <p role="alert" className="rounded-[4px] border border-neg/40 bg-neg/10 px-3 py-2 text-[12px] text-neg">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" block loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account & sign in'}
            </Button>
          </form>

          <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-mut-2">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
            Demonstration platform: no broker connections, no live orders. Accounts live in the
            workspace database and reset with it.
          </p>
        </div>
      </div>
    </div>
  );
}
