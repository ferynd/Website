'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firestore root + date-night collection names  */
/* ------------------------------------------------------------ */

import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import type { DateNightPoolItem, DateNightRoll, DateNightSettings } from './types';

export const ROOT_COLLECTION = 'artifacts';
export const APP_ID = 'date-night';

export const coupleDoc = (): DocumentReference => doc(db, ROOT_COLLECTION, APP_ID, 'couples', 'main');
export const settingsDoc = (): DocumentReference => doc(db, ROOT_COLLECTION, APP_ID, 'settings', 'global');
export const datesCol = (): CollectionReference => collection(db, ROOT_COLLECTION, APP_ID, 'dates');
export const dateDoc = (id: string): DocumentReference => doc(db, ROOT_COLLECTION, APP_ID, 'dates', id);
export const modifiersCol = (): CollectionReference => collection(db, ROOT_COLLECTION, APP_ID, 'modifiers');
export const modifierDoc = (id: string): DocumentReference => doc(db, ROOT_COLLECTION, APP_ID, 'modifiers', id);
export const rollsCol = (): CollectionReference => collection(db, ROOT_COLLECTION, APP_ID, 'rolls');
export const rollDoc = (id: string): DocumentReference => doc(db, ROOT_COLLECTION, APP_ID, 'rolls', id);

export const DEFAULT_SETTINGS: DateNightSettings = {
  rarityWeights: { common: 60, uncommon: 25, rare: 12, veryRare: 3 },
  stackingDefault: { '0': 8, '1': 52, '2': 25, '3': 10, '4': 4, '5': 1 },
  stackingHigher: { '0': 0, '1': 30, '2': 35, '3': 20, '4': 10, '5': 5 },
  decayRatePerWeek: 0.1,
  decayCap: 4,
};

export const DEFAULT_POOL_ITEM = {
  name: '',
  description: '',
  rarity: 'common',
  frequency: 'anytime',
  baseWeight: 1,
  decayEnabled: true,
  timesPicked: 0,
  timesVetoed: 0,
  timesAccepted: 0,
} as const satisfies Omit<DateNightPoolItem, 'id' | 'kind'>;

export const ensureDateNightDefaults = async (user: User): Promise<void> => {
  const [coupleSnapshot, settingsSnapshot] = await Promise.all([
    getDoc(coupleDoc()),
    getDoc(settingsDoc()),
  ]);

  if (!coupleSnapshot.exists()) {
    await setDoc(coupleDoc(), {
      participantUids: [user.uid],
      displayNames: { [user.uid]: user.displayName || 'Participant' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  if (!settingsSnapshot.exists()) {
    await setDoc(settingsDoc(), {
      ...DEFAULT_SETTINGS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
};

export const sanitizeRollForWrite = (roll: Omit<DateNightRoll, 'id'>) => ({
  ...roll,
  photos: roll.photos ?? [],
  reviews: roll.reviews ?? {},
});
