'use client';

import { Check } from 'lucide-react';
import type { Show, ShowList } from '../types';
import StatusBadge from './StatusBadge';
import TypeChip from './TypeChip';
import VibeTagChip from './VibeTagChip';
import MemberAvatars from './MemberAvatars';
import { groupComposite, formatScore } from '../lib/compositeScore';
import { needsReview } from '../lib/reviewCompleteness';

interface Props {
  show: Show;
  members: ShowList['members'];
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  currentUid?: string;
}

function serviceIcon(service: string | null): string {
  if (!service) return '';
  const s = service.toLowerCase();
  if (s.includes('crunchyroll')) return 'CR';
  if (s.includes('netflix')) return 'N';
  if (s.includes('hulu')) return 'H';
  if (s.includes('max')) return 'M';
  if (s.includes('prime') || s.includes('amazon')) return 'P';
  if (s.includes('disney')) return 'D+';
  if (s.includes('apple')) return '🍎';
  if (s.includes('peacock')) return '🦚';
  if (s.includes('dropout')) return 'DO';
  return service.slice(0, 2).toUpperCase();
}

export default function ShowCard({ show, members, onClick, selectMode = false, selected = false, currentUid }: Props) {
  const composite = groupComposite(show);
  const hasEpisode =
    (show.type === 'anime' || show.type === 'tv' || show.type === 'cartoon') &&
    (show.status === 'watching' || show.status === 'on_hold') &&
    (show.currentEpisode !== null || show.currentSeason !== null);
  const incomplete = currentUid ? needsReview(show, currentUid) : false;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-surface-1 p-4 hover:border-accent/30 hover:shadow-md transition-all duration-150 focus-ring active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        {selectMode && (
          <span
            className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
              selected ? 'bg-accent border-accent' : 'border-border bg-surface-2'
            }`}
          >
            {selected && <Check size={13} className="text-bg" strokeWidth={3} />}
          </span>
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-text leading-snug flex items-center gap-1.5">
              {show.title}
              {incomplete && (
                <span title="Missing review data" className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
              )}
            </h3>
            {composite !== null && (
              <span className="flex-shrink-0 text-sm font-bold text-accent">
                {formatScore(composite)}
              </span>
            )}
          </div>

          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeChip type={show.type} />
            <StatusBadge status={show.status} />
            {hasEpisode && (
              <span className="text-xs text-text-3">
                {show.currentSeason !== null && `S${show.currentSeason} `}
                {show.currentEpisode !== null && `E${show.currentEpisode}`}
              </span>
            )}
          </div>

          {/* Vibe tags */}
          {show.vibeTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {show.vibeTags.map((tag) => (
                <VibeTagChip key={tag} tag={tag} />
              ))}
            </div>
          )}

          {/* Footer row */}
          <div className="flex items-center justify-between pt-0.5">
            <MemberAvatars members={members} watcherUids={show.watchers} />
            {show.service && (
              <span className="text-xs text-text-3 font-medium">
                {serviceIcon(show.service)} {show.service}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
