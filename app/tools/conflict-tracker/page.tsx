'use client';

import { useCallback, useState } from 'react';
import { BarChart2, ChevronDown, Plus, X } from 'lucide-react';
import Nav from '@/components/Nav';
import Button from '@/components/Button';
import Input from '@/components/Input';
import AuthForm from '../trip-cost/components/AuthForm';
import { ADMIN_EMAIL } from '../trip-cost/firebaseConfig';
import { ConflictProvider, useConflict } from './ConflictContext';
import ConflictList from './components/ConflictList';
import ConflictDetail from './components/ConflictDetail';
import ConflictForm from './components/ConflictForm';
import TrendDashboard from './components/TrendDashboard';
import { auth } from './lib/firebase';
import { serverTimestamp, setDoc } from 'firebase/firestore';
import { userDoc } from '../trip-cost/db';

// ── Tracker creation modal ───────────────────────────────────────────────────

interface TrackerModalProps {
  onClose: () => void;
}

const TrackerModal = ({ onClose }: TrackerModalProps) => {
  const { createNewTracker, knownUsers, user } = useConflict();
  const [name, setName] = useState('');
  const [personAName, setPersonAName] = useState(
    user?.displayName ?? user?.email?.split('@')[0] ?? 'Person A',
  );
  const [personBName, setPersonBName] = useState('Person B');
  const [personBEmail, setPersonBEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Give your tracker a name.'); return; }
    setSaving(true);
    setError('');
    try {
      await createNewTracker({
        name: name.trim(),
        personAName: personAName.trim() || 'Person A',
        personBEmail: personBEmail.trim() || null,
        personBName: personBName.trim() || 'Person B',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create tracker.');
      setSaving(false);
    }
  };

  // If we know the partner's email, prefill their name from known users
  const matchedUser = knownUsers.find((u) => u.email === personBEmail.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <h2 className="text-lg font-semibold">New tracker</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-2 hover:text-text focus-ring rounded"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-5">
          <p className="text-sm text-text-2">
            A tracker groups all conflicts between two people and surfaces trends over time.
          </p>

          {error && (
            <p className="text-sm text-error bg-error/10 border border-error/20 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          <Input
            label={'Tracker name (e.g. “Us”)'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Us"
            required
          />

          <Input
            label="Your name (Person A)"
            value={personAName}
            onChange={(e) => setPersonAName(e.target.value)}
            placeholder="Your name"
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">
              Partner&apos;s email <span className="text-text-3 font-normal">(optional — lets them join)</span>
            </label>
            {knownUsers.length > 0 ? (
              <select
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus-ring"
                value={personBEmail}
                onChange={(e) => {
                  setPersonBEmail(e.target.value);
                  const found = knownUsers.find((u) => u.email === e.target.value);
                  if (found) setPersonBName(found.displayName);
                }}
              >
                <option value="">— type email below or pick a known user —</option>
                {knownUsers
                  .filter((u) => u.uid !== user?.uid)
                  .map((u) => (
                    <option key={u.uid} value={u.email}>
                      {u.displayName} ({u.email})
                    </option>
                  ))}
              </select>
            ) : (
              <input
                type="email"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring"
                placeholder="partner@example.com"
                value={personBEmail}
                onChange={(e) => setPersonBEmail(e.target.value)}
              />
            )}
            {matchedUser && (
              <p className="text-xs text-green-400">Found: {matchedUser.displayName}</p>
            )}
          </div>

          <Input
            label="Partner's display name (Person B)"
            value={personBName}
            onChange={(e) => setPersonBName(e.target.value)}
            placeholder="Person B"
          />

          <div className="flex gap-3 justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create tracker'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Person B claim banner ────────────────────────────────────────────────────

const ClaimBanner = ({ trackerId, email }: { trackerId: string; email: string | null }) => {
  const { claimSide } = useConflict();
  const [claiming, setClaiming] = useState(false);

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/10 p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-text">You were invited to this tracker{email ? ` (${email})` : ''}.</p>
        <p className="text-xs text-text-2 mt-0.5">Claim the Person B role to start adding reflections.</p>
      </div>
      <Button
        variant="primary"
        disabled={claiming}
        onClick={async () => {
          setClaiming(true);
          await claimSide(trackerId);
        }}
      >
        {claiming ? 'Claiming…' : 'Claim my role'}
      </Button>
    </div>
  );
};

// ── Main shell ───────────────────────────────────────────────────────────────

type ShellView = 'list' | 'new-conflict' | 'detail' | 'trends';

const ConflictTrackerShell = () => {
  const {
    user,
    authLoading,
    isAdmin,
    trackers,
    activeTracker,
    conflicts,
    activeConflict,
    reflections,
    conflictsLoading,
    selectTracker,
    selectConflict,
    addConflict,
    addTrackerCustomTag,
    signIn,
    signUp,
    signOut,
  } = useConflict();

  const [showAuth, setShowAuth] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [authError, setAuthError] = useState('');

  const [view, setView] = useState<ShellView>('list');
  const [showTrackerModal, setShowTrackerModal] = useState(false);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signIn(authEmail, authPassword);
      } else {
        await signUp(authEmail, authPassword, `${firstName} ${lastInitial}`.trim());
        if (auth.currentUser) {
          await setDoc(
            userDoc(auth.currentUser.uid),
            {
              uid: auth.currentUser.uid,
              email: authEmail,
              displayName: `${firstName} ${lastInitial}`.trim(),
              firstName,
              lastInitial,
              isAdmin: authEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }
      setShowAuth(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  const handleSignOut = useCallback(async () => {
    await signOut();
    setView('list');
  }, [signOut]);

  const handleSelectConflict = useCallback((id: string) => {
    selectConflict(id);
    setView('detail');
  }, [selectConflict]);

  const handleNewConflict = useCallback(() => {
    setView('new-conflict');
  }, []);

  const handleBack = useCallback(() => {
    selectConflict(null);
    setView('list');
  }, [selectConflict]);

  // Determine if this user can claim Person B on the active tracker
  const activePBUnclaimed =
    activeTracker &&
    !activeTracker.personBUid &&
    activeTracker.personAUid !== user?.uid &&
    (activeTracker.personBEmail
      ? activeTracker.personBEmail.toLowerCase() === (user?.email ?? '').toLowerCase()
      : true);

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

  if (!user || showAuth) {
    return (
      <AuthForm
        isLogin={isLogin}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        firstName={firstName}
        setFirstName={setFirstName}
        lastInitial={lastInitial}
        setLastInitial={setLastInitial}
        authError={authError}
        onSubmit={handleAuthSubmit}
        toggleMode={() => { setIsLogin((p) => !p); setAuthError(''); }}
      />
    );
  }

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="container-tight py-16 sm:py-24 space-y-10">
        {/* Page header */}
        <header className="space-y-3">
          <h1 className="text-4xl sm:text-5xl font-semibold bg-gradient-to-r from-accent to-purple text-transparent bg-clip-text">
            Conflict Tracker
          </h1>
          <p className="max-w-2xl text-lg text-text-2">
            A private place to reflect after conflict, preserve what happened, track what each person
            is owning, and notice patterns over time.
          </p>
        </header>

        {/* Tracker selector + sign-out toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1/80 p-4 shadow-md">
          {trackers.length > 0 && (
            <div className="relative flex items-center gap-2">
              <select
                className="appearance-none rounded-lg border border-border bg-surface-2 pl-3 pr-8 py-2 text-sm text-text focus-ring"
                value={activeTracker?.id ?? ''}
                onChange={(e) => {
                  selectTracker(e.target.value || null);
                  setView('list');
                }}
              >
                <option value="">— select tracker —</option>
                {trackers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2 text-text-3" />
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => setShowTrackerModal(true)}
            className="inline-flex items-center gap-2"
          >
            <Plus size={14} />
            New tracker
          </Button>
          {activeTracker && (
            <div className="flex gap-2 ml-auto">
              <Button
                variant={view === 'trends' ? 'primary' : 'ghost'}
                onClick={() => setView(view === 'trends' ? 'list' : 'trends')}
                className="inline-flex items-center gap-2"
              >
                <BarChart2 size={14} />
                Trends
              </Button>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => setShowAuth(true)}>Account</Button>
            <Button variant="ghost" onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>

        {/* Person B claim banner */}
        {activePBUnclaimed && activeTracker && (
          <ClaimBanner trackerId={activeTracker.id} email={activeTracker.personBEmail} />
        )}

        {/* No tracker selected */}
        {!activeTracker && (
          <div className="rounded-xl border border-border bg-surface-1 p-10 text-center space-y-4">
            <p className="text-text-2">
              {trackers.length === 0
                ? 'Create a tracker to start logging conflicts between two people.'
                : 'Select a tracker above to view its conflicts and trends.'}
            </p>
            <Button variant="primary" onClick={() => setShowTrackerModal(true)} className="inline-flex items-center gap-2">
              <Plus size={16} />
              New tracker
            </Button>
          </div>
        )}

        {/* Main content */}
        {activeTracker && view === 'trends' && (
          <TrendDashboard
            conflicts={conflicts}
            reflections={reflections}
            tracker={activeTracker}
          />
        )}

        {activeTracker && view === 'list' && (
          <ConflictList
            conflicts={conflicts}
            tracker={activeTracker}
            loading={conflictsLoading}
            onSelect={handleSelectConflict}
            onNew={handleNewConflict}
          />
        )}

        {activeTracker && view === 'new-conflict' && (
          <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
            <ConflictForm
              tracker={activeTracker}
              onSubmit={async (data) => {
                const id = await addConflict(data);
                // persist any new custom tags to the tracker
                for (const tag of data.tags) {
                  await addTrackerCustomTag(tag).catch(() => { /* non-critical */ });
                }
                selectConflict(id);
                setView('detail');
              }}
              onCancel={() => setView('list')}
            />
          </div>
        )}

        {activeTracker && view === 'detail' && activeConflict && user && (
          <div className="rounded-xl border border-border bg-surface-1 p-6 sm:p-8">
            <ConflictDetail
              conflict={activeConflict}
              tracker={activeTracker}
              reflections={reflections}
              authorUid={user.uid}
              isAdmin={isAdmin}
              onBack={handleBack}
            />
          </div>
        )}

        {activeTracker && view === 'detail' && !activeConflict && (
          <div className="rounded-xl border border-border bg-surface-1 p-6 text-center">
            <p className="text-text-2">Conflict not found.</p>
            <Button variant="ghost" onClick={handleBack} className="mt-4">Back to list</Button>
          </div>
        )}
      </section>

      {showTrackerModal && <TrackerModal onClose={() => setShowTrackerModal(false)} />}
    </main>
  );
};

export default function ConflictTrackerPage() {
  return (
    <ConflictProvider>
      <ConflictTrackerShell />
    </ConflictProvider>
  );
}
