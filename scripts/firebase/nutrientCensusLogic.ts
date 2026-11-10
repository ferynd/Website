import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  parseTrackerFood,
  verifyTrackerFoodFingerprint,
} from '@/app/tools/recipe-standardizer/lib/trackerFoods';
import { LEGACY_V1_KEYS, V2_DETAIL_KEYS } from '@/public/shared/nutrition/nutrientRegistry.js';

export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

export type FingerprintFormatCounts = { hex8: number; v2: number; other: number };

export type CensusReport = {
  users: number;
  foodItems: {
    total: number;
    v1: number;
    v2: number;
    other: number;
    nonNumericOrNullLegacy: number;
    collisions: number;
  };
  dailyEntries: {
    total: number;
    foodItemElements: number;
    elementCollisions: number;
    largestBytes: number;
  };
  recipes: number;
  confirmedLinks: number;
  exportRefs: number;
  fingerprints: {
    confirmedLinks: FingerprintFormatCounts;
    exportRefs: FingerprintFormatCounts;
  };
  /** Confirmed links whose stored fingerprint is not v2-prefixed. */
  v1Links: { verified: number; stale: number };
};

export type CensusDoc = { id: string; data: Record<string, unknown> };

export type CensusUser = {
  uid: string;
  foods: CensusDoc[];
  dailyEntries: CensusDoc[];
  recipes: CensusDoc[];
};

const emptyFormats = (): FingerprintFormatCounts => ({ hex8: 0, v2: 0, other: 0 });

export function refuseUnsafeRun(options: { dryRun: boolean; outputDirExists: boolean }): void {
  if (!options.dryRun) throw new Error('Refusing to run without --dry-run');
  if (options.outputDirExists) throw new Error('Refusing to run because the output directory already exists');
}

/**
 * Public installed-app OAuth client of the Firebase CLI (firebase-tools src/api.ts). Not a secret.
 * The user's refresh token is the secret; it stays in the local configstore file and is never printed.
 */
export const FIREBASE_CLI_CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
export const FIREBASE_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

export type CensusEnv = Record<string, string | undefined>;

export type AuthorizedUserCredential = {
  type: 'authorized_user';
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

export type CensusCredentialChoice =
  | { kind: 'application-default' }
  | { kind: 'firebase-cli'; credential: AuthorizedUserCredential };

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Candidate Firebase CLI configstore paths, XDG first. Pure string work. */
export function firebaseCliConfigPaths(env: CensusEnv, homeDir: string): string[] {
  const paths: string[] = [];
  const xdg = nonEmpty(env.XDG_CONFIG_HOME);
  if (xdg) paths.push(join(xdg, 'configstore', 'firebase-tools.json'));
  const home = nonEmpty(env.HOME) ?? nonEmpty(homeDir);
  if (home) {
    const fallback = join(home, '.config', 'configstore', 'firebase-tools.json');
    if (!paths.includes(fallback)) paths.push(fallback);
  }
  return paths;
}

/** The authorized_user credential for a parsed configstore, or null. Copies no other config field. */
export function cliAuthorizedUserCredential(parsedConfig: unknown, env: CensusEnv): AuthorizedUserCredential | null {
  const config = asRecord(parsedConfig);
  const tokens = config ? asRecord(config.tokens) : null;
  const refreshToken = tokens?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return null;
  return {
    type: 'authorized_user',
    client_id: nonEmpty(env.FIREBASE_CLIENT_ID) ?? FIREBASE_CLI_CLIENT_ID,
    client_secret: nonEmpty(env.FIREBASE_CLIENT_SECRET) ?? FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: refreshToken,
  };
}

/**
 * GOOGLE_APPLICATION_CREDENTIALS wins. Otherwise the first readable CLI configstore with a refresh token.
 * Otherwise Application Default Credentials. readText returns null for a missing or unreadable file;
 * malformed JSON falls through.
 */
export function selectCensusCredential(
  env: CensusEnv,
  homeDir: string,
  readText: (path: string) => string | null,
): CensusCredentialChoice {
  if (nonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS)) return { kind: 'application-default' };
  for (const path of firebaseCliConfigPaths(env, homeDir)) {
    const text = readText(path);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const credential = cliAuthorizedUserCredential(parsed, env);
    if (credential) return { kind: 'firebase-cli', credential };
  }
  return { kind: 'application-default' };
}

/**
 * True when argv[1] is the census script itself or the vite-node launcher.
 * vite-node consumes the script path, so argv[1] is its own binary. vitest and plain imports are false.
 */
export function isCensusProcessEntry(argv: readonly string[], scriptFilePath: string): boolean {
  const launcher = argv[1];
  if (!launcher) return false;
  const name = basename(launcher);
  if (name === 'vite-node' || name === 'vite-node.mjs') return true;
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(launcher) === real(scriptFilePath);
}

/** JSON that keeps numbers and nulls. Callers convert non-JSON admin types first. */
export function encodeBackup(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function schemaClass(data: Record<string, unknown>): 'v1' | 'v2' | 'other' {
  if (!Object.prototype.hasOwnProperty.call(data, 'nutrientSchemaVersion')) return 'v1';
  const version = data.nutrientSchemaVersion;
  if (version === 1) return 'v1';
  if (version === 2) return 'v2';
  return 'other';
}

function legacyKeyProblem(data: Record<string, unknown>): boolean {
  return LEGACY_V1_KEYS.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return false;
    const value = data[key];
    if (value === null) return true;
    return typeof value !== 'number' || !Number.isFinite(value);
  });
}

function collides(data: Record<string, unknown>, schema: 'v1' | 'v2' | 'other'): boolean {
  if (schema === 'v2') return false;
  return Object.keys(data).some((key) => key === 'nutrientMeta' || (V2_DETAIL_KEYS as readonly string[]).includes(key));
}

function fingerprintFormat(stored: unknown): 'hex8' | 'v2' | 'other' {
  if (typeof stored !== 'string' || stored.length === 0) return 'other';
  if (stored.startsWith('v2:')) return 'v2';
  if (/^[0-9a-f]{8}$/.test(stored)) return 'hex8';
  return 'other';
}

function bumpFormat(counts: FingerprintFormatCounts, stored: unknown): void {
  counts[fingerprintFormat(stored)] += 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recipeBody(data: Record<string, unknown>): Record<string, unknown> {
  return asRecord(data.recipe) ?? data;
}

function documentBytes(data: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(data), 'utf8');
}

/** Aggregate counts only. The report has no document ids, names, or nutrient values. */
export function censusFromFixtures(users: CensusUser[]): CensusReport {
  const report: CensusReport = {
    users: users.length,
    foodItems: { total: 0, v1: 0, v2: 0, other: 0, nonNumericOrNullLegacy: 0, collisions: 0 },
    dailyEntries: { total: 0, foodItemElements: 0, elementCollisions: 0, largestBytes: 0 },
    recipes: 0,
    confirmedLinks: 0,
    exportRefs: 0,
    fingerprints: { confirmedLinks: emptyFormats(), exportRefs: emptyFormats() },
    v1Links: { verified: 0, stale: 0 },
  };

  for (const user of users) {
    const foodsById = new Map<string, ReturnType<typeof parseTrackerFood>>();
    for (const food of user.foods) {
      report.foodItems.total += 1;
      const schema = schemaClass(food.data);
      report.foodItems[schema] += 1;
      if (legacyKeyProblem(food.data)) report.foodItems.nonNumericOrNullLegacy += 1;
      if (collides(food.data, schema)) report.foodItems.collisions += 1;
      foodsById.set(food.id, parseTrackerFood(food.id, food.data));
    }

    for (const entry of user.dailyEntries) {
      report.dailyEntries.total += 1;
      report.dailyEntries.largestBytes = Math.max(report.dailyEntries.largestBytes, documentBytes(entry.data));
      const items = entry.data.foodItems;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const record = asRecord(item);
        if (!record) continue;
        report.dailyEntries.foodItemElements += 1;
        if (collides(record, schemaClass(record))) report.dailyEntries.elementCollisions += 1;
      }
    }

    for (const recipe of user.recipes) {
      report.recipes += 1;
      const body = recipeBody(recipe.data);
      const ingredients = body.ingredients;
      if (Array.isArray(ingredients)) {
        for (const ingredient of ingredients) {
          const record = asRecord(ingredient);
          const link = record ? asRecord(record.nutritionLink) : null;
          if (!link || link.status !== 'confirmed') continue;
          report.confirmedLinks += 1;
          bumpFormat(report.fingerprints.confirmedLinks, link.targetFingerprint);
          if (typeof link.targetFingerprint === 'string' && link.targetFingerprint.startsWith('v2:')) continue;
          const foodId = typeof link.foodItemId === 'string' ? link.foodItemId : '';
          const food = foodsById.get(foodId) ?? null;
          const verdict = food
            ? verifyTrackerFoodFingerprint(food, typeof link.targetFingerprint === 'string' ? link.targetFingerprint : null)
            : 'mismatch';
          if (verdict === 'match' || verdict === 'match-v1-expanded') report.v1Links.verified += 1;
          else report.v1Links.stale += 1;
        }
      }
      const exportsValue = asRecord(body.nutritionExports);
      if (!exportsValue) continue;
      for (const ref of Object.values(exportsValue)) {
        const record = asRecord(ref);
        if (!record || typeof record.nutritionFingerprint !== 'string') continue;
        report.exportRefs += 1;
        bumpFormat(report.fingerprints.exportRefs, record.nutritionFingerprint);
      }
    }
  }

  return report;
}
