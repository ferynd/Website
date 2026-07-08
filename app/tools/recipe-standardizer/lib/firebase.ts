"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firebase app identity for Recipe Standardizer  */
/* ------------------------------------------------------------ */
export const APP_ID = 'recipe-standardizer';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../../trip-cost/firebaseConfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export { app };
export const auth = getAuth(app);
export const db = getFirestore(app);
