'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Loader2, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Show, ShowType, ShowStatus, ShowList } from '../types';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import type { DisambiguationOption } from '../lib/classifyTypes';
import VibeTagChip from './VibeTagChip';
import ScoreBlock from './ScoreBlock';
import { useShows } from '../ShowsContext';

const SERVICES = [
  'Crunchyroll',
  'Netflix',
  'Hulu',
  'Max',
  'Prime',
  'Disney+',
  'Apple TV+',
  'Peacock',
  'Dropout',
  'Other',
];

const TYPE_LABELS: Record<ShowType, string> = {
  anime:          'Anime',
  tv:             'TV Show',
  movie:          'Movie',
  animated_movie: 'Animated Movie',
  cartoon:        'Cartoon',
};

const STATUS_LABELS: Record<ShowStatus, string> = {
  watching:  'Watching',
  completed: 'Completed',
  dropped:   'Dropped',
  on_hold:   'On Hold',
  planned:   'Planned',
};

const BRAIN_POWER_LABELS: Record<number, string> = {
  1: 'Braindead / background-friendly',
  2: 'Easy watch',
  3: 'Normal focus',
  4: 'Pay attention',
  5: 'Dense / thought-provoking',
};

function hasEpisodes(type: ShowType) {
  return type === 'anime' || type === 'tv' || type === 'cartoon';
}

function resolveInitialService(show: Show | undefined): string {
  if (!show?.service) return '';
  if (SERVICES.includes(show.service)) return show.service;
  return 'Other';
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
  // typeTouched: only true when the user explicitly tapped a type button
  const [typeTouched, setTypeTouched] = useState(isEdit);
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
  const [service, setService] = useState<string>(resolveInitialService(show));
  const [customService, setCustomService] = useState(
    show?.service && !SERVICES.includes(show.service) ? show.service : '',
  );
  const [brainPower, setBrainPower] = useState<number | null>(show?.brainPower ?? null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const watchersInitialized = useRef(isEdit);
  const [watchers, setWatchers] = useState<string[]>(show?.watchers ?? []);
  useEffect(() => {
    if (!watchersInitialized.current && members.length > 0) {
      setWatchers(members.map((m) => m.uid));
      watchersInitialized.current = true;
    }
  }, [members]);

  const [description, setDescription] = useState(show?.description ?? '');

  const [memberNotes, setMemberNotes] = useState<Record<string, string>>(() => {
    if (!show) return {};
    if (show.memberNotes && Object.keys(show.memberNotes).length > 0) return show.memberNotes;
    if (show.notes && user?.uid) return { [user.uid]: show.notes };
    return {};
  });

  const [vibeTags, setVibeTags] = useState<string[]>(show?.vibeTags ?? []);
  const [classifying, setClassifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');

  // Disambiguation state
  const [disambigOptions, setDisambigOptions] = useState<DisambiguationOption[]>([]);
  const [disambigMessage, setDisambigMessage] = useState('');
  const [resolvingOption, setResolvingOption] = useState<string | null>(null); // sourceId being resolved

  const myRating = show?.ratings[user?.uid ?? ''] ?? {
    story: null, characters: null, vibes: null, wouldRewatch: null, ratedAt: null,
  };
  const [pendingRating, setPendingRating] = useState(myRating);

  useEffect(() => {
    if (!hasEpisodes(type)) {
      setCurrentSeason('');
      setCurrentEpisode('');
      setTotalSeasons('');
    }
  }, [type]);

  function selectType(t: ShowType) {
    setType(t);
    setTypeTouched(true);
  }

  function clearDisambig() {
    setDisambigOptions([]);
    setDisambigMessage('');
  }

  async function classify() {
    if (!title.trim()) return;
    setClassifying(true);
    setError('');
    clearDisambig();
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          typeHint: typeTouched ? type : null,
          typeHintWasUserSelected: typeTouched,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Classification failed');
      }
      const data = await res.json() as {
        status: string;
        canonicalTitle?: string;
        type?: ShowType;
        vibes?: string[];
        description?: string;
        options?: DisambiguationOption[];
        message?: string;
      };

      if (data.status === 'resolved') {
        if (data.canonicalTitle) setTitle(data.canonicalTitle);
        if (data.type) { setType(data.type); setTypeTouched(true); }
        if (data.vibes?.length) setVibeTags(data.vibes);
        if (typeof data.description === 'string') setDescription(data.description);
        clearDisambig();
      } else if (data.status === 'needs_selection') {
        setDisambigOptions(data.options ?? []);
        setDisambigMessage(data.message ?? 'Which one did you mean?');
      } else if (data.status === 'not_found') {
        setError(data.message ?? "Couldn't find that title. Try adding a year or more words.");
      } else {
        // Legacy shape fallback (direct-resolved without status field)
        if (data.canonicalTitle) setTitle(data.canonicalTitle);
        if (data.type) { setType(data.type); setTypeTouched(true); }
        if (data.vibes?.length) setVibeTags(data.vibes);
        if (typeof data.description === 'string') setDescription(data.description);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not classify — try again.');
    } finally {
      setClassifying(false);
    }
  }

  async function resolveOption(option: DisambiguationOption) {
    setResolvingOption(option.sourceId);
    setError('');
    try {
      const res = await fetch('/api/classify/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: option.source,
          sourceId: option.sourceId,
          mediaKind: option.mediaKind,
          title: option.title,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Could not fetch details');
      }
      const data = await res.json() as {
        status?: string;
        canonicalTitle?: string;
        type?: ShowType;
        vibes?: string[];
        description?: string;
        message?: string;
      };

      if (data.status === 'resolved' || data.canonicalTitle) {
        if (data.canonicalTitle) setTitle(data.canonicalTitle);
        if (data.type) { setType(data.type); setTypeTouched(true); }
        if (data.vibes?.length) setVibeTags(data.vibes);
        if (typeof data.description === 'string') setDescription(data.description);
        clearDisambig();
      } else {
        throw new Error(data.message ?? 'Resolve returned unexpected shape');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that selection — try again.');
    } finally {
      setResolvingOption(null);
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
        : prev.length < 6
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
        description,
        notes: show?.notes ?? '',
        memberNotes,
        brainPower,
        vibeTags,
        ratings: show?.ratings ?? {},
      };
      if (isEdit && show) {
        await updateShow(show.id, payload);
        if (user) await updateMyRating(show.id, pendingRating);
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
  const showScores = isEdit && show;

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
                onChange={(e) => { setTitle(e.target.value); clearDisambig(); }}
                placeholder="e.g. Frieren: Beyond Journey's End"
                className="flex-1 rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent min-h-[44px]"
                required
              />
              <button
                type="button"
                onClick={classify}
                disabled={classifying || !title.trim()}
                title="Auto-classify with AI (fills type, vibes, description, and corrects title)"
                className="rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-text-2 hover:text-accent hover:border-accent/40 disabled:opacity-40 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                {classifying ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              </button>
            </div>

            {/* Disambiguation panel */}
            {disambigOptions.length > 0 && (
              <div className="mt-2 rounded-xl border border-border bg-surface-2 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <p className="text-xs text-text-2">{disambigMessage}</p>
                  <button
                    type="button"
                    onClick={clearDisambig}
                    className="text-text-3 hover:text-text p-1"
                    aria-label="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="divide-y divide-border">
                  {disambigOptions.map((opt) => {
                    const isResolving = resolvingOption === opt.sourceId;
                    return (
                      <button
                        key={`${opt.source}:${opt.sourceId}`}
                        type="button"
                        disabled={resolvingOption !== null}
                        onClick={() => resolveOption(opt)}
                        className="w-full text-left px-3 py-2.5 hover:bg-surface-1 transition-colors disabled:opacity-50 flex items-start gap-2 min-h-[52px]"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium text-text truncate">{opt.title}</span>
                            {opt.year && (
                              <span className="text-xs text-text-3 shrink-0">{opt.year}</span>
                            )}
                            <span className="text-xs text-accent/80 shrink-0 capitalize">
                              {opt.derivedType.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-text-3 shrink-0 uppercase">{opt.source}</span>
                          </div>
                          {opt.overview && (
                            <p className="text-xs text-text-3 mt-0.5 line-clamp-2">{opt.overview}</p>
                          )}
                        </div>
                        {isResolving && <Loader2 size={14} className="animate-spin text-accent shrink-0 mt-1" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={clearDisambig}
                    className="w-full text-left px-3 py-2 text-xs text-text-3 hover:text-text hover:bg-surface-1 transition-colors"
                  >
                    None of these — try another search
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TYPE_LABELS) as ShowType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => selectType(t)}
                  className={`rounded-lg border py-2.5 text-xs font-medium transition-colors min-h-[44px] ${
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

          {/* Vibe tags */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-2">Vibe tags (2–6)</label>
              <span className="text-xs text-text-3">{vibeTags.length}/6 selected</span>
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

          {/* Brain power */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-2">Brain power required</label>
              {brainPower !== null && (
                <span className="text-xs text-text-3">
                  {brainPower}/5 — {BRAIN_POWER_LABELS[brainPower]}
                </span>
              )}
            </div>
            {brainPower === null ? (
              <button
                type="button"
                onClick={() => setBrainPower(3)}
                className="text-xs text-text-3 underline"
              >
                Set brain power
              </button>
            ) : (
              <>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={brainPower}
                  onChange={(e) => setBrainPower(Number(e.target.value))}
                  className="w-full h-2 accent-[hsl(var(--color-accent))] cursor-pointer"
                />
                <div className="flex justify-between text-xs text-text-3 px-0.5">
                  <span>Braindead</span>
                  <span>Dense</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBrainPower(null)}
                  className="text-xs text-text-3 underline"
                >
                  Clear
                </button>
              </>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-text-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="AI will fill this when you classify the show."
              className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {/* Per-person notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-2">Notes</label>
            {user && (
              <div className="space-y-1">
                <p className="text-xs text-text-3">
                  {members.find((m) => m.uid === user.uid)?.displayName ?? 'You'}
                </p>
                <textarea
                  value={memberNotes[user.uid] ?? ''}
                  onChange={(e) =>
                    setMemberNotes((prev) => ({ ...prev, [user.uid]: e.target.value }))
                  }
                  rows={2}
                  placeholder="Your personal notes about this show."
                  className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent resize-none"
                />
              </div>
            )}
            {members
              .filter((m) => m.uid !== user?.uid && memberNotes[m.uid])
              .map((m) => (
                <div key={m.uid} className="space-y-1">
                  <p className="text-xs text-text-3">{m.displayName}</p>
                  <p className="rounded-lg bg-surface-2 border border-border px-3 py-2.5 text-sm text-text-2 min-h-[44px]">
                    {memberNotes[m.uid]}
                  </p>
                </div>
              ))}
          </div>

          {/* Advanced: Watchers */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-2 hover:text-text hover:bg-surface-2 transition-colors"
            >
              <span>Watchers ({watchers.length} / {members.length})</span>
              {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showAdvanced && (
              <div className="px-4 pb-4 pt-1 space-y-2 border-t border-border">
                <p className="text-xs text-text-3">Who plans to watch / is watching this show.</p>
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
            )}
          </div>

          {/* Score blocks */}
          {showScores && user && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-2">Scores</p>
              <ScoreBlock
                memberName={members.find((m) => m.uid === user.uid)?.displayName ?? 'You'}
                rating={pendingRating}
                editable
                onChange={(partial) => setPendingRating((prev) => ({ ...prev, ...partial }))}
              />
              {members
                .filter((m) => m.uid !== user.uid && show!.ratings[m.uid])
                .map((m) => {
                  const r = show!.ratings[m.uid] ?? {
                    story: null, characters: null, vibes: null, wouldRewatch: null, ratedAt: null,
                  };
                  return <ScoreBlock key={m.uid} memberName={m.displayName} rating={r} editable={false} />;
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

      {/* Delete confirmation */}
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
