// Speaker profile metadata store (name + voice notes) — a separate
// localStorage key from the versioned settings store (lib/settings.ts) so
// that resetting settings to defaults never deletes a user's speaker
// profiles. Mirrors settings.ts's pure-parse + SSR-safe read/save pattern.
// Audio itself never lives here — see lib/speakerClips.ts (IndexedDB) for
// the actual reference-clip bytes, keyed by the same profile `id`.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import { DEFAULT_SPEAKER_NAMES } from './constants';

/* ------------------------------------------------------------ */
/* CONFIGURATION: storage key + default profiles                 */
/* ------------------------------------------------------------ */

export const SPEAKER_PROFILES_STORAGE_KEY = 'transcriber_speaker_profiles_v1';

export interface SpeakerProfileMeta {
  id: string;
  name: string;
  notes: string;
}

/** Seeded from DEFAULT_SPEAKER_NAMES (lib/constants.ts) so the two "known
 * speakers" defaults stay defined in exactly one place — stable ids
 * ('speaker-1', 'speaker-2', ...) so IndexedDB clip records (keyed by the
 * same id) survive a profile rename. */
export const DEFAULT_SPEAKER_PROFILES: SpeakerProfileMeta[] = DEFAULT_SPEAKER_NAMES.map((name, index) => ({
  id: `speaker-${index + 1}`,
  name,
  notes: '',
}));

/** Fresh copy of the defaults — callers get their own array/objects instead of references into the shared default. */
function cloneDefaults(): SpeakerProfileMeta[] {
  return DEFAULT_SPEAKER_PROFILES.map((profile) => ({ ...profile }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses a raw localStorage string into a validated speaker-profile list.
 * Pure and never throws.
 *
 * Invalid entries are dropped individually rather than rejecting the whole
 * list: a non-object entry, a missing/blank `id`, or a missing/blank `name`
 * (after trimming) is skipped; `notes` defaults to `''` when missing or not
 * a string; a duplicate `id` after the first is dropped. If the resulting
 * list is empty (unparseable input, a non-array value, or every entry was
 * invalid), this falls back to DEFAULT_SPEAKER_PROFILES.
 */
export function parseStoredProfiles(raw: string | null): SpeakerProfileMeta[] {
  if (!raw) return cloneDefaults();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cloneDefaults();
  }

  if (!Array.isArray(parsed)) return cloneDefaults();

  const seenIds = new Set<string>();
  const profiles: SpeakerProfileMeta[] = [];

  for (const entry of parsed) {
    if (!isPlainObject(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const notes = typeof entry.notes === 'string' ? entry.notes : '';
    if (!id || !name) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    profiles.push({ id, name, notes });
  }

  return profiles.length > 0 ? profiles : cloneDefaults();
}

/** Reads the speaker-profile list from localStorage. SSR-safe (returns defaults when `window` is undefined) and never throws. */
export function readSpeakerProfiles(): SpeakerProfileMeta[] {
  if (typeof window === 'undefined') return cloneDefaults();

  try {
    return parseStoredProfiles(window.localStorage.getItem(SPEAKER_PROFILES_STORAGE_KEY));
  } catch {
    return cloneDefaults();
  }
}

export function saveSpeakerProfiles(profiles: SpeakerProfileMeta[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(SPEAKER_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Local profile metadata is an optional device preference.
  }
}
