'use client';

import { useState } from 'react';
import { Sparkles, RefreshCw, Play, Loader2 } from 'lucide-react';
import Nav from '@/components/Nav';
import { useShows } from '../ShowsContext';
import StatusBadge from '../components/StatusBadge';
import TypeChip from '../components/TypeChip';
import VibeTagChip from '../components/VibeTagChip';
import { buildHistory, candidateShows } from '../lib/recommendationContext';
import { formatScore, groupComposite } from '../lib/compositeScore';
import type { Show } from '../types';

interface RecommendResult {
  show: Show;
  reason: string;
}

export default function MoodPage() {
  const { shows, activeList, updateShow, user } = useShows();
  const members = activeList?.members ?? [];

  // Track who is present tonight (default: everyone)
  const [presentUids, setPresentUids] = useState<string[]>(members.map((m) => m.uid));
  const [moods, setMoods] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [used, setUsed] = useState(false);

  const presentMembers = members.filter((m) => presentUids.includes(m.uid));

  function togglePresent(uid: string) {
    setPresentUids((prev) =>
      prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid],
    );
  }

  async function recommend(exclude: string[]) {
    setLoading(true);
    setError('');
    try {
      const moodsPayload: Record<string, { name: string; mood: string }> = {};
      presentMembers.forEach((m) => {
        moodsPayload[m.uid] = { name: m.displayName, mood: moods[m.uid] ?? '' };
      });

      const history = buildHistory(shows, presentMembers);
      const candidates = candidateShows(shows);

      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moods: moodsPayload, candidates, history, excludeIds: exclude }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Recommendation failed.');
      }
      const data = await res.json();
      const matchedShow = shows.find((s) => s.id === data.showId);
      if (!matchedShow) throw new Error('AI returned an unknown show. Try respin.');
      setResult({ show: matchedShow, reason: data.reason });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setExcludedIds([]);
    setResult(null);
    setUsed(false);
    recommend([]);
  }

  function respin() {
    if (!result) return;
    const newExcluded = [...excludedIds, result.show.id];
    setExcludedIds(newExcluded);
    setResult(null);
    recommend(newExcluded);
  }

  async function useThis() {
    if (!result || !user) return;
    if (result.show.status === 'planned') {
      await updateShow(result.show.id, { status: 'watching' });
    }
    setUsed(true);
  }

  const hasMoods = presentMembers.some((m) => (moods[m.uid] ?? '').trim().length > 0);
  const candidates = candidateShows(shows);

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="px-4 py-6 space-y-6 max-w-lg mx-auto">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles size={22} className="text-accent" />
            What&apos;s the vibe tonight?
          </h1>
          <p className="text-sm text-text-2">Tell me how everyone&apos;s feeling.</p>
        </div>

        {candidates.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-text-2">
              Add some shows with status <strong>Watching</strong>, <strong>Planned</strong>, or{' '}
              <strong>On Hold</strong> first.
            </p>
          </div>
        )}

        {candidates.length > 0 && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Who's watching tonight */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-2">Who&apos;s watching tonight?</p>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <button
                    key={m.uid}
                    type="button"
                    onClick={() => togglePresent(m.uid)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px] ${
                      presentUids.includes(m.uid)
                        ? 'bg-accent/20 text-accent border-accent/40'
                        : 'bg-surface-2 text-text-2 border-border'
                    }`}
                  >
                    {m.displayName}
                  </button>
                ))}
              </div>
            </div>

            {/* Mood inputs */}
            <div className="space-y-3">
              {presentMembers.map((m) => (
                <div key={m.uid} className="space-y-1.5">
                  <label className="text-sm font-medium text-text-2">
                    How is {m.displayName} feeling?
                  </label>
                  <textarea
                    value={moods[m.uid] ?? ''}
                    onChange={(e) =>
                      setMoods((prev) => ({ ...prev, [m.uid]: e.target.value }))
                    }
                    rows={2}
                    placeholder={`e.g. tired and want something chill, or hype for action…`}
                    className="w-full rounded-xl bg-surface-2 border border-border px-3 py-2.5 text-sm text-text placeholder:text-text-3 focus:outline-none focus:border-accent resize-none"
                  />
                </div>
              ))}
            </div>

            {error && (
              <p className="rounded-lg bg-error/15 border border-error/30 px-3 py-2 text-sm text-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !hasMoods || presentMembers.length === 0}
              className="w-full rounded-xl bg-accent py-3.5 font-semibold text-bg disabled:opacity-50 transition-opacity min-h-[52px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> Finding the perfect pick…</>
              ) : (
                'What should we watch?'
              )}
            </button>
          </form>
        )}

        {/* Result card */}
        {result && !loading && (
          <div className="rounded-xl border border-accent/30 bg-surface-1 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold text-lg leading-snug">{result.show.title}</h2>
              {groupComposite(result.show) !== null && (
                <span className="text-accent font-bold text-sm flex-shrink-0">
                  {formatScore(groupComposite(result.show))}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <TypeChip type={result.show.type} />
              <StatusBadge status={result.show.status} />
              {result.show.currentSeason && (
                <span className="text-xs text-text-3 self-center">
                  S{result.show.currentSeason}
                  {result.show.currentEpisode && ` E${result.show.currentEpisode}`}
                </span>
              )}
            </div>

            {result.show.vibeTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.show.vibeTags.map((tag) => <VibeTagChip key={tag} tag={tag} />)}
              </div>
            )}

            <p className="text-sm text-text-2 leading-relaxed">{result.reason}</p>

            {used ? (
              <p className="text-sm text-success font-medium">
                ✓ {result.show.status === 'planned' ? 'Moved to Watching!' : 'Noted!'}
              </p>
            ) : (
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={respin}
                  className="flex-1 rounded-xl border border-border bg-surface-2 py-3 text-sm font-medium text-text-2 hover:text-text transition-colors min-h-[48px] flex items-center justify-center gap-2"
                >
                  <RefreshCw size={15} /> Respin
                </button>
                <button
                  type="button"
                  onClick={useThis}
                  className="flex-1 rounded-xl bg-accent py-3 text-sm font-semibold text-bg min-h-[48px] flex items-center justify-center gap-2"
                >
                  <Play size={15} /> Use this
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
