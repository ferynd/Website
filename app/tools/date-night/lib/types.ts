import type { Timestamp } from 'firebase/firestore';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Date Night Roulette domain contracts          */
/* ------------------------------------------------------------ */

export type DateNightRarity = 'common' | 'uncommon' | 'rare' | 'veryRare';
export type DateNightFrequency = 'anytime' | 'biweekly' | 'monthly' | 'quarterly' | 'biannual' | 'annual';

export interface DateNightPoolItem {
  id: string;
  kind: 'date' | 'modifier';
  name: string;
  description?: string;
  rarity: DateNightRarity;
  frequency: DateNightFrequency;
  baseWeight: number;
  decayEnabled: boolean;
  timesPicked: number;
  timesVetoed: number;
  timesAccepted: number;
  lastAcceptedAt?: string;
  createdAt?: string | Timestamp;
  updatedAt?: string | Timestamp;
}

export interface DateNightSettings {
  rarityWeights: Record<DateNightRarity, number>;
  stackingDefault: Record<string, number>;
  stackingHigher: Record<string, number>;
  decayRatePerWeek: number;
  decayCap: number;
}

export interface DateNightReview {
  score: number;
  liked?: string;
  disliked?: string;
  notes?: string;
  submittedAt: string;
}

export interface DateNightPhoto {
  url: string;
  storagePath: string;
  uploadedAt: string;
}

export interface DateNightRoll {
  id: string;
  status: 'pending-review' | 'completed' | 'archived-no-review';
  date: { id: string; name: string; rarity: DateNightRarity };
  modifiers: Array<{ id: string; name: string; rarity: DateNightRarity }>;
  reviews: Partial<Record<'a' | 'b', DateNightReview>>;
  photos: DateNightPhoto[];
  vetoCount: number;
  createdAt?: string | Timestamp;
  updatedAt?: string | Timestamp;
}

export interface DateNightCoupleDoc {
  participantUids: string[];
  displayNames: Record<string, string>;
  createdAt?: string | Timestamp;
  updatedAt?: string | Timestamp;
}

export interface RollCandidate {
  date: DateNightPoolItem;
  modifiers: DateNightPoolItem[];
  modifierCountRequested: number;
}

export interface WheelSlice {
  id: string;
  label: string;
  weight: number;
}
