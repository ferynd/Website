import type { TripParticipant } from '../pageTypes';

/** A blank payer is safe to default only for one unambiguous account link. */
export function uniqueLinkedParticipant(
  participants: TripParticipant[],
  uid: string | undefined,
): TripParticipant | undefined {
  if (!uid) return undefined;
  const matches = participants.filter(participant => participant.userId === uid);
  return matches.length === 1 ? matches[0] : undefined;
}
