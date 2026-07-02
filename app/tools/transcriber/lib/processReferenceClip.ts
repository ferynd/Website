// Browser-only reference-clip processing pipeline: decode arbitrary
// recorded/uploaded audio, downmix to mono, resample to 16 kHz, pick the
// highest-energy ~8s window (lib/clipAnalysis.ts), and re-encode it as a
// small PCM16 WAV blob. All the actual math lives in clipAnalysis.ts — this
// module is a thin Web Audio orchestrator around it.
//
// Not unit-tested: everything here depends on browser-only APIs
// (AudioContext.decodeAudioData, OfflineAudioContext) that jsdom/vitest
// don't implement meaningfully — mirrors lib/audioDuration.ts's approach.
// Kept intentionally thin so there's little logic left uncovered.

import { computeClipValidation, encodeWavPcm16, selectBestWindow, type ClipValidationStatus } from './clipAnalysis';

/* ------------------------------------------------------------ */
/* CONFIGURATION: target sample rate for the re-encoded clip     */
/* ------------------------------------------------------------ */

const TARGET_SAMPLE_RATE = 16000;

export interface ProcessedReferenceClip {
  blob: Blob;
  mimeType: 'audio/wav';
  durationSec: number;
  validationStatus: ClipValidationStatus;
  rmsDb: number;
}

function createAudioContext(): AudioContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioContextCtor: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser does not support Web Audio decoding.');
  return new AudioContextCtor();
}

/**
 * Averages all channels of an AudioBuffer down to a single mono Float32Array.
 * Typed `Float32Array<ArrayBuffer>` (not the bare `Float32Array`, which
 * defaults to `Float32Array<ArrayBufferLike>`) because the result eventually
 * reaches `AudioBuffer.copyToChannel`, which requires the concrete
 * `ArrayBuffer` backing — both return paths here (`.slice()` and
 * `new Float32Array(length)`) already produce that, so this is just keeping
 * the annotation honest.
 */
function downmixToMono(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return buffer.getChannelData(0).slice();

  const mono = new Float32Array(length);
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) mono[i] += data[i] / numberOfChannels;
  }
  return mono;
}

/** Resamples mono Float32 samples to TARGET_SAMPLE_RATE via OfflineAudioContext (a no-op copy when already at that rate). */
async function resampleTo16k(
  mono: Float32Array<ArrayBuffer>,
  originalSampleRate: number,
): Promise<Float32Array<ArrayBuffer>> {
  if (originalSampleRate === TARGET_SAMPLE_RATE) return mono;

  const durationSec = mono.length / originalSampleRate;
  const targetLength = Math.max(1, Math.round(durationSec * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);

  const sourceBuffer = offlineCtx.createBuffer(1, mono.length, originalSampleRate);
  sourceBuffer.copyToChannel(mono, 0);

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0).slice();
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
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = createAudioContext();

  let decoded: AudioBuffer;
  try {
    // decodeAudioData can detach/consume the buffer it's given in some
    // implementations — pass a fresh copy so callers that hold onto
    // `arrayBuffer` (none here, but defensive) are never surprised.
    decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioContext.close().catch(() => {});
  }

  const originalDurationSec = decoded.duration;
  const mono = downmixToMono(decoded);
  const resampled = await resampleTo16k(mono, decoded.sampleRate);

  const window = selectBestWindow(resampled, TARGET_SAMPLE_RATE);
  const trimmed = resampled.slice(window.startSample, window.endSample);
  const wavBuffer = encodeWavPcm16(trimmed, TARGET_SAMPLE_RATE);

  const validationStatus = computeClipValidation({ durationSec: originalDurationSec, meanRmsDb: window.meanRmsDb });

  return {
    blob: new Blob([wavBuffer], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    durationSec: trimmed.length / TARGET_SAMPLE_RATE,
    validationStatus,
    rmsDb: window.meanRmsDb,
  };
}
