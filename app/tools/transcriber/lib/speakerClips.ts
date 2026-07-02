// Promise-wrapped raw IndexedDB access for speaker reference-clip audio.
// Browser-only — every export here assumes a real browser context; callers
// (useSpeakerProfiles.ts) must feature-detect with isClipStorageAvailable()
// before calling anything else. No third-party dependency: this is a
// deliberately thin wrapper around the native IndexedDB API. Profile
// metadata (name/notes) lives separately in localStorage — see
// lib/speakerProfiles.ts — keyed by the same `id` as the records here.
//
// Clip audio bytes never leave this store except when a transcription run
// explicitly reads them (via getClip) to attach as a reference — never
// logged, never sent anywhere else.

import type { ClipValidationStatus } from './clipAnalysis';

/* ------------------------------------------------------------ */
/* CONFIGURATION: database identity                               */
/* ------------------------------------------------------------ */

const DB_NAME = 'transcriber';
const DB_VERSION = 1;
const STORE_NAME = 'speakerClips';

export interface SpeakerClipRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  durationSec: number;
  validationStatus: ClipValidationStatus;
  rmsDb: number;
  updatedAt: number;
}

/** Metadata-only view of a stored clip (no audio bytes) — cheap to list for rendering validation pills without loading every clip's Blob into memory. */
export type SpeakerClipMeta = Omit<SpeakerClipRecord, 'blob'>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open the clip database.'));
  });
}

/**
 * Feature-detects IndexedDB support with a real open-and-close attempt, not
 * just a `typeof window.indexedDB` check — Firefox private browsing exposes
 * `window.indexedDB` but throws when actually opening a database, so a real
 * open is the only reliable test. Never throws.
 */
export async function isClipStorageAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.indexedDB) return false;
  try {
    const db = await openDb();
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function putClip(record: SpeakerClipRecord): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save the clip.'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving the clip was aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function getClip(id: string): Promise<SpeakerClipRecord | null> {
  const db = await openDb();
  try {
    return await new Promise<SpeakerClipRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve((request.result as SpeakerClipRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to load the clip.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteClip(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete the clip.'));
      tx.onabort = () => reject(tx.error ?? new Error('Deleting the clip was aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function listClipMeta(): Promise<SpeakerClipMeta[]> {
  const db = await openDb();
  try {
    return await new Promise<SpeakerClipMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const records = (request.result as SpeakerClipRecord[]) ?? [];
        resolve(
          records.map((record) => ({
            id: record.id,
            mimeType: record.mimeType,
            durationSec: record.durationSec,
            validationStatus: record.validationStatus,
            rmsDb: record.rmsDb,
            updatedAt: record.updatedAt,
          })),
        );
      };
      request.onerror = () => reject(request.error ?? new Error('Failed to list clips.'));
    });
  } finally {
    db.close();
  }
}
