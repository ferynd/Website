"use client";

export interface Tracker {
  id: string;
  name: string;
  personAUid: string;
  personAName: string;
  personBUid: string | null;
  personBEmail: string | null;
  personBName: string;
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
  sharedClarification?: string;
  personARealMeaning?: string;
  personBRealMeaning?: string;
  personAResolved: boolean;
  personBResolved: boolean;
  status: 'open' | 'partially_resolved' | 'resolved';
  hasReflectionA: boolean;
  hasReflectionB: boolean;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Reflection {
  id: 'personA' | 'personB';
  person: 'personA' | 'personB';
  conflictId: string;
  authorUid: string;
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
  submittedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}
