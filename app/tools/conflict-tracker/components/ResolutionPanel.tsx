"use client";

import type { Conflict, Tracker } from '../lib/types';

const STATUS_LABEL: Record<Conflict['status'], string> = {
  open: 'Open',
  partially_resolved: 'Partially resolved',
  resolved: 'Resolved',
};

interface Props {
  conflict: Conflict;
  tracker: Tracker;
  /** The current user's derived side, or null if unclaimed. */
  userSide: 'personA' | 'personB' | null;
  isAdmin: boolean;
  /** Called when the current user toggles their own resolution. Context enforces ownership. */
  onToggle: (resolved: boolean) => Promise<void>;
}

export default function ResolutionPanel({ conflict, tracker, userSide, isAdmin, onToggle }: Props) {
  const aName = tracker.personAName || 'Person A';
  const bName = tracker.personBName || 'Person B';

  // A user can only toggle their own side. Admin can toggle either (defaults to their claimed side).
  const canToggleA = userSide === 'personA' || isAdmin;
  const canToggleB = userSide === 'personB' || isAdmin;

  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text">Resolution</h3>
        <span className={`text-xs rounded-full px-3 py-1 border ${
          conflict.status === 'resolved'
            ? 'bg-green-900/30 text-green-300 border-green-700/40'
            : conflict.status === 'partially_resolved'
            ? 'bg-blue-900/30 text-blue-300 border-blue-700/40'
            : 'bg-orange-900/30 text-orange-300 border-orange-700/40'
        }`}>
          {STATUS_LABEL[conflict.status]}
        </span>
      </div>

      <p className="text-xs text-text-3">
        A conflict is only marked resolved when both people feel resolved.
      </p>

      <div className="space-y-3">
        <label className={`flex items-center gap-3 ${canToggleA ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            disabled={!canToggleA}
            checked={conflict.personAResolved}
            onChange={(e) => onToggle(e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-sm text-text">{aName} feels resolved</span>
        </label>

        <label className={`flex items-center gap-3 ${canToggleB ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            disabled={!canToggleB}
            checked={conflict.personBResolved}
            onChange={(e) => onToggle(e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-sm text-text">{bName} feels resolved</span>
        </label>
      </div>

      {!userSide && !isAdmin && (
        <p className="text-xs text-text-3">Claim a side to mark your resolution.</p>
      )}
    </div>
  );
}
