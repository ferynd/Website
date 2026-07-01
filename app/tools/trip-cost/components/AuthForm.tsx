'use client';

import React from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';

// ===============================
// CONFIGURATION (manual inputs)
// ===============================
// none for this component

interface AuthFormProps {
  authEmail: string;
  authPassword: string;
  firstName?: string;
  lastInitial?: string;
  isLogin: boolean;
  authError: string;
  onSubmit: (e: React.FormEvent) => void;
  setAuthEmail: (v: string) => void;
  setAuthPassword: (v: string) => void;
  setFirstName?: (v: string) => void;
  setLastInitial?: (v: string) => void;
  /** Only needed when allowSignUp is true — there's no mode to toggle otherwise. */
  toggleMode?: () => void;
  /** Overrides the heading. Defaults preserve the original "Log in to Trip Cost" / "Create Account" wording for existing callers. */
  title?: string;
  /** Optional line under the heading. */
  subtitle?: string;
  /** When false, hides the sign-up toggle and name fields entirely (login only). Defaults to true so existing callers are unaffected. */
  allowSignUp?: boolean;
}

export default function AuthForm({
  authEmail,
  authPassword,
  firstName = '',
  lastInitial = '',
  isLogin,
  authError,
  onSubmit,
  setAuthEmail,
  setAuthPassword,
  setFirstName,
  setLastInitial,
  toggleMode,
  title,
  subtitle,
  allowSignUp = true,
}: AuthFormProps) {
  // Login-only callers can never be in sign-up mode, even if isLogin were passed incorrectly.
  const effectiveIsLogin = allowSignUp ? isLogin : true;
  const heading = title ?? (effectiveIsLogin ? 'Log in to Trip Cost' : 'Create Account');

  return (
    <div className="min-h-screen bg-surface-2 flex justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface-1 p-6 rounded-lg shadow-lg">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-text">{heading}</h2>
          {subtitle && <p className="mt-2 text-sm text-text-2">{subtitle}</p>}
        </div>

        {authError && (
          <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded mb-4">
            {authError}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            required
          />

          <Input
            label="Password"
            type="password"
            autoComplete={effectiveIsLogin ? 'current-password' : 'new-password'}
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            required
          />

          {allowSignUp && !effectiveIsLogin && (
            <div className="flex gap-3">
              <Input
                label="First Name"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName?.(e.target.value)}
                className="w-full"
                wrapperClassName="flex-1"
                required
              />
              <Input
                label="Initial"
                type="text"
                autoComplete="family-name"
                value={lastInitial}
                onChange={(e) => setLastInitial?.(e.target.value.slice(0, 1))}
                className="w-full"
                wrapperClassName="w-24"
                maxLength={1}
                required
              />
            </div>
          )}

          <Button type="submit" className="w-full">
            {effectiveIsLogin ? 'Log In' : 'Sign Up'}
          </Button>
        </form>

        {allowSignUp && (
          <div className="mt-6 text-center text-sm text-text-2">
            {effectiveIsLogin ? (
              <>
                Don&apos;t have an account?{' '}
                <Button
                  onClick={toggleMode}
                  variant="ghost"
                  size="sm"
                  className="text-purple hover:underline p-0 h-auto"
                >
                  Sign up
                </Button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Button
                  onClick={toggleMode}
                  variant="ghost"
                  size="sm"
                  className="text-purple hover:underline p-0 h-auto"
                >
                  Log in
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

