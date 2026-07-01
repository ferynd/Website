// Browser-only helper to probe a File's audio duration before a Gemini
// direct-transcription run — Gemini needs the duration up front to decide
// single-call vs. windowed transcription (see GEMINI_SINGLE_CALL_MAX_SECONDS
// / createChunkWindows in useTranscriberPipeline.ts). OpenAI providers never
// call this — they don't need duration ahead of time.
//
// Not unit-tested: everything here depends on browser-only APIs (<audio>
// element metadata loading, AudioContext.decodeAudioData) that jsdom/vitest
// don't implement meaningfully. Kept intentionally thin so there's little
// logic left uncovered.

/* ------------------------------------------------------------ */
/* CONFIGURATION: <audio> metadata probe timeout                 */
/* ------------------------------------------------------------ */

/** A stalled/broken object URL should never hang the pipeline indefinitely — fall through to the decodeAudioData path instead. */
const AUDIO_METADATA_TIMEOUT_MS = 10_000;

function isUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Loads `file` into a hidden <audio> element and resolves with its duration once metadata is available, or null on error/timeout. Always revokes the object URL it creates. */
function probeViaAudioElement(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;

    const finish = (result: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), AUDIO_METADATA_TIMEOUT_MS);

    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(isUsableDuration(audio.duration) ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

/** Fallback: fully decode the file via Web Audio's decodeAudioData. Slower and more memory-hungry than the <audio> element probe, but works for a few container/codec combinations the element's metadata loader sometimes fumbles. */
async function probeViaDecodeAudioData(file: File): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AudioContextCtor: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await file.arrayBuffer();
    // decodeAudioData detaches/consumes the buffer it's given — the caller
    // already has its own copy via file.arrayBuffer() above, so that's fine.
    const decoded = await context.decodeAudioData(arrayBuffer);
    return isUsableDuration(decoded.duration) ? decoded.duration : null;
  } catch {
    return null;
  } finally {
    void context.close().catch(() => {});
  }
}

/**
 * Probes an audio File's duration in seconds. Tries the cheap `<audio>`
 * element metadata path first, then falls back to a full Web Audio decode.
 * Returns null (never throws) if both fail — callers (Gemini direct
 * transcription) treat that as "duration unknown" and recover by suggesting
 * an OpenAI provider instead, since OpenAI doesn't need duration up front.
 */
export async function probeAudioDuration(file: File): Promise<number | null> {
  const viaElement = await probeViaAudioElement(file);
  if (viaElement !== null) return viaElement;

  return probeViaDecodeAudioData(file);
}
