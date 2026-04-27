'use client';

import { useMemo, useState } from 'react';
import Input from '@/components/Input';
import { weeksSince } from '../lib/decay';
import { toDateOrNull } from '../lib/time';
import { useDateNight } from '../DateNightContext';

/* ------------------------------------------------------------ */
/* CONFIGURATION: filters + score bins                          */
/* ------------------------------------------------------------ */
const STATUSES = ['all', 'pending-review', 'completed', 'archived-no-review'] as const;
const SCORE_BINS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const weekKey = (iso: string) => {
  const date = new Date(iso);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - first.getTime()) / 86400000);
  return `${date.getUTCFullYear()}-${Math.floor(day / 7)}`;
};

export default function History() {
  const { rolls, dates, modifiers } = useDateNight();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return rolls.filter((roll) => {
      const matchesStatus = status === 'all' || roll.status === status;
      const haystack = `${roll.date.name} ${roll.modifiers.map((m) => m.name).join(' ')}`.toLowerCase();
      return matchesStatus && (!term || haystack.includes(term));
    });
  }, [rolls, search, status]);

  const completedRolls = useMemo(() => rolls.filter((roll) => roll.status === 'completed'), [rolls]);
  const allScores = completedRolls.flatMap((roll) => [roll.reviews.a?.score, roll.reviews.b?.score].filter(Boolean) as number[]);

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
    .map((entry) => ({ name: entry.name, avg: entry.scores.reduce((a, b) => a + b, 0) / Math.max(1, entry.scores.length) }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const topVetoedDates = [...dates].sort((a, b) => b.timesVetoed - a.timesVetoed).slice(0, 5);
  const topVetoedModifiers = [...modifiers].sort((a, b) => b.timesVetoed - a.timesVetoed).slice(0, 5);
  const longestDormant = [...dates, ...modifiers]
    .map((item) => ({ name: item.name, weeks: weeksSince(item.lastAcceptedAt) }))
    .sort((a, b) => b.weeks - a.weeks)
    .slice(0, 5);

  const weekSet = new Set(completedRolls.flatMap((roll) => {
    const createdAt = toDateOrNull(roll.createdAt);
    return createdAt ? [weekKey(createdAt.toISOString())] : [];
  }));
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

  return (
    <section className="rounded-xl3 border border-border bg-surface-1/80 p-5 shadow-md space-y-4">
      <h2 className="text-xl font-semibold">History & Stats</h2>
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="kpi"><p className="kpi-label">Total rolls</p><p className="kpi-value">{totalRolls}</p></div>
        <div className="kpi"><p className="kpi-label">Accept rate</p><p className="kpi-value">{acceptRate}%</p></div>
        <div className="kpi"><p className="kpi-label">Completed streak</p><p className="kpi-value">{streak} weeks</p></div>
        <div className="kpi"><p className="kpi-label">Completed</p><p className="kpi-value">{completed}</p></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
          <p className="font-medium mb-2">Most-loved dates (avg score)</p>
          <ul className="space-y-1 text-sm">{mostLoved.map((row) => <li key={row.name}>{row.name} — {row.avg.toFixed(2)}</li>)}</ul>
        </div>
        <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3 space-y-2">
          <p className="font-medium">Score distribution</p>
          {scoreHistogram.map((entry) => (
            <div className="kpi-row" key={entry.score}>
              <div className="meta"><span className="label">{entry.score}</span><span className="current">{entry.count}</span></div>
              <div className="hbar">
                <div className="hbar-fill" style={{ width: `${Math.min(150, entry.count * 18)}%` }} />
                <div className="hbar-marker" style={{ left: '66.666%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3"><p className="font-medium mb-2">Most-vetoed dates</p><ul className="text-sm space-y-1">{topVetoedDates.map((row) => <li key={row.id}>{row.name} ({row.timesVetoed})</li>)}</ul></div>
        <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3"><p className="font-medium mb-2">Most-vetoed modifiers</p><ul className="text-sm space-y-1">{topVetoedModifiers.map((row) => <li key={row.id}>{row.name} ({row.timesVetoed})</li>)}</ul></div>
        <div className="rounded-xl border border-border/60 bg-surface-2/70 p-3"><p className="font-medium mb-2">Longest dormant</p><ul className="text-sm space-y-1">{longestDormant.map((row) => <li key={row.name}>{row.name} ({row.weeks.toFixed(1)}w)</li>)}</ul></div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="text-sm">Status
          <select className="mt-1 w-full rounded-md border-border bg-surface-2" value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        {filtered.map((roll) => (
          <article key={roll.id} className="rounded-xl border border-border/60 bg-surface-2/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{roll.date.name}</p>
              <span className="badge info">{roll.status}</span>
            </div>
            <p className="text-sm text-text-3">{roll.modifiers.map((m) => m.name).join(', ') || 'No modifiers'} · vetoes before accept: {roll.vetoCount ?? 0}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
