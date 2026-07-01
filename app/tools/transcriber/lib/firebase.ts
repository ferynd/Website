'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firebase app identity for Transcriber          */
/* ------------------------------------------------------------ */
export const APP_ID = 'transcriber';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import { ADMIN_EMAIL, firebaseConfig } from '../../trip-cost/firebaseConfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export { app };
export const auth = getAuth(app);

/**
 * Client-side convenience check ONLY — this hides the tool's UI for anyone
 * other than the site owner. It provides no real security by itself: every
 * API route independently re-verifies the caller's Firebase ID token and
 * email server-side (see app/lib/verifyFirebaseAuth.ts). Never rely on this
 * check alone to protect data or API calls.
 */
export const isAllowedUser = (user: User | null | undefined): boolean =>
  !!user?.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
