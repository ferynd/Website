import { describe, expect, it } from 'vitest';
import {
    NUTRIENT_INTAKE_SPEC,
    parseNutritionJson,
    type ParsedNutritionItem,
} from '../../app/tools/recipe-standardizer/lib/nutritionIntake';
import {
    checkPer100g,
    checkPerUnit,
    emptyStagedRecord,
    getNutrient,
    LEGACY_V1_KEYS,
    NUTRIENT_REGISTRY_VERSION,
    toV2Fields,
    V2_KEYS,
} from '../../public/shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../public/shared/nutrition/ingredientProfile.js';
import { createResearchJob } from '../../public/shared/nutrition/research/researchJob.js';
import { validateProposal } from '../../public/shared/nutrition/research/researchValidator.js';
import { applyReviewDecision, reviewContentHash } from '../../public/shared/nutrition/research/researchReview.js';

// Synthetic test inputs only. These are not USDA records or import approvals.
const SCHEMAS = [1, 2] as const;
const REVIEW_VALUES = [900.000001, 901, 902, 910];
const REJECTED_VALUES = [910.000001, 911, 9020];
const FIXTURE_SOURCE = {
    type: 'fdc' as const,
    datasetId: 'SR Legacy',
    recordId: '9900001',
    title: 'Synthetic pure-fat energy fixture, not a USDA record',
    version: '2018-04',
    accessedAt: '2026-11-13',
    permittedUse: 'CC0 1.0',
};

function payload(schemaVersion: 1 | 2, calories: number | null): string {
    const nutrients: Record<string, number | null> = Object.fromEntries(LEGACY_V1_KEYS.map(key => [key, 0]));
    nutrients.calories = calories;
    nutrients.fat = 100;
    const identity = { ingredientId: 'synthetic-fat', name: 'Synthetic fat', assumptions: 'Test fixture only' };
    return JSON.stringify({
        kind: 'recipe-nutrition', schemaVersion, basis: 'per-100g',
        items: [schemaVersion === 1 ? { ...identity, nutrients } : {
            ...identity,
            observations: LEGACY_V1_KEYS.map(key => ({
                key,
                value: nutrients[key],
                unit: getNutrient(key)!.unit,
                status: nutrients[key] === null ? 'unknown' : key === 'calories' ? 'calculated' : 'source_reported',
            })),
        }],
    });
}

function parseRow(schemaVersion: 1 | 2, calories: number | null): ParsedNutritionItem {
    const parsed = parseNutritionJson(payload(schemaVersion, calories));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    expect(parsed.items).toHaveLength(1);
    return parsed.items[0];
}

async function energyDraft(calories: number) {
    const staged = emptyStagedRecord();
    for (const key of V2_KEYS) staged.quality[key] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    staged.values.calories = calories;
    staged.quality.calories = { status: 'calculated' };
    return buildRevisionDraft({
        identityId: 'synthetic-fat', variantId: 'synthetic-fat',
        basis: { kind: 'per_100g_edible', state: 'as-sold' },
        stagedRecord: staged,
        fieldProvenance: {
            calories: { sourceKey: 'fixture', sourceNutrientId: '1008', sourceDerivationCode: 'NC' },
        },
        sources: { fixture: FIXTURE_SOURCE },
    });
}

describe('energy validation contract (#63)', () => {
    it('uses the shared hard maximum for recipe intake, not a second literal', () => {
        expect(NUTRIENT_INTAKE_SPEC.calories.max).toBe(910);
        expect(NUTRIENT_INTAKE_SPEC.calories.max).toBe(getNutrient('calories')!.bounds.per100g.hardMax);
        expect(getNutrient('calories')!.bounds.per100g.reviewAbove).toBe(900);
        expect(NUTRIENT_REGISTRY_VERSION).toBe(2);
    });

    it('preserves per-unit limits and non-energy bounds', () => {
        expect(checkPerUnit('calories', 10000)).toBe('ok');
        expect(checkPerUnit('calories', 10001)).toBe('reject');
        expect(checkPer100g('fat', 100)).toBe('ok');
        expect(checkPer100g('fat', 100.01)).toBe('reject');
        expect(checkPer100g('sodium', 39340)).toBe('ok');
        expect(checkPer100g('sodium', 100001)).toBe('reject');
    });

    it('preserves 902 and calculated quality in v2 serialization', () => {
        const staged = emptyStagedRecord();
        staged.values.calories = 902;
        staged.quality.calories = { status: 'calculated' };
        const saved = toV2Fields(staged);
        expect(saved.fields.calories).toBe(902);
        expect(saved.nutrientMeta.quality.calories?.status).toBe('calculated');
        expect(saved.fields.protein).toBeNull();
    });

    it('builds a synthetic 902 draft without changing source amount or derivation', async () => {
        const draft = await energyDraft(902);
        expect(draft.nutrients.calories).toBe(902);
        expect(draft.nutrientMeta.quality.calories?.status).toBe('calculated');
        expect(draft.fieldProvenance.calories).toMatchObject({ sourceNutrientId: '1008', sourceDerivationCode: 'NC' });
        expect(draft.nutrients.protein).toBeNull();
        expect(checkPer100g('calories', draft.nutrients.calories!)).toBe('review');
    });

    it('still refuses a draft above the hard maximum', async () => {
        await expect(energyDraft(911)).rejects.toThrow('Invalid nutrient: calories');
    });

    it('requires acknowledgement of the actual 902 validation warning before approval', async () => {
        const job = await createResearchJob({
            scope: 'curated', targetKind: 'catalog', state: 'needs_review', sourceRelease: '2018-04',
            target: { manifestId: 'synthetic-fat', canonicalName: 'Synthetic fat', dims: { state: 'as-sold' } },
        });
        job.proposal = { revisionDraft: await energyDraft(902), conversions: [], extractedStateWords: ['as-sold'] };
        job.validation = await validateProposal(job);
        expect(job.validation.errors).toEqual([]);
        expect(job.validation.isValid).toBe(true);
        expect(job.validation.warnings).toEqual(['Nutrient calories value 902 requires review (exceeds reviewAbove)']);
        const decision = { decision: 'approve' as const, reviewer: 'synthetic-test', approvedContentHash: await reviewContentHash(job) };
        await expect(applyReviewDecision(job, { ...decision, acknowledgedWarnings: [] })).rejects.toThrow('unacknowledged warnings');
        const approved = await applyReviewDecision(job, { ...decision, acknowledgedWarnings: [...job.validation.warnings] });
        expect(approved.state).toBe('approved');
        expect(approved.proposal.revisionDraft.nutrients.calories).toBe(902);
    });
});

describe.each(SCHEMAS)('recipe intake schema %s energy bounds (#63)', schemaVersion => {
    it('accepts 900 without a high-energy warning', () => {
        const row = parseRow(schemaVersion, 900);
        expect(row.errors).toEqual([]);
        expect(row.nutrients.calories).toBe(900);
        expect(row.warnings).toEqual([]);
    });

    it.each(REVIEW_VALUES)('preserves %s and emits a review warning', calories => {
        const row = parseRow(schemaVersion, calories);
        expect(row.errors).toEqual([]);
        expect(row.nutrients.calories).toBe(calories);
        expect(row.warnings).toHaveLength(1);
        expect(row.warnings[0]).toMatch(/calories.*needs review/);
        if (schemaVersion === 2) {
            expect(row.quality?.calories?.status).toBe('calculated');
            expect(row.commitBlockers).toEqual([]);
        }
    });

    it.each(REJECTED_VALUES)('rejects %s instead of clamping it', calories => {
        const row = parseRow(schemaVersion, calories);
        expect(row.errors.some(error => /calories|kcal/.test(error))).toBe(true);
        expect(row.nutrients.calories).toBeNull();
    });

    it('does not turn unknown energy into zero', () => {
        const row = parseRow(schemaVersion, null);
        expect(row.nutrients.calories).toBeNull();
        if (schemaVersion === 1) expect(row.errors.some(error => /calories/.test(error))).toBe(true);
        else {
            expect(row.errors).toEqual([]);
            expect(row.quality?.calories?.status).toBe('unknown');
            expect(row.commitBlockers?.some(reason => /calories is unknown/.test(reason))).toBe(true);
        }
    });
});
