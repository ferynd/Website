// Shared bytes -> base64 encoding for speaker reference clips. Used both
// server-side (app/api/transcriber/transcribe/route.ts: OpenAI's
// known_speaker_references[] data-URL fields) and client-side
// (lib/providers/geminiProvider.ts: Gemini's experimental inlineData.data
// base64 field). Works in both the Edge runtime and the browser since both
// expose the standard `btoa` global — no Node `Buffer` dependency (the Edge
// runtime this app deploys to does not reliably provide one).
//
// NEVER log the output of these functions or the Blob/ArrayBuffer passed in
// — this is audio content.

/** Encodes raw bytes as a base64 string. Chunked to avoid
 * `String.fromCharCode`'s argument-count ceiling on large buffers (a
 * multi-MB clip passed as one spread call can exceed engine limits). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000; // 32 KiB
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

/** Encodes a Blob's bytes as a base64 string (no `data:` prefix) — the shape Gemini's `inlineData.data` field expects. */
export async function blobToBase64(blob: Blob): Promise<string> {
  return arrayBufferToBase64(await blob.arrayBuffer());
}

/** Encodes a Blob as a full `data:<mime>;base64,<data>` URL string — the shape OpenAI's `known_speaker_references[]` field expects. */
export async function blobToDataUrl(blob: Blob, mimeType: string): Promise<string> {
  return `data:${mimeType};base64,${await blobToBase64(blob)}`;
}
