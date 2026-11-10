import { it, expect, describe } from 'vitest';
import { emptyStagedRecord, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { createResearchJob } from '../../../shared/nutrition/research/researchJob.js';
import { validateProposal } from '../../../shared/nutrition/research/researchValidator.js';
import { extractStateWords } from '../../../shared/nutrition/research/fdcFood.js';
async function makeValidJob({ state = 'raw', sourceStrategy = 'usda-foundation-first', kind = 'produce', scope = 'curated', ownerUid, sourceType = 'fdc', values = {}, qualities = {}, provenance = {}, sources = {}, extractedStateWords = ['raw'], hasConcentrationFormula = false, } = {}) {
    const staged = emptyStagedRecord();
    for (const k of V2_KEYS) {
        staged.values[k] = values[k] !== undefined ? values[k] : null;
        staged.quality[k] = qualities[k] || { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    }
    // Set default protein to 10
    if (values.protein === undefined && staged.values.protein === null) {
        staged.values.protein = 10;
        staged.quality.protein = { status: 'measured' };
    }
    if (values.calories === undefined && staged.values.calories === null) {
        staged.values.calories = 40;
        staged.quality.calories = { status: 'measured' };
    }
    const defaultProvenance = {
        protein: { sourceKey: 'src-1', sourceNutrientId: '1003' },
        calories: { sourceKey: 'src-1', sourceNutrientId: '1008' },
        ...provenance,
    };
    const defaultSources = {
        'src-1': {
            type: sourceType,
            datasetId: 'Foundation',
            recordId: '9900001',
            title: 'Test source',
            url: 'https://fdc.nal.usda.gov/test',
            version: '2024-10-31',
            accessedAt: '2026-11-06',
            permittedUse: 'CC0 1.0',
        },
        ...sources,
    };
    const draft = await buildRevisionDraft({
        identityId: 'pi-11111111111111111111',
        variantId: 'pv-22222222222222222222',
        basis: { kind: 'per_100g_edible', state },
        stagedRecord: staged,
        fieldProvenance: defaultProvenance,
        sources: defaultSources,
    });
    const job = await createResearchJob({
        scope,
        ownerUid,
        targetKind: 'catalog',
        target: {
            manifestId: 'test-manifest-id',
            dims: { state },
            sourceStrategy,
            kind,
        },
        sourceRelease: '2024-10-31',
    });
    job.proposal = {
        revisionDraft: draft,
        conversions: [],
        extractedStateWords,
        hasConcentrationFormula,
    };
    return job;
}
describe('Research Validator', () => {
    it('validates a correct proposal with zero errors', async () => {
        const job = await makeValidJob();
        const outcome = await validateProposal(job);
        expect(outcome.errors).toEqual([]);
        expect(outcome.isValid).toBe(true);
    });
    it('validates LOQ and unknown values correctly', async () => {
        const job = await makeValidJob({
            values: { fat: null },
            qualities: { fat: { status: 'below_quantification_limit', upperBound: 0.05 } },
            provenance: { fat: { sourceKey: 'src-1' } },
        });
        const outcome = await validateProposal(job);
        expect(outcome.errors).toEqual([]);
    });
    it('rejects zero values without evidence/provenance', async () => {
        const job = await makeValidJob();
        // Directly mutate the proposal draft to have zero without evidence
        job.proposal.revisionDraft.nutrients.fat = 0;
        job.proposal.revisionDraft.nutrientMeta.quality.fat = { status: 'unknown' };
        delete job.proposal.revisionDraft.fieldProvenance.fat;
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
    });
    it('passes pure salt at 38,758 mg sodium and rejects physically impossible values', async () => {
        const saltJob = await makeValidJob({
            state: 'food-grade-dry',
            sourceStrategy: 'compound-reference',
            sourceType: 'manual',
            values: { sodium: 38758 },
            qualities: { sodium: { status: 'measured' } },
            provenance: { sodium: { sourceKey: 'src-1' } },
            extractedStateWords: ['dry'],
        });
        const saltOutcome = await validateProposal(saltJob);
        expect(saltOutcome.errors).toEqual([]);
        const badJob = await makeValidJob();
        // Mutate protein to 150 (> 100g per 100g)
        badJob.proposal.revisionDraft.nutrients.protein = 150;
        const badOutcome = await validateProposal(badJob);
        expect(badOutcome.isValid).toBe(false);
        expect(badOutcome.errors.some(e => e.includes('rejected by checkPer100g'))).toBe(true);
    });
    it('detects explicit raw vs cooked state conflicts', async () => {
        const job = await makeValidJob({
            state: 'raw',
            extractedStateWords: ['cooked', 'boiled'],
        });
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
        expect(outcome.errors.some(e => e.includes('conflict: target is raw but source is cooked'))).toBe(true);
    });
    it('detects drained and fortification conflicts', async () => {
        const job = await makeValidJob({
            extractedStateWords: ['raw', 'undrained', 'unfortified'],
        });
        job.target.dims.drained = 'drained';
        job.target.dims.fortification = 'fortified';
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
        expect(outcome.errors.some(e => e.includes('target is drained but source is undrained'))).toBe(true);
        expect(outcome.errors.some(e => e.includes('target is fortified but source is unfortified'))).toBe(true);
    });
    it('rejects FDC adapter used on compound-reference entry', async () => {
        const job = await makeValidJob({
            sourceStrategy: 'compound-reference',
            sourceType: 'fdc',
        });
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
        expect(outcome.errors.some(e => e.includes('FDC adapter used on a compound-reference entry'))).toBe(true);
    });
    it('blocks concentration-needed state if no concentration formula is provided', async () => {
        const job = await makeValidJob({
            state: 'food-grade-solution-concentration-needed',
            hasConcentrationFormula: false,
        });
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
        expect(outcome.blockedReason?.code).toBe('requires_composition');
    });
    it('emits warnings for Atwater inconsistency and fat class overshoot', async () => {
        const job = await makeValidJob({
            values: {
                calories: 500, // declared 500, but 4*10 + 4*0 + 9*0 = 40 kcal -> major inconsistency!
                protein: 10,
                carbs: 0,
                fat: 10,
                fatSaturated: 8,
                fatMonounsaturated: 5, // 8 + 5 = 13 > 10 * 1.05
            },
            qualities: {
                calories: { status: 'measured' },
                protein: { status: 'measured' },
                carbs: { status: 'measured' },
                fat: { status: 'measured' },
                fatSaturated: { status: 'measured' },
                fatMonounsaturated: { status: 'measured' },
            },
            provenance: {
                calories: { sourceKey: 'src-1' },
                protein: { sourceKey: 'src-1' },
                carbs: { sourceKey: 'src-1' },
                fat: { sourceKey: 'src-1' },
                fatSaturated: { sourceKey: 'src-1' },
                fatMonounsaturated: { sourceKey: 'src-1' },
            },
        });
        const outcome = await validateProposal(job);
        expect(outcome.warnings.some(w => w.includes('Atwater energy inconsistency'))).toBe(true);
        expect(outcome.warnings.some(w => w.includes('Fat classes sum'))).toBe(true);
    });
    it('rejects private material in curated scope', async () => {
        const job = await makeValidJob({
            scope: 'curated',
            sources: {
                'src-1': {
                    type: 'manual',
                    recordId: '1',
                    version: '1',
                    accessedAt: '2026-11-06',
                    permittedUse: 'private-user-data',
                },
            },
        });
        const outcome = await validateProposal(job);
        expect(outcome.isValid).toBe(false);
        expect(outcome.errors.some(e => e.includes('non-public permittedUse'))).toBe(true);
    });
});
it.each(['measured', 'label_reported', 'calculated', 'estimated_from_comparable'])('rejects a null value that carries observational status %s', async status => {
    const job = await makeValidJob({ values: { fat: null }, qualities: { fat: { status } } });
    const validation = await validateProposal(job);
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain('Field fat observational status requires non-null value');
});
it.each(['unknown', 'below_quantification_limit', 'not_applicable'])('allows a null value with %s status', async status => {
    const job = await makeValidJob({
        values: { fat: null },
        qualities: { fat: status === 'below_quantification_limit' ? { status, upperBound: 0.05 } : { status, qualifier: 'gap:not_reported_by_source' } },
        provenance: status === 'unknown' ? {} : { fat: { sourceKey: 'src-1' } },
    });
    const validation = await validateProposal(job);
    expect(validation.errors.some(error => error.includes('observational status'))).toBe(false);
    expect(validation.errors.some(error => error.includes('provenance'))).toBe(false);
});
it('rejects unsalted versus salted the way it rejects drained and fortified', async () => {
    const salted = extractStateWords('Lentils, mature seeds, cooked, boiled, with salt');
    expect(salted).toEqual(expect.arrayContaining(['cooked', 'boiled', 'salted']));
    expect(salted).not.toContain('unsalted');
    const job = await makeValidJob({
        state: 'boiled',
        values: { sodium: 400 },
        qualities: { sodium: { status: 'measured' } },
        provenance: { sodium: { sourceKey: 'src-1' } },
        extractedStateWords: salted,
    });
    job.target.dims.salt = 'unsalted';
    job.target.dims.drained = 'drained';
    const outcome = await validateProposal(job);
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors).toContain('Explicit conflict: target is unsalted but source is salted');
    const unsalted = extractStateWords('Lentils, mature seeds, cooked, boiled, without salt');
    expect(unsalted).not.toContain('salted');
    const matching = await makeValidJob({
        state: 'boiled',
        values: { sodium: 400 },
        qualities: { sodium: { status: 'measured' } },
        provenance: { sodium: { sourceKey: 'src-1' } },
        extractedStateWords: unsalted,
    });
    matching.target.dims.salt = 'unsalted';
    matching.target.dims.drained = 'drained';
    expect((await validateProposal(matching)).errors.some(error => error.includes('salt'))).toBe(false);
    const reverse = await makeValidJob({
        state: 'boiled',
        extractedStateWords: unsalted,
    });
    reverse.target.dims.salt = 'salted';
    const reverseOutcome = await validateProposal(reverse);
    expect(reverseOutcome.isValid).toBe(false);
    expect(reverseOutcome.errors).toContain('Explicit conflict: target is salted but source is unsalted');
});
it('checks the union of per-source state words', async () => {
    const job = await makeValidJob({ state: 'raw', extractedStateWords: ['raw'] });
    job.proposal.stateWordsBySource = { a: ['raw'], b: ['cooked'] };
    const outcome = await validateProposal(job);
    expect(outcome.isValid).toBe(false);
    expect(outcome.errors).toContain('Explicit conflict: target is raw but source is cooked/prepared');
});
it('conflicts a raw-only source with a cooked target even when another source is cooked', async () => {
    const cookedTarget = await makeValidJob({ state: 'cooked', extractedStateWords: ['cooked'] });
    cookedTarget.proposal.stateWordsBySource = { protein: ['cooked'], sodium: ['raw'] };
    const cookedOutcome = await validateProposal(cookedTarget);
    expect(cookedOutcome.isValid).toBe(false);
    expect(cookedOutcome.errors).toContain('Explicit conflict: target is cooked but source is raw');
    const rawTarget = await makeValidJob({ state: 'raw', extractedStateWords: ['raw'] });
    rawTarget.proposal.stateWordsBySource = { protein: ['raw'], sodium: ['cooked'] };
    const rawOutcome = await validateProposal(rawTarget);
    expect(rawOutcome.isValid).toBe(false);
    expect(rawOutcome.errors).toContain('Explicit conflict: target is raw but source is cooked/prepared');
});
it('requires curated provenance for an upper bound or not-applicable status', async () => {
    const loq = await makeValidJob({
        values: { sodium: null },
        qualities: { sodium: { status: 'below_quantification_limit', upperBound: 0.001 } },
    });
    const missing = await validateProposal(loq);
    expect(missing.isValid).toBe(false);
    expect(missing.errors).toContain('Curated field sodium requires provenance for below_quantification_limit');
    const sourced = await makeValidJob({
        values: { sodium: null },
        qualities: { sodium: { status: 'below_quantification_limit', upperBound: 0.001 } },
        provenance: { sodium: { sourceKey: 'src-1' } },
    });
    expect((await validateProposal(sourced)).errors.some(error => error.includes('provenance'))).toBe(false);
    const notApplicable = await makeValidJob({
        values: { alcohol: null },
        qualities: { alcohol: { status: 'not_applicable' } },
    });
    expect((await validateProposal(notApplicable)).errors).toContain('Curated field alcohol requires provenance for not_applicable');
});
it.each(['accessedAt', 'publishedAt'])('rejects invalid source %s dates before approval', async field => {
    for (const date of ['', 'not-a-date', '2026-13-01']) {
        const job = await makeValidJob({ sources: { bad: { type: 'manual', version: 'fixture', permittedUse: 'CC0', accessedAt: '2026-11-06', [field]: date } } });
        const validation = await validateProposal(job);
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContain(`Source bad invalid ${field === 'accessedAt' ? 'access' : 'publication'} date`);
    }
    const valid = await makeValidJob({ sources: { valid: { type: 'label', version: 'fixture', permittedUse: 'CC0', accessedAt: '2026-11-06T12:00:00Z', publishedAt: '2025-01-01' } } });
    expect((await validateProposal(valid)).isValid).toBe(true);
});

describe('Q-004 assumed_zero validation (issue #215)', () => {
    it('rejects a nonzero value carrying the assumed_zero status', async () => {
        const job = await makeValidJob({ values: { sodium: 5 }, qualities: { sodium: { status: 'assumed_zero' } }, provenance: { sodium: { sourceKey: 'src-1', sourceNutrientId: '1093', sourceDerivationCode: 'Z' } } });
        const outcome = await validateProposal(job);
        expect(outcome.errors.some(e => e.includes('assumed_zero status requires a zero value'))).toBe(true);
    });
    it('accepts a zero value carrying the assumed_zero status', async () => {
        const job = await makeValidJob({ values: { sodium: 0 }, qualities: { sodium: { status: 'assumed_zero' } }, provenance: { sodium: { sourceKey: 'src-1', sourceNutrientId: '1093', sourceDerivationCode: 'Z' } } });
        const outcome = await validateProposal(job);
        expect(outcome.errors.some(e => e.includes('assumed_zero'))).toBe(false);
    });
});
