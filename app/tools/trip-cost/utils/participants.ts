import type { TripParticipant } from '../pageTypes';

/* ------------------------------------------------------------------ */
/*  Participant identity helpers                                       */
/* ------------------------------------------------------------------ */

/**
 * The `participantIds` array that grants member access: each traveler's
 * linked account uid, or their participant id when unlinked (deduplicated,
 * trip order).
 */
export function participantIdsFor(participants: Pick<TripParticipant, 'id' | 'userId'>[]): string[] {
  const ids: string[] = [];
  for (const p of participants) {
    const key = p.userId || p.id;
    if (key && !ids.includes(key)) ids.push(key);
  }
  return ids;
}

/** The traveler already linked to `uid`, if any. */
export function participantForAccount(
  participants: TripParticipant[],
  uid: string | undefined,
): TripParticipant | undefined {
  if (!uid) return undefined;
  return participants.find((p) => p.userId === uid);
}

export type LinkAccountErrorCode =
  | 'participant-unknown'
  | 'uid-required'
  | 'uid-linked-elsewhere'
  | 'already-linked';

export type LinkAccountResult =
  | { ok: true; participants: TripParticipant[]; participantIds: string[] }
  | { ok: false; code: LinkAccountErrorCode; message: string };

/**
 * Links an existing traveler (e.g. one added by name) to a registered
 * account. The participant keeps its id and trip name, so every expense,
 * payment, and cap that references it is preserved; no new participant is
 * created. Refuses an account already linked to another traveler on the
 * trip, and a traveler already linked to a different account. Linking the
 * same account again is a no-op.
 */
export function linkParticipantAccount(
  participants: TripParticipant[],
  id: string,
  uid: string,
): LinkAccountResult {
  const target = participants.find((p) => p.id === id);
  if (!target) {
    return { ok: false, code: 'participant-unknown', message: "That traveler isn't on this trip." };
  }
  if (!uid) {
    return { ok: false, code: 'uid-required', message: 'Choose an account to link.' };
  }
  const linkedElsewhere = participants.find((p) => p.id !== id && p.userId === uid);
  if (linkedElsewhere) {
    return {
      ok: false,
      code: 'uid-linked-elsewhere',
      message: `That account is already linked to ${linkedElsewhere.name} on this trip.`,
    };
  }
  if (target.userId && target.userId !== uid) {
    return {
      ok: false,
      code: 'already-linked',
      message: `${target.name} is already linked to a different account.`,
    };
  }
  const updated = participants.map((p) =>
    p.id === id ? { ...p, userId: uid, isRegistered: true } : p,
  );
  return { ok: true, participants: updated, participantIds: participantIdsFor(updated) };
}
