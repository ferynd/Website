'use client';

// MediaRecorder-backed voice-clip recorder for the speaker-profile
// read-aloud script (see components/ClipRecorder.tsx, which is the only
// consumer). Not unit-tested: everything here depends on browser-only APIs
// (getUserMedia, MediaRecorder) that jsdom/vitest don't implement
// meaningfully — mirrors lib/audioDuration.ts's/lib/processReferenceClip.ts's
// approach. Kept intentionally thin: the actual clip processing (trimming,
// validation, WAV re-encoding) happens downstream in
// lib/processReferenceClip.ts, not here.

import { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------ */
/* CONFIGURATION: recording limit + mime type selection           */
/* ------------------------------------------------------------ */

/** A runaway recording is a bug, not a feature, for a short voice-ID sample — hard-stop regardless of whether the caller ever calls stop(). */
const MAX_RECORD_SECONDS = 20;
const PREFERRED_MIME_TYPE = 'audio/webm;codecs=opus';
/** Safari has no Opus/WebM MediaRecorder support — falls back to this. */
const FALLBACK_MIME_TYPE = 'audio/mp4';

export type ClipRecorderState = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';

export interface UseClipRecorderResult {
  state: ClipRecorderState;
  error: string | null;
  elapsedSec: number;
  start: () => void;
  stop: () => void;
}

function pickMimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(PREFERRED_MIME_TYPE)) {
    return PREFERRED_MIME_TYPE;
  }
  return FALLBACK_MIME_TYPE;
}

/**
 * `onRecorded` is called once with the finished Blob every time a recording
 * completes successfully — a failure sets `error`/state 'error' instead and
 * never calls it. The Blob's own `.type` carries the mime type actually
 * used, so callers don't need it passed separately.
 */
export function useClipRecorder(onRecorded: (blob: Blob) => void): UseClipRecorderResult {
  const [state, setState] = useState<ClipRecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>(PREFERRED_MIME_TYPE);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const releaseTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (hardStopTimerRef.current) clearTimeout(hardStopTimerRef.current);
    elapsedTimerRef.current = null;
    hardStopTimerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setState('processing');
    recorder.stop();
  }, []);

  const start = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support audio recording.');
      setState('error');
      return;
    }
    if (state === 'requesting' || state === 'recording') return;

    setError(null);
    setElapsedSec(0);
    setState('requesting');

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          // Disabled deliberately — a voice-ID reference clip wants the
          // speaker's raw natural voice, not a call-optimized signal.
          // Trivially settable per MediaTrackConstraints; not every browser
          // honors them, but Chrome/Firefox do.
          echoCancellation: false,
          noiseSuppression: false,
        },
      })
      .then((stream) => {
        streamRef.current = stream;
        const mimeType = pickMimeType();
        mimeTypeRef.current = mimeType;

        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, { mimeType });
        } catch {
          // Some browsers reject an explicit mimeType they don't actually
          // support despite isTypeSupported saying otherwise — fall back to
          // the browser's own default rather than failing the recording.
          recorder = new MediaRecorder(stream);
        }
        mediaRecorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          clearTimers();
          releaseTracks();
          const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
          chunksRef.current = [];
          setState('idle');
          onRecordedRef.current(blob);
        };

        recorder.onerror = () => {
          clearTimers();
          releaseTracks();
          setError('Recording failed.');
          setState('error');
        };

        recorder.start();
        startedAtRef.current = Date.now();
        setState('recording');

        elapsedTimerRef.current = setInterval(() => {
          setElapsedSec((Date.now() - startedAtRef.current) / 1000);
        }, 200);
        hardStopTimerRef.current = setTimeout(() => stop(), MAX_RECORD_SECONDS * 1000);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Microphone access was denied or unavailable.');
        setState('error');
      });
    // `state` is read only to no-op a re-entrant start() call — including it
    // would tear down/recreate the callback (and its closure over the
    // in-flight getUserMedia promise) on every state transition this same
    // function causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, releaseTracks, stop]);

  // Unmount safety net: stop any in-flight recording and release the
  // microphone even if the panel unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimers();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      releaseTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, error, elapsedSec, start, stop };
}
