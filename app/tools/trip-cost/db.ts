'use client';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  CollectionReference,
  DocumentReference,
} from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

export const APP_COLLECTION = 'artifacts';
export const APP_ID = 'trip-cost';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Collection/doc builders
export const usersCol = (): CollectionReference =>
  collection(db, APP_COLLECTION, APP_ID, 'users');

export const userDoc = (uid: string): DocumentReference =>
  doc(db, APP_COLLECTION, APP_ID, 'users', uid);

export const tripsCol = (): CollectionReference =>
  collection(db, APP_COLLECTION, APP_ID, 'trips');

export const tripDoc = (tripId: string): DocumentReference =>
  doc(db, APP_COLLECTION, APP_ID, 'trips', tripId);

export const tripAuditCol = (tripId: string): CollectionReference =>
  collection(db, APP_COLLECTION, APP_ID, 'trips', tripId, 'audit');

export const tripAuditDoc = (tripId: string, auditId: string): DocumentReference =>
  doc(db, APP_COLLECTION, APP_ID, 'trips', tripId, 'audit', auditId);
