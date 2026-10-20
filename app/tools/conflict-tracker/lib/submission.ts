import { Timestamp } from 'firebase/firestore';

/** Truthy strings/flags and unresolved local timestamps must never reveal drafts. */
export const isSubmissionTimestamp = (value: unknown): value is Timestamp =>
  value instanceof Timestamp;

export const bothSubmitted = (conflict: {
  personASubmittedAt?: unknown;
  personBSubmittedAt?: unknown;
}): boolean =>
  isSubmissionTimestamp(conflict.personASubmittedAt)
  && isSubmissionTimestamp(conflict.personBSubmittedAt);

type Side = 'personA' | 'personB';
export const mirrorField = (side: Side) =>
  side === 'personA' ? 'personASubmittedAt' as const : 'personBSubmittedAt' as const;
export const draftFlagField = (side: Side) =>
  side === 'personA' ? 'hasReflectionA' as const : 'hasReflectionB' as const;

/**
 * Self-heal for submissions made before mirrors existed: if the caller's OWN
 * reflection is genuinely submitted but their side's parent mirror is
 * missing/null, return the exact patch the rules accept (mirror == the
 * reflection's submittedAt, plus the draft flag). Never touches the partner
 * side, never returns content, and returns null whenever anything is off.
 */
export function selfHealPatch(
  side: Side,
  uid: string,
  conflictId: string,
  conflict: Record<string, unknown> | undefined,
  ownReflection: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!conflict || !ownReflection || !uid) return null;
  if (conflict[mirrorField(side)] != null) return null;
  const submittedAt = ownReflection.submittedAt;
  if (!isSubmissionTimestamp(submittedAt)) return null;
  if (ownReflection.authorUid !== uid || ownReflection.id !== side
    || ownReflection.person !== side || ownReflection.conflictId !== conflictId) return null;
  return { [mirrorField(side)]: submittedAt, [draftFlagField(side)]: true };
}

/** A reflection with a submission timestamp can never be saved back to a draft. */
export const isLockedSubmission = (reflection: Record<string, unknown> | undefined): boolean =>
  reflection?.submittedAt != null;

export const CANONICAL_REFLECTION_IDS = ['personA', 'personB'] as const;
/**
 * Reflection IDs to delete with a conflict: every document the caller could
 * enumerate plus the two canonical IDs (listing is denied pre-reveal under the
 * AR-03 rules, so `listed` is null there and only canonical IDs are known).
 */
export const reflectionIdsToDelete = (listed: readonly string[] | null): string[] =>
  [...new Set([...CANONICAL_REFLECTION_IDS, ...(listed ?? [])])];
