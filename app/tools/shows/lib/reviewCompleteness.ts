import type { Show, MemberRating } from '../types';
import { isRatable } from './compositeScore';

/** Required fields for a member's review of a show to count as "complete". Brain power is context-only and intentionally excluded. */
export function isReviewComplete(rating: MemberRating | undefined): boolean {
  if (!rating) return false;
  return (
    rating.story !== null &&
    rating.characters !== null &&
    rating.vibes !== null &&
    rating.wouldRewatch !== null
  );
}

/**
 * A show counts as "needing review" from a given member when it has reached a
 * ratable status (completed/dropped/on_hold) and that member either watched it
 * (is in `watchers`, or already has a partial rating) but hasn't finished rating it.
 */
export function needsReview(show: Show, uid: string): boolean {
  if (!isRatable(show.status)) return false;
  if (isReviewComplete(show.ratings[uid])) return false;
  const isWatcher = show.watchers.length === 0 || show.watchers.includes(uid);
  const hasStarted = Boolean(show.ratings[uid]);
  return isWatcher || hasStarted;
}

export function showsNeedingReview(shows: Show[], uid: string): Show[] {
  return shows.filter((s) => needsReview(s, uid));
}
