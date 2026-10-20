"use client";

export interface Tracker {
  id: string;
  name: string;
  personAUid: string;
  personAName: string;
  personBUid: string | null;
  personBEmail: string | null;
  personBName: string;
  /** All UIDs with access — [personAUid, personBUid once claimed]. Used for array-contains queries. */
  memberUids: string[];
  /** Invited emails before claiming — used so Person B can see the tracker before signing up. */
  memberEmails: string[];
  customTags: string[];
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Conflict {
  id: string;
  trackerId: string;
  title: string;
  date: string;
  severity: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  summary?: string;
  // Shared section — unlocks once both reflections are submitted
  personARealMeaning?: string;
  personBRealMeaning?: string;
  sharedClarification?: string;
  sharedOwnershipNotes?: string;
  sharedNextSteps?: string;
  sharedUpdatedBy?: string;
  sharedUpdatedAt?: unknown;
  // Resolution
  personAResolved: boolean;
  personBResolved: boolean;
  status: 'open' | 'partially_resolved' | 'resolved';
  // Mirrored flags for cheap list rendering — true once a draft exists,
  // whether or not it has been submitted. Never gates the shared-section
  // reveal; see personASubmittedAt/personBSubmittedAt for that (F-069).
  hasReflectionA: boolean;
  hasReflectionB: boolean;
  /**
   * Server-validated mirror of each side's reflection `submittedAt` — null
   * until that side has genuinely submitted (not merely drafted). Firestore
   * rules only allow this to transition null -> the exact timestamp already
   * present on that side's own reflection document, so it can't be forged
   * independent of a real submission. This (not hasReflectionA/B) is the
   * only trustworthy reveal signal for the shared section and the
   * partner-reflection read rule (F-036/F-069).
   */
  personASubmittedAt: unknown;
  personBSubmittedAt: unknown;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

/** User-entered fields only. System fields (person, authorUid, conflictId, timestamps) are injected by the context/db layer. */
export interface ReflectionInput {
  trigger?: string;
  whatHappened: string;
  whatIFelt: string;
  physicalOrEmotionalSignals?: string;
  whatIThoughtTheyMeant: string;
  whatIFeltHurtBy?: string;
  whatINeeded: string;
  whatHelped?: string;
  whatMadeItWorse?: string;
  whatIAmOwning: string;
  whatIWillDoDifferently: string;
  unresolvedPieces?: string;
  tags: string[];
  feelsResolved: 'yes' | 'no' | 'partially';
}

export interface Reflection extends ReflectionInput {
  id: 'personA' | 'personB';
  person: 'personA' | 'personB';
  conflictId: string;
  authorUid: string;
  submittedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export type SharedSectionPatch = Partial<
  Pick<
    Conflict,
    | 'personARealMeaning'
    | 'personBRealMeaning'
    | 'sharedClarification'
    | 'sharedOwnershipNotes'
    | 'sharedNextSteps'
  >
>;
