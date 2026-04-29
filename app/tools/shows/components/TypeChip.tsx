import type { ShowType } from '../types';

const LABELS: Record<ShowType, string> = {
  anime:          'Anime',
  tv:             'TV Show',
  movie:          'Movie',
  animated_movie: 'Animated Movie',
};

export default function TypeChip({ type }: { type: ShowType }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2 border border-border">
      {LABELS[type]}
    </span>
  );
}
