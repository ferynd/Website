'use client';

import { Check } from 'lucide-react';
import type { Show, ShowList } from '../types';
import { StatusDot, statusLabel } from './StatusBadge';
import { groupComposite, formatScore } from '../lib/compositeScore';
import { needsReview } from '../lib/reviewCompleteness';

const TYPE_ABBR: Record<Show['type'], string> = {
  anime: 'Anime',
  tv: 'TV',
  movie: 'Movie',
  animated_movie: 'Anim. Movie',
  cartoon: 'Cartoon',
};

interface Props {
  show: Show;
  members: ShowList['members'];
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  currentUid?: string;
}

/** Compact single-line-per-show layout for scanning large lists on mobile. */
export default function ShowRow({ show, onClick, selectMode = false, selected = false, currentUid }: Props) {
  const composite = groupComposite(show);
  const hasEpisode =
    (show.type === 'anime' || show.type === 'tv' || show.type === 'cartoon') &&
    (show.currentEpisode !== null || show.currentSeason !== null);
  const incomplete = currentUid ? needsReview(show, currentUid) : false;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 min-h-[52px] border-b border-border hover:bg-surface-2/60 active:bg-surface-2 transition-colors focus-ring"
    >
      {selectMode && (
        <span
          className={`flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
            selected ? 'bg-accent border-accent' : 'border-border bg-surface-2'
          }`}
        >
          {selected && <Check size={13} className="text-bg" strokeWidth={3} />}
        </span>
      )}

      <StatusDot status={show.status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-text truncate">{show.title}</span>
          {incomplete && (
            <span
              title="Missing review data"
              className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-warning"
            />
          )}
        </div>
        <p className="text-xs text-text-3 truncate">
          {TYPE_ABBR[show.type]} · {statusLabel(show.status)}
          {hasEpisode && (
            <>
              {' · '}
              {show.currentSeason !== null && `S${show.currentSeason}`}
              {show.currentEpisode !== null && `E${show.currentEpisode}`}
            </>
          )}
          {show.totalSeasons !== null && ` · ${show.totalSeasons}S total`}
        </p>
      </div>

      {composite !== null && (
        <span className="flex-shrink-0 text-sm font-bold text-accent">{formatScore(composite)}</span>
      )}
    </button>
  );
}
