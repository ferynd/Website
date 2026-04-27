'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firebase app identity for Date Night Roulette */
/* ------------------------------------------------------------ */
export const APP_ID = 'date-night';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { ADMIN_EMAIL, firebaseConfig } from '../../trip-cost/firebaseConfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export { app };
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const isAdmin = (user: User | null | undefined): boolean =>
  !!user?.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
