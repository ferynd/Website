import { it, expect, describe, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
import {
    expectedOutcome, verifyNormalizedRecord, normalizeThroughAdapter, summarizeVerifications, deterministicSample,
    runNormalizationVerification, KEY_OUTCOMES, A1_PROPOSED_MATCHES, type ProposedMatch,
} from './normalizationVerification';
import { main, VerificationCliError } from './normalizationVerificationCli';

const temp: string[] = [];
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct63-v3-')); temp.push(p); return p; }
const load = async (name: string) => JSON.parse(await readFile(`scripts/fixtures/nutrition/fdc/${name}`, 'utf8'));

/** Synthetic FDC rows and records; not nutrition data. */
const row = (id: number, unitName: string, amount: number | null | undefined, extra: Record<string, unknown> = {}) => ({
    type: 'FoodNutrient', nutrient: { id, number: String(id), name: `Synthetic ${id}`, unitName },
    ...(amount === undefined ? {} : { amount }), ...extra,
});
const food = (fdcId: number, foodNutrients: unknown[], extra: Record<string, unknown> = {}) => ({
    _fixture: 'synthetic; not nutrition data', fdcId, description: `Synthetic verification food ${fdcId}`,
    dataType: 'SR Legacy', publicationDate: '2019-04-01', foodNutrients, foodPortions: [], ...extra,
});
async function verify(raw: Record<string, unknown>, release = 'fixture-v3') {
    const { parsed, normalized } = await normalizeThroughAdapter(raw, release);
    return { parsed, normalized, result: verifyNormalizedRecord(raw as never, parsed, normalized, release) };
}

describe('normalization verification on committed synthetic fixtures (#63 V3)', () => {
    it.each(['apple-bulk.json', 'legume-bulk.json', 'oil-bulk.json', 'loq-food.json', 'mismatch-vitamins.json', 'salt-additive-bulk.json'])('accounts for every registry key without a defect: %s', async name => {
        const { result, normalized } = await verify(await load(name));
        expect(result.defects).toEqual([]);
        expect(Object.keys(result.keys).sort()).toEqual([...PROFILE_FIELDS].sort());
        expect(PROFILE_FIELDS).toHaveLength(67);
        for (const key of PROFILE_FIELDS) {
            expect(KEY_OUTCOMES).toContain(result.keys[key]);
            expect(normalized.nutrientMeta.quality[key].status).toBeTruthy();
        }
    });
    it('classifies below-LOQ zeros and definition-mismatch rows from the committed fixtures', async () => {
        const loq = (await verify(await load('loq-food.json'))).result;
        expect(loq.keys).toMatchObject({ fat: 'below_loq', sodium: 'below_loq', protein: 'resolved', iron: 'absent' });
        expect(loq.loqPreserved).toBe(2);
        const mismatch = (await verify(await load('mismatch-vitamins.json'))).result;
        expect(mismatch.keys).toMatchObject({ vitaminA: 'gap', vitaminK: 'gap', folate: 'gap', omega3ALA: 'gap', omega3: 'gap' });
        expect(mismatch.policy).toMatchObject({ vitaminAIuOnlyGap: 1, vitaminAIuNeverConverted: true, folateTotalOnlyGap: 1, vitaminKGap: 1 });
    });
});

describe('unit handling', () => {
    it('keeps same-unit values and converts mcg/mg/g through the registry converter', async () => {
        const { result, normalized } = await verify(food(9910001, [
            row(1008, 'kcal', 120),
            row(1003, 'mg', 1500),      // protein g <- mg
            row(1093, 'g', 0.4),        // sodium mg <- g
            row(1103, 'mg', 0.02),      // selenium mcg <- mg
            row(1178, 'µg', 2.5),       // vitamin B12 mcg (micro sign)
            row(1087, 'MG', 30),        // calcium, upper-case unit
            row(1162, 'mg', 4),         // vitamin C identity
        ]));
        expect(result.defects).toEqual([]);
        expect(normalized.nutrients).toMatchObject({ protein: 1.5, sodium: 400, selenium: 20, vitaminB12: 2.5, calcium: 30, vitaminC: 4 });
        const pairs = Object.fromEntries(result.unitChecks.map(c => [c.pair, c.pass]));
        expect(pairs).toMatchObject({ 'mg->g': true, 'g->mg': true, 'mg->mcg': true, 'mcg (identity)': true, 'mg (identity)': true, 'kcal (identity)': true });
        expect(result.unitChecks.every(c => c.pass)).toBe(true);
    });
    it('keeps vitamin A IU and total folate as gaps and never converts them into RAE or DFE', async () => {
        const iuOnly = await verify(food(9910002, [row(1104, 'IU', 500), row(1177, 'µg', 30)]));
        expect(iuOnly.result.defects).toEqual([]);
        expect(iuOnly.normalized.nutrients.vitaminA).toBeNull();
        expect(iuOnly.normalized.nutrientMeta.quality.vitaminA.qualifier).toBe('gap:definition_mismatch');
        expect(iuOnly.normalized.nutrients.folate).toBeNull();
        expect(iuOnly.normalized.nutrientMeta.quality.folate.qualifier).toBe('gap:definition_mismatch');
        expect(iuOnly.normalized.fieldProvenance.vitaminA).toBeUndefined();
        const withRae = await verify(food(9910003, [row(1104, 'IU', 500), row(1106, 'µg', 25), row(1177, 'µg', 30), row(1190, 'µg', 40)]));
        expect(withRae.result.defects).toEqual([]);
        expect(withRae.normalized.nutrients).toMatchObject({ vitaminA: 25, folate: 40 });
        expect(withRae.normalized.fieldProvenance.vitaminA.sourceNutrientId).toBe('1106');
        expect(withRae.normalized.fieldProvenance.folate.sourceNutrientId).toBe('1190');
    });
    it('never maps kJ energy (1062) to calories and prefers 1008 > 2048 > 2047', async () => {
        const kjOnly = await verify(food(9910004, [row(1062, 'kJ', 400)]));
        expect(kjOnly.result.defects).toEqual([]);
        expect(kjOnly.result.keys.calories).toBe('absent');
        expect(kjOnly.result.energy).toMatchObject({ hasKj: true, kjOnly: true, chosen: null });
        expect(kjOnly.normalized.nutrients.calories).toBeNull();
        const cases: [number[], string, string][] = [
            [[1062, 1008, 2048, 2047], '1008', 'measured'],
            [[1062, 2048, 2047], '2048', 'calculated'],
            [[2047, 1062], '2047', 'calculated'],
        ];
        for (const [ids, chosen, status] of cases) {
            const { result, normalized } = await verify(food(9910005, ids.map(id => row(id, id === 1062 ? 'kJ' : 'kcal', id === 1062 ? 500 : 100 + id % 7))));
            expect(result.defects).toEqual([]);
            expect(result.energy.chosen).toBe(chosen);
            expect(normalized.nutrientMeta.quality.calories.status).toBe(status);
        }
    });
});

describe('expanded field coverage (#63 V3 fix)', () => {
    it('maps Foundation total sugars (1063), molybdenum (1102), and resistant starch (1071)', async () => {
        const { result, normalized } = await verify(food(9910009, [row(1063, 'g', 6.5), row(1102, 'µg', 12), row(1071, 'g', 1.2)], { dataType: 'Foundation' }));
        expect(result.defects).toEqual([]);
        expect(result.keys).toMatchObject({ sugarsTotal: 'resolved', molybdenum: 'resolved', resistantStarch: 'resolved' });
        expect(normalized.nutrients).toMatchObject({ sugarsTotal: 6.5, molybdenum: 12, resistantStarch: 1.2 });
        expect(normalized.fieldProvenance.sugarsTotal.sourceNutrientId).toBe('1063');
        expect(normalized.fieldProvenance.molybdenum.sourceNutrientId).toBe('1102');
        expect(normalized.nutrientMeta.quality.sugarsTotal).toEqual({ status: 'measured' });
    });
    it('prefers 2000 over 1063 and a quantified row over a below-LOQ row', async () => {
        const both = await verify(food(9910010, [row(1063, 'g', 6.5), row(2000, 'g', 7)]));
        expect(both.result.defects).toEqual([]);
        expect(both.normalized.nutrients.sugarsTotal).toBe(7);
        expect(both.normalized.fieldProvenance.sugarsTotal.sourceNutrientId).toBe('2000');
        const nullFirst = await verify(food(9910011, [row(2000, 'g', null), row(1063, 'g', 6.5)]));
        expect(nullFirst.normalized.fieldProvenance.sugarsTotal.sourceNutrientId).toBe('1063');
        const loqFirst = await verify(food(9910012, [row(2000, 'g', 0, { loq: 0.1 }), row(1063, 'g', 6.5)]));
        expect(loqFirst.result.defects).toEqual([]);
        expect(loqFirst.normalized.nutrients.sugarsTotal).toBe(6.5);
        const loqOnly = await verify(food(9910013, [row(2000, 'g', 0, { loq: 0.1 }), row(1063, 'g', null)]));
        expect(loqOnly.result.keys.sugarsTotal).toBe('below_loq');
        expect(loqOnly.normalized.nutrientMeta.quality.sugarsTotal).toEqual({ status: 'below_quantification_limit', upperBound: 0.1 });
    });
});
describe('zero versus unknown', () => {
    it('keeps a measured zero, a null amount, a missing nutrient, and a below-LOQ zero apart', async () => {
        const { result, normalized } = await verify(food(9910006, [
            row(1008, 'kcal', 40),
            row(1087, 'mg', 0, { foodNutrientDerivation: { code: 'A' } }),     // explicit measured zero
            row(1095, 'mg', null),                                              // reported with a null amount
            row(1090, 'mg', undefined),                                         // reported with no amount at all
            row(1093, 'mg', 0, { loq: 0.2 }),                                   // zero below the limit of quantification
            row(1253, 'mg', 0, { foodNutrientDerivation: { code: 'Z' } }),     // FDC "assumed zero"
        ]));
        expect(result.defects).toEqual([]);
        expect(result.keys).toMatchObject({ calcium: 'resolved', zinc: 'unknown', magnesium: 'unknown', sodium: 'below_loq', iron: 'absent', cholesterol: 'resolved' });
        expect(normalized.nutrients.calcium).toBe(0);
        expect(normalized.nutrientMeta.quality.calcium.status).toBe('measured');
        expect(normalized.fieldProvenance.calcium).toEqual({ sourceKey: 'fdc:9910006', sourceNutrientId: '1087' });
        for (const key of ['zinc', 'magnesium', 'iron']) {
            expect(normalized.nutrients[key]).toBeNull();
            expect(normalized.nutrientMeta.quality[key]).toEqual({ status: 'unknown', qualifier: 'gap:not_reported_by_source' });
            expect(normalized.fieldProvenance[key]).toBeUndefined();
        }
        expect(normalized.nutrients.sodium).toBeNull();
        expect(normalized.nutrientMeta.quality.sodium).toEqual({ status: 'below_quantification_limit', upperBound: 0.2 });
        expect(result).toMatchObject({ nullStaysUnknown: 2, loqPreserved: 1, zero: { preserved: 2, lost: 0, assumedZeroAsMeasured: 1 } });
        // Documented follow-up: the status ignores the FDC derivation code, so "assumed zero" reads as measured.
        expect(normalized.nutrientMeta.quality.cholesterol.status).toBe('measured');
        expect(result.measuredDerivationCodes).toMatchObject({ A: 1, Z: 1 });
    });
});

describe('provenance', () => {
    it('keeps recordId, release, dataType, publishedAt and checksum, and names the source nutrient per field', async () => {
        const raw = food(9910007, [row(1008, 'kcal', 52), row(1003, 'g', 0.3), row(1079, 'g', 2.4), row(1404, 'g', 0.01), row(1278, 'g', 0), row(1272, 'g', 0)], { dataType: 'Foundation', publicationDate: '2026-04-30' });
        const { result, normalized, parsed } = await verify(raw, 'fixture-2026');
        expect(result.defects).toEqual([]);
        expect(result.provenance.recordOk).toBe(true);
        const checksum = 'sha256:' + createHash('sha256').update(canonicalJson(raw)).digest('hex');
        expect(parsed.checksum).toBe(checksum);
        expect(normalized.sourceRecord).toMatchObject({ type: 'fdc', recordId: '9910007', datasetId: 'Foundation', version: 'fixture-2026', publishedAt: '2026-04-30', checksum, title: raw.description });
        expect(normalized.fieldProvenance.calories).toEqual({ sourceKey: 'fdc:9910007', sourceNutrientId: '1008' });
        expect(normalized.fieldProvenance.fiber).toEqual({ sourceKey: 'fdc:9910007', sourceNutrientId: '1079', derivation: 'same_as:fiberTotal' });
        expect(normalized.fieldProvenance.omega3).toEqual({ sourceKey: 'fdc:9910007', derivation: 'sum:ALA+EPA+DHA' });
        expect(result.keys.omega3).toBe('resolved');
    });
});

describe('the verifier itself', () => {
    it('reports tampered normalization output instead of passing it', async () => {
        const raw = food(9910008, [row(1008, 'kcal', 52), row(1062, 'kJ', 218), row(1087, 'mg', 0), row(1104, 'IU', 500), row(1093, 'mg', 5)]);
        const { parsed, normalized } = await normalizeThroughAdapter(raw, 'fixture-v3');
        const tampered = structuredClone(normalized);
        tampered.fieldProvenance.calories.sourceNutrientId = '1062';
        tampered.nutrients.calcium = null;
        tampered.nutrientMeta.quality.calcium = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
        tampered.nutrients.vitaminA = 150;
        tampered.nutrientMeta.quality.vitaminA = { status: 'measured' };
        tampered.nutrients.sodium = 0.005;
        tampered.sourceRecord.version = 'other-release';
        delete tampered.nutrients.iron;
        const result = verifyNormalizedRecord(raw as never, parsed, tampered, 'fixture-v3');
        expect(result.defects).toEqual(expect.arrayContaining([
            'provenance_mismatch:calories', 'energy_preference', 'energy_from_kj',
            'outcome_mismatch:calcium:resolved', 'outcome_mismatch:vitaminA:gap', 'vitaminA_iu_converted', 'vitaminA_not_from_rae',
            'key_unaccounted:iron', 'record_provenance:release',
        ]));
        expect(result.unitChecks.find(c => c.pair === 'mg (identity)' && !c.pass)).toBeTruthy();
    });
    it('classifies from the source alone', () => {
        const rows = new Map([[1104, { nutrientId: 1104, unitName: 'IU', amount: 5, isBelowLoq: false, loq: null }]]);
        expect(expectedOutcome('vitaminA', rows)).toEqual({ outcome: 'gap', gapQualifier: 'gap:definition_mismatch' });
        expect(expectedOutcome('omega6', rows)).toEqual({ outcome: 'absent' });
        expect(expectedOutcome('omega3', rows)).toEqual({ outcome: 'gap', gapQualifier: 'gap:partial_components' });
    });
    it('samples deterministically and excludes the proposed records', () => {
        const foods = [5, 3, 9, 1, 7, 2, 8].map(fdcId => ({ fdcId }));
        expect(deterministicSample(foods, 3).map(f => f.fdcId)).toEqual([1, 3, 7]);
        expect(deterministicSample([...foods].reverse(), 3).map(f => f.fdcId)).toEqual([1, 3, 7]);
        expect(deterministicSample(foods, 10, new Set([1, 2])).map(f => f.fdcId)).toEqual([3, 5, 7, 8, 9]);
    });
});

async function pinnedPair() {
    const root = await dir();
    const write = async (name: string, release: string, key: string, foods: unknown[]) => {
        const file = path.join(root, name);
        await writeFile(file, JSON.stringify({ _fixture: 'synthetic; not nutrition data', [key]: foods }));
        return { file, pin: { id: name.replace('.json', ''), release, sha256: 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex'), fixtureOnly: true } };
    };
    // Sentinel amounts must never appear in the summary.
    const sentinel = (fdcId: number, dataType: string) => food(fdcId, [row(1008, 'kcal', 432.198765), row(1003, 'g', 12.345678), row(1087, 'mg', 0)], { dataType, description: `SENTINEL-DESC-${fdcId}` });
    const foundationFoods = [sentinel(9920001, 'Foundation'), sentinel(9920002, 'Foundation'), food(9920003, [row(1008, 'kcal', 'n/a' as never)], { dataType: 'Foundation' })];
    const srFoods = [sentinel(9930001, 'SR Legacy'), sentinel(9930002, 'SR Legacy'), sentinel(9930003, 'SR Legacy')];
    const foundation = await write('foundation.json', 'fx-foundation-2026', 'FoundationFoods', foundationFoods);
    const sr = await write('sr-legacy.json', 'fx-sr-2018', 'SRLegacyFoods', srFoods);
    const proposed: ProposedMatch[] = [
        { manifestId: 'fx-a', dataset: 'foundation', fdcId: 9920001, dataType: 'Foundation', description: 'SENTINEL-DESC-9920001' },
        { manifestId: 'fx-b', dataset: 'sr-legacy', fdcId: 9930002, dataType: 'SR Legacy', description: 'Not the verbatim description' },
    ];
    return { root, foundation, sr, proposed };
}
describe('end-to-end run on two synthetic pinned releases', () => {
    it('verifies proposed records plus a sample, runs them as one mixed-release batch, and prints counts only', async () => {
        const { foundation, sr, proposed } = await pinnedPair();
        const summary = await runNormalizationVerification({ datasets: [foundation, sr], proposed, sampleSize: 1 });
        expect(summary.datasets.foundation).toMatchObject({ release: 'fx-foundation-2026', total: 3, parsed: 2, blocked: 1, a1Checked: 1, sampleChecked: 1, records: 2, recordsWithDefects: 0 });
        expect(summary.datasets['sr-legacy']).toMatchObject({ release: 'fx-sr-2018', total: 3, parsed: 3, blocked: 0, a1Checked: 1, sampleChecked: 1, records: 2 });
        expect(summary.combined.defects).toEqual({});
        expect(summary.combined.keyCoverage.calories).toEqual({ resolved: 4, below_loq: 0, unknown: 0, gap: 0, absent: 0 });
        expect(summary.a1).toMatchObject({
            proposed: 2, foundInPinnedFile: 2, descriptionMatches: 1, dataTypeMatches: 2,
            runJob: { needsReview: 2, blocked: 0 }, draftAgreesWithNormalized: 2, stampedWithOwnRelease: 2, stampedWithOtherRelease: 0,
            tableCheck: { exactEntryPasses: 2, noEntryFails: 2, wrongReleaseFails: 2, wrongDataTypeFails: 2, reportDescriptionFails: 1 },
            problems: [{ fdcId: 9930002, check: 'report_description_not_verbatim' }],
        });
        const all = await runNormalizationVerification({ datasets: [foundation, sr], proposed, all: true });
        expect(all.mode).toBe('all-parsed-records');
        expect(all.combined.records).toBe(5);
        const text = JSON.stringify(summary) + JSON.stringify(all);
        for (const leak of ['432.19', '198765', '12.345', '345678', 'SENTINEL'])
            expect(text).not.toContain(leak);
    });
    it('runs through the CLI only on files outside the checkout and writes nothing but stdout', async () => {
        const { foundation, sr } = await pinnedPair();
        const pins = { foundation: foundation.pin, 'sr-legacy': sr.pin };
        const out: string[] = [];
        const summary = await main(['node', 'cli', '--', '--foundation', foundation.file, '--sr-legacy', sr.file, '--sample', '1'], { pins, write: t => out.push(t) });
        expect(JSON.parse(out.join(''))).toEqual(JSON.parse(JSON.stringify(summary)));
        // The real A1 list is used by default; synthetic files do not contain those ids.
        expect(summary.a1).toMatchObject({ proposed: A1_PROPOSED_MATCHES.length, foundInPinnedFile: 0 });
        await expect(main(['node', 'cli', '--', '--foundation', 'package.json', '--sr-legacy', sr.file], { pins })).rejects.toThrow(VerificationCliError);
        await expect(main(['node', 'cli', '--', '--foundation', foundation.file], { pins })).rejects.toThrow('Usage');
        await expect(main(['node', 'cli', '--', '--foundation', foundation.file, '--sr-legacy', sr.file], { pins: { foundation: { ...foundation.pin, sha256: 'sha256:' + '0'.repeat(64) }, 'sr-legacy': sr.pin } })).rejects.toThrow('Dataset checksum mismatch');
        for (const file of ['scripts/nutrition/normalizationVerification.ts', 'scripts/nutrition/normalizationVerificationCli.ts'])
            expect(await readFile(file, 'utf8')).not.toMatch(/writeFile|appendFile|mkdir|createWriteStream/);
    });
    it('lists the 17 A1 proposed matches (3 Foundation, 14 SR Legacy)', () => {
        expect(A1_PROPOSED_MATCHES).toHaveLength(17);
        expect(A1_PROPOSED_MATCHES.filter(m => m.dataset === 'foundation')).toHaveLength(3);
        expect(new Set(A1_PROPOSED_MATCHES.map(m => m.fdcId)).size).toBe(17);
    });
});

it('summarizes without values', () => {
    expect(summarizeVerifications([])).toMatchObject({ records: 0, recordsWithDefects: 0, defects: {} });
});
