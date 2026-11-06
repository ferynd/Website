import path from 'node:path';

export function hasBackLink(source) {
  return /<a\b[^>]*\bhref\s*=\s*['"](?:\/(?:tools|games|trips)?\/?|\.\.\/)['"]/i.test(source);
}

/** Paths that are intentionally absent (deleted, policy-forbidden, or historical). */
export const KNOWN_ABSENT = new Set([
  'CURRENT_WORK.md',
  'public/trips/JapanTrip.html',
]);

const stripFences = (source) => source.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');

/** GitHub-style heading slugs (with -1, -2 duplicate suffixes) plus explicit id/name anchors. */
export function markdownAnchors(source) {
  const prose = stripFences(source);
  const anchors = new Set();
  const seen = new Map();
  const headings = [
    ...[...prose.matchAll(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm)].map((m) => [m.index, m[1]]),
    ...[...prose.matchAll(/^(?! {0,3}[#>*+-]|\s*$)([^\n]+)\n {0,3}(?:=+|-+)[ \t]*$/gm)].map((m) => [m.index, m[1]]),
  ].sort((a, b) => a[0] - b[0]);
  for (const [, text] of headings) {
    const base = text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[`*~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  for (const m of prose.matchAll(/<[a-z][\w-]*\b[^>]*\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1].toLowerCase());
  return anchors;
}

/**
 * @param {string} file
 * @param {string} source
 * @param {(file: string) => boolean} exists
 * @param {{ checkCodePaths?: boolean, read?: (file: string) => string }} [options]
 */
export function docLinkErrors(file, source, exists, { checkCodePaths = true, read } = {}) {
  const errors = [];
  const prose = stripFences(source);
  const check = (raw, rule) => {
    const fragment = raw.match(/#(.*)$/)?.[1];
    let target = raw.replace(/[?#].*$/, '');
    if (/^(?:[a-z]+:|\/\/)/i.test(target)) return;
    // Fragments are validated only against Markdown documents; line anchors (#L10) are GitHub source views.
    const checkFragment = (doc, docSource) => {
      if (!fragment || !read || !/\.md$/i.test(doc) || /^L\d+(?:-L\d+)?$/.test(fragment)) return;
      let id;
      try { id = decodeURIComponent(fragment).toLowerCase(); } catch { errors.push(`doc-anchor: ${file} -> ${raw}`); return; }
      if (!markdownAnchors(docSource ?? read(doc)).has(id)) errors.push(`doc-anchor: ${file} -> ${raw}`);
    };
    if (!target) { checkFragment(file, source); return; }
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { errors.push(`${rule}: ${file}`); return; }
    if (KNOWN_ABSENT.has(decoded.replace(/^\.\//, ''))) return;
    const resolved = decoded.startsWith('/')
      ? decoded.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded));
    // Reject links that escape the repository root.
    if (resolved.startsWith('../') || path.posix.isAbsolute(resolved) || resolved === '..') {
      errors.push(`${rule}: ${file} -> ${target}`);
      return;
    }
    if (KNOWN_ABSENT.has(resolved)) return;
    if (!exists(resolved)) errors.push(`${rule}: ${file} -> ${target}`);
    else checkFragment(resolved);
  };
  for (const match of prose.matchAll(/(?<!!)\[[^\]\n]+\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
    check(match[1], 'doc-link');
  }
  if (checkCodePaths) {
    for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
      const target = match[1];
      if (/^(?:(?:app|public|scripts|tests|docs|backlogs|reviews|\.github)\/[\w./-]+\.[\w-]+|(?:README|AGENTS|CLAUDE|ARCHITECTURE|SECURITY|BACKLOG|CONTRIBUTING|GROK_BOT)\.md)$/.test(target)) {
        if (KNOWN_ABSENT.has(target)) continue;
        if (!exists(target)) errors.push(`doc-path: ${file} -> ${target}`);
      }
    }
  }
  return errors;
}
