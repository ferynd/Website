"use client";

import { Plus } from 'lucide-react';
import Button from '@/components/Button';
import type { Conflict, Tracker } from '../lib/types';

const SEVERITY_LABEL: Record<number, string> = {
  1: 'Very low',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Very high',
};

const SEVERITY_COLOR: Record<number, string> = {
  1: 'text-green-400',
  2: 'text-yellow-400',
  3: 'text-orange-400',
  4: 'text-red-400',
  5: 'text-red-500',
};

const STATUS_LABEL: Record<Conflict['status'], string> = {
  open: 'Open',
  partially_resolved: 'Partially resolved',
  resolved: 'Resolved',
};

const STATUS_COLOR: Record<Conflict['status'], string> = {
  open: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  partially_resolved: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  resolved: 'bg-green-900/40 text-green-300 border-green-700/40',
};

interface Props {
  conflicts: Conflict[];
  tracker: Tracker;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function ConflictList({ conflicts, tracker, loading, onSelect, onNew }: Props) {
  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Conflicts</h2>
        <Button variant="primary" onClick={onNew} className="inline-flex items-center gap-2">
          <Plus size={16} />
          Log a conflict
        </Button>
      </div>

      {loading && (
        <p className="text-text-2 text-sm">Loading…</p>
      )}

      {!loading && conflicts.length === 0 && (
        <div className="rounded-xl border border-border bg-surface-1 p-10 text-center">
          <p className="text-text-2">No conflicts logged yet.</p>
          <p className="mt-2 text-sm text-text-3">
            Use this after things have cooled down. Capture your side honestly, then compare
            reflections to understand what was felt, what was meant, and what needs to change.
          </p>
          <Button variant="primary" onClick={onNew} className="mt-6 inline-flex items-center gap-2">
            <Plus size={16} />
            Log a conflict
          </Button>
        </div>
      )}

      {!loading && conflicts.length > 0 && (
        <ul className="space-y-3">
          {conflicts.map((conflict) => (
            <li key={conflict.id}>
              <button
                type="button"
                onClick={() => onSelect(conflict.id)}
                className="group w-full text-left rounded-xl border border-border bg-surface-1 p-5 shadow-sm transition-all hover:shadow-md hover:scale-[1.01] focus-ring"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-text truncate">{conflict.title}</span>
                      <span
                        className={`text-xs border rounded-full px-2 py-0.5 ${STATUS_COLOR[conflict.status]}`}
                      >
                        {STATUS_LABEL[conflict.status]}
                      </span>
                    </div>
                    <p className="text-sm text-text-3">{conflict.date}</p>
                    {conflict.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {conflict.tags.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-surface-2 border border-border rounded-full px-2 py-0.5 text-text-2"
                          >
                            {tag}
                          </span>
                        ))}
                        {conflict.tags.length > 4 && (
                          <span className="text-xs text-text-3">+{conflict.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <span className={`text-sm font-medium ${SEVERITY_COLOR[conflict.severity]}`}>
                      {SEVERITY_LABEL[conflict.severity]}
                    </span>
                    <div className="flex gap-2 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 border ${conflict.personAResolved
                          ? 'bg-green-900/30 text-green-300 border-green-700/40'
                          : 'bg-surface-2 text-text-3 border-border'
                        }`}
                      >
                        {aName} {conflict.personAResolved ? '✓' : '○'}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 border ${conflict.personBResolved
                          ? 'bg-green-900/30 text-green-300 border-green-700/40'
                          : 'bg-surface-2 text-text-3 border-border'
                        }`}
                      >
                        {bName} {conflict.personBResolved ? '✓' : '○'}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
