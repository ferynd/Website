// These routes are unauthenticated today (F-030 → AR-11). Deliberately assert
// validation and zero provider work without locking in unauthenticated access.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_KEYS, installFetchGuard, makeRequest, stubKeys } from './helpers';

const routes = [
  { route: 'classify', load: () => import('../../app/api/classify/route'), missing: 'title is required.' },
  { route: 'classify/resolve', load: () => import('../../app/api/classify/resolve/route'), missing: 'source and sourceId are required.' },
  { route: 'recommend', load: () => import('../../app/api/recommend/route'), missing: 'moods, candidates, and profiles are required.' },
  { route: 'seasons', load: () => import('../../app/api/seasons/route'), missing: 'shows is required.' },
];
let calls: string[];
beforeEach(() => {
  vi.resetModules();
  stubKeys(); // Keys must be present even if the route checks config first.
  calls = installFetchGuard();
});
for (const route of routes) {
  describe(`POST /api/${route.route}`, () => {
    for (const scenario of [{ name: 'invalid JSON', body: '{', error: 'Invalid JSON body.' },
      { name: 'missing required fields', body: '{}', error: route.missing }]) {
      it(`rejects ${scenario.name} without provider work or key disclosure`, async () => {
        const { POST } = await route.load();
        const response = await POST(makeRequest(`/api/${route.route}`, { body: scenario.body }));
        const text = await response.text();
        expect(calls).toEqual([]);
        for (const key of Object.values(FAKE_KEYS)) expect(text).not.toContain(key);
        expect(response.status).toBe(400);
        expect(JSON.parse(text)).toEqual({ error: scenario.error });
      });
    }
  });
}
