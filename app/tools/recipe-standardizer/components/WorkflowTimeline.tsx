'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: timeline stage badge styling                   */
/* ------------------------------------------------------------ */
import type { TimelineKind } from '../lib/types';

const KIND_BADGES: Record<TimelineKind, { label: string; classes: string; dot: string }> = {
  prep: { label: 'Prep', classes: 'bg-info/10 text-info', dot: 'bg-info' },
  execution: { label: 'Execution', classes: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  wait: { label: 'Wait', classes: 'bg-surface-2 text-text-3 border border-border', dot: 'bg-border' },
  serve: { label: 'Serve', classes: 'bg-success/10 text-success', dot: 'bg-success' },
};

import { ChevronRight, Hourglass, Link2, Timer } from 'lucide-react';
import type { NormalizedTimelineEntry } from '../lib/workflow';

function TimeChips({ activeTime, passiveTime }: { activeTime: string; passiveTime: string }) {
  if (!activeTime && !passiveTime) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {activeTime && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
          <Timer size={12} /> {activeTime} active
        </span>
      )}
      {passiveTime && (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 border border-border px-2 py-0.5 text-xs text-text-3">
          <Hourglass size={12} /> {passiveTime}
        </span>
      )}
    </div>
  );
}

function AlternativesDisclosure({ entry }: { entry: NormalizedTimelineEntry }) {
  const { alternatives } = entry.entry;
  if (alternatives.length === 0) return null;
  return (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1 rounded text-xs text-text-3 hover:text-text-2 focus-ring">
        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
        Alternative timing
      </summary>
      <ul className="mt-1.5 space-y-1.5 ps-4">
        {alternatives.map((alt, i) => (
          <li key={i} className="text-xs text-text-2 space-y-1">
            <p className="font-medium text-text">{alt.label}</p>
            <TimeChips activeTime={alt.activeTime} passiveTime={alt.passiveTime} />
            {alt.note && <p className="text-text-3">{alt.note}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function EntryContent({ item, compact }: { item: NormalizedTimelineEntry; compact?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className={`font-medium text-text ${compact ? 'text-sm' : ''}`}>{item.title}</p>
      {item.detail && <p className="text-sm text-text-2">{item.detail}</p>}
      <TimeChips activeTime={item.entry.activeTime} passiveTime={item.entry.passiveTime} />
      {item.afterNames.length > 0 && (
        <p className="flex items-center gap-1 text-xs text-text-3">
          <Link2 size={12} /> After: {item.afterNames.join(', ')}
        </p>
      )}
      <AlternativesDisclosure entry={item} />
      {item.nested.length > 0 && (
        <ol className="mt-2 space-y-3 border-s border-dashed border-border ps-3">
          {item.nested.map((nested) => (
            <li key={nested.entry.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGES[nested.entry.kind].classes}`}>
                  Meanwhile · {KIND_BADGES[nested.entry.kind].label}
                </span>
                {nested.entry.phaseLabel && (
                  <span className="text-xs uppercase tracking-wide text-text-3">{nested.entry.phaseLabel}</span>
                )}
              </div>
              <EntryContent item={nested} compact />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The recommended workflow path as one responsive vertical timeline.
 * Phone: a single rail with the stage badge and phase label above the
 * title, and each fact on its own line. Desktop (sm+): a two-column grid
 * (badge/phase | content) for stable alignment. Work that overlaps a wait
 * nests under it; alternative timing paths live in a collapsed disclosure.
 * Everything references the structured sections/groups/steps — the timeline
 * carries no second copy of the instructions.
 */
export default function WorkflowTimeline({ timeline }: { timeline: NormalizedTimelineEntry[] }) {
  if (timeline.length === 0) {
    return <p className="text-sm text-text-3">This recipe has no timeline entries.</p>;
  }
  return (
    <ol>
      {timeline.map((item, i) => {
        const badge = KIND_BADGES[item.entry.kind];
        return (
          <li key={item.entry.id} className="relative ps-6 pb-5 last:pb-0">
            <span aria-hidden className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${badge.dot}`} />
            {i < timeline.length - 1 && (
              <span aria-hidden className="absolute left-[4px] top-5 bottom-0 w-px bg-border" />
            )}
            <div className="sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 sm:mb-0 sm:block sm:space-y-1">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.classes}`}>
                  {badge.label}
                </span>
                {item.entry.phaseLabel && (
                  <span className="block text-xs uppercase tracking-wide text-text-3">{item.entry.phaseLabel}</span>
                )}
              </div>
              <EntryContent item={item} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
