// Never expose matched text in diagnostics. Matches stay internal for allowlisting.
// Firebase web API keys (AIza…) are public client identifiers ONLY in known config
// files (AGENTS.md). Other AIza strings (e.g. a leaked GEMINI_API_KEY) must fail CI.
const EVERYWHERE = [
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ['private-key-json', /["']private_key["']\s*:/g],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{16,}/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9_]{20,}/g],
  ['slack-token', /\bxox?[a-z]?-[A-Za-z0-9-]{10,}/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{30,}/g],
];
const SCOPED = /^(?:public\/trips\/|tests\/|scripts\/fixtures\/)|(?:^|\/)__tests__\//;
const SAFE_DOMAIN = /^(?:.*\.)?(?:example\.(?:com|org|net)|test|invalid|localhost)$/i;
const SKIP_FILES = /^(?:PLAN\.md|VERIFY\.md|.*\/PLAN\.md)$/;

export function scanSensitive(file, source) {
  if (SKIP_FILES.test(file)) return [];
  const hits = [];
  const add = (pattern, regex) => {
    for (const match of source.matchAll(new RegExp(regex.source, regex.flags))) {
      if (/FAKE|EXAMPLE|REDACTED|abcdefghijklmnopqrstuvwxyz/i.test(match[0])) continue;
      hits.push({ file, pattern, match: match[0] });
    }
  };
  for (const [pattern, regex] of EVERYWHERE) add(pattern, regex);
  if (SCOPED.test(file)) {
    for (const match of source.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}|localhost)\b/gi)) {
      const domain = match[1];
      if (SAFE_DOMAIN.test(domain)) continue;
      if (/(?:^|\.)gserviceaccount\.com$/i.test(domain)) continue;
      const idx = match.index ?? source.indexOf(match[0]);
      const before = source.slice(Math.max(0, idx - 80), idx);
      if (/googleapis\.com\//i.test(before)) continue;
      hits.push({ file, pattern: 'email', match: match[0] });
    }
  }
  if (file.startsWith('public/trips/')) {
    add('phone', /(?<![\w#])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/g);
    add('booking', /\b(?:booking|confirmation|reservation)\s+(?:number|code|reference|id)\b/gi);
  }
  return hits;
}

export function secretFile(file) {
  return /(?:^|\/)\.env(?!\.example(?:$|\.))|(?:^|\/)\.dev\.vars|\.pem$|service-account.*\.json$|(?:^|\/)\.wrangler\/|(?:^|\/)\.open-next\/|(?:^|\/)\.firebase\//.test(file);
}

export function allowlistErrors(entries = []) {
  const errors = [];
  for (const entry of entries) {
    if (!entry?.file || !entry?.pattern || !entry?.owner || !entry?.reason || !entry?.reviewBy) {
      errors.push('allowlist: incomplete entry');
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy) || Date.parse(entry.reviewBy) < Date.now()) {
      errors.push(`allowlist: reviewBy: ${entry.file}`);
    }
  }
  return [...new Set(errors)];
}

/** file may be an exact path or a RegExp source prefixed with "re:" */
export function entryMatches(entry, hit) {
  if (entry.pattern !== hit.pattern) return false;
  if (entry.match && entry.match !== hit.match) return false;
  if (entry.file.startsWith('re:')) {
    try { return new RegExp(entry.file.slice(3)).test(hit.file); }
    catch { return false; }
  }
  return entry.file === hit.file;
}

export function unexpectedSensitive(hits, entries = []) {
  return hits.filter((hit) => !entries.some((entry) => entryMatches(entry, hit)));
}
