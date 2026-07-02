// Pure clip-analysis math for speaker reference clips: picking the
// highest-energy window of a recording/upload, computing a validation
// status from duration+loudness, and encoding PCM16 WAV bytes. No Web
// Audio/browser APIs here — see lib/processReferenceClip.ts for the
// browser-side orchestrator that calls into this.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

export type ClipValidationStatus = 'missing' | 'too-short' | 'too-quiet' | 'trimmed' | 'ok';

/* ------------------------------------------------------------ */
/* CONFIGURATION: window selection + validation thresholds       */
/* ------------------------------------------------------------ */

/** Below this duration, a clip can't reliably carry a voice sample. */
const MIN_CLIP_SECONDS = 2;
/** Above this ORIGINAL (pre-trim) duration, the clip is trimmed down to the best TARGET_WINDOW_SECONDS window and reported as 'trimmed' rather than 'ok'. */
const MAX_UNTRIMMED_SECONDS = 10;
/** Target length of the best-energy window selectBestWindow slides across the clip. */
const TARGET_WINDOW_SECONDS = 8;
/** Default hop between candidate window starts, in seconds. */
const DEFAULT_HOP_SECONDS = 0.25;
/** Below this mean loudness (dBFS), a clip is flagged as too quiet to be a reliable voice reference. */
const QUIET_DBFS_THRESHOLD = -40;

/** Floor applied to true silence (RMS 0, whose real dB is -Infinity) so downstream math/JSON always sees a finite number. */
const SILENCE_FLOOR_DB = -120;

export interface BestWindowResult {
  startSample: number;
  endSample: number;
  meanRmsDb: number;
}

/** Converts a linear RMS amplitude (0..1) to dBFS, flooring true silence to SILENCE_FLOOR_DB instead of -Infinity. */
function rmsToDb(rms: number): number {
  if (rms <= 0) return SILENCE_FLOOR_DB;
  return Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(rms));
}

function computeRms(samples: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sumSquares = 0;
  for (let i = start; i < end; i++) {
    const s = samples[i];
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / count);
}

/**
 * Slides a `targetSec` window across `samples` (hopping by `hopSec`) and
 * returns the window with the highest mean RMS energy — i.e. the most
 * likely stretch of actual speech rather than silence/room tone. When the
 * whole clip is shorter than or equal to the target window, the whole clip
 * is returned as-is.
 */
export function selectBestWindow(
  samples: Float32Array,
  sampleRate: number,
  targetSec = TARGET_WINDOW_SECONDS,
  hopSec = DEFAULT_HOP_SECONDS,
): BestWindowResult {
  const totalSamples = samples.length;
  const targetSamples = Math.round(targetSec * sampleRate);

  if (totalSamples === 0) {
    return { startSample: 0, endSample: 0, meanRmsDb: rmsToDb(0) };
  }

  if (totalSamples <= targetSamples) {
    return { startSample: 0, endSample: totalSamples, meanRmsDb: rmsToDb(computeRms(samples, 0, totalSamples)) };
  }

  const hopSamples = Math.max(1, Math.round(hopSec * sampleRate));
  const lastStart = totalSamples - targetSamples;

  let bestStart = 0;
  let bestRms = -1;
  for (let start = 0; start <= lastStart; start += hopSamples) {
    const rms = computeRms(samples, start, start + targetSamples);
    if (rms > bestRms) {
      bestRms = rms;
      bestStart = start;
    }
  }

  // The hop stride doesn't necessarily land exactly on the final possible
  // window — always check it explicitly so a burst right at the very end of
  // the clip is never missed.
  if (lastStart % hopSamples !== 0) {
    const rms = computeRms(samples, lastStart, totalSamples);
    if (rms > bestRms) {
      bestRms = rms;
      bestStart = lastStart;
    }
  }

  return { startSample: bestStart, endSample: bestStart + targetSamples, meanRmsDb: rmsToDb(bestRms) };
}

export interface ClipValidationInput {
  /** The clip's duration BEFORE any trimming — see lib/processReferenceClip.ts, which always passes the original decoded duration so a >10s original correctly reports 'trimmed' even though the stored clip itself is only ~8s. */
  durationSec: number;
  meanRmsDb: number;
}

/**
 * Computes a clip's validation status from its (pre-trim) duration and the
 * mean loudness of its selected window. Order matters: too-short (a
 * near-empty clip) takes priority over too-quiet, which takes priority over
 * trimmed — a clip that is both too short AND too quiet is far more usefully
 * reported as "too short" than "trimmed to best 8s".
 */
export function computeClipValidation({ durationSec, meanRmsDb }: ClipValidationInput): ClipValidationStatus {
  if (durationSec < MIN_CLIP_SECONDS) return 'too-short';
  if (meanRmsDb < QUIET_DBFS_THRESHOLD) return 'too-quiet';
  if (durationSec > MAX_UNTRIMMED_SECONDS) return 'trimmed';
  return 'ok';
}

/**
 * Encodes mono Float32 samples (nominal range -1..1, clamped) as a 16-bit
 * PCM WAV file: a standard 44-byte RIFF/WAVE/fmt/data header followed by
 * little-endian PCM16 sample data.
 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intSample = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}
