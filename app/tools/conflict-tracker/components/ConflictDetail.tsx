"use client";

import { useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import ReflectionForm from './ReflectionForm';
import ReflectionView from './ReflectionView';
import SharedSection from './SharedSection';
import ResolutionPanel from './ResolutionPanel';
import ConflictForm from './ConflictForm';
import { useConflict } from '../ConflictContext';
import type { Conflict, Reflection, Tracker } from '../lib/types';

const SEVERITY_LABEL: Record<number, string> = {
  1: 'Very low', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Very high',
};

interface Props {
  conflict: Conflict;
  tracker: Tracker;
  reflections: Reflection[];
  authorUid: string;
  isAdmin: boolean;
  onBack: () => void;
}

export default function ConflictDetail({
  conflict,
  tracker,
  reflections,
  authorUid,
  isAdmin,
  onBack,
}: Props) {
  const {
    editConflict,
    removeConflict,
    updateShared,
    markResolved,
    saveDraft,
    submitReflectionFn,
    userSide,
  } = useConflict();

  const [view, setView] = useState<'detail' | 'edit-conflict' | 'reflect'>('detail');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  const isPersonA = tracker.personAUid === authorUid;
  const isPersonB = tracker.personBUid === authorUid;

  // Own reflection based on the derived side
  const myReflection = userSide === 'personA'
    ? reflections.find((r) => r.person === 'personA')
    : userSide === 'personB'
    ? reflections.find((r) => r.person === 'personB')
    : undefined;

  const reflectionA = reflections.find((r) => r.person === 'personA');
  const reflectionB = reflections.find((r) => r.person === 'personB');

  const myReflectionSubmitted = !!myReflection?.submittedAt;
  const bothSubmitted =
    conflict.hasReflectionA &&
    conflict.hasReflectionB &&
    !!reflectionA?.submittedAt &&
    !!reflectionB?.submittedAt;

  const canEditConflict = isPersonA || isAdmin;
  const canDelete = isPersonA || isAdmin;

  // Show the reflect CTA for anyone who has claimed a side, or anyone who could claim
  const canReflect = isPersonA || isPersonB || (!tracker.personBUid && !isAdmin);

  const handleDelete = async () => {
    setDeleting(true);
    await removeConflict(conflict.id);
    onBack();
  };

  if (view === 'edit-conflict') {
    return (
      <ConflictForm
        tracker={tracker}
        initial={conflict}
        onSubmit={async (data) => {
          await editConflict(conflict.id, data);
          setView('detail');
        }}
        onCancel={() => setView('detail')}
      />
    );
  }

  if (view === 'reflect') {
    // Extract only user-entered fields from an existing reflection (drop system fields)
    const existingInput = myReflection
      ? {
          trigger: myReflection.trigger,
          whatHappened: myReflection.whatHappened,
          whatIFelt: myReflection.whatIFelt,
          physicalOrEmotionalSignals: myReflection.physicalOrEmotionalSignals,
          whatIThoughtTheyMeant: myReflection.whatIThoughtTheyMeant,
          whatIFeltHurtBy: myReflection.whatIFeltHurtBy,
          whatINeeded: myReflection.whatINeeded,
          whatHelped: myReflection.whatHelped,
          whatMadeItWorse: myReflection.whatMadeItWorse,
          whatIAmOwning: myReflection.whatIAmOwning,
          whatIWillDoDifferently: myReflection.whatIWillDoDifferently,
          unresolvedPieces: myReflection.unresolvedPieces,
          tags: myReflection.tags,
          feelsResolved: myReflection.feelsResolved,
        }
      : undefined;

    return (
      <ReflectionForm
        tracker={tracker}
        authorUid={authorUid}
        existingInput={existingInput}
        isSubmitted={myReflectionSubmitted}
        userSide={userSide}
        onSaveDraft={async (input) => {
          await saveDraft(conflict.id, input);
          setView('detail');
        }}
        onSubmit={async (input) => {
          await submitReflectionFn(conflict.id, input);
          setView('detail');
        }}
        onCancel={() => setView('detail')}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-1 text-text-2 hover:text-text transition-colors focus-ring rounded"
          aria-label="Back to list"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-semibold text-text leading-tight">{conflict.title}</h2>
          <p className="text-sm text-text-3 mt-1">
            {conflict.date} &nbsp;·&nbsp; Severity: {SEVERITY_LABEL[conflict.severity]}
          </p>
        </div>
        {canEditConflict && (
          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              onClick={() => setView('edit-conflict')}
              className="inline-flex items-center gap-1.5"
            >
              <Pencil size={14} />
              Edit
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-error hover:text-error"
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="rounded-xl border border-error/40 bg-error/10 p-5 space-y-3">
          <p className="text-sm text-text">
            Delete this conflict and all reflections? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleDelete}
              disabled={deleting}
              className="bg-error hover:bg-error/80 border-error"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      )}

      {/* Tags + summary */}
      {conflict.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {conflict.tags.map((tag) => (
            <span key={tag} className="text-xs bg-surface-2 border border-border rounded-full px-2 py-0.5 text-text-2">
              {tag}
            </span>
          ))}
        </div>
      )}
      {conflict.summary && (
        <p className="text-sm text-text-2 rounded-lg bg-surface-1 border border-border p-4">
          {conflict.summary}
        </p>
      )}

      {/* Resolution */}
      <ResolutionPanel
        conflict={conflict}
        tracker={tracker}
        userSide={userSide}
        isAdmin={isAdmin}
        onToggle={(resolved) => markResolved(conflict.id, resolved)}
      />

      {/* Reflect CTA */}
      {canReflect && (
        <div className="rounded-xl border border-border bg-surface-1 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-text">
              {myReflectionSubmitted ? 'Your reflection' : myReflection ? 'Your draft' : 'Add your reflection'}
            </p>
            <p className="text-sm text-text-2 mt-0.5">
              {myReflectionSubmitted
                ? 'Submitted. You can update it by reflecting again.'
                : myReflection
                ? 'You have a saved draft. Continue writing when ready.'
                : 'Write privately. Only shared after your partner also submits.'}
            </p>
          </div>
          <Button
            variant={myReflectionSubmitted ? 'secondary' : 'primary'}
            onClick={() => setView('reflect')}
          >
            {myReflectionSubmitted ? 'View / update' : myReflection ? 'Continue' : 'Reflect'}
          </Button>
        </div>
      )}

      {/* Reflection status (Phase 1 — locked view) */}
      {!bothSubmitted && (
        <div className="rounded-xl border border-border bg-surface-1/60 p-5">
          <h3 className="font-medium text-text mb-3">Reflection status</h3>
          <div className="flex gap-4 text-sm">
            <span className={`rounded-full px-3 py-1 border text-xs ${
              conflict.hasReflectionA && reflectionA?.submittedAt
                ? 'bg-green-900/30 text-green-300 border-green-700/40'
                : 'bg-surface-2 text-text-3 border-border'
            }`}>
              {aName}{' '}
              {conflict.hasReflectionA && reflectionA?.submittedAt
                ? '✓ submitted'
                : conflict.hasReflectionA
                ? '◑ draft'
                : '○ not started'}
            </span>
            <span className={`rounded-full px-3 py-1 border text-xs ${
              conflict.hasReflectionB && reflectionB?.submittedAt
                ? 'bg-green-900/30 text-green-300 border-green-700/40'
                : 'bg-surface-2 text-text-3 border-border'
            }`}>
              {bName}{' '}
              {conflict.hasReflectionB && reflectionB?.submittedAt
                ? '✓ submitted'
                : conflict.hasReflectionB
                ? '◑ draft'
                : '○ not started'}
            </span>
          </div>
          <p className="text-xs text-text-3 mt-3">
            Reflections are hidden until both sides submit. Each person sees only their own draft.
          </p>
        </div>
      )}

      {/* Phase 2: both submitted — side-by-side + interpretation comparison */}
      {bothSubmitted && reflectionA && reflectionB && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-3 uppercase tracking-widest">Both reflections</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface-1 p-5">
              <ReflectionView reflection={reflectionA} name={aName} />
            </div>
            <div className="rounded-xl border border-border bg-surface-1 p-5">
              <ReflectionView reflection={reflectionB} name={bName} />
            </div>
          </div>

          {(reflectionA.whatIThoughtTheyMeant || reflectionB.whatIThoughtTheyMeant) && (
            <div className="rounded-xl border border-border bg-surface-2/50 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-text">What each thought the other meant</h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-text-3 mb-1">{aName} thought:</p>
                  <p className="text-text">{reflectionA.whatIThoughtTheyMeant}</p>
                </div>
                <div>
                  <p className="text-xs text-text-3 mb-1">{bName} thought:</p>
                  <p className="text-text">{reflectionB.whatIThoughtTheyMeant}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Shared section */}
      <SharedSection
        conflict={conflict}
        tracker={tracker}
        authorUid={authorUid}
        isAdmin={isAdmin}
        onSave={(patch) => updateShared(conflict.id, patch)}
      />
    </div>
  );
}
