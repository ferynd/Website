'use client';

import Nav from '@/components/Nav';
import { useShows } from '../ShowsContext';
import { memberComposite, groupComposite, formatScore } from '../lib/compositeScore';
import type { Show } from '../types';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart as StackedBarChart,
} from 'recharts';

// Accent palette for charts (CSS vars aren't available in SVG fill; use hex-ish)
const COLORS = ['#00e5cc', '#a855f7', '#f59e0b', '#22c55e', '#ec4899', '#3b82f6', '#f97316'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 space-y-3">
      <h2 className="font-semibold text-sm text-text-2 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}

function NoData() {
  return <p className="text-sm text-text-3 text-center py-6">Not enough data yet.</p>;
}

export default function TrendsPage() {
  const { shows, activeList } = useShows();
  const members = activeList?.members ?? [];

  const ratedShows = shows.filter((s) => Object.values(s.ratings).some((r) => memberComposite(r) !== null));

  // ── Vibe distribution ────────────────────────────────────────────────────────
  const vibeCount: Record<string, number> = {};
  ratedShows.forEach((s) => s.vibeTags.forEach((v) => { vibeCount[v] = (vibeCount[v] ?? 0) + 1; }));
  const vibeData = Object.entries(vibeCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  // ── Average group composite by vibe ─────────────────────────────────────────
  const vibeScoreMap: Record<string, number[]> = {};
  ratedShows.forEach((s) => {
    const gc = groupComposite(s);
    if (gc === null) return;
    s.vibeTags.forEach((v) => {
      vibeScoreMap[v] = [...(vibeScoreMap[v] ?? []), gc];
    });
  });
  const vibeScoreData = Object.entries(vibeScoreMap)
    .map(([name, scores]) => ({ name, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => b.avg - a.avg);

  // ── Radar: avg story/characters/vibes per member ─────────────────────────────
  const radarKeys = ['Story', 'Characters', 'Vibes'];
  const radarData = radarKeys.map((key) => {
    const entry: Record<string, number | string> = { subject: key };
    members.forEach((m) => {
      const vals = ratedShows
        .map((s) => s.ratings[m.uid])
        .filter(Boolean)
        .map((r) => (key === 'Story' ? r.story : key === 'Characters' ? r.characters : r.vibes))
        .filter((v): v is number => v !== null);
      entry[m.displayName] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    return entry;
  });

  // ── Rewatch sentiment ────────────────────────────────────────────────────────
  const rewatchData = members.map((m) => {
    let yes = 0, no = 0, maybe = 0;
    ratedShows.forEach((s) => {
      const r = s.ratings[m.uid]?.wouldRewatch;
      if (r === 'yes') yes++;
      else if (r === 'no') no++;
      else if (r === 'maybe') maybe++;
    });
    return { name: m.displayName, Yes: yes, Maybe: maybe, No: no };
  });

  // ── Status breakdown ─────────────────────────────────────────────────────────
  const statusCount: Record<string, number> = {};
  shows.forEach((s) => { statusCount[s.status] = (statusCount[s.status] ?? 0) + 1; });
  const statusData = Object.entries(statusCount).map(([name, value]) => ({ name, value }));

  // ── Top 5 ─────────────────────────────────────────────────────────────────────
  const top5 = [...ratedShows]
    .map((s) => ({ show: s, score: groupComposite(s)! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // ── Most common service ───────────────────────────────────────────────────────
  const serviceCount: Record<string, number> = {};
  shows.forEach((s) => {
    if (s.service) serviceCount[s.service] = (serviceCount[s.service] ?? 0) + 1;
  });
  const topService = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0];

  // ── Per-member insights ──────────────────────────────────────────────────────
  function memberInsights(show: Show, memberUid: string, memberName: string): string[] {
    void show;
    const rated = ratedShows.filter((s) => {
      const r = s.ratings[memberUid];
      return r && memberComposite(r) !== null;
    });
    if (rated.length < 2) return [];
    const insights: string[] = [];
    const avgStory = rated.map((s) => s.ratings[memberUid]?.story ?? 0).reduce((a, b) => a + b, 0) / rated.length;
    const avgVibes = rated.map((s) => s.ratings[memberUid]?.vibes ?? 0).reduce((a, b) => a + b, 0) / rated.length;
    const avgChars = rated.map((s) => s.ratings[memberUid]?.characters ?? 0).reduce((a, b) => a + b, 0) / rated.length;
    if (Math.abs(avgStory - avgVibes) > 1) {
      insights.push(`${memberName} rates ${avgStory > avgVibes ? 'Story' : 'Vibes'} noticeably higher on average.`);
    }
    // Vibe preference
    const vibeScores: Record<string, number[]> = {};
    rated.forEach((s) => {
      const comp = memberComposite(s.ratings[memberUid]);
      if (comp === null) return;
      s.vibeTags.forEach((v) => { vibeScores[v] = [...(vibeScores[v] ?? []), comp]; });
    });
    const bestVibe = Object.entries(vibeScores)
      .map(([v, scores]) => ({ v, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
      .sort((a, b) => b.avg - a.avg)[0];
    if (bestVibe && bestVibe.avg > avgChars + 0.5) {
      insights.push(`${memberName} tends to score ${bestVibe.v} shows highest.`);
    }
    return insights.slice(0, 2);
  }

  const hasData = ratedShows.length > 0;

  return (
    <main className="bg-bg text-text min-h-dvh">
      <Nav />
      <section className="px-4 py-6 space-y-4 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold">
          Trends
          {activeList && <span className="text-text-2 font-normal"> · {activeList.name}</span>}
        </h1>

        {!hasData && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-text-2">Finish and rate some shows to see trends.</p>
          </div>
        )}

        {hasData && (
          <>
            {/* Vibe donut */}
            {vibeData.length > 0 && (
              <Section title="Vibe distribution">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={vibeData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={2}>
                      {vibeData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v} shows`, '']} />
                    <Legend formatter={(value) => <span className="text-xs text-text-2">{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </Section>
            )}

            {/* Avg composite by vibe */}
            {vibeScoreData.length > 0 && (
              <Section title="Avg group score by vibe">
                <ResponsiveContainer width="100%" height={Math.max(180, vibeScoreData.length * 28)}>
                  <BarChart data={vibeScoreData} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11, fill: 'hsl(var(--color-text-3))' }} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: 'hsl(var(--color-text-2))' }} />
                    <Tooltip formatter={(v: number) => [v.toFixed(1), 'Avg score']} />
                    <Bar dataKey="avg" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Section>
            )}

            {/* Radar */}
            {members.length > 0 && (
              <Section title="Score breakdown by member">
                {ratedShows.length < 1 ? <NoData /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="hsl(var(--color-border))" />
                      <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: 'hsl(var(--color-text-2))' }} />
                      {members.map((m, i) => (
                        <Radar
                          key={m.uid}
                          name={m.displayName}
                          dataKey={m.displayName}
                          stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]}
                          fillOpacity={0.15}
                        />
                      ))}
                      <Legend formatter={(value) => <span className="text-xs text-text-2">{value}</span>} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                )}
              </Section>
            )}

            {/* Rewatch */}
            {members.length > 0 && rewatchData.some((d) => d.Yes + d.Maybe + d.No > 0) && (
              <Section title="Would rewatch?">
                <ResponsiveContainer width="100%" height={160}>
                  <StackedBarChart data={rewatchData}>
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--color-text-2))' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--color-text-3))' }} />
                    <Tooltip />
                    <Legend formatter={(value) => <span className="text-xs text-text-2">{value}</span>} />
                    <Bar dataKey="Yes" stackId="a" fill="#22c55e" />
                    <Bar dataKey="Maybe" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="No" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </StackedBarChart>
                </ResponsiveContainer>
              </Section>
            )}

            {/* Per-member insights */}
            {members.length > 0 && (
              <Section title="Taste insights">
                {members.map((m) => {
                  const ins = memberInsights(shows[0], m.uid, m.displayName);
                  if (ins.length === 0) return null;
                  return (
                    <div key={m.uid} className="space-y-1">
                      <p className="text-xs font-semibold text-accent">{m.displayName}</p>
                      {ins.map((i, idx) => (
                        <p key={idx} className="text-sm text-text-2">{i}</p>
                      ))}
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Status breakdown */}
            {statusData.length > 0 && (
              <Section title="Library status">
                <div className="grid grid-cols-3 gap-2">
                  {statusData.map(({ name, value }) => (
                    <div key={name} className="rounded-lg bg-surface-2 p-3 text-center">
                      <p className="text-xl font-bold text-accent">{value}</p>
                      <p className="text-xs text-text-2 capitalize mt-0.5">{name.replace('_', ' ')}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Top 5 */}
            {top5.length > 0 && (
              <Section title="Top 5 group scores">
                <ol className="space-y-2">
                  {top5.map(({ show, score }, i) => (
                    <li key={show.id} className="flex items-center gap-3">
                      <span className="text-lg font-bold text-text-3 w-6 text-center">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium truncate">{show.title}</span>
                      <span className="text-sm font-bold text-accent">{formatScore(score)}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {/* Most common service */}
            {topService && (
              <Section title="Most-used service">
                <p className="text-2xl font-bold text-accent">{topService[0]}</p>
                <p className="text-sm text-text-2">{topService[1]} show{topService[1] !== 1 ? 's' : ''}</p>
              </Section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
