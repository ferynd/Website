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
  // Mirrored flags for cheap list rendering
  hasReflectionA: boolean;
  hasReflectionB: boolean;
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
