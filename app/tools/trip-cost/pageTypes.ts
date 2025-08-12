import type { Timestamp } from 'firebase/firestore';

// ===============================
// CONFIGURATION (manual inputs)
// ===============================
// None - purely type declarations

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

export interface Expense {
  id: string;
  category: string;
  description: string;
  totalAmount: number;
  paidBy: { [personId: string]: number };
  splitType: 'even' | 'manual';
  splitParticipants: string[];
  manualSplit: { [personId: string]: { type: 'percent' | 'amount'; value: number } };
  createdBy?: string;
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
}

// Draft types for form state
export type ExpenseDraft = Omit<Expense, 'id' | 'totalAmount' | 'paidBy' | 'manualSplit'> & {
  id?: string;
  totalAmount: string;
  paidBy: { [personId: string]: string };
  manualSplit: { [personId: string]: { type: 'percent' | 'amount'; value: string } };
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

