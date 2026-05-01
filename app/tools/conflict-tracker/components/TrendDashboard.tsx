"use client";

import type { Conflict, Reflection, Tracker } from '../lib/types';

interface Props {
  conflicts: Conflict[];
  reflections: Reflection[];
  tracker: Tracker;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-surface-1 p-5 space-y-3">
    <h3 className="font-semibold text-text">{title}</h3>
    {children}
  </div>
);

export default function TrendDashboard({ conflicts, reflections, tracker }: Props) {
  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  // 1. Resolution status counts
  const statusCounts = {
    open: conflicts.filter((c) => c.status === 'open').length,
    partially: conflicts.filter((c) => c.status === 'partially_resolved').length,
    resolved: conflicts.filter((c) => c.status === 'resolved').length,
  };
  const total = conflicts.length;

  // 2. Tag frequency across conflicts + reflections
  const tagFreq: Record<string, number> = {};
  for (const c of conflicts) {
    for (const t of c.tags) {
      tagFreq[t] = (tagFreq[t] ?? 0) + 1;
    }
  }
  for (const r of reflections) {
    for (const t of r.tags) {
      tagFreq[t] = (tagFreq[t] ?? 0) + 1;
    }
  }
  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // 3. Severity over time
  const severities = [...conflicts]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => c.severity);
  const avgSeverity = severities.length
    ? (severities.reduce((s, v) => s + v, 0) / severities.length).toFixed(1)
    : null;
  const maxSeverity = severities.length ? Math.max(...severities) : null;

  // Sparkline: normalize 1-5 to 0-100% height
  const sparkH = 36;
  const sparkW = 6;

  // 4. Active commitments — most recent "what I will do differently" per person
  const recentReflectionsByPerson = (side: 'personA' | 'personB') =>
    reflections
      .filter((r) => r.person === side && r.whatIWillDoDifferently?.trim())
      .slice(-3)
      .reverse();

  // 5. What's working — filter by repair tags or what helped
  const workingItems = reflections
    .filter(
      (r) =>
        r.whatHelped?.trim() ||
        r.tags.some((t) =>
          ['Repair successful', 'Felt cared for'].includes(t),
        ),
    )
    .slice(-5)
    .reverse();

  // 6. Repeated needs
  const needCounts: Record<string, number> = {};
  for (const r of reflections) {
    const need = r.whatINeeded?.trim();
    if (need) {
      needCounts[need] = (needCounts[need] ?? 0) + 1;
    }
  }
  const topNeeds = Object.entries(needCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-10 text-center">
        <p className="text-text-2">No data yet. Trends will appear once you have logged conflicts.</p>
        <p className="text-xs text-text-3 mt-2">
          Patterns are easier to work with when they stay visible.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold">Trends</h2>
        <p className="text-sm text-text-2 mt-1">
          Patterns are easier to work with when they stay visible. This section summarizes repeated
          needs, misunderstandings, behaviors, and repairs across entries.
        </p>
      </div>

      {/* Resolution overview */}
      <Section title="Status overview">
        <div className="flex gap-6 text-sm">
          <div className="text-center">
            <p className="text-2xl font-semibold text-orange-400">{statusCounts.open}</p>
            <p className="text-text-3 mt-0.5">Open</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-blue-400">{statusCounts.partially}</p>
            <p className="text-text-3 mt-0.5">Partial</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-green-400">{statusCounts.resolved}</p>
            <p className="text-text-3 mt-0.5">Resolved</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-semibold text-text">{total}</p>
            <p className="text-text-3 mt-0.5">Total</p>
          </div>
        </div>
      </Section>

      {/* Severity sparkline */}
      {severities.length > 1 && (
        <Section title="Severity over time">
          <div className="flex items-end gap-1 h-9">
            {severities.map((s, i) => {
              const h = Math.round((s / 5) * sparkH);
              const color =
                s <= 2 ? 'bg-green-500'
                : s === 3 ? 'bg-yellow-500'
                : s === 4 ? 'bg-orange-500'
                : 'bg-red-500';
              return (
                <div
                  key={i}
                  title={`Severity ${s}`}
                  className={`rounded-sm ${color}`}
                  style={{ width: `${sparkW}px`, height: `${h}px` }}
                />
              );
            })}
          </div>
          <div className="flex gap-6 text-sm mt-2">
            <span className="text-text-2">Average: <span className="text-text font-medium">{avgSeverity}</span></span>
            <span className="text-text-2">Highest: <span className="text-text font-medium">{maxSeverity}</span></span>
            <span className="text-text-2">Latest: <span className="text-text font-medium">{severities[severities.length - 1]}</span></span>
          </div>
        </Section>
      )}

      {/* Recurring themes */}
      {topTags.length > 0 && (
        <Section title="Recurring themes">
          <div className="flex flex-wrap gap-2">
            {topTags.map(([tag, count]) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-text-2"
              >
                {tag}
                <span className="text-text-3">×{count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Repeated needs */}
      {topNeeds.length > 0 && (
        <Section title="Repeated unmet needs">
          <ul className="space-y-2">
            {topNeeds.map(([need, count]) => (
              <li key={need} className="flex items-start gap-3">
                <span className="text-xs rounded-full bg-accent/20 text-accent border border-accent/30 px-2 py-0.5 mt-0.5 flex-shrink-0">
                  ×{count}
                </span>
                <p className="text-sm text-text">{need}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Active commitments */}
      {(recentReflectionsByPerson('personA').length > 0 || recentReflectionsByPerson('personB').length > 0) && (
        <Section title="Recent commitments">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">{aName}</p>
              <ul className="space-y-2">
                {recentReflectionsByPerson('personA').map((r, i) => (
                  <li key={i} className="text-sm text-text border-l-2 border-accent/40 pl-3">
                    {r.whatIWillDoDifferently}
                  </li>
                ))}
                {recentReflectionsByPerson('personA').length === 0 && (
                  <li className="text-sm text-text-3">No recent commitments.</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-3 uppercase tracking-wide mb-2">{bName}</p>
              <ul className="space-y-2">
                {recentReflectionsByPerson('personB').map((r, i) => (
                  <li key={i} className="text-sm text-text border-l-2 border-purple/40 pl-3">
                    {r.whatIWillDoDifferently}
                  </li>
                ))}
                {recentReflectionsByPerson('personB').length === 0 && (
                  <li className="text-sm text-text-3">No recent commitments.</li>
                )}
              </ul>
            </div>
          </div>
        </Section>
      )}

      {/* What's working */}
      {workingItems.length > 0 && (
        <Section title="What&apos;s working">
          <ul className="space-y-3">
            {workingItems.map((r, i) => (
              <li key={i} className="text-sm text-text border-l-2 border-green-500/40 pl-3 space-y-1">
                {r.whatHelped && <p>{r.whatHelped}</p>}
                {r.tags.some((t) => ['Repair successful', 'Felt cared for'].includes(t)) && (
                  <div className="flex gap-1">
                    {r.tags
                      .filter((t) => ['Repair successful', 'Felt cared for'].includes(t))
                      .map((t) => (
                        <span key={t} className="text-xs rounded-full bg-green-900/30 text-green-300 border border-green-700/40 px-2 py-0.5">
                          {t}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Sparkline padding for 1-item case */}
      {severities.length === 1 && (
        <Section title="Severity">
          <p className="text-sm text-text-2">Only one entry so far — severity trends will appear as you log more.</p>
        </Section>
      )}
    </div>
  );
}
