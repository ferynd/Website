import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseFdcFood, PermanentSourceError } from '../../public/shared/nutrition/research/fdcFood.js';
import type { SourceCache } from '../../public/shared/nutrition/research/researchPorts.js';
import { matchFor, type MatchEntry } from './matchTable';
export interface DatasetPin {
    id: string;
    release: string;
    sha256: string | null;
    fixtureOnly: boolean;
}
async function readPinnedBytes(file: string, pin: DatasetPin) {
    if (!pin.sha256 || !/^sha256:[a-f0-9]{64}$/.test(pin.sha256))
        throw new Error('Dataset is unpinned');
    const data = await readFile(file);
    if ('sha256:' + createHash('sha256').update(data).digest('hex') !== pin.sha256)
        throw new Error('Dataset checksum mismatch');
    return data;
}
async function readPinnedFoods(file: string, pin: DatasetPin) {
    const data = await readPinnedBytes(file, pin);
    const raw = JSON.parse(data.toString('utf8'));
    const foods = Array.isArray(raw) ? raw : raw.FoundationFoods || raw.SRLegacyFoods || raw.BrandedFoods || raw.foods;
    if (!Array.isArray(foods))
        throw new PermanentSourceError('Invalid bulk food array');
    return { raw, foods };
}
export async function readPinnedBulk(file: string, pin: DatasetPin) {
    const { raw, foods } = await readPinnedFoods(file, pin);
    const seen = new Set();
    for (const food of foods) {
        if (pin.fixtureOnly && !/synthetic/i.test(food._fixture || raw._fixture || ''))
            throw new Error('Fixture-only reader refuses unlabeled data');
        await parseFdcFood(food, { release: pin.release });
        if (seen.has(food.fdcId))
            throw new PermanentSourceError('Duplicate food ID');
        seen.add(food.fdcId);
    }
    return foods as Record<string, unknown>[];
}
export interface BulkAuditFailure {
    fdcId: number | null;
    category: string;
}
export interface BulkAudit {
    total: number;
    parsedCount: number;
    foods: Record<string, unknown>[];
    failures: BulkAuditFailure[];
    failureCategories: Record<string, number>;
    duplicateCount: number;
}
export const DUPLICATE_FDC_ID = 'duplicate_fdc_id';
/**
 * Groups a parser error into a value-free category: every number becomes 'N',
 * and the one parser message that echoes a raw (possibly non-numeric) amount
 * has that tail redacted, so no nutrient value or description can leak.
 */
function failureCategory(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, 'N')
        .replace(/^(Non-numeric amount for nutrient N in fdcId N: )(?!N$)[\s\S]*$/, '$1<redacted>')
        .replace(/^(Invalid or missing fdcId: )(?!N$|undefined$|null$)[\s\S]*$/, '$1<redacted>');
}
/**
 * Audit counterpart of readPinnedBulk: the same pin, checksum, and top-level
 * shape checks still throw, but per-record failures (fixture label, parser,
 * duplicate fdcId) are counted and categorized instead of aborting.
 *
 * Semantics: the first occurrence of an fdcId is checked normally; every later
 * occurrence is a 'duplicate_fdc_id' failure (and is not parsed), whether or
 * not the first occurrence parsed. Records without a numeric fdcId are never
 * duplicates and report fdcId null. Each record yields at most one failure.
 */
export async function auditPinnedBulk(file: string, pin: DatasetPin): Promise<BulkAudit> {
    const { raw, foods } = await readPinnedFoods(file, pin);
    const parsed: Record<string, unknown>[] = [];
    const failures: BulkAuditFailure[] = [];
    const failureCategories: Record<string, number> = {};
    const seen = new Set<unknown>();
    let duplicateCount = 0;
    const fail = (fdcId: number | null, category: string) => {
        failures.push({ fdcId, category });
        failureCategories[category] = (failureCategories[category] || 0) + 1;
    };
    for (const food of foods) {
        const id = food && typeof food === 'object' ? food.fdcId : undefined;
        const fdcId = typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
        if (id !== undefined && id !== null) {
            if (seen.has(id)) {
                duplicateCount++;
                fail(fdcId, DUPLICATE_FDC_ID);
                continue;
            }
            seen.add(id);
        }
        if (pin.fixtureOnly && !/synthetic/i.test(food?._fixture || raw._fixture || '')) {
            fail(fdcId, 'Fixture-only reader refuses unlabeled data');
            continue;
        }
        try {
            await parseFdcFood(food, { release: pin.release });
            parsed.push(food);
        }
        catch (error) {
            fail(fdcId, failureCategory(error));
        }
    }
    return { total: foods.length, parsedCount: parsed.length, foods: parsed, failures, failureCategories, duplicateCount };
}
export async function indexBulk(file: string, pin: DatasetPin, cache: SourceCache) {
    const foods = await readPinnedBulk(file, pin);
    for (const food of foods)
        await cache.set(`fdc_bulk:${pin.release}:${food.fdcId}`, food);
    return foods.length;
}
/**
 * One pinned food record per file (the committed synthetic fixtures). The same
 * pin, label, and parser checks as readPinnedBulk apply.
 */
export async function readPinnedRecord(file: string, pin: DatasetPin) {
    const data = await readPinnedBytes(file, pin);
    const food = JSON.parse(data.toString('utf8'));
    if (!food || typeof food !== 'object' || Array.isArray(food))
        throw new PermanentSourceError('Invalid pinned food record');
    if (pin.fixtureOnly && !/synthetic/i.test(food._fixture || ''))
        throw new Error('Fixture-only reader refuses unlabeled data');
    await parseFdcFood(food, { release: pin.release });
    return food as Record<string, unknown>;
}
export async function indexPinnedRecord(file: string, pin: DatasetPin, cache: SourceCache) {
    const food = await readPinnedRecord(file, pin);
    await cache.set(`fdc_bulk:${pin.release}:${food.fdcId}`, food);
    return food;
}
export function createFdcBulkAdapter({ cache, release, matches }: {
    cache: SourceCache;
    release: string;
    matches: MatchEntry[];
}) {
    return { id: 'fdc_bulk', scope: ['curated', 'private'] as ('curated' | 'private')[], runsIn: ['cli'] as 'cli'[], requiresSecret: false, release: async () => release, match: async (t: {
            manifestId: string;
        }) => matchFor(matches, t.manifestId, 'fdc_bulk'), fetch: async (id: string) => {
            const row = await cache.get(`fdc_bulk:${release}:${id}`);
            if (!row)
                throw new PermanentSourceError('Pinned bulk record not indexed');
            return row.data;
        }, toSourceResult: (raw: unknown) => parseFdcFood(raw, { release }) };
}
