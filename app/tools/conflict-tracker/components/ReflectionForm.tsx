"use client";

import { useState } from 'react';
import Button from '@/components/Button';
import { allTags, parseTags } from '../lib/tags';
import type { Reflection, Tracker } from '../lib/types';

type ReflectionDraft = Omit<Reflection, 'id' | 'conflictId' | 'submittedAt' | 'createdAt' | 'updatedAt'>;

const EMPTY_DRAFT: ReflectionDraft = {
  person: 'personA',
  authorUid: '',
  trigger: '',
  whatHappened: '',
  whatIFelt: '',
  physicalOrEmotionalSignals: '',
  whatIThoughtTheyMeant: '',
  whatIFeltHurtBy: '',
  whatINeeded: '',
  whatHelped: '',
  whatMadeItWorse: '',
  whatIAmOwning: '',
  whatIWillDoDifferently: '',
  unresolvedPieces: '',
  tags: [],
  feelsResolved: 'no',
};

interface Props {
  tracker: Tracker;
  authorUid: string;
  existingReflection?: Partial<Reflection>;
  isSubmitted: boolean;
  onSaveDraft: (side: 'personA' | 'personB', data: ReflectionDraft) => Promise<void>;
  onSubmit: (side: 'personA' | 'personB', data: ReflectionDraft) => Promise<void>;
  onCancel: () => void;
}

const TA = ({
  label,
  value,
  onChange,
  placeholder,
  required,
  optional,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  rows?: number;
}) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-text">
      {label}
      {optional && <span className="text-text-3 font-normal"> (optional)</span>}
      {required && <span className="text-error ml-1">*</span>}
    </label>
    <textarea
      required={required}
      rows={rows}
      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring resize-y"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default function ReflectionForm({
  tracker,
  authorUid,
  existingReflection,
  isSubmitted,
  onSaveDraft,
  onSubmit,
  onCancel,
}: Props) {
  const canClaimA = !tracker.personAUid || tracker.personAUid === authorUid;
  const canClaimB = !tracker.personBUid || tracker.personBUid === authorUid;

  // Determine which side this user is
  const defaultSide: 'personA' | 'personB' =
    tracker.personAUid === authorUid ? 'personA'
    : tracker.personBUid === authorUid ? 'personB'
    : canClaimA ? 'personA'
    : 'personB';

  const [side, setSide] = useState<'personA' | 'personB'>(
    existingReflection?.person ?? defaultSide,
  );
  const [draft, setDraft] = useState<ReflectionDraft>({
    ...EMPTY_DRAFT,
    ...existingReflection,
    person: existingReflection?.person ?? defaultSide,
    authorUid,
  });
  const [showOptional, setShowOptional] = useState(false);
  const [customTagInput, setCustomTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ReflectionDraft>(key: K, value: ReflectionDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';
  const sideName = side === 'personA' ? aName : bName;
  const available = allTags(tracker.customTags ?? []);

  const toggleTag = (tag: string) => {
    set('tags', draft.tags.includes(tag)
      ? draft.tags.filter((t) => t !== tag)
      : [...draft.tags, tag]);
  };

  const addCustomTags = () => {
    const parsed = parseTags(customTagInput);
    const next = [...draft.tags];
    for (const t of parsed) {
      if (!next.includes(t)) next.push(t);
    }
    set('tags', next);
    setCustomTagInput('');
  };

  const buildData = (): ReflectionDraft => ({
    ...draft,
    person: side,
    authorUid,
  });

  const handleSaveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await onSaveDraft(side, buildData());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save draft.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const required: (keyof ReflectionDraft)[] = [
      'whatHappened', 'whatIFelt', 'whatIThoughtTheyMeant',
      'whatINeeded', 'whatIAmOwning', 'whatIWillDoDifferently',
    ];
    for (const field of required) {
      if (!(draft[field] as string)?.trim()) {
        setError(`Please fill in all required fields.`);
        return;
      }
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(side, buildData());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit reflection.');
      setSubmitting(false);
    }
  };

  // Side claiming: only show picker if neither side is already claimed by this user
  const sideAlreadyClaimed = tracker.personAUid === authorUid || tracker.personBUid === authorUid;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Your reflection</h2>
        <p className="text-sm text-text-2">
          Write honestly. This stays private until your partner also submits.
        </p>
      </div>

      {isSubmitted && (
        <div className="rounded-lg bg-blue-900/30 border border-blue-700/40 text-blue-300 px-4 py-3 text-sm">
          You have already submitted this reflection. Editing and re-submitting will replace it.
        </div>
      )}

      {!sideAlreadyClaimed && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-text">I am</label>
          <div className="flex gap-3">
            {(canClaimA || side === 'personA') && (
              <button
                type="button"
                onClick={() => { setSide('personA'); set('person', 'personA'); }}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors focus-ring ${
                  side === 'personA'
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-border bg-surface-2 text-text-2 hover:border-accent/40'
                }`}
              >
                {aName}
              </button>
            )}
            {(canClaimB || side === 'personB') && (
              <button
                type="button"
                onClick={() => { setSide('personB'); set('person', 'personB'); }}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors focus-ring ${
                  side === 'personB'
                    ? 'border-accent bg-accent/20 text-accent'
                    : 'border-border bg-surface-2 text-text-2 hover:border-accent/40'
                }`}
              >
                {bName}
              </button>
            )}
          </div>
          <p className="text-xs text-text-3">
            Once you save, your UID is linked to this side for this tracker.
          </p>
        </div>
      )}

      {sideAlreadyClaimed && (
        <div className="rounded-lg bg-surface-2 border border-border px-4 py-3 text-sm text-text-2">
          Reflecting as <span className="font-medium text-text">{sideName}</span>
        </div>
      )}

      {error && (
        <p className="text-sm text-error bg-error/10 border border-error/20 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Required fields */}
      <div className="space-y-5">
        <TA
          label="What triggered this for you?"
          value={draft.trigger ?? ''}
          onChange={(v) => set('trigger', v)}
          placeholder="The moment it started — what happened or was said?"
          optional
        />
        <TA
          label="What happened, from your perspective?"
          value={draft.whatHappened}
          onChange={(v) => set('whatHappened', v)}
          placeholder="Describe the events as you experienced them."
          required
        />
        <TA
          label="What did you feel?"
          value={draft.whatIFelt}
          onChange={(v) => set('whatIFelt', v)}
          placeholder="Emotions, not judgments. (e.g. hurt, scared, dismissed, unseen)"
          required
        />
        <TA
          label="What did you think they meant?"
          value={draft.whatIThoughtTheyMeant}
          onChange={(v) => set('whatIThoughtTheyMeant', v)}
          placeholder="Your interpretation in the moment — not necessarily what they meant."
          required
        />
        <TA
          label="What did you need in that moment?"
          value={draft.whatINeeded}
          onChange={(v) => set('whatINeeded', v)}
          placeholder="Reassurance, space, to be heard, an apology, clarity…"
          required
        />
        <TA
          label="What are you owning?"
          value={draft.whatIAmOwning}
          onChange={(v) => set('whatIAmOwning', v)}
          placeholder="Your part — even if small. How did your words or actions contribute?"
          required
        />
        <TA
          label="What will you do differently?"
          value={draft.whatIWillDoDifferently}
          onChange={(v) => set('whatIWillDoDifferently', v)}
          placeholder="A specific, honest commitment."
          required
        />
      </div>

      {/* Optional deeper fields */}
      <div>
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="text-sm text-accent hover:underline focus-ring"
        >
          {showOptional ? '▲ Hide optional fields' : '▼ Show optional fields'}
        </button>
      </div>

      {showOptional && (
        <div className="space-y-5 border-l-2 border-border pl-4">
          <TA
            label="Physical or emotional signals you noticed"
            value={draft.physicalOrEmotionalSignals ?? ''}
            onChange={(v) => set('physicalOrEmotionalSignals', v)}
            placeholder="Body tension, shutdown, tears, raised voice…"
            optional
          />
          <TA
            label="What specifically felt hurtful?"
            value={draft.whatIFeltHurtBy ?? ''}
            onChange={(v) => set('whatIFeltHurtBy', v)}
            placeholder="A word, tone, action, or omission."
            optional
          />
          <TA
            label="What helped (if anything)?"
            value={draft.whatHelped ?? ''}
            onChange={(v) => set('whatHelped', v)}
            placeholder="Something they said or did that made it a little better."
            optional
          />
          <TA
            label="What made it worse?"
            value={draft.whatMadeItWorse ?? ''}
            onChange={(v) => set('whatMadeItWorse', v)}
            placeholder="Something that escalated or prolonged it."
            optional
          />
          <TA
            label="Unresolved pieces"
            value={draft.unresolvedPieces ?? ''}
            onChange={(v) => set('unresolvedPieces', v)}
            placeholder="What still feels open or unaddressed for you?"
            optional
          />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text">Tags</label>
            <div className="flex flex-wrap gap-2">
              {available.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors focus-ring ${
                    draft.tags.includes(tag)
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-border bg-surface-2 text-text-2 hover:border-accent/40'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus-ring"
                placeholder="Custom tags (comma-separated)"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTags(); } }}
              />
              <Button type="button" variant="secondary" onClick={addCustomTags}>Add</Button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-text">Does this feel resolved for you?</label>
        <div className="flex gap-3">
          {(['yes', 'partially', 'no'] as Reflection['feelsResolved'][]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => set('feelsResolved', v)}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-colors focus-ring ${
                draft.feelsResolved === v
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-border bg-surface-2 text-text-2 hover:border-accent/40'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={saving}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit reflection'}
        </Button>
      </div>
      <p className="text-xs text-text-3 text-right">
        Submitting locks your reflection and reveals your partner&apos;s once they also submit.
      </p>
    </form>
  );
}
