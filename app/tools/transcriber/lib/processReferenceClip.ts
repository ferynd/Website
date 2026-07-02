// Browser-only reference-clip processing pipeline: decode arbitrary
// recorded/uploaded audio (via decodeAudioMono16k.ts), pick the
// highest-energy ~8s window (lib/clipAnalysis.ts), and re-encode it as a
// small PCM16 WAV blob.
//
// Not unit-tested: everything here depends on browser-only APIs
// (AudioContext.decodeAudioData, OfflineAudioContext) that jsdom/vitest
// don't implement meaningfully — mirrors lib/audioDuration.ts's approach.
// Kept intentionally thin so there's little logic left uncovered.

import { computeClipValidation, encodeWavPcm16, selectBestWindow, type ClipValidationStatus } from './clipAnalysis';
import { decodeToMono16k } from './decodeAudioMono16k';

export interface ProcessedReferenceClip {
  blob: Blob;
  mimeType: 'audio/wav';
  durationSec: number;
  validationStatus: ClipValidationStatus;
  rmsDb: number;
}

/**
 * Decodes a recorded/uploaded audio Blob and normalizes it into a small
 * mono 16 kHz PCM16 WAV clip trimmed to its best (highest-energy) ~8s
 * window — the format OpenAI's known-speaker reference fields need,
 * regardless of what format the original recording/upload was in.
 * `validationStatus` is computed from the ORIGINAL decoded duration (before
 * trimming), so a long original correctly reports 'trimmed' rather than
 * 'ok'.
 */
export async function processReferenceClip(blob: Blob): Promise<ProcessedReferenceClip> {
  const { samples, sampleRate, durationSec: originalDurationSec } = await decodeToMono16k(blob);

  const window = selectBestWindow(samples, sampleRate);
  const trimmed = samples.slice(window.startSample, window.endSample);
  const wavBuffer = encodeWavPcm16(trimmed, sampleRate);

  const validationStatus = computeClipValidation({ durationSec: originalDurationSec, meanRmsDb: window.meanRmsDb });

  return {
    blob: new Blob([wavBuffer], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    durationSec: trimmed.length / sampleRate,
    validationStatus,
    rmsDb: window.meanRmsDb,
  };
}
