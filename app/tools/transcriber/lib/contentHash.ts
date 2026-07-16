// SHA-256 content hashing via platform-native WebCrypto (browser, Edge, and
// Node 18+ all expose crypto.subtle) — used for reference-clip identity in
// cache keys and the debug manifest, replacing the old name+size fingerprint
// that couldn't tell a re-recorded clip from its predecessor.
//
// Source-audio identity deliberately stays name|size|lastModified
// (useTranscriberPipeline.ts's buildFileKey): hashing a recording of up to
// ~95 MB would buffer the whole file into memory purely for a cache key,
// on top of the decode buffers the pipeline already holds — an unacceptable
// mobile-memory cost for caches that are per-session and only read on an
// explicit retry of the same in-memory File object. Clips are ~256 KB, so
// hashing them is effectively free.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

export function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? (data.slice().buffer as ArrayBuffer) : data;
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  );
}

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}
