import type { Timestamp } from 'firebase/firestore';

export interface Person {
  id: string;
  name: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  firstName: string;
  lastInitial: string;
  isAdmin: boolean;
  createdAt?: Timestamp;
}

export interface TripParticipant {
  id: string;
  name: string;
  userId?: string;
  isRegistered: boolean;
  addedBy: string;
}

/** Per-participant spending cap with overage redistribution config */
export interface SpendCap {
  participantId: string;
  maxAmount: number;
}

/**
 * Defines how overage from capped participants is redistributed.
 * 'even' = spread equally among remaining uncapped participants.
 * 'manual' = use specific percentages keyed by participant ID.
 */
export interface OverageSplit {
  type: 'even' | 'manual';
  /** Only used when type === 'manual'. Maps participantId → percentage (0–100). */
  shares?: { [participantId: string]: number };
}

/**
 * Trip-level default split applied to new expenses when no manual split is specified.
 * Maps participantId → percentage (0–100). Values should sum to 100.
 */
export type DefaultSplit = { [participantId: string]: number };

export interface Expense {
  id: string;
  category: string;
  description: string;
  totalAmount: number;
  paidBy: { [personId: string]: number };
  splitType: 'even' | 'manual';
  splitParticipants: string[];
  manualSplit: {
    [personId: string]: { type: 'percent' | 'amount'; value: number };
  };
  createdBy: string;
  createdAt?: Timestamp;
}

export interface Payment {
  id: string;
  payerId: string;
  payeeId: string;
  date: string;
  description: string;
  amount: number;
  createdBy?: string;
  createdAt?: Timestamp;
}

export interface Trip {
  id: string;
  name: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  participants: TripParticipant[];
  participantIds: string[];
  expenses: Expense[];
  payments: Payment[];
  /** Per-participant spending caps */
  spendCaps?: SpendCap[];
  /** How overage above caps is redistributed */
  overageSplit?: OverageSplit;
  /** Trip-wide default split percentages (participantId → %) */
  defaultSplit?: DefaultSplit;
}

// Draft types for form state
export type ExpenseDraft = {
  category: string;
  description: string;
  totalAmount: string;
  paidBy: Record<string, string>;
  splitType: 'even' | 'manual';
  splitParticipants: string[];
  manualSplit: Record<string, { type: 'amount' | 'percent'; value: string }>;
  /** When manual, whether the user is entering dollars or percentages */
  manualSplitMode: 'amount' | 'percent';
};

export interface AuditEntry {
  id: string;
  type: string;
  actorUid: string | null;
  actorEmail: string | null;
  ts?: Timestamp;
  details?: unknown;
}

export interface Balance {
  personId: string;
  name: string;
  totalPaid: number;
  shouldHavePaid: number;
  balance: number;
}

/** Balance after spend caps have been applied */
export interface CappedBalance extends Balance {
  /** Original shouldHavePaid before cap enforcement */
  rawShouldHavePaid: number;
  /** true when cap has been hit */
  isCapped: boolean;
  capAmount?: number;
}
