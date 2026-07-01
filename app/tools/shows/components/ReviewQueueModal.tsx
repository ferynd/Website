'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, PartyPopper, ChevronRight } from 'lucide-react';
import type { Show, ShowList, MemberRating } from '../types';
import { useShows } from '../ShowsContext';
import ScoreBlock from './ScoreBlock';
import StatusBadge from './StatusBadge';
import TypeChip from './TypeChip';
import { isReviewComplete } from '../lib/reviewCompleteness';

interface Props {
  shows: Show[];
  members: ShowList['members'];
  currentUid: string;
  onClose: () => void;
}

const EMPTY_RATING: MemberRating = {
  story: null, characters: null, vibes: null, wouldRewatch: null, brainPower: null, ratedAt: null,
};

export default function ReviewQueueModal({ shows, members, currentUid, onClose }: Props) {
  const { updateMyRating, updateMyNote } = useShows();
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const show = shows[index] as Show | undefined;
  const [pendingRating, setPendingRating] = useState<MemberRating>(EMPTY_RATING);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!show) return;
    setPendingRating(show.ratings[currentUid] ?? EMPTY_RATING);
    setNote(show.memberNotes?.[currentUid] ?? show.notes ?? '');
  }, [show, currentUid]);

  const memberName = useMemo(
    () => members.find((m) => m.uid === currentUid)?.displayName ?? 'You',
    [members, currentUid],
  );

  const isLast = index >= shows.length - 1;
  const done = !show;
  const canSave = isReviewComplete(pendingRating);

  async function saveAndNext() {
    if (!show || !canSave) return;
    setSaving(true);
    try {
      await updateMyRating(show.id, pendingRating);
      const existingNote = show.memberNotes?.[currentUid] ?? show.notes ?? '';
      if (note !== existingNote) {
        await updateMyNote(show.id, note);
      }
      setIndex((i) => i + 1);
    } finally {
      setSaving(false);
    }
  }

  function skip() {
    setIndex((i) => i + 1);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-1 border border-border shadow-2">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
          <h2 className="font-semibold">
            {done ? 'All caught up' : `Review missing · ${index + 1} of ${shows.length}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center space-y-3">
            <PartyPopper size={32} className="mx-auto text-accent" />
            <p className="font-medium text-text">You&apos;ve reviewed everything!</p>
            <p className="text-sm text-text-2">No more shows are missing your review right now.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-bg min-h-[48px]"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-bold leading-snug">{show.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                <TypeChip type={show.type} />
                <StatusBadge status={show.status} />
              </div>
              {show.description && <p className="text-sm text-text-2 leading-relaxed">{show.description}</p>}
            </div>

            <ScoreBlock
              memberName={memberName}
              rating={pendingRating}
              editable
              onChange={(partial) => setPendingRating((prev) => ({ ...prev, ...partial }))}
            />

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-2">Your notes</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Anything worth remembering about this one?"
                className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent resize-none"
              />
            </div>

            <div className="flex gap-3 pt-1 pb-safe">
              <button
                type="button"
                onClick={skip}
                className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px]"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={saveAndNext}
                disabled={saving || !canSave}
                title={canSave ? undefined : 'Set story, characters, vibes, and would-rewatch to save'}
                className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-50 transition-opacity min-h-[48px] flex items-center justify-center gap-2"
              >
                {saving ? 'Saving…' : isLast ? 'Save & finish' : 'Save & next'}
                {!saving && <ChevronRight size={16} />}
              </button>
            </div>
            {!canSave && (
              <p className="text-xs text-text-3 text-right -mt-2">
                Set story, characters, vibes, and would-rewatch to save this review — or Skip for now.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
