'use client';

import { useMemo, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { useDateNight } from '../DateNightContext';
import { weeksSince } from '../lib/decay';
import { toDateOrNull } from '../lib/time';

/* ------------------------------------------------------------ */
/* CONFIGURATION: filters + score bins + empty state text       */
/* ------------------------------------------------------------ */
const STATUSES = ['all', 'pending-review', 'completed', 'archived-no-review'] as const;
const SCORE_BINS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const STATS_EMPTY_STATE_TEXT = 'Roll and review more dates to unlock statistics.';

const weekKey = (iso: string) => {
  const date = new Date(iso);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - first.getTime()) / 86400000);
  return `${date.getUTCFullYear()}-${Math.floor(day / 7)}`;
};

export default function History() {
  const { rolls, dates, modifiers, deleteRoll } = useDateNight();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return rolls.filter((roll) => {
      const matchesStatus = status === 'all' || roll.status === status;
      const haystack = `${roll.date.name} ${roll.modifiers.map((m) => m.name).join(' ')}`.toLowerCase();
      return matchesStatus && (!term || haystack.includes(term));
    });
  }, [rolls, search, status]);

  const completedRolls = useMemo(
    () => rolls.filter((roll) => roll.status === 'completed'),
    [rolls],
  );

  const allScores = completedRolls.flatMap((roll) =>
    [roll.reviews.a?.score, roll.reviews.b?.score].filter(Boolean) as number[],
  );

  const scoreHistogram = SCORE_BINS.map((score) => ({
    score,
    count: allScores.filter((entry) => entry === score).length,
  }));

  const lovedMap = new Map<string, { name: string; scores: number[] }>();
  for (const roll of completedRolls) {
    const bucket = lovedMap.get(roll.date.id) ?? { name: roll.date.name, scores: [] };
    if (roll.reviews.a?.score) bucket.scores.push(roll.reviews.a.score);
    if (roll.reviews.b?.score) bucket.scores.push(roll.reviews.b.score);
    lovedMap.set(roll.date.id, bucket);
  }

  const mostLoved = [...lovedMap.values()]
    .filter((entry) => entry.scores.length > 0)
    .map((entry) => ({
      name: entry.name,
      avg: entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const topVetoedDates = [...dates]
    .filter((item) => item.timesVetoed > 0)
    .sort((a, b) => b.timesVetoed - a.timesVetoed)
    .slice(0, 5);

  const topVetoedModifiers = [...modifiers]
    .filter((item) => item.timesVetoed > 0)
    .sort((a, b) => b.timesVetoed - a.timesVetoed)
    .slice(0, 5);

  const longestDormant = [...dates, ...modifiers]
    .filter((item) => Boolean(item.lastAcceptedAt))
    .map((item) => ({ name: item.name, weeks: weeksSince(item.lastAcceptedAt) }))
    .sort((a, b) => b.weeks - a.weeks)
    .slice(0, 5);

  const weekSet = new Set(
    completedRolls.flatMap((roll) => {
      const createdAt = toDateOrNull(roll.createdAt);
      return createdAt ? [weekKey(createdAt.toISOString())] : [];
    }),
  );

  let streak = 0;
  let cursor = new Date();
  while (true) {
    const key = weekKey(cursor.toISOString());
    if (!weekSet.has(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 7 * 86400000);
  }

  const totalRolls = rolls.length;
  const completed = completedRolls.length;
  const acceptRate = totalRolls ? Math.round((completed / totalRolls) * 100) : 0;
  const hasAnyStatData =
    mostLoved.length > 0 ||
    topVetoedDates.length > 0 ||
    topVetoedModifiers.length > 0 ||
    longestDormant.length > 0;

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <h2 className="text-xl font-semibold">History &amp; Stats</h2>

      <div className="grid sm:grid-cols-4 gap-3">
        <div className="kpi">
          <p className="kpi-label">Total rolls</p>
          <p className="kpi-value">{totalRolls}</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Accept rate</p>
          <p className="kpi-value">{acceptRate}%</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Completed streak</p>
          <p className="kpi-value">{streak} weeks</p>
        </div>
        <div className="kpi">
          <p className="kpi-label">Completed</p>
          <p className="kpi-value">{completed}</p>
        </div>
      </div>

      {!hasAnyStatData ? (
        <p className="text-sm text-text-2">{STATS_EMPTY_STATE_TEXT}</p>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
              <p className="font-medium mb-2">Most-loved dates (avg score)</p>
              {mostLoved.length === 0 ? (
                <p className="text-sm text-text-2">{STATS_EMPTY_STATE_TEXT}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {mostLoved.map((row) => (
                    <li key={row.name}>
                      {row.name} — {row.avg.toFixed(2)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3 space-y-2">
              <p className="font-medium">Score distribution</p>
              {scoreHistogram.map((entry) => (
                <div className="kpi-row" key={entry.score}>
                  <div className="meta">
                    <span className="label">{entry.score}</span>
                    <span className="current">{entry.count}</span>
                  </div>
                  <div className="hbar">
                    <div className="hbar-fill" style={{ width: `${Math.min(150, entry.count * 18)}%` }} />
                    <div className="hbar-marker" style={{ left: '66.666%' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
              <p className="font-medium mb-2">Most-vetoed dates</p>
              {topVetoedDates.length === 0 ? (
                <p className="text-sm text-text-2">{STATS_EMPTY_STATE_TEXT}</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {topVetoedDates.map((row) => (
                    <li key={row.id}>
                      {row.name} ({row.timesVetoed})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
              <p className="font-medium mb-2">Most-vetoed modifiers</p>
              {topVetoedModifiers.length === 0 ? (
                <p className="text-sm text-text-2">{STATS_EMPTY_STATE_TEXT}</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {topVetoedModifiers.map((row) => (
                    <li key={row.id}>
                      {row.name} ({row.timesVetoed})
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
              <p className="font-medium mb-2">Longest dormant</p>
              {longestDormant.length === 0 ? (
                <p className="text-sm text-text-2">{STATS_EMPTY_STATE_TEXT}</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {longestDormant.map((row) => (
                    <li key={row.name}>
                      {row.name} ({row.weeks.toFixed(1)}w)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="text-sm">
          Status
          <select
            className="mt-1 w-full rounded-md border-border bg-surface-2"
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        {filtered.map((roll) => {
          const isExpanded = expandedId === roll.id;

          return (
            <article key={roll.id} className="rounded-xl border border-border/60 bg-surface-2/70 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{roll.date.name}</p>
                <span className="badge info">{roll.status}</span>
              </div>

              <p className="text-sm text-text-3">
                {roll.modifiers.map((m) => m.name).join(', ') || 'No modifiers'} · vetoes before accept:{' '}
                {roll.vetoCount ?? 0}
              </p>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setExpandedId(isExpanded ? null : roll.id)}
                >
                  {isExpanded ? 'Hide Details' : 'View Details'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void deleteRoll(roll.id)}>
                  Delete Record
                </Button>
              </div>

              {isExpanded && (
                <div className="rounded-lg border border-border/50 bg-surface-1/60 p-3 text-sm space-y-2">
                  <p>
                    <strong>Review A:</strong>{' '}
                    {roll.reviews.a
                      ? `${roll.reviews.a.score}/9 · liked: ${roll.reviews.a.liked || '-'} · disliked: ${roll.reviews.a.disliked || '-'} · notes: ${roll.reviews.a.notes || '-'}`
                      : 'Not submitted.'}
                  </p>
                  <p>
                    <strong>Review B:</strong>{' '}
                    {roll.reviews.b
                      ? `${roll.reviews.b.score}/9 · liked: ${roll.reviews.b.liked || '-'} · disliked: ${roll.reviews.b.disliked || '-'} · notes: ${roll.reviews.b.notes || '-'}`
                      : 'Not submitted.'}
                  </p>

                  {roll.photos.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {roll.photos.map((photo) => (
                        <img
                          key={photo.storagePath}
                          src={photo.url}
                          alt="review upload"
                          className="h-24 w-full rounded-lg object-cover border border-border/60"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
