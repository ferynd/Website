import type { Trip, TripParticipant } from '../pageTypes';

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

const shorten = (value: string): string => (value.length > 100 ? `${value.slice(0, 97)}…` : value);

/**
 * Expenses and payments that still reference this traveler. A stored share or
 * payment counts even when its amount is zero or otherwise invalid, because
 * deleting the traveler would orphan that record.
 */
export function participantRemovalBlockers(
  trip: Pick<Trip, 'participants' | 'expenses' | 'payments'>,
  id: string,
): string[] {
  const nameOf = (participantId: string) =>
    trip.participants.find((person) => person.id === participantId)?.name ?? 'Unknown traveler';

  const expenses = trip.expenses
    .filter((expense) =>
      // Legacy or hand-edited documents may omit these fields (ledger.ts treats
      // them as optional too); a missing field must not crash rendering.
      Object.prototype.hasOwnProperty.call(expense.paidBy ?? {}, id) ||
      (expense.splitParticipants ?? []).includes(id) ||
      Object.prototype.hasOwnProperty.call(expense.manualSplit ?? {}, id),
    )
    .map((expense) => `Expense: ${shorten(expense.description || 'Untitled expense')}`);

  const payments = trip.payments
    .filter((payment) => payment.payerId === id || payment.payeeId === id)
    .map((payment) => {
      const pair = `${shorten(nameOf(payment.payerId))} to ${shorten(nameOf(payment.payeeId))}`;
      const note = payment.description ? ` (${shorten(payment.description)})` : '';
      return `Payment: ${pair}${note}`;
    });

  return [...expenses, ...payments];
}

/** Lists up to five blocking records, then how many more were left out. */
export function participantRemovalMessage(blockers: string[]): string {
  const visible = blockers.slice(0, 5).join('; ');
  const more = blockers.length > 5 ? `; and ${blockers.length - 5} more records` : '';
  return `Remove or reassign these records first: ${visible}${more}.`;
}
