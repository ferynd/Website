import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FDC_NUTRIENT_ENTRIES } from '../../public/shared/nutrition/research/fdcNutrientMap.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { validateManifest } from './manifestReader';
import { validateMatchTable } from './matchTable';
import { buildGeminiBundle, canonicalDigest, findConflicts, renderPrompt, selectBundleTargets, stemOf, KEY_FIELDS, type BundleDataset } from './geminiBundle';
import { geminiBundleCli } from './geminiBundleCli';

const DIR = 'scripts/fixtures/nutrition/gemini-bundle';
const json = async (name: string) => JSON.parse(await readFile(`${DIR}/${name}`, 'utf8'));
const entries = async () => validateManifest(await json('manifest.json'));
const table = async () => validateMatchTable(await json('match-table.json'));
async function datasets(): Promise<BundleDataset[]> {
    const pin = async (id: 'foundation' | 'sr-legacy', file: string, release: string) => ({
        pin: { id, release, fileName: file, fixtureOnly: true, sha256: 'sha256:' + createHash('sha256').update(await readFile(`${DIR}/${file}`)).digest('hex') },
        file: `${DIR}/${file}`,
    });
    return [await pin('sr-legacy', 'sr-legacy.json', 'fixture-sr-v1'), await pin('foundation', 'foundation.json', 'fixture-foundation-v1')];
}
// Fixture replay: three cumulative wave-A batches of one id each (A1, A2, A3).
const REPLAY = { batchMax: 1, batches: 3 };
const UNRESOLVED = [{ id: 'cherry-raw', source: 'docs/nutrition/population-batch-a3-report.md', note: 'fixture unresolved' }];
async function build(now = new Date('2026-11-11T12:00:00Z'), count = 200) {
    return buildGeminiBundle({ entries: await entries(), matchTable: await table(), datasets: await datasets(), count, now, unresolved: UNRESOLVED, ...REPLAY });
}
const EXPECTED_ORDER = [
    'lentils-boiled-drained-without-added-salt', // priority 1, legumes
    'milk-reduced-fat-2-percent-fat-as-sold', // priority 2, dairy
    'apple-juice-100-percent-ready-to-drink', // priority 2, fruits, by id
    'apple-with-skin-cooked-without-added-sugar',
    'pear-raw',
    'cherry-dried-sweetened', // priority 3
];

describe('selection', () => {
    it('excludes published and replayed A1-A3 ids and returns the rest in priority/category/id order', async () => {
        const s = selectBundleTargets(await entries(), await table(), { count: 200, ...REPLAY });
        expect(s.assignedBatches).toEqual([['apple-with-skin-raw'], ['banana-raw'], ['cherry-raw']]);
        expect(s.selected.map(e => e.id)).toEqual(EXPECTED_ORDER);
        // Eligible: 9 generic usda-first entries (coconut milk is manufacturer-first, salt is an additive, cola is branded).
        expect(s).toMatchObject({ eligibleCount: 9, excludedPublishedCount: 1, excludedAssignedCount: 2 });
        expect(selectBundleTargets(await entries(), await table(), { count: 3, ...REPLAY }).selected.map(e => e.id)).toEqual(EXPECTED_ORDER.slice(0, 3));
    });
    it('fails closed when a published id is outside the replayed batches', async () => {
        const raw = await json('match-table.json');
        raw.entries[0].manifestId = 'pear-raw';
        await expect(validateMatchTable(raw).then(async t => selectBundleTargets(await entries(), t, REPLAY))).rejects.toThrow('outside the replayed batches');
    });
});

describe('bundle', () => {
    it('is deterministic: same inputs give the same inputDigest and identical targets', async () => {
        const a = (await build(new Date('2026-11-11T12:00:00Z'))).bundle;
        const b = (await build(new Date('2026-12-01T08:30:00Z'))).bundle;
        expect(a.inputDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(b.inputDigest).toBe(a.inputDigest);
        expect(b.manifestDigest).toBe(a.manifestDigest);
        expect(JSON.stringify(b.targets)).toBe(JSON.stringify(a.targets));
        expect(a.bundleId).toBe(`gemini-bundle-2026-11-11-${a.inputDigest.slice(0, 12)}`);
        expect(b.bundleId).toBe(`gemini-bundle-2026-12-01-${a.inputDigest.slice(0, 12)}`);
        expect(a.manifestDigest).toBe(canonicalDigest(await entries()));
        expect(a.inputDigest).toBe(canonicalDigest({
            selectedTargetIds: EXPECTED_ORDER,
            sourceVersions: a.sourceVersions.map(({ dataset, release, sha256 }) => ({ dataset, release, sha256 })),
            manifestDigest: a.manifestDigest,
        }));
        expect(a.sourceVersions.map(v => [v.dataset, v.release, v.file])).toEqual([['foundation', 'fixture-foundation-v1', 'foundation.json'], ['sr-legacy', 'fixture-sr-v1', 'sr-legacy.json']]);
        expect(a.selection).toMatchObject({ count: 6, excludedPublishedCount: 1, excludedAssignedCount: 2 });
        // A different selection changes the digest.
        expect((await build(undefined, 5)).bundle.inputDigest).not.toBe(a.inputDigest);
    });

    it('carries verbatim descriptions, pipeline coverage counts, and explicit conflicts', async () => {
        const { bundle, candidateTotals } = await build();
        interface FixtureNutrient { nutrient: { id: number }; amount: number | null }
        interface FixtureFood { fdcId: number; description: string; foodNutrients: FixtureNutrient[] }
        const records = new Map<string, FixtureFood>();
        for (const [dataset, file, key] of [['foundation', 'foundation.json', 'FoundationFoods'], ['sr-legacy', 'sr-legacy.json', 'SRLegacyFoods']] as const)
            for (const food of (await json(file))[key]) records.set(`${dataset}:${food.fdcId}`, food);
        let total = 0;
        for (const target of bundle.targets) {
            expect(target.candidates.length).toBeLessThanOrEqual(6);
            for (const c of target.candidates) {
                total++;
                const record = records.get(`${c.dataset}:${c.fdcId}`)!;
                expect(c.description).toBe(record.description);
                expect(c.ref).toBe(`cand:${target.targetId}:${c.fdcId}`);
                // Independent count: registry keys reached by mapped (non-gap) FDC nutrients with an amount.
                const keys = new Set(record.foodNutrients
                    .filter(n => n.amount !== null && n.amount !== undefined)
                    .map(n => FDC_NUTRIENT_ENTRIES.find(m => m.fdcNutrientId === n.nutrient.id && m.policy !== 'gap')?.key)
                    .filter(Boolean));
                // The normalizer mirrors fiberTotal into the v1 `fiber` field.
                if (keys.has('fiberTotal')) keys.add('fiber');
                expect(c.coverage).toEqual({ fieldsPresent: keys.size, fieldsTotal: PROFILE_FIELDS.length, missingKeyFields: KEY_FIELDS.filter(k => !keys.has(k)) });
            }
        }
        expect(candidateTotals.foundation + candidateTotals['sr-legacy']).toBe(total);
        const pear = bundle.targets.find(t => t.targetId === 'pear-raw')!;
        expect(pear.candidates.map(c => c.fdcId)).toEqual(['9910002', '9920001']);
        expect(pear.candidates[0].conflicts).toEqual([]);
        expect(pear.candidates[1].conflicts).toEqual([{ attribute: 'state', reason: expect.stringContaining('description says cooked') }]);
        expect(pear.candidates[1].distinctions).toEqual(expect.arrayContaining(['state:cooked', 'state:boiled']));
        // Vitamin A IU is a definition-mismatch gap, so it does not count as present.
        expect(pear.candidates[0].coverage.missingKeyFields).toContain('vitaminA');

        const lentils = bundle.targets.find(t => t.targetId.startsWith('lentils'))!;
        expect(lentils.candidates[0]).toMatchObject({ fdcId: '9920002', conflicts: [] });
        expect(lentils.candidates.find(c => c.fdcId === '9910003')!.conflicts.map(c => c.attribute)).toEqual(['state']);
        const milk = bundle.targets.find(t => t.targetId.startsWith('milk'))!;
        expect(milk.candidates.find(c => c.fdcId === '9920003')!.conflicts).toEqual([]);
        expect(milk.candidates.find(c => c.fdcId === '9920004')!.conflicts).toEqual([{ attribute: 'percent', reason: 'target 2% fat; description says 1% fat' }]);
        const juice = bundle.targets.find(t => t.targetId.startsWith('apple-juice'))!;
        expect(juice.candidates.find(c => c.fdcId === '9920005')!.conflicts).toEqual([]);
        expect(juice.candidates.find(c => c.fdcId === '9910001')!.conflicts).toContainEqual({ attribute: 'productForm', reason: 'target is juice; description is the whole food' });
        const cherry = bundle.targets.find(t => t.targetId === 'cherry-dried-sweetened')!;
        expect(cherry.candidates[0].distinctions).toEqual(expect.arrayContaining(['state:dried', 'sweetening:sweetened', 'variety:tart', "qualifier:Includes foods for USDA's Food Distribution Program"]));
    });

    it('attaches approved and unresolved precedents by stem and records material attributes', async () => {
        const { bundle } = await build();
        const cooked = bundle.targets.find(t => t.targetId === 'apple-with-skin-cooked-without-added-sugar')!;
        expect(cooked.precedents).toEqual([{ targetId: 'apple-with-skin-raw', decision: 'approved', source: 'docs/nutrition/source-match-table.json', note: 'reviewed Foundation fixture-foundation-v1 fdcId 9910001' }]);
        expect(cooked.materialAttributes).toEqual(expect.arrayContaining([{ attribute: 'state', value: 'cooked' }, { attribute: 'sweetening', value: 'unsweetened' }, { attribute: 'skin', value: 'with-skin' }]));
        // The raw apple record contradicts the cooked state; the cooked SR record does not.
        expect(cooked.candidates.find(c => c.fdcId === '9910001')!.conflicts.map(c => c.attribute)).toEqual(['state']);
        expect(cooked.candidates.find(c => c.fdcId === '9920007')!.conflicts).toEqual([]);
        expect(bundle.targets.find(t => t.targetId === 'cherry-dried-sweetened')!.precedents).toEqual([{ targetId: 'cherry-raw', decision: 'unresolved', source: 'docs/nutrition/population-batch-a3-report.md', note: 'fixture unresolved' }]);
        expect(bundle.targets.find(t => t.targetId === 'pear-raw')!.precedents).toEqual([]);
    });

    it('serializes no nutrient values: every object has exactly the specified keys', async () => {
        const { bundle } = await build();
        const roundTrip = JSON.parse(JSON.stringify(bundle));
        expect(Object.keys(roundTrip).sort()).toEqual(['bundleId', 'generatedAt', 'inputDigest', 'manifestDigest', 'schemaVersion', 'selection', 'sourceVersions', 'targets']);
        expect(Object.keys(roundTrip.selection).sort()).toEqual(['count', 'excludedAssignedCount', 'excludedPublishedCount', 'rule']);
        for (const v of roundTrip.sourceVersions) expect(Object.keys(v).sort()).toEqual(['dataset', 'file', 'release', 'sha256']);
        for (const t of roundTrip.targets) {
            expect(Object.keys(t).sort()).toEqual(['aliases', 'candidates', 'category', 'kind', 'materialAttributes', 'name', 'notes', 'precedents', 'state', 'targetId', 'variant']);
            for (const a of t.materialAttributes) expect(Object.keys(a).sort()).toEqual(['attribute', 'value']);
            for (const p of t.precedents) expect(Object.keys(p).sort()).toEqual(['decision', 'note', 'source', 'targetId']);
            for (const c of t.candidates) {
                expect(Object.keys(c).sort()).toEqual(['conflicts', 'coverage', 'dataset', 'description', 'distinctions', 'fdcId', 'ref', 'release']);
                expect(Object.keys(c.coverage).sort()).toEqual(['fieldsPresent', 'fieldsTotal', 'missingKeyFields']);
                for (const x of c.conflicts) expect(Object.keys(x).sort()).toEqual(['attribute', 'reason']);
                expect(c.distinctions.every((d: unknown) => typeof d === 'string')).toBe(true);
            }
        }
        const text = JSON.stringify(bundle);
        for (const leak of ['foodNutrients', '"amount"', '"nutrients"', '"unitName"'])
            expect(text).not.toContain(leak);
    });
});

describe('stems', () => {
    it('strip the catalog state, the manifest variant, and trailing variant qualifiers', () => {
        expect(stemOf({ id: 'soy-sauce-regular-as-sold', state: 'as-sold' })).toBe('soy-sauce');
        expect(stemOf({ id: 'soy-sauce-reduced-sodium-as-sold', state: 'as-sold' })).toBe('soy-sauce');
        expect(stemOf({ id: 'orange-juice-pasteurized-not-fortified-ready-to-drink', state: 'ready-to-drink' })).toBe('orange-juice');
        expect(stemOf({ id: 'orange-juice-fresh-ready-to-drink', state: 'ready-to-drink' })).toBe('orange-juice');
        expect(stemOf({ id: 'milk-whole-3-25-percent-fat-as-sold', state: 'as-sold' })).toBe('milk');
        expect(stemOf({ id: 'ground-beef-80-percent-lean-20-percent-fat-raw-raw-formulation-80-20', state: 'raw', variant: 'raw-formulation-80-20' })).toBe('ground-beef-80-percent-lean');
        expect(stemOf({ id: 'chicken-egg-white-raw', state: 'raw' })).toBe('chicken-egg-white');
    });
});

describe('conflict rubric', () => {
    const entry = (over: Record<string, unknown>) => ({ id: 'x-raw', name: 'X, raw', category: 'c', kind: 'generic', state: 'raw', priority: 1, sourceStrategy: 'usda-first', status: 'queued' as const, ...over });
    it('needs explicit evidence; an unqualified description is not a contradiction', () => {
        expect(findConflicts(entry({}), 'Pears')).toEqual([]);
        expect(findConflicts(entry({ name: 'Mango, dried, unsweetened', state: 'dried-unsweetened' }), 'Mango, dried')).toEqual([]);
        expect(findConflicts(entry({ name: 'Mango, dried, unsweetened', state: 'dried-unsweetened' }), 'Mango, dried, sweetened').map(c => c.attribute)).toEqual(['sweetening']);
        expect(findConflicts(entry({ name: 'Pineapple, canned in juice, drained', state: 'canned-in-juice-drained' }), 'Pineapple, canned, juice pack, solids and liquids').map(c => c.attribute)).toEqual(['drained']);
        expect(findConflicts(entry({ name: 'Banana, pureed, unsweetened', state: 'pureed-unsweetened' }), 'Babyfood, banana no tapioca, strained').map(c => c.attribute)).toEqual(['productForm']);
    });
});

describe('prompt and CLI', () => {
    it('fills the prompt header placeholders', async () => {
        const template = await readFile('docs/nutrition/gemini-research-prompt.md', 'utf8');
        const filled = renderPrompt(template, { bundleId: 'gemini-bundle-2026-11-11-abc', inputDigest: 'f'.repeat(64) });
        expect(filled).not.toContain('{{');
        expect(filled).toContain('Bundle ID: gemini-bundle-2026-11-11-abc');
        expect(filled).toContain('Input digest: ' + 'f'.repeat(64));
        expect(() => renderPrompt('no placeholders', { bundleId: 'b', inputDigest: 'd' })).toThrow('placeholders');
    });
    it('rejects unknown commands and flags and requires --out and dataset files', async () => {
        await expect(geminiBundleCli(['plan'])).rejects.toThrow('Expected build');
        await expect(geminiBundleCli(['build', '--write'])).rejects.toThrow('Unknown flag');
        await expect(geminiBundleCli(['build'])).rejects.toThrow('--out required');
        await expect(geminiBundleCli(['build', '--out', '/tmp/x', '--count', '0'])).rejects.toThrow('positive integer');
        await expect(geminiBundleCli(['build', '--out', '/tmp/x'], { env: {} })).rejects.toThrow('No file for dataset');
    });
});
