import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getApps, getApp, initializeApp } from 'firebase/app';
import { firebaseConfig } from '../../trip-cost/firebaseConfig';

// Reuse the same Firebase project used by all other tools on this site.
// getApps() ensures the app is only initialized once across all modules.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
