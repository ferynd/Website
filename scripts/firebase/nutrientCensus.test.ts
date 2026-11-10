import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintTrackerFoodV1, parseTrackerFood } from '@/app/tools/recipe-standardizer/lib/trackerFoods';
import { LEGACY_V1_KEYS } from '@/public/shared/nutrition/nutrientRegistry.js';
import { authenticateWithApplicationDefault, main } from './nutrientCensus';
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

  it('never builds a non-implicit refreshToken() credential, which Firestore rejects', () => {
    const source = readFileSync(new URL('./nutrientCensus.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('refreshToken(');
    expect(source).toContain('applicationDefault()');
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

describe('nutrient census staged ADC credential', () => {
  const CLI_PATH = join('/fixture-home', '.config', 'configstore', 'firebase-tools.json');
  const CLI_CONFIG = JSON.stringify({ tokens: { refresh_token: FAKE_REFRESH, access_token: 'fixture-access' }, user: { email: 'someone@example.test' } });
  const readText = (path: string): string | null => (path === CLI_PATH ? CLI_CONFIG : null);
  const expectedCredential = {
    type: 'authorized_user',
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: FAKE_REFRESH,
  };
  let parent: string;
  let out: string;
  let tempBase: string;
  const argv = (): string[] => ['node', 'nutrientCensus.ts', '--', '--project', 'jlb-calorietracker', '--out', out, '--dry-run'];
  const load = async () => ({ users: [] as CensusUser[], backup: [] });

  type Seen = { path: string | undefined; parsed?: unknown; fileMode?: number; dirMode?: number; inTempBase?: boolean };
  /** A fake firebase-admin/app whose applicationDefault() reads the injected env, as real ADC reads process.env. */
  function fakeAdmin(env: Record<string, string | undefined>, seen: Seen[], fail: boolean) {
    const applicationDefault = vi.fn(() => {
      const path = env.GOOGLE_APPLICATION_CREDENTIALS;
      const record: Seen = { path };
      if (path && existsSync(path)) {
        record.parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        record.fileMode = statSync(path).mode & 0o777;
        record.dirMode = statSync(dirname(path)).mode & 0o777;
        record.inTempBase = dirname(dirname(path)) === tempBase;
      }
      seen.push(record);
      return {
        getAccessToken: async () => {
          if (fail) throw new Error('fixture auth failure');
          return { access_token: 'fixture-access', expires_in: 3600 };
        },
      };
    });
    const authenticate = () => authenticateWithApplicationDefault(async () => ({ applicationDefault }) as never);
    return { applicationDefault, authenticate };
  }

  beforeEach(() => {
    // Safety net for process.env; every case below injects its own env object.
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', join(tmpdir(), 'nutrient-census-no-such-credential.json'));
    parent = mkdtempSync(join(tmpdir(), 'nutrient-census-adc-test-'));
    out = join(parent, 'run');
    tempBase = join(parent, 'tmp');
    mkdirSync(tempBase, { mode: 0o700 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(parent, { recursive: true, force: true });
  });

  it('stages the CLI login as a private ADC file for applicationDefault and removes it after success', async () => {
    const env: Record<string, string | undefined> = { HOME: '/fixture-home' };
    const seen: Seen[] = [];
    const { applicationDefault, authenticate } = fakeAdmin(env, seen, false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(argv(), { authenticate, loadCensus: load, env, homeDir: '/fixture-home', readText, tempBase });
    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBeTruthy();
    expect(seen[0]!.parsed).toEqual(expectedCredential);
    expect(seen[0]!.fileMode).toBe(0o600);
    expect(seen[0]!.dirMode).toBe(0o700);
    expect(seen[0]!.inTempBase).toBe(true);
    expect(existsSync(seen[0]!.path!)).toBe(false);
    expect(readdirSync(tempBase)).toEqual([]);
    expect('GOOGLE_APPLICATION_CREDENTIALS' in env).toBe(false);
    expect(existsSync(join(out, 'plan.json'))).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_REFRESH);
  });

  it('removes the staged file and restores the variable when auth fails, leaving no output directory', async () => {
    const env: Record<string, string | undefined> = { HOME: '/fixture-home', GOOGLE_APPLICATION_CREDENTIALS: '' };
    const seen: Seen[] = [];
    const { authenticate } = fakeAdmin(env, seen, true);
    const loadCensus = vi.fn(load);
    await expect(main(argv(), { authenticate, loadCensus, env, homeDir: '/fixture-home', readText, tempBase })).rejects.toThrow('fixture auth failure');
    expect(seen[0]!.parsed).toEqual(expectedCredential);
    expect(existsSync(seen[0]!.path!)).toBe(false);
    expect(readdirSync(tempBase)).toEqual([]);
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('');
    expect(loadCensus).not.toHaveBeenCalled();
    expect(existsSync(out)).toBe(false);
  });

  it('removes the staged file when authenticate throws before applicationDefault', async () => {
    const env: Record<string, string | undefined> = { HOME: '/fixture-home' };
    let during: string | undefined;
    const authenticate = async (): Promise<never> => {
      during = env.GOOGLE_APPLICATION_CREDENTIALS;
      throw new Error('fixture import failure');
    };
    await expect(main(argv(), { authenticate, loadCensus: load, env, homeDir: '/fixture-home', readText, tempBase })).rejects.toThrow();
    expect(during).toBeTruthy();
    expect(existsSync(during!)).toBe(false);
    expect(readdirSync(tempBase)).toEqual([]);
    expect('GOOGLE_APPLICATION_CREDENTIALS' in env).toBe(false);
  });

  it('leaves a preset GOOGLE_APPLICATION_CREDENTIALS alone and stages nothing', async () => {
    const env: Record<string, string | undefined> = { HOME: '/fixture-home', GOOGLE_APPLICATION_CREDENTIALS: '/preset/key.json' };
    const seen: Seen[] = [];
    const { authenticate } = fakeAdmin(env, seen, false);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(argv(), { authenticate, loadCensus: load, env, homeDir: '/fixture-home', readText, tempBase });
    expect(seen).toEqual([{ path: '/preset/key.json' }]);
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe('/preset/key.json');
    expect(readdirSync(tempBase)).toEqual([]);
  });

  it('uses plain ADC with no temp file when there is no CLI login', async () => {
    const env: Record<string, string | undefined> = { HOME: '/nowhere' };
    const seen: Seen[] = [];
    const { authenticate } = fakeAdmin(env, seen, false);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await main(argv(), { authenticate, loadCensus: load, env, homeDir: '/nowhere', readText, tempBase });
    expect(seen).toEqual([{ path: undefined }]);
    expect('GOOGLE_APPLICATION_CREDENTIALS' in env).toBe(false);
    expect(readdirSync(tempBase)).toEqual([]);
  });

  it('stages nothing when a precondition refuses the run', async () => {
    const env: Record<string, string | undefined> = { HOME: '/fixture-home' };
    const authenticate = vi.fn(async () => 'fixture-credential');
    const refused = ['node', 's', '--', '--project', 'jlb-calorietracker', '--out', parent, '--dry-run'];
    await expect(main(refused, { authenticate, loadCensus: load, env, homeDir: '/fixture-home', readText, tempBase })).rejects.toThrow(/output directory/);
    expect(authenticate).not.toHaveBeenCalled();
    expect(readdirSync(tempBase)).toEqual([]);
    expect('GOOGLE_APPLICATION_CREDENTIALS' in env).toBe(false);
  });
});
