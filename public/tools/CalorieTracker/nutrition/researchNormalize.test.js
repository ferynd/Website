import { it, expect, describe } from 'vitest';
import fs from 'node:fs';
import { PROFILE_FIELDS as V2_KEYS } from '../../../shared/nutrition/research/profileFields.js';
import { parseFdcFood } from '../../../shared/nutrition/research/fdcFood.js';
import { normalizeSourceResult } from '../../../shared/nutrition/research/sourceResult.js';
function loadFixture(relPath) {
    const url = new URL(`../../../../scripts/fixtures/nutrition/fdc/${relPath}`, import.meta.url);
    return JSON.parse(fs.readFileSync(url, 'utf8'));
}
describe('Source Result Normalization', () => {
    it('assigns a status and value/null to every key in V2_KEYS', async () => {
        const raw = loadFixture('apple-bulk.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        const proposal = normalizeSourceResult(parsed, {
            dims: { state: 'raw' }
        });
        expect(Object.keys(proposal.nutrients).length).toBe(V2_KEYS.length);
        expect(Object.keys(proposal.nutrientMeta.quality).length).toBe(V2_KEYS.length);
        for (const key of V2_KEYS) {
            expect(proposal.nutrients).toHaveProperty(key);
            expect(proposal.nutrientMeta.quality).toHaveProperty(key);
            const quality = proposal.nutrientMeta.quality[key];
            expect(quality).toBeDefined();
            expect(quality.status).toBeDefined();
            if (proposal.nutrients[key] !== null) {
                expect(typeof proposal.nutrients[key]).toBe('number');
                expect(Number.isFinite(proposal.nutrients[key])).toBe(true);
            }
        }
    });
    it('handles fiber mapping per D9 (1079 -> fiberTotal and fiber, fiberWeightedLegacy as gap:not_computed)', async () => {
        const raw = loadFixture('apple-bulk.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        const proposal = normalizeSourceResult(parsed, { dims: { state: 'raw' } });
        expect(proposal.nutrients.fiberTotal).toBe(2.4);
        expect(proposal.nutrients.fiber).toBe(2.4);
        expect(proposal.fieldProvenance.fiber.derivation).toBe('same_as:fiberTotal');
        expect(proposal.nutrientMeta.fiberMeaning).toBe('total');
        expect(proposal.nutrients).not.toHaveProperty('fiberWeightedLegacy');
        expect(proposal.nutrientMeta.quality).not.toHaveProperty('fiberWeightedLegacy');
    });
    it('handles omega-3 per D10: calculated only when ALA, EPA, and DHA are present; otherwise gap:partial_components', async () => {
        // In apple-bulk.json, ALA (1404) is 0.009, EPA (1278) is 0, DHA (1272) is 0 -> all 3 present!
        const rawApple = loadFixture('apple-bulk.json');
        const parsedApple = await parseFdcFood(rawApple, { release: '2024-10-31' });
        const proposalApple = normalizeSourceResult(parsedApple, { dims: { state: 'raw' } });
        expect(proposalApple.nutrients.omega3).toBe(0.009);
        expect(proposalApple.nutrientMeta.quality.omega3.status).toBe('calculated');
        expect(proposalApple.fieldProvenance.omega3.derivation).toBe('sum:ALA+EPA+DHA');
        // In legume-bulk.json, ALA/EPA/DHA are not present -> gap:partial_components
        const rawLegume = loadFixture('legume-bulk.json');
        const parsedLegume = await parseFdcFood(rawLegume, { release: '2024-10-31' });
        const proposalLegume = normalizeSourceResult(parsedLegume, { dims: { state: 'cooked' } });
        expect(proposalLegume.nutrients.omega3).toBeNull();
        expect(proposalLegume.nutrientMeta.quality.omega3.qualifier).toBe('gap:partial_components');
    });
    it('treats LOQ nutrient as null with below_quantification_limit and upperBound', async () => {
        const raw = loadFixture('loq-food.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        const proposal = normalizeSourceResult(parsed);
        expect(proposal.nutrients.fat).toBeNull();
        expect(proposal.nutrientMeta.quality.fat.status).toBe('below_quantification_limit');
        expect(proposal.nutrientMeta.quality.fat.upperBound).toBe(0.05);
        expect(proposal.nutrients.sodium).toBeNull();
        expect(proposal.nutrientMeta.quality.sodium.status).toBe('below_quantification_limit');
        expect(proposal.nutrientMeta.quality.sodium.upperBound).toBe(0.2);
    });
    it('flags definition mismatches (IU-only vitamin A, K1-only, non-DFE folate) as gap:definition_mismatch', async () => {
        const raw = loadFixture('mismatch-vitamins.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        const proposal = normalizeSourceResult(parsed);
        expect(proposal.nutrients.vitaminA).toBeNull();
        expect(proposal.nutrientMeta.quality.vitaminA.qualifier).toBe('gap:definition_mismatch');
        expect(proposal.nutrients.vitaminK).toBeNull();
        expect(proposal.nutrientMeta.quality.vitaminK.qualifier).toBe('gap:definition_mismatch');
        expect(proposal.nutrients.folate).toBeNull();
        expect(proposal.nutrientMeta.quality.folate.qualifier).toBe('gap:definition_mismatch');
    });
    it('scales per-serving values to per 100g when gram weight is present', async () => {
        const raw = loadFixture('apple-bulk.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        // Simulate branded food with servingSize 50g -> scale factor 2
        parsed.originalBasis = 'per_serving';
        parsed.servingSize = 50;
        parsed.servingSizeUnit = 'g';
        parsed.dataType = 'Branded';
        const proposal = normalizeSourceResult(parsed);
        expect(proposal.nutrients.calories).toBe(104); // 52 * 2
        expect(proposal.nutrients.protein).toBe(0.52); // 0.26 * 2
        expect(proposal.nutrientMeta.quality.calories.status).toBe('label_reported');
    });
    it('marks all keys as gap:unit_not_convertible when serving basis is only in mL without density', async () => {
        const raw = loadFixture('oil-bulk.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        parsed.originalBasis = 'per_serving';
        parsed.servingSize = 15;
        parsed.servingSizeUnit = 'mL';
        const proposal = normalizeSourceResult(parsed);
        for (const key of V2_KEYS) {
            expect(proposal.nutrients[key]).toBeNull();
            expect(proposal.nutrientMeta.quality[key].qualifier).toBe('gap:unit_not_convertible');
        }
    });
    it('marks unrequested fields as gap:not_requested when requestedFields is specified', async () => {
        const raw = loadFixture('apple-bulk.json');
        const parsed = await parseFdcFood(raw, { release: '2024-10-31' });
        const proposal = normalizeSourceResult(parsed, {
            requestedFields: ['calories', 'protein']
        });
        expect(proposal.nutrients.calories).toBe(52);
        expect(proposal.nutrients.protein).toBe(0.26);
        expect(proposal.nutrients.carbs).toBeNull();
        expect(proposal.nutrientMeta.quality.carbs.qualifier).toBe('gap:not_requested');
    });
});
it('keeps an exact limit of quantification when a definition-mismatch row is also present', () => {
    const result = {
        type: 'fdc', recordId: 'fixture', originalBasis: 'per_100g_edible',
        nutrients: [
            { nutrientId: 1190, amount: null, unitName: 'mcg', isBelowLoq: true, loq: 5 },
            { nutrientId: 1177, amount: 30, unitName: 'mcg' },
            { nutrientId: 1106, amount: null, unitName: 'mcg', isBelowLoq: true, loq: 2 },
            { nutrientId: 1104, amount: 500, unitName: 'IU' },
            { nutrientId: 1404, amount: null, unitName: 'g', isBelowLoq: true, loq: 0.01 },
            { nutrientId: 1270, amount: 0.05, unitName: 'g' },
        ],
    };
    const proposal = normalizeSourceResult(result);
    expect(proposal.nutrientMeta.quality.folate).toMatchObject({ status: 'below_quantification_limit', upperBound: 5 });
    expect(proposal.nutrientMeta.quality.vitaminA).toMatchObject({ status: 'below_quantification_limit', upperBound: 2 });
    expect(proposal.nutrientMeta.quality.omega3ALA).toMatchObject({ status: 'below_quantification_limit', upperBound: 0.01 });
    for (const key of ['folate', 'vitaminA', 'omega3ALA']) {
        expect(proposal.nutrientMeta.quality[key].qualifier).not.toBe('gap:definition_mismatch');
        expect(proposal.gaps[key]).toBeUndefined();
    }
});
it('preserves FDC per-100g basis despite a listed serving, and scales source units/LOQ safely', async () => {
    const raw = loadFixture('apple-bulk.json');
    raw.servingSize = 50;
    raw.servingSizeUnit = 'g';
    const result = await parseFdcFood(raw, { release: 'fixture' });
    expect(normalizeSourceResult(result).nutrients.calories).toBe(52);
    const protein = result.nutrients.find(n => n.nutrientId === 1003);
    protein.amount = 1000;
    protein.unitName = 'mg';
    expect(normalizeSourceResult(result).nutrients.protein).toBe(1);
    const energy = result.nutrients.find(n => n.nutrientId === 1008);
    energy.amount = 0;
    energy.isBelowLoq = true;
    energy.loq = 1;
    const proposal = normalizeSourceResult(result);
    expect(proposal.nutrients.calories).toBeNull();
    expect(proposal.nutrientMeta.quality.calories.upperBound).toBe(1);
});
it('uses a below-LOQ energy row only when no quantified energy value exists', () => {
    const base = { type: 'fdc', recordId: 'fixture', originalBasis: 'per_100g_edible' };
    const preferred = normalizeSourceResult({ ...base, nutrients: [
        { nutrientId: 1008, amount: 0, unitName: 'kcal', isBelowLoq: true, loq: 1 },
        { nutrientId: 2048, amount: 52, unitName: 'kcal' },
    ] });
    expect(preferred.nutrients.calories).toBe(52);
    expect(preferred.nutrientMeta.quality.calories.status).toBe('calculated');
    expect(preferred.fieldProvenance.calories.sourceNutrientId).toBe('2048');
    expect(preferred.gaps.calories).toBeUndefined();
    const atwater = normalizeSourceResult({ ...base, nutrients: [
        { nutrientId: 1008, amount: null, unitName: 'kcal', isBelowLoq: true, loq: 1 },
        { nutrientId: 2048, amount: 180, unitName: 'kcal' },
    ] });
    expect(atwater.nutrients.calories).toBe(180);
    expect(atwater.fieldProvenance.calories.sourceNutrientId).toBe('2048');
    const general = normalizeSourceResult({ ...base, nutrients: [
        { nutrientId: 1008, amount: 0, unitName: 'kcal', isBelowLoq: true, loq: 1 },
        { nutrientId: 2048, amount: null, unitName: 'kcal', isBelowLoq: true, loq: 3 },
        { nutrientId: 2047, amount: 180, unitName: 'kcal' },
    ] });
    expect(general.nutrients.calories).toBe(180);
    expect(general.fieldProvenance.calories).toMatchObject({ sourceNutrientId: '2047', derivation: 'atwater_general_factors' });
    const onlyLoq = normalizeSourceResult({ ...base, nutrients: [
        { nutrientId: 1008, amount: 0, unitName: 'kcal', isBelowLoq: true, loq: 1 },
        { nutrientId: 2047, amount: null, unitName: 'kcal', isBelowLoq: true, loq: 2 },
    ] });
    expect(onlyLoq.nutrients.calories).toBeNull();
    expect(onlyLoq.nutrientMeta.quality.calories).toMatchObject({ status: 'below_quantification_limit', upperBound: 1 });
    expect(onlyLoq.fieldProvenance.calories.sourceNutrientId).toBe('1008');
});
it.each([[2048, 'atwater_specific_factors'], [2047, 'atwater_general_factors']])('retains calculated energy provenance for FDC %i after unit/basis normalization', (nutrientId, derivation) => {
    const result = { type: 'fdc', recordId: 'fixture', originalBasis: 'per_serving', servingSize: 50, servingSizeUnit: 'g',
        nutrients: [{ nutrientId, amount: 100, unitName: 'kcal' }] };
    const normalized = normalizeSourceResult(result);
    expect(normalized.nutrients.calories).toBe(200);
    expect(normalized.nutrientMeta.quality.calories.status).toBe('calculated');
    expect(normalized.fieldProvenance.calories).toMatchObject({ sourceNutrientId: String(nutrientId), derivation });
    result.nutrients.push({ nutrientId: 1008, amount: 90, unitName: 'kcal' });
    expect(normalizeSourceResult(result).nutrientMeta.quality.calories.status).toBe('measured');
    expect(normalizeSourceResult(result).nutrients.calories).toBe(180);
});
