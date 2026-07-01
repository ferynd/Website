'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { Settings } from 'lucide-react';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import AuthForm from '../trip-cost/components/AuthForm';
import { auth, isAllowedUser } from './lib/firebase';
import { DEFAULT_CONTEXT_NOTES, DEFAULT_SPEAKER_NAMES } from './lib/constants';
import { useTranscriberPipeline } from './useTranscriberPipeline';
import UploadPanel from './components/UploadPanel';
import PipelineStatusView from './components/PipelineStatusView';
import TranscriptOutput from './components/TranscriptOutput';
import SettingsModal from './components/SettingsModal';

function TranscriberShell() {
  const { state, run, reset } = useTranscriberPipeline();
  const isRunning = !['idle', 'complete', 'failed'].includes(state.status);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-12 sm:py-20 space-y-8">
        <header className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">
              Transcriber
            </h1>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(true)}
                className="inline-flex items-center gap-2"
              >
                <Settings size={16} />
                Settings
              </Button>
              <Button variant="ghost" size="sm" onClick={() => signOut(auth)}>
                Sign out
              </Button>
            </div>
          </div>
          <p className="max-w-2xl text-lg text-text-2">
            Upload a long recording and get a cleaned, speaker-labeled, timestamped transcript.
          </p>
        </header>

        <UploadPanel
          disabled={isRunning}
          onRun={run}
          defaultSpeakerNames={DEFAULT_SPEAKER_NAMES}
          defaultContextNotes={DEFAULT_CONTEXT_NOTES}
        />

        {state.status !== 'idle' && <PipelineStatusView state={state} />}

        {state.status === 'complete' && <TranscriptOutput state={state} onReset={reset} />}
      </section>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </main>
  );
}

function RestrictedNotice() {
  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-24 text-center space-y-4">
        <h1 className="text-3xl font-semibold">Transcriber</h1>
        <p className="text-text-2">This tool is private and restricted to the site owner.</p>
        <Button variant="ghost" onClick={() => signOut(auth)}>
          Sign out
        </Button>
      </section>
    </main>
  );
}

export default function TranscriberPage() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(!auth.currentUser);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Login only — this is a private, single-user tool. Account creation is
  // intentionally not exposed here so other Firebase users on this shared
  // project aren't invited to sign up just to be blocked by isAllowedUser.
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  if (authLoading) {
    return (
      <main className="bg-bg text-text min-h-dvh">
        <Nav />
        <section className="container-tight py-16 sm:py-24">
          <p className="text-center text-text-2">Checking authentication…</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthForm
        isLogin
        allowSignUp={false}
        title="Transcriber"
        subtitle="Private tool — sign in with the site owner's account to continue."
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authError={authError}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  // Client-side gating is convenience only — every API route independently
  // re-verifies the Firebase ID token and email server-side.
  if (!isAllowedUser(user)) {
    return <RestrictedNotice />;
  }

  return <TranscriberShell />;
}
