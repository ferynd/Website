import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FAKE_KEYS, GOOGLE_KEYS_URL, exportedRouteHandlers, fakeJwt, installFetchGuard, makeRequest, stubKeys } from './helpers';

const handlers = [
  { route: 'classify', method: 'POST', load: () => import('../../app/api/transcriber/classify/route') },
  { route: 'correct', method: 'POST', load: () => import('../../app/api/transcriber/correct/route') },
  { route: 'gemini/file', method: 'GET', load: () => import('../../app/api/transcriber/gemini/file/route') },
  { route: 'gemini/file', method: 'DELETE', load: () => import('../../app/api/transcriber/gemini/file/route') },
  { route: 'gemini/upload', method: 'POST', load: () => import('../../app/api/transcriber/gemini/upload/route') },
  { route: 'gemini/window', method: 'POST', load: () => import('../../app/api/transcriber/gemini/window/route') },
  { route: 'speaker-repair', method: 'POST', load: () => import('../../app/api/transcriber/speaker-repair/route') },
  { route: 'transcribe', method: 'POST', load: () => import('../../app/api/transcriber/transcribe/route') },
];
let calls: string[];
beforeEach(() => {
  vi.resetModules(); // Also clears the verifier's JWKS cache between cases.
  stubKeys();
  calls = installFetchGuard();
});

function expectNoProviderWork(body: string) {
  expect(calls.filter((url) => url !== GOOGLE_KEYS_URL)).toEqual([]);
  for (const key of Object.values(FAKE_KEYS)) expect(body).not.toContain(key);
}

for (const handler of handlers) {
  describe(`${handler.method} /api/transcriber/${handler.route}`, () => {
    for (const scenario of ['missing auth', 'malformed token', 'unsigned token', 'invalid body before auth']) {
      it(`returns 401 with ${scenario}`, async () => {
        const authorization = scenario === 'malformed token' ? 'Bearer not-a-jwt'
          : scenario === 'unsigned token' ? `Bearer ${fakeJwt()}` : undefined;
        const request = makeRequest(`/api/transcriber/${handler.route}?name=invalid`, {
          method: handler.method, body: scenario === 'invalid body before auth' ? '{' : '{}', authorization,
        });
        const json = vi.spyOn(request, 'json');
        const form = vi.spyOn(request, 'formData');
        const module = await handler.load();
        const run = module[handler.method as keyof typeof module];
        const response = await run(request);
        const body = await response.text();
        expectNoProviderWork(body);
        expect(response.status).toBe(401);
        expect(json).not.toHaveBeenCalled();
        expect(form).not.toHaveBeenCalled();
        expect(calls).toEqual(scenario === 'unsigned token' ? [GOOGLE_KEYS_URL] : []);
      });
    }
  });
}

it('status keeps key presence private for an unauthenticated request', async () => {
  const { GET } = await import('../../app/api/transcriber/status/route');
  const response = await GET(makeRequest('/api/transcriber/status', { method: 'GET' }));
  const body = await response.text();
  expectNoProviderWork(body);
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toMatchObject({ signedIn: false, transcribeKeyConfigured: null, correctionKeyConfigured: null });
  expect(calls).toEqual([]);
});

it('registers every exported transcriber HTTP handler', async () => {
  const actual = await exportedRouteHandlers('app/api/transcriber');
  expect(actual).toEqual([...handlers.map(({ method, route }) => `${method} ${route}`), 'GET status'].sort());
});

it('registry enumeration includes export-list and aliased handlers', async () => {
  expect(await exportedRouteHandlers('tests/api/fixtures/routes')).toEqual(['GET reexported', 'POST reexported', 'PUT reexported/nested']);
});
