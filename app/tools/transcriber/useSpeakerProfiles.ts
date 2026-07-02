'use client';

// Owns speaker profile metadata (localStorage, via lib/speakerProfiles.ts)
// together with each profile's reference clip (IndexedDB, via
// lib/speakerClips.ts — or an in-memory fallback store when IndexedDB is
// unavailable). page.tsx holds a single instance of this hook and threads
// it through to SpeakerProfilesPanel (rendering) and into the pipeline run
// (speakerNames/speakerNotes/getRunClips). Not unit-tested: this hook's own
// logic is thin glue around already-tested pure libs (lib/speakerProfiles.ts,
// lib/clipAnalysis.ts) and untestable browser APIs (IndexedDB, Web Audio via
// lib/processReferenceClip.ts) — mirrors useClipRecorder.ts's approach.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipValidationStatus } from './lib/clipAnalysis';
import { processReferenceClip } from './lib/processReferenceClip';
import type { SpeakerReferenceClip } from './lib/providers/types';
import {
  deleteClip as deleteStoredClip,
  getClip,
  isClipStorageAvailable,
  listClipMeta,
  putClip,
  type SpeakerClipMeta,
} from './lib/speakerClips';
import {
  readSpeakerProfiles,
  saveSpeakerProfiles,
  type SpeakerProfileMeta,
} from './lib/speakerProfiles';

/** A processed clip kept in memory only, for the IndexedDB-unavailable fallback path (private browsing, disabled storage, etc.) — never persisted, so it's lost on reload; the panel shows a warning banner in this mode. */
interface FallbackClip {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  validationStatus: ClipValidationStatus;
  rmsDb: number;
}

export interface SpeakerProfileClipStatus {
  hasClip: boolean;
  validationStatus: ClipValidationStatus;
  durationSec: number | null;
  rmsDb: number | null;
  /** True while a just-uploaded/recorded clip is being decoded/trimmed/re-encoded (lib/processReferenceClip.ts). */
  processing: boolean;
  error: string | null;
}

const MISSING_STATUS: Omit<SpeakerProfileClipStatus, 'processing' | 'error'> = {
  hasClip: false,
  validationStatus: 'missing',
  durationSec: null,
  rmsDb: null,
};

function nextProfileId(existing: SpeakerProfileMeta[]): string {
  const usedIds = new Set(existing.map((p) => p.id));
  let n = existing.length + 1;
  while (usedIds.has(`speaker-${n}`)) n += 1;
  return `speaker-${n}`;
}

function removeKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const k of Object.keys(record)) {
    if (k !== key) next[k] = record[k];
  }
  return next;
}

export interface UseSpeakerProfilesResult {
  profiles: SpeakerProfileMeta[];
  clipStatusByProfile: Record<string, SpeakerProfileClipStatus>;
  /** null while the availability check is in flight. */
  clipStorageAvailable: boolean | null;
  addProfile: () => void;
  removeProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;
  updateNotes: (id: string, notes: string) => void;
  uploadClip: (id: string, file: File) => Promise<void>;
  recordClip: (id: string, blob: Blob) => Promise<void>;
  deleteClipForProfile: (id: string) => Promise<void>;
  /** Resolves clip blobs for the CURRENT profiles that have both a non-empty name and a clip — for attaching to a transcription run. Reads from IndexedDB (or the in-memory fallback store when storage is unavailable). */
  getRunClips: () => Promise<SpeakerReferenceClip[]>;
  /** Non-empty, trimmed profile names in profile order — replaces the old free-form speaker-name inputs as the source of speakerNames for a run. */
  speakerNames: string[];
  /** Parallel to speakerNames. */
  speakerNotes: string[];
  /** True once every profile has a clip with status 'ok' or 'trimmed' — drives SpeakerProfilesPanel's default collapsed/expanded state. */
  allProfilesValid: boolean;
}

export function useSpeakerProfiles(): UseSpeakerProfilesResult {
  const [profiles, setProfiles] = useState<SpeakerProfileMeta[]>(() => readSpeakerProfiles());
  const [clipStorageAvailable, setClipStorageAvailable] = useState<boolean | null>(null);
  const [clipMetaById, setClipMetaById] = useState<Record<string, SpeakerClipMeta>>({});
  const [fallbackClips, setFallbackClips] = useState<Record<string, FallbackClip>>({});
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>({});
  const [errorsById, setErrorsById] = useState<Record<string, string | null>>({});

  // getRunClips() needs the latest fallback-clip Blobs without re-creating
  // its own callback identity on every keystroke elsewhere in the panel.
  const fallbackClipsRef = useRef(fallbackClips);
  fallbackClipsRef.current = fallbackClips;

  const refreshClipMeta = useCallback(async () => {
    try {
      const metas = await listClipMeta();
      const byId: Record<string, SpeakerClipMeta> = {};
      for (const meta of metas) byId[meta.id] = meta;
      setClipMetaById(byId);
    } catch {
      setClipMetaById({});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await isClipStorageAvailable();
      if (cancelled) return;
      setClipStorageAvailable(available);
      if (available) await refreshClipMeta();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshClipMeta]);

  const addProfile = useCallback(() => {
    setProfiles((prev) => {
      const next = [...prev, { id: nextProfileId(prev), name: '', notes: '' }];
      saveSpeakerProfiles(next);
      return next;
    });
  }, []);

  const removeProfile = useCallback((id: string) => {
    setProfiles((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      saveSpeakerProfiles(next);
      return next;
    });
    void deleteStoredClip(id).catch(() => {});
    setFallbackClips((prev) => removeKey(prev, id));
    setClipMetaById((prev) => removeKey(prev, id));
    setErrorsById((prev) => removeKey(prev, id));
  }, []);

  const renameProfile = useCallback((id: string, name: string) => {
    setProfiles((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, name } : p));
      saveSpeakerProfiles(next);
      return next;
    });
  }, []);

  const updateNotes = useCallback((id: string, notes: string) => {
    setProfiles((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, notes } : p));
      saveSpeakerProfiles(next);
      return next;
    });
  }, []);

  const processAndStore = useCallback(
    async (id: string, blob: Blob) => {
      setProcessingIds((prev) => ({ ...prev, [id]: true }));
      setErrorsById((prev) => ({ ...prev, [id]: null }));
      try {
        const processed = await processReferenceClip(blob);
        if (clipStorageAvailable) {
          await putClip({
            id,
            blob: processed.blob,
            mimeType: processed.mimeType,
            durationSec: processed.durationSec,
            validationStatus: processed.validationStatus,
            rmsDb: processed.rmsDb,
            updatedAt: Date.now(),
          });
          await refreshClipMeta();
        } else {
          setFallbackClips((prev) => ({
            ...prev,
            [id]: {
              blob: processed.blob,
              mimeType: processed.mimeType,
              durationSec: processed.durationSec,
              validationStatus: processed.validationStatus,
              rmsDb: processed.rmsDb,
            },
          }));
        }
      } catch (err) {
        setErrorsById((prev) => ({
          ...prev,
          [id]: err instanceof Error ? err.message : 'Could not process this audio clip.',
        }));
      } finally {
        setProcessingIds((prev) => ({ ...prev, [id]: false }));
      }
    },
    [clipStorageAvailable, refreshClipMeta],
  );

  const uploadClip = useCallback((id: string, file: File) => processAndStore(id, file), [processAndStore]);
  const recordClip = useCallback((id: string, blob: Blob) => processAndStore(id, blob), [processAndStore]);

  const deleteClipForProfile = useCallback(
    async (id: string) => {
      if (clipStorageAvailable) {
        await deleteStoredClip(id).catch(() => {});
        await refreshClipMeta();
      } else {
        setFallbackClips((prev) => removeKey(prev, id));
      }
      setErrorsById((prev) => ({ ...prev, [id]: null }));
    },
    [clipStorageAvailable, refreshClipMeta],
  );

  const clipStatusByProfile = useMemo(() => {
    const result: Record<string, SpeakerProfileClipStatus> = {};
    for (const profile of profiles) {
      const meta = clipMetaById[profile.id];
      const fallback = fallbackClips[profile.id];
      const source = meta ?? fallback;
      result[profile.id] = {
        ...(source
          ? {
              hasClip: true,
              validationStatus: source.validationStatus,
              durationSec: source.durationSec,
              rmsDb: source.rmsDb,
            }
          : MISSING_STATUS),
        processing: !!processingIds[profile.id],
        error: errorsById[profile.id] ?? null,
      };
    }
    return result;
  }, [profiles, clipMetaById, fallbackClips, processingIds, errorsById]);

  const getRunClips = useCallback(async (): Promise<SpeakerReferenceClip[]> => {
    const results: SpeakerReferenceClip[] = [];
    for (const profile of profiles) {
      const name = profile.name.trim();
      if (!name) continue;

      if (clipStorageAvailable && clipMetaById[profile.id]) {
        const record = await getClip(profile.id);
        if (record) {
          results.push({ name, blob: record.blob, mimeType: record.mimeType, validationStatus: record.validationStatus });
        }
      } else if (!clipStorageAvailable) {
        const fallback = fallbackClipsRef.current[profile.id];
        if (fallback) {
          results.push({
            name,
            blob: fallback.blob,
            mimeType: fallback.mimeType,
            validationStatus: fallback.validationStatus,
          });
        }
      }
    }
    return results;
  }, [profiles, clipStorageAvailable, clipMetaById]);

  const speakerNames = useMemo(() => profiles.map((p) => p.name.trim()).filter(Boolean), [profiles]);
  const speakerNotes = useMemo(
    () => profiles.filter((p) => p.name.trim().length > 0).map((p) => p.notes),
    [profiles],
  );

  const allProfilesValid = useMemo(
    () =>
      profiles.length > 0 &&
      profiles.every((p) => {
        const status = clipStatusByProfile[p.id];
        return !!status && (status.validationStatus === 'ok' || status.validationStatus === 'trimmed');
      }),
    [profiles, clipStatusByProfile],
  );

  return {
    profiles,
    clipStatusByProfile,
    clipStorageAvailable,
    addProfile,
    removeProfile,
    renameProfile,
    updateNotes,
    uploadClip,
    recordClip,
    deleteClipForProfile,
    getRunClips,
    speakerNames,
    speakerNotes,
    allProfilesValid,
  };
}
