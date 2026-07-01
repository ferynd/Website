'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import type { FilterStatus, FilterType, SortOption, ShowList } from '../types';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import Chip from './Chip';

interface Props {
  statusFilter: FilterStatus;
  typeFilter: FilterType;
  vibeFilter: string | null;
  watcherFilter: string | null;
  sort: SortOption;
  members: ShowList['members'];
  onStatusFilter: (v: FilterStatus) => void;
  onTypeFilter: (v: FilterType) => void;
  onVibeFilter: (v: string | null) => void;
  onWatcherFilter: (v: string | null) => void;
  onSort: (v: SortOption) => void;
}

const STATUS_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'watching',  label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_hold',   label: 'On Hold' },
  { value: 'planned',   label: 'Planned' },
  { value: 'dropped',   label: 'Dropped' },
];

const TYPE_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all',            label: 'All Types' },
  { value: 'anime',          label: 'Anime' },
  { value: 'tv',             label: 'TV Show' },
  { value: 'movie',          label: 'Movie' },
  { value: 'animated_movie', label: 'Animated Movie' },
  { value: 'cartoon',        label: 'Cartoon' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'updated',    label: 'Recent' },
  { value: 'score',      label: 'Score' },
  { value: 'alpha',      label: 'A–Z' },
  { value: 'seasons',    label: 'Most Seasons' },
  { value: 'incomplete', label: 'Needs Review' },
];

export default function FilterBar({
  statusFilter, typeFilter, vibeFilter, watcherFilter, sort, members,
  onStatusFilter, onTypeFilter, onVibeFilter, onWatcherFilter, onSort,
}: Props) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (typeFilter !== 'all' ? 1 : 0) +
    (vibeFilter ? 1 : 0) +
    (watcherFilter ? 1 : 0);

  return (
    <div className="space-y-2">
      {/* Sort — always visible, used most often while scanning */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <span className="text-xs text-text-3 flex-shrink-0">Sort</span>
        {SORT_OPTIONS.map(({ value, label }) => (
          <Chip key={value} label={label} active={sort === value} onClick={() => onSort(value)} />
        ))}
      </div>

      {/* Filters — collapsed by default to keep the list dense on mobile */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-text-2 hover:text-text hover:bg-surface-2 transition-colors min-h-[44px]"
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal size={14} />
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-accent/20 text-accent text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                {activeCount}
              </span>
            )}
          </span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {open && (
          <div className="px-3 pb-3 pt-1 border-t border-border space-y-2">
            {/* Status */}
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={statusFilter === value} onClick={() => onStatusFilter(value)} />
              ))}
            </div>

            {/* Type */}
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {TYPE_OPTIONS.map(({ value, label }) => (
                <Chip key={value} label={label} active={typeFilter === value} onClick={() => onTypeFilter(value)} />
              ))}
            </div>

            {/* Vibes */}
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              <Chip label="Any vibe" active={vibeFilter === null} onClick={() => onVibeFilter(null)} />
              {VIBE_CATEGORIES.map((v) => (
                <Chip
                  key={v}
                  label={v}
                  active={vibeFilter === v}
                  onClick={() => onVibeFilter(vibeFilter === v ? null : v)}
                />
              ))}
            </div>

            {/* Watchers */}
            {members.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                <Chip label="Everyone" active={watcherFilter === null} onClick={() => onWatcherFilter(null)} />
                {members.map((m) => (
                  <Chip
                    key={m.uid}
                    label={m.displayName}
                    active={watcherFilter === m.uid}
                    onClick={() => onWatcherFilter(watcherFilter === m.uid ? null : m.uid)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
