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
  firstName: string;
  lastInitial: string;
  isLogin: boolean;
  authError: string;
  onSubmit: (e: React.FormEvent) => void;
  setAuthEmail: (v: string) => void;
  setAuthPassword: (v: string) => void;
  setFirstName: (v: string) => void;
  setLastInitial: (v: string) => void;
  toggleMode: () => void;
}

export default function AuthForm({
  authEmail,
  authPassword,
  firstName,
  lastInitial,
  isLogin,
  authError,
  onSubmit,
  setAuthEmail,
  setAuthPassword,
  setFirstName,
  setLastInitial,
  toggleMode,
}: AuthFormProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex justify-center items-center p-4">
      <div className="w-full max-w-md bg-white p-6 rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
          {isLogin ? 'Log in to Trip Cost' : 'Create Account'}
        </h2>

        {authError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
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
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            required
          />

          {!isLogin && (
            <div className="flex gap-3">
              <Input
                label="First Name"
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full"
                wrapperClassName="flex-1"
                required
              />
              <Input
                label="Initial"
                type="text"
                autoComplete="family-name"
                value={lastInitial}
                onChange={(e) => setLastInitial(e.target.value.slice(0, 1))}
                className="w-full"
                wrapperClassName="w-24"
                maxLength={1}
                required
              />
            </div>
          )}

          <Button type="submit" className="w-full">
            {isLogin ? 'Log In' : 'Sign Up'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-700">
          {isLogin ? (
            <>
              Don&apos;t have an account?{' '}
              <Button
                onClick={toggleMode}
                variant="ghost"
                size="sm"
                className="text-purple-600 hover:underline p-0 h-auto"
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
                className="text-purple-600 hover:underline p-0 h-auto"
              >
                Log in
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

