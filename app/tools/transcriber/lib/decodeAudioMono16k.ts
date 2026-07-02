// Browser-only shared audio-decode helper: decodes an arbitrary audio Blob
// via Web Audio, downmixes to mono, and resamples to 16 kHz. Shared by
// lib/processReferenceClip.ts (voice reference clips) and
// lib/providers/geminiProvider.ts (true per-window audio slicing ahead of
// each Gemini direct-transcription window call, rather than sending the
// full file every time — see GEMINI_WINDOW_SECONDS in lib/constants.ts).
//
// Not unit-tested: everything here depends on browser-only APIs
// (AudioContext.decodeAudioData, OfflineAudioContext) that jsdom/vitest
// don't implement meaningfully — mirrors lib/audioDuration.ts's approach.
// Kept intentionally thin so there's little logic left uncovered.

/** Gemini itself downsamples audio input to 16 kHz mono internally, so
 * encoding at this rate client-side loses nothing Gemini would keep anyway
 * — and keeps each per-window upload small regardless of the source
 * format/bitrate. */
export const AUDIO_MONO_SAMPLE_RATE = 16000;

export interface DecodedMonoAudio {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** The ORIGINAL decoded duration in seconds, before any downstream slicing/trimming. */
  durationSec: number;
}

function createAudioContext(): AudioContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioContextCtor: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser does not support Web Audio decoding.');
  return new AudioContextCtor();
}

/** Averages all channels of an AudioBuffer down to a single mono Float32Array — see lib/processReferenceClip.ts's original for the `Float32Array<ArrayBuffer>` typing rationale. */
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

/** Resamples mono Float32 samples to AUDIO_MONO_SAMPLE_RATE via OfflineAudioContext (a no-op copy when already at that rate). */
async function resampleTo16k(
  mono: Float32Array<ArrayBuffer>,
  originalSampleRate: number,
): Promise<Float32Array<ArrayBuffer>> {
  if (originalSampleRate === AUDIO_MONO_SAMPLE_RATE) return mono;

  const durationSec = mono.length / originalSampleRate;
  const targetLength = Math.max(1, Math.round(durationSec * AUDIO_MONO_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, targetLength, AUDIO_MONO_SAMPLE_RATE);

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
 * Decodes an audio Blob and normalizes it into mono 16 kHz PCM samples — the
 * shared first stage for both reference-clip processing and Gemini
 * per-window audio slicing. Decodes the whole blob into memory at once
 * (Web Audio has no streaming decode API for arbitrary containers), so
 * callers slicing a very long recording should call this once and reuse the
 * returned samples rather than decoding per window.
 */
export async function decodeToMono16k(blob: Blob): Promise<DecodedMonoAudio> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = createAudioContext();

  let decoded: AudioBuffer;
  try {
    // decodeAudioData can detach/consume the buffer it's given in some
    // implementations — pass a fresh copy so callers that hold onto
    // `arrayBuffer` are never surprised.
    decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await audioContext.close().catch(() => {});
  }

  const durationSec = decoded.duration;
  const mono = downmixToMono(decoded);
  const samples = await resampleTo16k(mono, decoded.sampleRate);

  return { samples, sampleRate: AUDIO_MONO_SAMPLE_RATE, durationSec };
}

/** Extracts [startSec, endSec) from decoded mono samples, clamped to the buffer's bounds. */
export function sliceMonoSamples(
  samples: Float32Array<ArrayBuffer>,
  sampleRate: number,
  startSec: number,
  endSec: number,
): Float32Array<ArrayBuffer> {
  const total = samples.length;
  const startSample = Math.max(0, Math.min(total, Math.round(startSec * sampleRate)));
  const endSample = Math.max(startSample, Math.min(total, Math.round(endSec * sampleRate)));
  return samples.slice(startSample, endSample);
}
