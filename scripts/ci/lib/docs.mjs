import path from 'node:path';

export function hasBackLink(source) {
  return /<a\b[^>]*\bhref\s*=\s*['"](?:\/(?:tools|games|trips)?\/?|\.\.\/)['"]/i.test(source);
}

/** Paths that are intentionally absent (deleted, policy-forbidden, or historical). */
export const KNOWN_ABSENT = new Set([
  'CURRENT_WORK.md',
  'public/trips/JapanTrip.html',
]);

export function docLinkErrors(file, source, exists, { checkCodePaths = true } = {}) {
  const errors = [];
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  const check = (target, rule) => {
    target = target.replace(/[?#].*$/, '');
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) return;
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
