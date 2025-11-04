"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firebase app identity for Trip Planner         */
/* ------------------------------------------------------------ */
export const APP_ID = 'trip-planner';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { firebaseConfig, ADMIN_EMAIL } from '../../trip-cost/firebaseConfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export { app };
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const isAdmin = (user: User | null | undefined): boolean =>
  !!user?.email && user.email === ADMIN_EMAIL;

