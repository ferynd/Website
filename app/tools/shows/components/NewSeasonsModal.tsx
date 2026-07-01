'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Tv, Radio, CheckCircle2, PlayCircle } from 'lucide-react';
import type { Show } from '../types';
import { useShows } from '../ShowsContext';
import { isSeasonCheckEligible, recordedSeasonCount, type SeasonCheckResult } from '../lib/seasonCheck';

interface Props {
  shows: Show[];
  onClose: () => void;
}

interface ApiResult extends Partial<SeasonCheckResult> {
  showId: string;
  matched: boolean;
  reason?: string;
}

export default function NewSeasonsModal({ shows, onClose }: Props) {
  const { updateShow } = useShows();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Record<string, ApiResult>>({});
  const [moved, setMoved] = useState<Set<string>>(new Set());

  const eligible = shows.filter(isSeasonCheckEligible);

  useEffect(() => {
    if (eligible.length === 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/seasons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shows: eligible.map((s) => ({
              id: s.id,
              title: s.title,
              recordedSeasons: recordedSeasonCount(s),
              metadataSource: s.metadataSource ?? null,
              metadataSourceId: s.metadataSourceId ?? null,
            })),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? 'Season check failed.');
        }
        const data = await res.json() as { results: ApiResult[] };
        if (cancelled) return;
        const map: Record<string, ApiResult> = {};
        data.results.forEach((r) => { map[r.showId] = r; });
        setResults(map);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Season check failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function moveToWatching(show: Show, latestSeasons: number) {
    await updateShow(show.id, { status: 'watching', totalSeasons: latestSeasons });
    setMoved((prev) => new Set(prev).add(show.id));
  }

  const withNewSeason = eligible.filter((s) => results[s.id]?.hasNewSeason);
  const unmatchedCount = eligible.filter((s) => results[s.id] && !results[s.id].matched).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-1 border border-border shadow-2">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface-1 px-4 py-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Tv size={16} className="text-accent" /> New seasons
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-text-3">
            Checks completed/on-hold TV shows and cartoons against TMDb. Anime isn&apos;t covered — AniList/MyAnimeList
            track each season as a separate title, so there&apos;s no reliable season count to compare there.
          </p>

          {eligible.length === 0 && (
            <p className="text-sm text-text-2 text-center py-6">
              No completed or on-hold TV shows / cartoons to check yet.
            </p>
          )}

          {loading && eligible.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-text-2 text-sm">
              <Loader2 size={16} className="animate-spin" /> Checking {eligible.length} show{eligible.length === 1 ? '' : 's'}…
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-error/15 border border-error/30 px-3 py-2 text-sm text-error">{error}</p>
          )}

          {!loading && !error && eligible.length > 0 && (
            <>
              {withNewSeason.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 size={24} className="mx-auto text-success" />
                  <p className="text-sm text-text-2">Everything&apos;s up to date.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {withNewSeason.map((show) => {
                    const r = results[show.id];
                    if (!r || r.latestSeasons === undefined) return null;
                    const isMoved = moved.has(show.id);
                    return (
                      <li key={show.id} className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm text-text">{show.title}</p>
                          {r.airingStatus === 'airing' ? (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-info/20 text-info border border-info/30 px-2 py-0.5 text-[10px] font-medium">
                              <Radio size={10} /> Airing now
                            </span>
                          ) : (
                            <span className="flex-shrink-0 inline-flex items-center rounded-full bg-success/20 text-success border border-success/30 px-2 py-0.5 text-[10px] font-medium">
                              Fully released
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-3">
                          You have S{r.recordedSeasons ?? '?'} · Latest is S{r.latestSeasons}
                        </p>
                        {isMoved ? (
                          <p className="text-xs text-success font-medium">Moved to Watching</p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => moveToWatching(show, r.latestSeasons!)}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg min-h-[36px]"
                          >
                            <PlayCircle size={14} /> Move to Watching
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {unmatchedCount > 0 && (
                <p className="text-xs text-text-3 pt-2 border-t border-border">
                  Couldn&apos;t confidently match {unmatchedCount} show{unmatchedCount === 1 ? '' : 's'} to TMDb. Re-running
                  AI classify (✨) on those improves match accuracy for next time.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
