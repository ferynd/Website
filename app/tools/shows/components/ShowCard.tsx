'use client';

import type { Show, ShowList } from '../types';
import StatusBadge from './StatusBadge';
import TypeChip from './TypeChip';
import VibeTagChip from './VibeTagChip';
import MemberAvatars from './MemberAvatars';
import { groupComposite, formatScore } from '../lib/compositeScore';

interface Props {
  show: Show;
  members: ShowList['members'];
  onClick: () => void;
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

export default function ShowCard({ show, members, onClick }: Props) {
  const composite = groupComposite(show);
  const hasEpisode =
    (show.type === 'anime' || show.type === 'tv' || show.type === 'cartoon') &&
    (show.status === 'watching' || show.status === 'on_hold') &&
    (show.currentEpisode !== null || show.currentSeason !== null);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-surface-1 p-4 hover:border-accent/30 hover:shadow-md transition-all duration-150 focus-ring active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-text leading-snug">{show.title}</h3>
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
