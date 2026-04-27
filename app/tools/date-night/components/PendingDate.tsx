'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Images } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { REVIEW_SLOT_ORDER, useDateNight } from '../DateNightContext';
import ScorePicker from './PendingDate/ScorePicker';

/* ------------------------------------------------------------ */
/* CONFIGURATION: local review defaults + lightbox state        */
/* ------------------------------------------------------------ */
const DEFAULT_SCORE = 7;

export default function PendingDate() {
  const { pendingRoll, reviewSlotNames, upsertReview, addPhoto, markCompleted } = useDateNight();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [liked, setLiked] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [disliked, setDisliked] = useState<Record<'a' | 'b', string>>({ a: '', b: '' });
  const [scores, setScores] = useState<Record<'a' | 'b', number>>({ a: DEFAULT_SCORE, b: DEFAULT_SCORE });

  useEffect(() => {
    if (!pendingRoll) return;
    const nextNotes = { a: pendingRoll.reviews.a?.notes ?? '', b: pendingRoll.reviews.b?.notes ?? '' };
    const nextLiked = { a: pendingRoll.reviews.a?.liked ?? '', b: pendingRoll.reviews.b?.liked ?? '' };
    const nextDisliked = { a: pendingRoll.reviews.a?.disliked ?? '', b: pendingRoll.reviews.b?.disliked ?? '' };
    const nextScores = { a: pendingRoll.reviews.a?.score ?? DEFAULT_SCORE, b: pendingRoll.reviews.b?.score ?? DEFAULT_SCORE };
    setNotes(nextNotes);
    setLiked(nextLiked);
    setDisliked(nextDisliked);
    setScores(nextScores);
  }, [pendingRoll]);

  const canComplete = useMemo(() => Boolean(pendingRoll?.reviews?.a && pendingRoll?.reviews?.b), [pendingRoll]);

  const submitReview = async (slot: 'a' | 'b') => {
    if (!pendingRoll) return;
    await upsertReview(pendingRoll.id, slot, {
      score: scores[slot],
      liked: liked[slot],
      disliked: disliked[slot],
      notes: notes[slot],
    });

    const other = slot === 'a' ? 'b' : 'a';
    const otherAlreadySubmitted = Boolean(pendingRoll.reviews?.[other]);
    if (otherAlreadySubmitted) {
      await markCompleted(pendingRoll.id);
    }
  };

  if (!pendingRoll) {
    return (
      <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md">
        <h2 className="text-xl font-semibold">Pinned Pending Card</h2>
        <p className="text-text-2 mt-2">No pending roll right now.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <h2 className="text-xl font-semibold">Pinned Pending Card</h2>
      <p className="text-lg font-medium">{pendingRoll.date.name}</p>
      <p className="text-sm text-text-2">Modifiers: {pendingRoll.modifiers.map((m) => m.name).join(', ') || 'None'}</p>

      <div className="flex items-center gap-3">
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
        <Button variant="secondary" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2">
          <Camera size={16} /> Upload photo
        </Button>
      </div>

      {pendingRoll.photos.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-text-2 inline-flex items-center gap-2"><Images size={14} /> Photos</p>
          <div className="grid grid-cols-3 gap-2">
            {pendingRoll.photos.map((photo) => (
              <button type="button" key={photo.storagePath} onClick={() => setLightbox(photo.url)}>
                <img src={photo.url} alt="date night upload" className="h-24 w-full object-cover rounded-lg border border-border/50" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {REVIEW_SLOT_ORDER.map((slot) => (
          <div key={slot} className="rounded-lg border border-border/60 bg-surface-2/70 p-3 space-y-2">
            <p className="font-medium">{reviewSlotNames[slot]}</p>
            <ScorePicker value={scores[slot]} onChange={(score) => setScores((p) => ({ ...p, [slot]: score }))} />
            <Input label="Liked" value={liked[slot]} onChange={(e) => setLiked((p) => ({ ...p, [slot]: e.target.value }))} />
            <Input label="Disliked" value={disliked[slot]} onChange={(e) => setDisliked((p) => ({ ...p, [slot]: e.target.value }))} />
            <Input label="Notes" value={notes[slot]} onChange={(e) => setNotes((p) => ({ ...p, [slot]: e.target.value }))} />
            <Button size="sm" onClick={() => void submitReview(slot)}>Save review</Button>
          </div>
        ))}
      </div>

      {canComplete && (
        <Button variant="success" onClick={() => markCompleted(pendingRoll.id)}>
          Mark as Completed (already has both reviews)
        </Button>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Date night full size" className="max-h-[90vh] max-w-[90vw] rounded-xl border border-border" />
        </div>
      )}
    </section>
  );
}
