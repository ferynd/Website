'use client';

import { useState, type ReactNode } from 'react';
import { Tv } from 'lucide-react';
import { useShows } from '../ShowsContext';
import BottomNav from './BottomNav';

function AuthForm() {
  const { signIn, signUp } = useShows();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        if (!displayName.trim()) { setError('Display name is required.'); return; }
        await signUp(email, password, displayName.trim());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(
        msg.includes('wrong-password') || msg.includes('invalid-credential')
          ? 'Incorrect email or password.'
          : msg.includes('email-already-in-use')
          ? 'An account with this email already exists.'
          : msg.includes('weak-password')
          ? 'Password must be at least 6 characters.'
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/15 border border-accent/20">
            <Tv size={28} className="text-accent" />
          </div>
          <h1 className="text-2xl font-semibold">Show Tracker</h1>
          <p className="text-sm text-text-2">Sign in to see your watchlists</p>
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl border border-border bg-surface-2 p-1">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                mode === m ? 'bg-surface-1 text-text shadow-sm' : 'text-text-2 hover:text-text'
              }`}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <p className="rounded-lg bg-error/15 border border-error/30 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          {mode === 'signup' && (
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name (e.g. Jimi)"
              className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[48px]"
              required
            />
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[48px]"
            required
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[48px]"
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-50 transition-opacity min-h-[48px]"
          >
            {loading ? 'Loading…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ShowsAuthGate({ children }: { children: ReactNode }) {
  const { user, authLoading } = useShows();

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return <AuthForm />;

  return (
    <>
      <div className="min-h-dvh pb-16">{children}</div>
      <BottomNav />
    </>
  );
}
