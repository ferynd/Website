import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintTrackerFoodV1, parseTrackerFood } from '@/app/tools/recipe-standardizer/lib/trackerFoods';
import { LEGACY_V1_KEYS } from '@/public/shared/nutrition/nutrientRegistry.js';
import { main } from './nutrientCensus';
import {
  censusFromFixtures,
  cliAuthorizedUserCredential,
  encodeBackup,
  FIREBASE_CLI_CLIENT_ID,
  FIREBASE_CLI_CLIENT_SECRET,
  firebaseCliConfigPaths,
  isCensusProcessEntry,
  refuseUnsafeRun,
  selectCensusCredential,
  type CensusUser,
} from './nutrientCensusLogic';

const SENTINEL_NAME = 'zz-sentinel-food-name';
const SENTINEL_VALUE = 8675309;

function legacyNumbers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...Object.fromEntries(LEGACY_V1_KEYS.map((key) => [key, 0])),
    ...overrides,
  };
}

describe('nutrient census', () => {
  it('census counts v1/v2/other shapes, collisions and fingerprint formats from fixtures without emitting names or values', () => {
    const verifiedFood = {
      name: SENTINEL_NAME,
      quantity: 1,
      ...legacyNumbers({ sodium: SENTINEL_VALUE }),
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const parsed = parseTrackerFood('food-verified', verifiedFood);
    expect(parsed).not.toBeNull();
    const verifiedFingerprint = fingerprintTrackerFoodV1(parsed!);
    const expandedFood = {
      name: SENTINEL_NAME,
      quantity: 1,
      ...legacyNumbers({ sodium: 1 }),
      fatSaturated: 4,
      nutrientSchemaVersion: 2,
      nutrientMeta: { registryVersion: 2, quality: {} },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const expanded = parseTrackerFood('food-expanded', expandedFood);
    const expandedFingerprint = fingerprintTrackerFoodV1(expanded!);

    const users: CensusUser[] = [
      {
        uid: 'user-a',
        foods: [
          { id: 'food-verified', data: verifiedFood },
          { id: 'food-null', data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers({ sodium: null }) } },
          { id: 'food-text', data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers({ calories: 'twelve' }) } },
          {
            id: 'food-collision',
            data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers(), fatSaturated: SENTINEL_VALUE, nutrientMeta: { registryVersion: 2 } },
          },
          { id: 'food-expanded', data: expandedFood },
          { id: 'food-other', data: { name: SENTINEL_NAME, quantity: 1, nutrientSchemaVersion: 3, ...legacyNumbers() } },
        ],
        dailyEntries: [
          {
            id: '2026-11-01',
            data: {
              date: '2026-11-01',
              foodItems: [
                { id: 'item-1', name: SENTINEL_NAME, calories: SENTINEL_VALUE, fatSaturated: 1 },
                { id: 'item-2', name: SENTINEL_NAME, calories: 1 },
              ],
            },
          },
          { id: '2026-11-02', data: { date: '2026-11-02', notes: SENTINEL_NAME } },
        ],
        recipes: [
          {
            id: 'recipe-1',
            data: {
              name: SENTINEL_NAME,
              recipe: {
                name: SENTINEL_NAME,
                ingredients: [
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-verified', targetFingerprint: verifiedFingerprint } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-verified', targetFingerprint: '00000000' } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-expanded', targetFingerprint: expandedFingerprint } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-expanded', targetFingerprint: 'v2:deadbeef' } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'missing', targetFingerprint: 'not-a-hash' } },
                  { nutritionLink: { status: 'candidate', foodItemId: 'food-verified', targetFingerprint: verifiedFingerprint } },
                ],
                nutritionExports: {
                  perPortion: { nutritionFingerprint: verifiedFingerprint, foodId: 'food-verified', foodName: SENTINEL_NAME },
                  per100gCooked: { nutritionFingerprint: 'v2:cafebabe', foodId: 'food-expanded' },
                },
              },
            },
          },
        ],
      },
      { uid: 'user-b', foods: [], dailyEntries: [], recipes: [] },
    ];

    const report = censusFromFixtures(users);
    expect(report.users).toBe(2);
    expect(report.foodItems).toEqual({
      total: 6,
      v1: 4,
      v2: 1,
      other: 1,
      nonNumericOrNullLegacy: 2,
      collisions: 1,
    });
    expect(report.dailyEntries.total).toBe(2);
    expect(report.dailyEntries.foodItemElements).toBe(2);
    expect(report.dailyEntries.elementCollisions).toBe(1);
    expect(report.dailyEntries.largestBytes).toBeGreaterThan(0);
    expect(report.recipes).toBe(1);
    expect(report.confirmedLinks).toBe(5);
    expect(report.exportRefs).toBe(2);
    expect(report.fingerprints.confirmedLinks).toEqual({ hex8: 3, v2: 1, other: 1 });
    expect(report.fingerprints.exportRefs).toEqual({ hex8: 1, v2: 1, other: 0 });
    expect(report.v1Links).toEqual({ verified: 2, stale: 2 });

    const printed = JSON.stringify(report);
    expect(printed).not.toContain(SENTINEL_NAME);
    expect(printed).not.toContain(String(SENTINEL_VALUE));
    expect(printed).not.toContain('food-verified');
    expect(printed).not.toContain('user-a');
  });

  it('backup encoding keeps typed values', () => {
    const encoded = encodeBackup({ sodium: 39340, fatSaturated: null, quantity: 1, nested: { water: 0 } });
    const round = JSON.parse(JSON.stringify(encoded)) as {
      sodium: number;
      fatSaturated: null;
      quantity: number;
      nested: { water: number };
    };
    expect(round).toEqual(encoded);
    expect(round.sodium).toBe(39340);
    expect(round.fatSaturated).toBeNull();
    expect(typeof round.sodium).toBe('number');
    expect(typeof round.quantity).toBe('number');
  });

  it('refuses to run without --dry-run or with an existing output directory', () => {
    expect(() => refuseUnsafeRun({ dryRun: false, outputDirExists: false })).toThrow(/dry-run/);
    expect(() => refuseUnsafeRun({ dryRun: true, outputDirExists: true })).toThrow(/output directory/);
    expect(() => refuseUnsafeRun({ dryRun: true, outputDirExists: false })).not.toThrow();
  });

  it('has no write code path', () => {
    const source = readFileSync(new URL('./nutrientCensus.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.set\s*\(/);
    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/\.create\s*\(/);
    expect(source).not.toMatch(/\bbatch\s*\(/);
    expect(source).not.toMatch(/from\s+['"]firebase-admin/);
    expect(source).toMatch(/import\('firebase-admin\/app'\)/);
    expect(source).toMatch(/import\('firebase-admin\/firestore'\)/);
  });
});

const FAKE_REFRESH = 'fixture-refresh-token-not-real';
const SCRIPT_PATH = fileURLToPath(new URL('./nutrientCensus.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('nutrient census Firebase CLI credential', () => {
  it('builds an authorized_user credential from a configstore fixture with the public CLI client', () => {
    const fixture = { tokens: { refresh_token: FAKE_REFRESH, access_token: 'fixture-access' }, user: { email: 'someone@example.test' }, usage: true };
    const credential = cliAuthorizedUserCredential(fixture, {});
    expect(credential).toEqual({
      type: 'authorized_user',
      client_id: FIREBASE_CLI_CLIENT_ID,
      client_secret: FIREBASE_CLI_CLIENT_SECRET,
      refresh_token: FAKE_REFRESH,
    });
    expect(JSON.stringify(credential)).not.toContain('someone@example.test');
    expect(JSON.stringify(credential)).not.toContain('fixture-access');
  });

  it('respects FIREBASE_CLIENT_ID and FIREBASE_CLIENT_SECRET overrides', () => {
    const credential = cliAuthorizedUserCredential(
      { tokens: { refresh_token: FAKE_REFRESH } },
      { FIREBASE_CLIENT_ID: 'override-id', FIREBASE_CLIENT_SECRET: 'override-secret' },
    );
    expect(credential?.client_id).toBe('override-id');
    expect(credential?.client_secret).toBe('override-secret');
  });

  it('returns null without a usable refresh token', () => {
    for (const config of [null, undefined, 'text', [], {}, { tokens: null }, { tokens: {} }, { tokens: { refresh_token: '' } }, { tokens: { refresh_token: 42 } }]) {
      expect(cliAuthorizedUserCredential(config, {})).toBeNull();
    }
  });

  it('resolves candidate configstore paths from XDG_CONFIG_HOME then HOME', () => {
    expect(firebaseCliConfigPaths({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/tmp/fbhome' }, '/home/other')).toEqual([
      join('/x/cfg', 'configstore', 'firebase-tools.json'),
      join('/tmp/fbhome', '.config', 'configstore', 'firebase-tools.json'),
    ]);
    expect(firebaseCliConfigPaths({ HOME: '/tmp/fbhome' }, '/home/other')).toEqual([
      join('/tmp/fbhome', '.config', 'configstore', 'firebase-tools.json'),
    ]);
    expect(firebaseCliConfigPaths({}, '/home/other')).toEqual([join('/home/other', '.config', 'configstore', 'firebase-tools.json')]);
    expect(firebaseCliConfigPaths({ XDG_CONFIG_HOME: '/h/.config', HOME: '/h' }, '/h')).toEqual([
      join('/h/.config', 'configstore', 'firebase-tools.json'),
    ]);
  });

  it('selects ADC when GOOGLE_APPLICATION_CREDENTIALS is set, else the CLI login, else ADC', () => {
    const cliPath = join('/tmp/fbhome', '.config', 'configstore', 'firebase-tools.json');
    const files: Record<string, string> = { [cliPath]: JSON.stringify({ tokens: { refresh_token: FAKE_REFRESH } }) };
    const read = (path: string): string | null => files[path] ?? null;
    expect(selectCensusCredential({ GOOGLE_APPLICATION_CREDENTIALS: '/k.json', HOME: '/tmp/fbhome' }, '/h', read)).toEqual({ kind: 'application-default' });
    const chosen = selectCensusCredential({ HOME: '/tmp/fbhome' }, '/h', read);
    expect(chosen.kind).toBe('firebase-cli');
    expect(chosen.kind === 'firebase-cli' && chosen.credential.refresh_token).toBe(FAKE_REFRESH);
    expect(selectCensusCredential({ HOME: '/nowhere' }, '/h', read)).toEqual({ kind: 'application-default' });
    files[cliPath] = '{not json';
    expect(selectCensusCredential({ HOME: '/tmp/fbhome' }, '/h', read)).toEqual({ kind: 'application-default' });
  });
});

describe('nutrient census entry detection', () => {
  it('is the entry for a direct script launch and for vite-node', () => {
    expect(isCensusProcessEntry(['/usr/bin/node', SCRIPT_PATH, '--dry-run'], SCRIPT_PATH)).toBe(true);
    expect(isCensusProcessEntry(['/usr/bin/node', '/repo/node_modules/.bin/vite-node', '--dry-run', '--project', 'p'], SCRIPT_PATH)).toBe(true);
    expect(isCensusProcessEntry(['/usr/bin/node', '/repo/node_modules/vite-node/vite-node.mjs', '--dry-run'], SCRIPT_PATH)).toBe(true);
  });

  it('is not the entry under vitest, another script, or a plain import', () => {
    expect(isCensusProcessEntry(['/usr/bin/node', '/repo/node_modules/vitest/vitest.mjs', 'run'], SCRIPT_PATH)).toBe(false);
    expect(isCensusProcessEntry(['/usr/bin/node', '/repo/node_modules/.bin/vitest', 'run'], SCRIPT_PATH)).toBe(false);
    expect(isCensusProcessEntry(['/usr/bin/node', '/repo/scripts/other.ts'], SCRIPT_PATH)).toBe(false);
    expect(isCensusProcessEntry(['/usr/bin/node'], SCRIPT_PATH)).toBe(false);
    expect(isCensusProcessEntry(process.argv, SCRIPT_PATH)).toBe(false);
  });
});

describe('nutrient census run order', () => {
  let parent: string;
  let out: string;
  let inside: string | null = null;
  const fixtureUsers: CensusUser[] = [
    {
      uid: 'user-a',
      foods: [{ id: 'food-a', data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers({ sodium: SENTINEL_VALUE }) } }],
      dailyEntries: [],
      recipes: [],
    },
  ];
  const argv = (): string[] => ['node', 'nutrientCensus.ts', '--', '--project', 'jlb-calorietracker', '--out', out, '--dry-run'];

  beforeEach(() => {
    // Safety net: a real default credential can never resolve inside these tests.
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', join(tmpdir(), 'nutrient-census-no-such-credential.json'));
    parent = mkdtempSync(join(tmpdir(), 'nutrient-census-'));
    out = join(parent, 'run');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(parent, { recursive: true, force: true });
    // A regression could create the in-checkout probe; never leave it behind.
    if (inside) rmSync(inside, { recursive: true, force: true });
    inside = null;
  });

  it('a failed auth leaves no output directory and the retry succeeds', async () => {
    const calls: string[] = [];
    const failing = {
      authenticate: async () => {
        calls.push(`auth:dirExists=${existsSync(out)}`);
        throw new Error('fixture auth failure');
      },
      loadCensus: async () => {
        calls.push('load');
        return { users: fixtureUsers, backup: [] };
      },
    };
    await expect(main(argv(), failing)).rejects.toThrow();
    expect(calls).toEqual(['auth:dirExists=false']);
    expect(existsSync(out)).toBe(false);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const succeeding = {
      authenticate: async () => {
        calls.push(`auth:dirExists=${existsSync(out)}`);
        return 'fixture-credential';
      },
      loadCensus: async (credential: string, projectId: string) => {
        calls.push(`load:${credential}:${projectId}:dirExists=${existsSync(out)}`);
        return { users: fixtureUsers, backup: [] };
      },
    };
    await main(argv(), succeeding);
    expect(calls).toEqual([
      'auth:dirExists=false',
      'auth:dirExists=false',
      'load:fixture-credential:jlb-calorietracker:dirExists=true',
    ]);
    expect(statSync(out).mode & 0o777).toBe(0o700);
    expect(existsSync(join(out, 'plan.json'))).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const printed = String(log.mock.calls[0]?.[0]);
    expect(printed).not.toContain(SENTINEL_NAME);
    expect(printed).not.toContain(String(SENTINEL_VALUE));
    expect(printed).not.toContain('user-a');
    expect(printed).not.toContain('food-a');
  });

  it('still refuses an existing output directory and an output inside the checkout before auth', async () => {
    const authenticate = vi.fn(async () => 'fixture-credential');
    const loadCensus = vi.fn(async () => ({ users: fixtureUsers, backup: [] }));
    await expect(main(['node', 's', '--', '--project', 'jlb-calorietracker', '--out', parent, '--dry-run'], { authenticate, loadCensus })).rejects.toThrow(/output directory/);
    inside = join(REPO_ROOT, `nutrient-census-must-not-exist-${process.pid}-${Date.now()}`);
    await expect(main(['node', 's', '--', '--project', 'jlb-calorietracker', '--out', inside, '--dry-run'], { authenticate, loadCensus })).rejects.toThrow(/outside the checkout/);
    expect(existsSync(inside)).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
    expect(loadCensus).not.toHaveBeenCalled();
  });
});
