/**
 * Every Next.js JavaScript chunk path referenced by an HTML page, via
 * <script src> or <link href> (preload/modulepreload). Absolute URLs are reduced
 * to their path (probes only go to the smoke base) and query strings are dropped
 * so the `.map` probe targets the file path itself.
 */
export function scriptChunks(html) {
  const chunks = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']((?:https?:\/\/[^/"']+)?\/_next\/static\/[^"'?#<>]+\.js)(?:[?#][^"'<>]*)?["']/gi)) {
    chunks.add(match[1].replace(/^https?:\/\/[^/]+/i, ''));
  }
  return [...chunks].sort();
}
