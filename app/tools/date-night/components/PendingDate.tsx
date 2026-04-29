'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Images } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { REVIEW_SLOT_ORDER, useDateNight } from '../DateNightContext';
import ScorePicker from './PendingDate/ScorePicker';

/* ------------------------------------------------------------ */
/* CONFIGURATION: review defaults + UI labels                   */
/* ------------------------------------------------------------ */
const DEFAULT_SCORE = 7;
const CANCEL_SPIN_BUTTON_TEXT = 'Cancel Spin';

export default function PendingDate() {
  const {
    pendingRoll,
    dates,
    modifiers,
    reviewSlotNames,
    upsertReview,
    addPhoto,
    markCompleted,
    archivePendingRollWithoutReview,
  } = useDateNight();

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [liked, setLiked] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [disliked, setDisliked] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [scores, setScores] = useState<Record<'a' | 'b', number>>({
    a: DEFAULT_SCORE,
    b: DEFAULT_SCORE,
  });

  const dateLookup = useMemo(() => new Map(dates.map((item) => [item.id, item])), [dates]);
  const modifierLookup = useMemo(() => new Map(modifiers.map((item) => [item.id, item])), [modifiers]);

  useEffect(() => {
    if (!pendingRoll) return;

    setNotes({
      a: pendingRoll.reviews.a?.notes ?? '',
      b: pendingRoll.reviews.b?.notes ?? '',
    });
    setLiked({
      a: pendingRoll.reviews.a?.liked ?? '',
      b: pendingRoll.reviews.b?.liked ?? '',
    });
    setDisliked({
      a: pendingRoll.reviews.a?.disliked ?? '',
      b: pendingRoll.reviews.b?.disliked ?? '',
    });
    setScores({
      a: pendingRoll.reviews.a?.score ?? DEFAULT_SCORE,
      b: pendingRoll.reviews.b?.score ?? DEFAULT_SCORE,
    });
  }, [pendingRoll]);

  const canComplete = useMemo(
    () => Boolean(pendingRoll?.reviews?.a && pendingRoll?.reviews?.b),
    [pendingRoll],
  );

  if (!pendingRoll) {
    return (
      <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md">
        <h2 className="text-xl font-semibold">Pinned Pending Card</h2>
        <p className="text-text-2 mt-2">No pending roll right now.</p>
      </section>
    );
  }

  const rolledDate = dateLookup.get(pendingRoll.date.id);
  const rolledModifiers = pendingRoll.modifiers.map((mod) => ({
    ...mod,
    description: modifierLookup.get(mod.id)?.description,
  }));

  const submitReview = async (slot: 'a' | 'b') => {
    await upsertReview(pendingRoll.id, slot, {
      score: scores[slot],
      liked: liked[slot],
      disliked: disliked[slot],
      notes: notes[slot],
    });

    const other = slot === 'a' ? 'b' : 'a';
    if (pendingRoll.reviews?.[other]) {
      await markCompleted(pendingRoll.id);
    }
  };

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Pinned Pending Card</h2>
        <Button
          variant="danger"
          size="sm"
          onClick={() => void archivePendingRollWithoutReview(pendingRoll.id)}
        >
          {CANCEL_SPIN_BUTTON_TEXT}
        </Button>
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-2/60 p-3 space-y-1">
        <p className="text-lg font-medium">{pendingRoll.date.name}</p>
        <p className="text-sm text-text-2">
          {rolledDate?.description || 'No date description provided yet.'}
        </p>
      </div>

      <div className="rounded-lg border border-border/60 bg-surface-2/60 p-3 space-y-2">
        <p className="font-medium">Modifiers</p>
        {rolledModifiers.length === 0 ? (
          <p className="text-sm text-text-2">No modifiers.</p>
        ) : (
          rolledModifiers.map((mod) => (
            <div key={mod.id}>
              <p className="text-sm font-medium">{mod.name}</p>
              <p className="text-xs text-text-3">
                {mod.description || 'No modifier description provided yet.'}
              </p>
            </div>
          ))
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void addPhoto(pendingRoll.id, file);
          event.currentTarget.value = '';
        }}
      />
      <Button
        variant="secondary"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-2"
      >
        <Camera size={16} /> Upload photo
      </Button>

      {pendingRoll.photos.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-text-2 inline-flex items-center gap-2">
            <Images size={14} /> Photos
          </p>
          <div className="grid grid-cols-3 gap-2">
            {pendingRoll.photos.map((photo) => (
              <button
                type="button"
                key={photo.storagePath}
                onClick={() => setLightbox(photo.url)}
              >
                <img
                  src={photo.url}
                  alt="date night upload"
                  className="h-24 w-full object-cover rounded-lg border border-border/50"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {REVIEW_SLOT_ORDER.map((slot) => (
          <div
            key={slot}
            className="rounded-lg border border-border/60 bg-surface-2/70 p-3 space-y-2"
          >
            <p className="font-medium">{reviewSlotNames[slot]}</p>
            <ScorePicker
              value={scores[slot]}
              onChange={(score) => setScores((p) => ({ ...p, [slot]: score }))}
            />
            <Input
              label="Liked"
              value={liked[slot]}
              onChange={(e) => setLiked((p) => ({ ...p, [slot]: e.target.value }))}
            />
            <Input
              label="Disliked"
              value={disliked[slot]}
              onChange={(e) => setDisliked((p) => ({ ...p, [slot]: e.target.value }))}
            />
            <Input
              label="Notes"
              value={notes[slot]}
              onChange={(e) => setNotes((p) => ({ ...p, [slot]: e.target.value }))}
            />
            <Button size="sm" onClick={() => void submitReview(slot)}>
              Save review
            </Button>
          </div>
        ))}
      </div>

      {canComplete && (
        <Button variant="success" onClick={() => markCompleted(pendingRoll.id)}>
          Mark as Completed (already has both reviews)
        </Button>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="Date night full size"
            className="max-h-[90vh] max-w-[90vw] rounded-xl border border-border"
          />
        </div>
      )}
    </section>
  );
}
