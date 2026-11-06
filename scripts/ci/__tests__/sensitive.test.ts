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
  it('rejects tracked secret files but permits the environment template', () => {
    for (const path of ['.env', '.env.local', '.dev.vars', 'key.pem', 'service-account-prod.json', '.wrangler/cache', '.open-next/worker.js', '.firebase/cache']) expect(secretFile(path)).toBe(true);
    expect(secretFile('.env.example')).toBe(false);
  });
});
