'use client';

import { Sparkles, X, CheckSquare, Square } from 'lucide-react';

interface Props {
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onCancel: () => void;
  onAiUpdate: () => void;
}

/** Sticky action bar shown while selection mode is active on the watchlist. */
export default function SelectionToolbar({
  selectedCount, visibleCount, allVisibleSelected, onSelectAllVisible, onCancel, onAiUpdate,
}: Props) {
  return (
    <div className="fixed bottom-16 inset-x-0 z-30 border-t border-border bg-surface-1/95 backdrop-blur-md px-4 py-3">
      <div className="max-w-2xl mx-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onSelectAllVisible}
          className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px]"
        >
          {allVisibleSelected ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
          {allVisibleSelected ? 'Clear' : `Select all (${visibleCount})`}
        </button>

        <span className="text-xs text-text-3 flex-1 text-center">{selectedCount} selected</span>

        <button
          type="button"
          onClick={onAiUpdate}
          disabled={selectedCount === 0}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg disabled:opacity-40 transition-opacity min-h-[44px]"
        >
          <Sparkles size={14} /> AI update
        </button>

        <button
          type="button"
          onClick={onCancel}
          title="Exit selection"
          className="rounded-lg p-2 text-text-3 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
