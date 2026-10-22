/* --- CONFIGURATION: none (namespaces live in lib/namespaces.ts) --- */
/** Shared Firebase app; namespace identity is independent of Firebase initialization. */
'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../../trip-cost/firebaseConfig';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/** Shared initialized Firebase application. */
export { app };
/** Auth helper. */
export const auth = getAuth(app);
/** Db helper. */
export const db = getFirestore(app);
