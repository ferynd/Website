// Browser-only OpenAI long-recording preprocessing: decode once, remove real
// silence, split the trimmed audio into chunks under OpenAI's duration/size
// caps (optionally speeding up each chunk's slice), and hand back the chunk
// Files plus a time mapper that undoes both transforms — mirrors
// lib/providers/geminiProvider.ts's client-side windowing, but where Gemini
// slices out real (unmodified) windows of the original audio, this path
// also edits the audio itself (silence removed, sped up) before slicing.
//
// Not unit-tested: everything here depends on browser-only APIs
// (AudioContext.decodeAudioData, OfflineAudioContext) that jsdom/vitest
// don't implement meaningfully — mirrors lib/decodeAudioMono16k.ts's and
// lib/audioDuration.ts's approach. All the actual planning math this calls
// into (silence detection, timeline mapping, chunk planning) lives in the
// pure, fully-tested lib/preprocessAudioPlan.ts.
//
// PEAK MEMORY: this tool's real-world target is a 1-3 HOUR, ~12 kbps, 16 kHz
// mono phone recording (~350 MB as raw float32 samples at the 3-hour end).
// decodeAudioMono16k.ts now requests a 16 kHz AudioContext specifically so
// decoding such a file doesn't upsample it 3x first. Within this module,
// each processing stage is kept sequential and the previous stage's buffer
// is dropped as soon as the next stage has its own copy. Crucially, the
// speed-up is applied PER CHUNK SLICE inside the encoding loop — the full
// sped-up recording is never materialized as one buffer (which would put
// the trimmed buffer, an OfflineAudioContext copy of it, and the rendered
// result alive simultaneously) — so the steady peak is the silence-trimmed
// buffer plus one ~13-minute chunk's worth of transient render buffers.
// The one memory cost this module does NOT avoid: `chunkFiles` (all of
// them) are returned together per this module's contract
// (`PreprocessedOpenAiAudio.chunkFiles: File[]`), so the full set of
// encoded PCM16 WAV chunks — half the size of the float32 samples they
// were sliced from (16-bit vs. 32-bit) — is held at once before the caller
// starts uploading; this is the result's "at rest" size, not an extra
// transient peak.

import { encodeWavPcm16 } from './clipAnalysis';
import {
  OPENAI_CHUNK_MAX_BYTES,
  OPENAI_CHUNK_MAX_SECONDS,
  WAV_PCM16_MONO_16K_BYTES_PER_SECOND,
} from './constants';
import { decodeToMono16k, sliceMonoSamples } from './decodeAudioMono16k';
import {
  buildKeptTimeline,
  createChunkTimeMapper,
  detectKeptIntervals,
  planChunks,
  type KeptInterval,
  type TimeBias,
} from './preprocessAudioPlan';

export interface PreprocessOpenAiAudioOptions {
  silenceRemoval: boolean;
  speedFactor: number;
  onPhase?: (phase: 'decoding' | 'encoding') => void;
}

export interface PreprocessReport {
  originalDurationSec: number;
  keptDurationSec: number;
  silenceRemovedSec: number;
  speedFactor: number;
  finalDurationSec: number;
  chunkCount: number;
}

export interface PreprocessedOpenAiAudio {
  chunkFiles: File[];
  /** Maps (chunkIndex, secondsIntoThatChunk) back to ORIGINAL-recording seconds. `bias` resolves seam-exact times — see preprocessAudioPlan.ts's TimeBias. */
  mapTime: (chunkIndex: number, tSec: number, bias?: TimeBias) => number;
  report: PreprocessReport;
}

/** Resamples/pitch-shifts one buffer by `speedFactor` via an
 * OfflineAudioContext render — playbackRate > 1 speeds up (and raises the
 * pitch of) the audio, which is accepted/documented, not corrected for.
 * Called once per chunk slice (never on the whole recording — see the peak
 * memory note in the header) and once per speaker reference clip. A
 * speedFactor <= 1 returns the input unchanged. */
async function applySpeedFactor(
  samples: Float32Array<ArrayBuffer>,
  sampleRate: number,
  speedFactor: number,
): Promise<Float32Array<ArrayBuffer>> {
  if (speedFactor <= 1) return samples;

  const targetLength = Math.max(1, Math.ceil(samples.length / speedFactor));
  const offlineCtx = new OfflineAudioContext(1, targetLength, sampleRate);

  const sourceBuffer = offlineCtx.createBuffer(1, samples.length, sampleRate);
  sourceBuffer.copyToChannel(samples, 0);

  const source = offlineCtx.createBufferSource();
  source.buffer = sourceBuffer;
  source.playbackRate.value = speedFactor;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0).slice();
}

/** Concatenates the samples covered by `intervals` (original-time seconds) out of `samples` into one contiguous Float32Array. */
function concatenateKeptSamples(
  samples: Float32Array<ArrayBuffer>,
  sampleRate: number,
  intervals: KeptInterval[],
): Float32Array<ArrayBuffer> {
  const totalLength = intervals.reduce((sum, iv) => sum + Math.max(0, Math.round((iv.end - iv.start) * sampleRate)), 0);
  const out = new Float32Array(totalLength) as Float32Array<ArrayBuffer>;
  let offset = 0;
  for (const iv of intervals) {
    const slice = sliceMonoSamples(samples, sampleRate, iv.start, iv.end);
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}

interface DecodedAndConcatenated {
  concatenated: Float32Array<ArrayBuffer>;
  sampleRate: number;
  originalDurationSec: number;
  keptDurationSec: number;
  intervals: KeptInterval[];
}

/**
 * Decodes `file`, detects the kept (non-silence) intervals, and concatenates
 * them into one buffer — isolated into its own function so that the raw
 * decoded buffer (`decodeToMono16k`'s `DecodedMonoAudio`, potentially
 * hundreds of MB for a multi-hour recording) is only ever referenced by this
 * function's own local `decoded` binding. Once this returns, that binding
 * (and the array it points to) is unreachable from the caller — nothing
 * further down preprocessForOpenAi holds a reference to it — so it's
 * eligible for GC well before the speed-up render below allocates its own
 * same-order-of-magnitude buffer, rather than staying alive across that
 * await just because it's in an enclosing scope.
 */
async function decodeAndConcatenate(file: File, silenceRemoval: boolean): Promise<DecodedAndConcatenated> {
  const decoded = await decodeToMono16k(file);
  const intervals: KeptInterval[] = silenceRemoval
    ? detectKeptIntervals(decoded.samples, decoded.sampleRate)
    : [{ start: 0, end: decoded.durationSec }];
  const keptDurationSec = intervals.reduce((sum, iv) => sum + Math.max(0, iv.end - iv.start), 0);
  const concatenated = concatenateKeptSamples(decoded.samples, decoded.sampleRate, intervals);
  return { concatenated, sampleRate: decoded.sampleRate, originalDurationSec: decoded.durationSec, keptDurationSec, intervals };
}

/**
 * Decodes `file` once, removes real silence (when `silenceRemoval` is on),
 * splits the trimmed audio into chunks under OpenAI's duration/size caps
 * (speeding up each chunk's slice by `speedFactor`), and returns those chunk
 * Files plus a `mapTime(chunkIndex, tSec) => originalSec` function so the
 * caller can remap every transcribed segment back to ORIGINAL-recording
 * time. Never sends the original file anywhere — chunk encoding happens
 * entirely client-side. See the header comment for this module's peak
 * memory profile on a multi-hour recording.
 */
export async function preprocessForOpenAi(
  file: File,
  opts: PreprocessOpenAiAudioOptions,
): Promise<PreprocessedOpenAiAudio> {
  const { silenceRemoval, speedFactor, onPhase } = opts;

  onPhase?.('decoding');
  const { concatenated, sampleRate, originalDurationSec, keptDurationSec, intervals } = await decodeAndConcatenate(
    file,
    silenceRemoval,
  );

  const timeline = buildKeptTimeline(intervals);
  const chunks = planChunks(timeline, {
    speedFactor,
    maxChunkSeconds: OPENAI_CHUNK_MAX_SECONDS,
    maxChunkBytes: OPENAI_CHUNK_MAX_BYTES,
    bytesPerSecond: WAV_PCM16_MONO_16K_BYTES_PER_SECOND,
  });

  onPhase?.('encoding');
  // Each chunk's FINAL-time bounds correspond to processed-time bounds
  // multiplied by speedFactor — slice that processed-time range out of the
  // trimmed buffer and speed up just the slice, one chunk at a time
  // (sequentially, so only one render's buffers are alive at once), instead
  // of ever rendering the whole sped-up recording as a single buffer.
  const chunkFiles: File[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const slice = sliceMonoSamples(concatenated, sampleRate, chunk.finalStart * speedFactor, chunk.finalEnd * speedFactor);
    const sped = await applySpeedFactor(slice, sampleRate, speedFactor);
    const wavBuffer = encodeWavPcm16(sped, sampleRate);
    chunkFiles.push(new File([wavBuffer], `${file.name}.chunk-${i + 1}.wav`, { type: 'audio/wav' }));
  }

  const mapTime = createChunkTimeMapper(chunks, timeline, speedFactor);

  return {
    chunkFiles,
    mapTime,
    report: {
      originalDurationSec,
      keptDurationSec,
      silenceRemovedSec: Math.max(0, originalDurationSec - keptDurationSec),
      speedFactor,
      finalDurationSec: timeline.processedDurationSec / speedFactor,
      chunkCount: chunkFiles.length,
    },
  };
}

/**
 * Speeds up a speaker-reference clip Blob by the SAME `speedFactor` used for
 * the main recording, so pitch-shifted chunk audio still matches the
 * reference voices OpenAI compares against. On any internal error, the
 * CALLER is responsible for falling back to the original blob — this never
 * throws a wrapped/classified error itself, just rejects with whatever the
 * underlying decode/render call rejected with.
 */
export async function applySpeedFactorToClip(blob: Blob, speedFactor: number): Promise<Blob> {
  const decoded = await decodeToMono16k(blob);
  const sped = await applySpeedFactor(decoded.samples, decoded.sampleRate, speedFactor);
  const wavBuffer = encodeWavPcm16(sped, decoded.sampleRate);
  return new Blob([wavBuffer], { type: 'audio/wav' });
}
