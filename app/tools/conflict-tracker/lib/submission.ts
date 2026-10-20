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
