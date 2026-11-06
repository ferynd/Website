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
    expect(match[1]).toBe('nutritrack-v4');
    expect(match[1]).toBe(NUTRITRACK_CACHE_NAME);
    expect(source).not.toContain('nutritrack-v2');
  });
});

it('manifest is network-first and Firestore stays network-only',()=>{const source=readFileSync(join(trackerRoot,'sw.js'),'utf8');expect(source).toContain('manifest\\.json$');expect(source.indexOf('NETWORK_ONLY_PATTERNS.some')).toBeLessThan(source.indexOf('event.respondWith'));expect(source).toContain('firestore\\.googleapis');});

import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
function workerHarness(network, cached) {
  const handlers = {};
  const fetch = vi.fn(network);
  const cache = { match: vi.fn(async () => cached), put: vi.fn(async () => {}) };
  runInNewContext(readFileSync(join(trackerRoot, 'sw.js'), 'utf8'), {
    self: { addEventListener: (name, fn) => { handlers[name] = fn; } },
    URL, Response, location: { origin: 'https://example.test' }, fetch,
    caches: { open: async () => cache, match: async () => cached },
  });
  const request = async url => {
    let response;
    handlers.fetch({ request: { url, mode: 'cors' }, respondWith: promise => { response = promise; } });
    return response ? await response : null;
  };
  return { request, fetch, cache };
}
it('fetches manifests from network first, falling back to the cached manifest offline', async () => {
  const url = 'https://example.test/shared/nutrition/catalog/nutrition-curated/manifest.json';
  const cached = new Response('old');
  const online = workerHarness(async () => new Response('new'), cached);
  expect(await (await online.request(url)).text()).toBe('new');
  expect(online.fetch).toHaveBeenCalledTimes(1);
  const offline = workerHarness(async () => { throw new Error('offline'); }, cached);
  expect(await (await offline.request(url)).text()).toBe('old');
});
it('serves immutable hashed shards from cache without a network call', async () => {
  const worker = workerHarness(async () => { throw new Error('network should not run'); }, new Response('shard'));
  expect(await (await worker.request('https://example.test/shared/nutrition/catalog/nutrition-curated/variants/ch.' + 'a'.repeat(64) + '.json')).text()).toBe('shard');
  expect(worker.fetch).not.toHaveBeenCalled();
});
it('lets Firestore use the browser network without touching Cache Storage', async () => {
  const worker = workerHarness(async () => new Response('private'), new Response('cached'));
  expect(await worker.request('https://firestore.googleapis.com/v1/projects/demo/documents')).toBeNull();
  expect(worker.fetch).not.toHaveBeenCalled();
  expect(worker.cache.match).not.toHaveBeenCalled();
  expect(worker.cache.put).not.toHaveBeenCalled();
});
