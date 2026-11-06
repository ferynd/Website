import { it, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createFdcApiAdapter } from './fdcApiAdapter';
afterEach(() => vi.unstubAllEnvs());
const fakeKey = 'synthetic-key-24-hex-prefix';
it('requires --live before reading a key or calling fetch; sends the key only in the header', async () => {
    const fetch = vi.fn();
    const offline = createFdcApiAdapter({ fetch });
    await expect(offline.fetch('9900001')).rejects.toThrow('--live');
    expect(fetch).not.toHaveBeenCalled();
    const adapter = createFdcApiAdapter({ live: true, fetch, sleep: async () => { } });
    vi.stubEnv('FDC_API_KEY', '');
    await expect(adapter.fetch('9900001')).rejects.toThrow('required');
    vi.stubEnv('FDC_API_KEY', fakeKey);
    fetch.mockResolvedValue(new Response(await readFile('scripts/fixtures/nutrition/fdc/apple-api.json', 'utf8')));
    await adapter.fetch('9900001');
    expect(fetch.mock.calls[0][0]).not.toContain(fakeKey);
    expect(fetch.mock.calls[0][0]).not.toContain('api_key');
    expect(fetch.mock.calls[0][1].headers['X-Api-Key']).toBe(fakeKey);
});
it.each([429, 500, 404, 400])('classifies HTTP %s with redacted errors', async (status) => {
    vi.stubEnv('FDC_API_KEY', fakeKey);
    const adapter = createFdcApiAdapter({ live: true, fetch: vi.fn(async () => new Response(fakeKey, { status, headers: { 'retry-after': '120' } })), sleep: async () => { } });
    const err = await adapter.fetch('9900001').catch(e => e);
    expect(err.message).not.toContain(fakeKey);
    expect(err.name).toBe(status < 429 ? 'PermanentSourceError' : 'Error');
    if (status === 429)
        expect(err.retryAfterMs).toBe(30000);
});
it('redacts transport failures and malformed JSON and enforces request spacing', async () => {
    vi.stubEnv('FDC_API_KEY', fakeKey);
    const sleeps: number[] = [], fetch = vi.fn(async () => { throw new Error(fakeKey); });
    const adapter = createFdcApiAdapter({ live: true, fetch, now: () => 100, sleep: async (ms) => { sleeps.push(ms); } });
    await expect(adapter.fetch('9900001')).rejects.toThrow('redacted');
    await expect(adapter.fetch('9900001')).rejects.not.toThrow(fakeKey);
    expect(sleeps).toEqual([0, 1000]);
    const bad = createFdcApiAdapter({ live: true, fetch: vi.fn(async () => new Response('{')), sleep: async () => { } });
    await expect(bad.fetch('9900001')).rejects.toThrow('Invalid FDC JSON');
});
