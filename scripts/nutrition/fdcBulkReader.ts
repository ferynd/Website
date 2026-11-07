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
export async function readPinnedBulk(file: string, pin: DatasetPin) {
    if (!pin.sha256 || !/^sha256:[a-f0-9]{64}$/.test(pin.sha256))
        throw new Error('Dataset is unpinned');
    const data = await readFile(file);
    if ('sha256:' + createHash('sha256').update(data).digest('hex') !== pin.sha256)
        throw new Error('Dataset checksum mismatch');
    const raw = JSON.parse(data.toString('utf8'));
    const foods = Array.isArray(raw) ? raw : raw.FoundationFoods || raw.BrandedFoods || raw.foods;
    if (!Array.isArray(foods))
        throw new PermanentSourceError('Invalid bulk food array');
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
export async function indexBulk(file: string, pin: DatasetPin, cache: SourceCache) {
    const foods = await readPinnedBulk(file, pin);
    for (const food of foods)
        await cache.set(`fdc_bulk:${pin.release}:${food.fdcId}`, food);
    return foods.length;
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
