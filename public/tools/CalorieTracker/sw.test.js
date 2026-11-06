import { readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NUTRITRACK_CACHE_NAME } from '../../shared/nutrition/capabilities.js';

const trackerRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(trackerRoot, '../..');

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Static and dynamic import specifiers. HTTP and bare packages are ignored. */
function localSpecifiers(source) {
  const specs = [];
  const re = /\b(?:import|export)\s*(?:\(|[\s\S]*?\bfrom\s*)\s*['"]([^'"]+)['"]/g;
  for (const match of stripComments(source).matchAll(re)) specs.push(match[1]);
  return specs.filter((spec) => spec.startsWith('.') || spec.startsWith('/'));
}

function resolveSpecifier(fromFile, spec) {
  if (spec.startsWith('/')) return normalize(join(publicRoot, spec));
  return normalize(join(dirname(fromFile), spec));
}

function shellFile(entry) {
  if (entry.startsWith('/')) return normalize(join(publicRoot, entry));
  return normalize(join(trackerRoot, entry));
}

/** Modules reachable from main.js, including dynamic import(). */
function importGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of localSpecifiers(source)) {
      const next = resolveSpecifier(file, spec);
      const inTracker = next.startsWith(trackerRoot);
      const sharedNutrition = next.includes(`${normalize('/shared/nutrition/')}`);
      if (!inTracker && !sharedNutrition) continue;
      if (!next.endsWith('.js')) continue;
      queue.push(next);
    }
  }
  return seen;
}

describe('service worker shell', () => {
  const source = readFileSync(join(trackerRoot, 'sw.js'), 'utf8');
  const shellMatch = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  const shell = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

  it('APP_SHELL lists every tracker and shared nutrition module imported by main.js', () => {
    const graph = importGraph(join(trackerRoot, 'main.js'));
    const listed = new Set(shell.map(shellFile));
    const missing = [...graph].filter((file) => !listed.has(file));
    expect(missing).toEqual([]);
  });

  it('CACHE_NAME changed from nutritrack-v2', () => {
    const match = source.match(/const CACHE_NAME = '([^']+)'/);
    expect(match[1]).toBe('nutritrack-v3');
    expect(match[1]).toBe(NUTRITRACK_CACHE_NAME);
    expect(source).not.toContain('nutritrack-v2');
  });
});
