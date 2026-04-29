'use client';

import type { FilterStatus, FilterType, SortOption, ShowList } from '../types';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';

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

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium border transition-colors min-h-[36px] ${
        active
          ? 'bg-accent/20 text-accent border-accent/40'
          : 'bg-surface-2 text-text-2 border-border hover:border-accent/30'
      }`}
    >
      {label}
    </button>
  );
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
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'updated', label: 'Recent' },
  { value: 'score',   label: 'Score' },
  { value: 'alpha',   label: 'A–Z' },
];

export default function FilterBar({
  statusFilter, typeFilter, vibeFilter, watcherFilter, sort, members,
  onStatusFilter, onTypeFilter, onVibeFilter, onWatcherFilter, onSort,
}: Props) {
  return (
    <div className="space-y-2">
      {/* Status */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {STATUS_OPTIONS.map(({ value, label }) => (
          <Chip
            key={value}
            label={label}
            active={statusFilter === value}
            onClick={() => onStatusFilter(value)}
          />
        ))}
      </div>

      {/* Type + Sort */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {TYPE_OPTIONS.map(({ value, label }) => (
          <Chip
            key={value}
            label={label}
            active={typeFilter === value}
            onClick={() => onTypeFilter(value)}
          />
        ))}
        <div className="w-px bg-border flex-shrink-0 mx-1" />
        {SORT_OPTIONS.map(({ value, label }) => (
          <Chip
            key={value}
            label={label}
            active={sort === value}
            onClick={() => onSort(value)}
          />
        ))}
      </div>

      {/* Vibes */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <Chip
          label="Any vibe"
          active={vibeFilter === null}
          onClick={() => onVibeFilter(null)}
        />
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
          <Chip
            label="Everyone"
            active={watcherFilter === null}
            onClick={() => onWatcherFilter(null)}
          />
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
  );
}
