import type { MemberRating, Show } from '../types';

export function memberComposite(rating: MemberRating): number | null {
  const { story, characters, vibes } = rating;
  if (story === null || characters === null || vibes === null) return null;
  return (story + characters + vibes) / 3;
}

export function groupComposite(show: Show): number | null {
  const composites = Object.values(show.ratings)
    .map(memberComposite)
    .filter((c): c is number => c !== null);
  if (composites.length === 0) return null;
  return composites.reduce((a, b) => a + b, 0) / composites.length;
}

export function formatScore(score: number | null): string {
  if (score === null) return '—';
  return score.toFixed(1);
}

export function isRatable(status: Show['status']): boolean {
  return status === 'completed' || status === 'dropped' || status === 'on_hold';
}
