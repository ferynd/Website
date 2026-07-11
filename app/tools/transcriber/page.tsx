'use client';

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { Settings } from 'lucide-react';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import AuthForm from '../trip-cost/components/AuthForm';
import { auth, isAllowedUser } from './lib/firebase';
import { DEFAULT_CONTEXT_NOTES } from './lib/constants';
import { readTranscriberSettings, saveTranscriberSettings, type TranscriberSettings } from './lib/settings';
import { useSpeakerProfiles } from './useSpeakerProfiles';
import { useTranscriberPipeline } from './useTranscriberPipeline';
import UploadPanel from './components/UploadPanel';
import PipelineStatusView from './components/PipelineStatusView';
import TranscriptOutput from './components/TranscriptOutput';
import ErrorRecoveryPanel from './components/ErrorRecoveryPanel';
import SettingsModal from './components/SettingsModal';
import RequirementsPanel from './components/RequirementsPanel';
import SpeakerProfilesPanel from './components/SpeakerProfilesPanel';

function TranscriberShell({ user }: { user: User }) {
  const { state, run, retryWith, resume, completeWithRawOnly, reclassify, reset } = useTranscriberPipeline();
  // Source of truth for speaker profile metadata + reference clips (Phase 4)
  // — SpeakerProfilesPanel renders it, and its speakerNames/speakerNotes/
  // getRunClips() feed every run below, replacing the old free-form
  // speaker-name inputs that used to live in UploadPanel.
  const sp = useSpeakerProfiles();
  const isRunning = !['idle', 'complete', 'failed'].includes(state.status);
  const [showSettings, setShowSettings] = useState(false);

  // Single source-of-truth settings copy for this page (per the Phase 3
  // plan — UploadPanel/ProviderPicker read/write through it via props,
  // rather than each owning a separate localStorage-synced copy). Lazy init
  // is SSR-safe: readTranscriberSettings() returns defaults when window is
  // undefined. SettingsModal still owns its own read/write cycle (unchanged
  // from Phase 1/2) — re-read here on close so this copy doesn't go stale
  // after an edit made there.
  const [settings, setSettings] = useState<TranscriberSettings>(() => readTranscriberSettings());

  const updateSettings = useCallback((patch: Partial<TranscriberSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveTranscriberSettings(next);
      return next;
    });
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setSettings(readTranscriberSettings());
  }, []);

  // UploadPanel only knows about the file/notes/mode toggles it renders
  // itself — speaker names, notes, and reference clips come from the
  // SpeakerProfilesPanel/useSpeakerProfiles source of truth above. Clip
  // resolution is async (IndexedDB), so it's handed to the pipeline hook as
  // a lazy getSpeakerClips() rather than resolved eagerly here — the hook
  // only calls it when the active provider/settings combination needs it,
  // and degrades gracefully (warning + debug event) if it rejects.
  const handleRun = useCallback(
    (opts: { file: File; contextNotes: string; strictMode: boolean; skipCleanup: boolean }) => {
      run({
        ...opts,
        speakerNames: sp.speakerNames,
        speakerNotes: sp.speakerNotes,
        getSpeakerClips: sp.getRunClips,
      });
    },
    [run, sp.speakerNames, sp.speakerNotes, sp.getRunClips],
  );

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

        <RequirementsPanel user={user} settings={settings} />

        <SpeakerProfilesPanel sp={sp} disabled={isRunning} />

        <UploadPanel
          disabled={isRunning}
          onRun={handleRun}
          settings={settings}
          onSettingsChange={updateSettings}
          defaultContextNotes={DEFAULT_CONTEXT_NOTES}
        />

        {state.status !== 'idle' && <PipelineStatusView state={state} />}

        {state.status === 'failed' && state.recovery && (
          <ErrorRecoveryPanel
            recovery={state.recovery}
            rawText={state.rawText}
            onRetry={retryWith}
            onResume={resume}
            onOpenSettings={() => setShowSettings(true)}
            onCompleteWithRawOnly={completeWithRawOnly}
          />
        )}

        {state.status === 'complete' && <TranscriptOutput state={state} onReset={reset} onReclassify={reclassify} />}
      </section>

      {showSettings && <SettingsModal onClose={closeSettings} />}
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

  return <TranscriberShell user={user} />;
}
