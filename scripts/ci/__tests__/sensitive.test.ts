import { describe, expect, it } from 'vitest';
import { allowlistErrors, scanSensitive, secretFile, unexpectedSensitive } from '../lib/sensitive.mjs';

// Assemble realistic synthetic patterns so the scanner's own fixtures aren't hits.
const key = ['sk', ''].join('-') + '123456789012345678901234567890';
const email = ['person', 'gmail.com'].join('@');

describe('sensitive content', () => {
  it('distinguishes FAKE and EXAMPLE keys from unmarked key shapes', () => {
    expect(scanSensitive('app/example.ts', key).map((hit: { pattern: string }) => hit.pattern)).toEqual(['openai-key']);
    expect(scanSensitive('app/example.ts', key.replace('sk-', 'sk-FAKE_'))).toEqual([]);
    expect(scanSensitive('app/example.ts', key.replace('sk-', 'sk-EXAMPLE_'))).toEqual([]);
  });
  it('accepts synthetic domains and flags other emails only in scoped files', () => {
    for (const domain of ['example.com', 'example.org', 'example.net', 'test', 'invalid', 'localhost']) {
      expect(scanSensitive('tests/a.test.ts', `person@${domain}`)).toEqual([]);
    }
    expect(scanSensitive('tests/a.test.ts', email)[0]?.pattern).toBe('email');
    expect(scanSensitive('app/page.tsx', email)).toEqual([]);
  });
  it('limits phone and booking checks to trips and requires a booking qualifier', () => {
    expect(scanSensitive('public/trips/example.html', 'Booking reference: synthetic')[0]?.pattern).toBe('booking');
    expect(scanSensitive('public/trips/example.html', 'No-Reservation Afternoon')).toEqual([]);
    expect(scanSensitive('public/trips/example.html', '312-555-0100')[0]?.pattern).toBe('phone');
    expect(scanSensitive('tests/a.test.ts', '312-555-0100')).toEqual([]);
  });
  it('requires an exact allowlisted file and pattern', () => {
    const hits = scanSensitive('tests/a.test.ts', email);
    expect(unexpectedSensitive(hits, [{ file: 'tests/a.test.ts', pattern: 'email', match: email }])).toEqual([]);
    expect(unexpectedSensitive(hits, [{ file: 'tests/other.test.ts', pattern: 'email' }])).toHaveLength(1);
    expect(unexpectedSensitive(hits, [{ file: 'tests/a.test.ts', pattern: 'email', match: 'other@example.com' }])).toHaveLength(1);
    expect(allowlistErrors([{ file: 'example' }])).toEqual(['allowlist: incomplete entry']);
  });
  it('flags unmarked AIza keys and allows Firebase configs via allowlist', () => {
    const key = ['AIza', 'SyREAL_LOOKING_KEY_123456789012345'].join('');
    expect(scanSensitive('app/secret.ts', key)[0]?.pattern).toBe('google-api-key');
    expect(scanSensitive('app/secret.ts', key.replace('SyREAL', 'SyFAKE_REAL'))).toEqual([]);
    const hits = scanSensitive('app/tools/trip-cost/firebaseConfig.ts', key);
    expect(unexpectedSensitive(hits, [{ file: 'app/tools/trip-cost/firebaseConfig.ts', pattern: 'google-api-key' }])).toEqual([]);
    const built = scanSensitive('_next/static/chunks/app/tools/trip-cost/page.js', key);
    expect(unexpectedSensitive(built, [{ file: 're:^_next/static/chunks/app/tools/trip-cost/.*\\.js$', pattern: 'google-api-key' }])).toEqual([]);
  });
  it('scans plan and verification notes like any other file', () => {
    const header = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
    for (const path of ['PLAN.md', 'VERIFY.md', 'docs/nested/PLAN.md']) {
      expect(scanSensitive(path, header).map((hit: { pattern: string }) => hit.pattern)).toEqual(['private-key']);
      expect(scanSensitive(path, `${key}`).map((hit: { pattern: string }) => hit.pattern)).toEqual(['openai-key']);
    }
  });
  it('flags TMDB v3 API keys in TMDB or api_key context only', () => {
    const tmdbKey = '0123456789abcdef'.repeat(2);
    const patterns = (file: string, source: string) => scanSensitive(file, source).map((hit: { pattern: string }) => hit.pattern);
    expect(patterns('app/x.ts', `TMDB_API_KEY=${tmdbKey}`)).toEqual(['tmdb-api-key']);
    expect(patterns('_next/static/chunks/a.js', `fetch("https://api.themoviedb.org/3/x?api_key=${tmdbKey}")`)).toEqual(['tmdb-api-key']);
    expect(patterns('app/x.ts', `const apiKey = "${tmdbKey.toUpperCase()}";`)).toEqual(['tmdb-api-key']);
    expect(patterns('app/x.ts', `const checksum = "${tmdbKey}";`)).toEqual([]);
    expect(patterns('app/x.ts', `TMDB commit ${tmdbKey}01234567`)).toEqual([]);
    const hits = scanSensitive('tests/fixture.test.ts', `TMDB_API_KEY=${tmdbKey}`);
    expect(unexpectedSensitive(hits, [{ file: 'tests/fixture.test.ts', pattern: 'tmdb-api-key', match: tmdbKey }])).toEqual([]);
    expect(unexpectedSensitive(hits, [{ file: 'tests/fixture.test.ts', pattern: 'tmdb-api-key', match: tmdbKey.replace('0', '1') }])).toHaveLength(1);
  });
  it('flags TMDB read access tokens and other bearer JWTs', () => {
    const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = [segment({ alg: 'HS256' }), segment({ aud: '0123456789abcdef', sub: 'synthetic', scopes: ['api_read'] }), 'c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU'].join('.');
    expect(scanSensitive('app/x.ts', `Authorization: Bearer ${token}`).map((hit: { pattern: string }) => hit.pattern)).toEqual(['jwt-token']);
    expect(scanSensitive('.open-next/assets/a.js', `t="${token}"`)[0]?.pattern).toBe('jwt-token');
    expect(scanSensitive('app/x.ts', `${token.split('.').slice(0, 2).join('.')}`)).toEqual([]);
    const fake = [segment({ alg: 'HS256' }), segment({ sub: 'FAKE-synthetic-user' }), 'FAKE_signature_value_123'].join('.');
    expect(scanSensitive('tests/x.test.ts', fake)).toEqual([]);
  });
  it('rejects tracked secret files but permits the environment template', () => {
    for (const path of ['.env', '.env.local', '.dev.vars', 'key.pem', 'service-account-prod.json', '.wrangler/cache', '.open-next/worker.js', '.firebase/cache']) expect(secretFile(path)).toBe(true);
    expect(secretFile('.env.example')).toBe(false);
  });
});
