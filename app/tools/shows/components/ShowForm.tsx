'use client';

import { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Trash2 } from 'lucide-react';
import type { Show, ShowType, ShowStatus, ShowList } from '../types';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import { isRatable } from '../lib/compositeScore';
import VibeTagChip from './VibeTagChip';
import ScoreBlock from './ScoreBlock';
import { useShows } from '../ShowsContext';

const SERVICES = [
  'Crunchyroll', 'Netflix', 'Hulu', 'Max', 'Prime', 'Disney+', 'Apple TV+', 'Other',
];

const TYPE_LABELS: Record<ShowType, string> = {
  anime:          'Anime',
  tv:             'TV Show',
  movie:          'Movie',
  animated_movie: 'Animated Movie',
};

const STATUS_LABELS: Record<ShowStatus, string> = {
  watching:  'Watching',
  completed: 'Completed',
  dropped:   'Dropped',
  on_hold:   'On Hold',
  planned:   'Planned',
};

function hasEpisodes(type: ShowType) {
  return type === 'anime' || type === 'tv';
}

interface Props {
  show?: Show;
  listId: string;
  members: ShowList['members'];
  onClose: () => void;
}

export default function ShowForm({ show, listId, members, onClose }: Props) {
  const { user, activeList, addShow, updateShow, updateMyRating, deleteShow } = useShows();
  const isEdit = !!show;

  const [title, setTitle] = useState(show?.title ?? '');
  const [type, setType] = useState<ShowType>(show?.type ?? 'anime');
  const [status, setStatus] = useState<ShowStatus>(show?.status ?? 'planned');
  const [currentSeason, setCurrentSeason] = useState<string>(
    show?.currentSeason?.toString() ?? '',
  );
  const [currentEpisode, setCurrentEpisode] = useState<string>(
    show?.currentEpisode?.toString() ?? '',
  );
  const [totalSeasons, setTotalSeasons] = useState<string>(
    show?.totalSeasons?.toString() ?? '',
  );
  const [service, setService] = useState<string>(show?.service ?? '');
  const [customService, setCustomService] = useState('');
  const [watchers, setWatchers] = useState<string[]>(
    show?.watchers ?? (user ? [user.uid] : []),
  );
  const [notes, setNotes] = useState(show?.notes ?? '');
  const [vibeTags, setVibeTags] = useState<string[]>(show?.vibeTags ?? []);
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  // Local rating state for the current user (editable inline)
  const myRating = show?.ratings[user?.uid ?? ''] ?? {
    story: null, characters: null, vibes: null, wouldRewatch: null, ratedAt: null,
  };
  const [pendingRating, setPendingRating] = useState(myRating);

  useEffect(() => {
    // Reset episode fields when type changes away from anime/tv
    if (!hasEpisodes(type)) {
      setCurrentSeason('');
      setCurrentEpisode('');
      setTotalSeasons('');
    }
  }, [type]);

  async function classify() {
    if (!title.trim()) return;
    setClassifying(true);
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), type }),
      });
      if (!res.ok) throw new Error('Classification failed');
      const data = await res.json();
      if (data.vibes?.length) setVibeTags(data.vibes);
    } catch {
      setError('Could not classify — check your connection and try again.');
    } finally {
      setClassifying(false);
    }
  }

  async function handleDelete() {
    if (!show) return;
    setDeleting(true);
    setError('');
    try {
      await deleteShow(show.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed. Try again.');
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  function toggleTag(tag: string) {
    setVibeTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length < 4
        ? [...prev, tag]
        : prev,
    );
  }

  function toggleWatcher(uid: string) {
    setWatchers((prev) =>
      prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const resolvedService =
        service === 'Other' ? customService.trim() || 'Other' : service || null;
      const payload = {
        listId,
        title: title.trim(),
        type,
        status,
        currentSeason: hasEpisodes(type) && currentSeason ? Number(currentSeason) : null,
        currentEpisode: hasEpisodes(type) && currentEpisode ? Number(currentEpisode) : null,
        totalSeasons: hasEpisodes(type) && totalSeasons ? Number(totalSeasons) : null,
        service: resolvedService,
        watchers,
        notes,
        vibeTags,
        ratings: show?.ratings ?? {},
      };
      if (isEdit && show) {
        await updateShow(show.id, payload);
        if (user && isRatable(status)) {
          await updateMyRating(show.id, pendingRating);
        }
      } else {
        await addShow(payload);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const canDelete = isEdit && show && user && (
    show.createdBy === user.uid || (activeList?.adminUids.includes(user.uid) ?? false)
  );
  const showEpisodeFields = hasEpisodes(type);
  const showScores = isEdit && show && isRatable(status);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-1 border border-border shadow-2">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
          <h2 className="font-semibold">{isEdit ? 'Edit show' : 'Add show'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <p className="rounded-lg bg-error/15 border border-error/30 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          {/* Title + classify */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Title *</label>
            <div className="flex gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Frieren: Beyond Journey's End"
                className="flex-1 rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                required
              />
              <button
                type="button"
                onClick={classify}
                disabled={classifying || !title.trim()}
                title="Auto-suggest vibe tags"
                className="rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-text-2 hover:text-accent hover:border-accent/40 disabled:opacity-40 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {classifying ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              </button>
            </div>
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Type *</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(TYPE_LABELS) as ShowType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-lg border py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                    type === t
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Status *</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STATUS_LABELS) as ShowStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-lg border py-2.5 text-xs font-medium transition-colors min-h-[44px] ${
                    status === s
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Episode tracking */}
          {showEpisodeFields && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-2">Season</label>
                <input
                  type="number"
                  min={1}
                  value={currentSeason}
                  onChange={(e) => setCurrentSeason(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-2">Episode</label>
                <input
                  type="number"
                  min={1}
                  value={currentEpisode}
                  onChange={(e) => setCurrentEpisode(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-2">Total S</label>
                <input
                  type="number"
                  min={1}
                  value={totalSeasons}
                  onChange={(e) => setTotalSeasons(e.target.value)}
                  placeholder="—"
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                />
              </div>
            </div>
          )}

          {/* Service chips */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Streaming service</label>
            <div className="flex flex-wrap gap-2">
              {SERVICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setService(service === s ? '' : s)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                    service === s
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {service === 'Other' && (
              <input
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                placeholder="Service name"
                className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
              />
            )}
          </div>

          {/* Watchers */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Watchers</label>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.uid}
                  type="button"
                  onClick={() => toggleWatcher(m.uid)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                    watchers.includes(m.uid)
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
                  }`}
                >
                  {m.displayName}
                </button>
              ))}
            </div>
          </div>

          {/* Vibe tags */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-2">Vibe tags (2–4)</label>
              <span className="text-xs text-text-3">{vibeTags.length}/4 selected</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VIBE_CATEGORIES.map((tag) => (
                <VibeTagChip
                  key={tag}
                  tag={tag}
                  selected={vibeTags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything to remember…"
              className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {/* Score blocks — only on edit when ratable */}
          {showScores && user && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-2">Scores</p>
              {/* Current user's editable block */}
              <ScoreBlock
                memberName={
                  members.find((m) => m.uid === user.uid)?.displayName ?? 'You'
                }
                rating={pendingRating}
                editable
                onChange={(partial) =>
                  setPendingRating((prev) => ({ ...prev, ...partial }))
                }
              />
              {/* Other members — read-only */}
              {members
                .filter((m) => m.uid !== user.uid && watchers.includes(m.uid))
                .map((m) => {
                  const r = show!.ratings[m.uid] ?? {
                    story: null, characters: null, vibes: null,
                    wouldRewatch: null, ratedAt: null,
                  };
                  return (
                    <ScoreBlock
                      key={m.uid}
                      memberName={m.displayName}
                      rating={r}
                      editable={false}
                    />
                  );
                })}
            </div>
          )}

          {/* Delete */}
          {canDelete && (
            <div className="border-t border-border pt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 text-sm text-error bg-transparent hover:underline"
              >
                <Trash2 size={14} />
                Delete this show
              </button>
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-3 pt-2 pb-safe">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg disabled:opacity-50 transition-opacity min-h-[48px]"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add show'}
            </button>
          </div>
        </form>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && show && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-surface-1 border border-border p-6 space-y-4 shadow-2">
            <h3 className="font-semibold text-text">Delete &ldquo;{show.title}&rdquo;?</h3>
            <p className="text-sm text-text-2">This can&rsquo;t be undone.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 rounded-xl bg-error py-3 text-sm font-semibold text-white disabled:opacity-50 transition-opacity min-h-[48px]"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
