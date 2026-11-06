import { it, expect, describe } from 'vitest';
import { createManualAdapter, createLabelAdapter, getFdaRoundingInterval } from '../../../shared/nutrition/research/manualAdapters.js';
import { normalizeSourceResult } from '../../../shared/nutrition/research/sourceResult.js';
import { createResearchService } from '../../../shared/nutrition/research/researchService.js';
import { createMemoryResearchStore, createMemorySourceCache } from '../../../shared/nutrition/research/memoryResearchStore.js';
describe('Manual and Label Adapters', () => {
    describe('FDA rounding intervals', () => {
        it('calculates FDA rounding intervals for key nutrients', () => {
            expect(getFdaRoundingInterval('calories', 40)).toBe(5);
            expect(getFdaRoundingInterval('calories', 120)).toBe(10);
            expect(getFdaRoundingInterval('fat', 3)).toBe(0.5);
            expect(getFdaRoundingInterval('fat', 12)).toBe(1);
            expect(getFdaRoundingInterval('sodium', 80)).toBe(5);
            expect(getFdaRoundingInterval('sodium', 240)).toBe(10);
            expect(getFdaRoundingInterval('cholesterol', 10)).toBe(5);
            expect(getFdaRoundingInterval('carbs', 0.8)).toBe(0.5);
            expect(getFdaRoundingInterval('protein', 5)).toBe(1);
        });
    });
    describe('Manual Adapter', () => {
        it('creates manual source result and enforces comparator requirement for estimates', async () => {
            const adapter = createManualAdapter();
            // Estimate without comparatorRef, transferReason and range must throw
            await expect(adapter.toSourceResult({
                source: { type: 'manual' },
                recordId: 'man-1',
                nutrients: {
                    protein: { value: 12, status: 'estimated_from_comparable' },
                },
            })).rejects.toThrow('comparatorRef, transferReason and range');
            // Estimate with comparatorRef succeeds
            const result = await adapter.toSourceResult({
                source: { type: 'manual' },
                recordId: 'man-1',
                title: 'Estimated beef cut',
                nutrients: {
                    protein: {
                        value: 12,
                        status: 'estimated_from_comparable',
                        comparatorRef: 'catalog:beef-chuck-raw',
                        transferReason: 'Similar cut', range: { min: 10, max: 14 },
                    },
                },
            });
            expect(result.type).toBe('manual');
            expect(result.recordId).toBe('man-1');
            expect(result.nutrients[0].status).toBe('estimated_from_comparable');
            expect(result.nutrients[0].comparatorRef).toBe('catalog:beef-chuck-raw');
        });
    });
    describe('Label Adapter', () => {
        it('attaches label_reported status and FDA rounding interval to label values including label 0', async () => {
            const adapter = createLabelAdapter();
            const raw = {
                recordId: 'lbl-1',
                brand: 'TestBrand',
                productName: 'Low Fat Crackers',
                servingSize: 30,
                servingSizeUnit: 'g',
                nutrients: {
                    calories: 120,
                    fat: 0, // label zero!
                    sodium: 150,
                    protein: 2,
                },
            };
            const result = await adapter.toSourceResult(raw);
            expect(result.type).toBe('label');
            expect(result.servingSize).toBe(30);
            const fatNutrient = result.nutrients.find(n => n.key === 'fat');
            expect(fatNutrient.amount).toBe(0);
            expect(fatNutrient.status).toBe('label_reported');
            expect(fatNutrient.roundingInterval).toBe(0.5);
        });
        it('produces gap:unit_not_convertible when serving basis is in mL with no density', async () => {
            const adapter = createLabelAdapter();
            const raw = {
                recordId: 'lbl-2',
                productName: 'Salad Dressing',
                servingSize: 30,
                servingSizeUnit: 'mL', // mL without density!
                nutrients: {
                    calories: 100,
                    fat: 10,
                },
            };
            const result = await adapter.toSourceResult(raw);
            const proposal = normalizeSourceResult(result);
            expect(proposal.nutrients.calories).toBeNull();
            expect(proposal.nutrientMeta.quality.calories.qualifier).toBe('gap:unit_not_convertible');
            expect(proposal.gaps.calories).toBe('unit_not_convertible');
        });
        it('rejects photos in curated scope', async () => {
            const adapter = createLabelAdapter();
            const rawWithPhoto = {
                recordId: 'lbl-3',
                productName: 'Yogurt',
                photos: ['https://example.com/user-upload.jpg'],
                nutrients: { calories: 80 },
            };
            await expect(adapter.toSourceResult(rawWithPhoto, { scope: 'curated' })).rejects.toThrow('Photos cannot enter curated data');
        });
    });
});
it('normalizes explicit manual observations and label zero into sourced values', async () => {
    const manual = await createManualAdapter().toSourceResult({ source: { type: 'manual', url: 'https://example.test/fixture' }, recordId: 'fixture', nutrients: { protein: { value: 3, unit: 'g', status: 'measured' } } });
    const proposal = normalizeSourceResult(manual);
    expect(proposal.nutrients.protein).toBe(3);
    expect(proposal.nutrientMeta.quality.protein.status).toBe('measured');
    expect(proposal.sources.manual.url).toBe('https://example.test/fixture');
    const label = await createLabelAdapter().toSourceResult({ recordId: 'fixture', servingSize: 50, servingSizeUnit: 'g', nutrients: { fat: 0 } });
    const normalized = normalizeSourceResult(label);
    expect(normalized.nutrients.fat).toBe(0);
    expect(normalized.nutrientMeta.quality.fat).toEqual({ status: 'label_reported', roundingInterval: 1 });
});
it('rejects numeric text from manual/label inputs', async () => {
    await expect(createLabelAdapter().toSourceResult({ nutrients: { protein: { value: '2' } } })).rejects.toThrow('number');
    await expect(createManualAdapter().toSourceResult({ source: { type: 'manual' }, nutrients: { protein: { value: '2', status: 'measured' } } })).rejects.toThrow('observation');
});
it.each(['manual', 'label'])('%s inline cache keys follow canonical content across jobs and corrected passes', async type => {
    const adapter = type === 'manual' ? createManualAdapter() : createLabelAdapter();
    const record = value => type === 'manual'
        ? { source: { type: 'manual' }, nutrients: { protein: { value, unit: 'g', status: 'measured' } } }
        : { originalBasis: 'per_100g_edible', nutrients: { protein: value } };
    const context = value => ({ [type + 'Record']: record(value) });
    const first = await adapter.match({}, context(2));
    const reordered = Object.fromEntries(Object.entries(record(2)).reverse());
    expect((await adapter.match({}, { [type + 'Record']: reordered })).sourceId).toBe(first.sourceId);
    expect((await adapter.match({}, context(3))).sourceId).not.toBe(first.sourceId);
    expect((await adapter.toSourceResult(record(2))).recordId).toBe(first.sourceId);
    const store = createMemoryResearchStore(), sourceCache = createMemorySourceCache();
    const service = createResearchService({ store, sourceCache, adapters: [adapter] });
    const a = await service.enqueue({ fields: ['protein'], target: { manifestId: 'inline-a', dims: { state: 'raw' } } });
    const b = await service.enqueue({ fields: ['protein'], target: { manifestId: 'inline-b', dims: { state: 'raw' } } });
    await service.runJob(a.jobId, { adapterId: type, context: context(2) });
    expect((await service.runJob(b.jobId, { adapterId: type, context: context(3) })).proposal.nutrients.protein).toBe(3);
    await service.review(a.jobId, { decision: 'reject', reviewer: 'r' });
    const corrected = await service.runJob(a.jobId, { adapterId: type, context: context(4) });
    expect(corrected.proposal.nutrients.protein).toBe(4);
    expect(corrected.match.sourceId).not.toBe(first.sourceId);
});
it.each([
    {}, { servingSize: 0, servingSizeUnit: 'g' },
    { servingSize: -1, servingSizeUnit: 'g' }, { servingSize: '50', servingSizeUnit: 'g' },
])('rejects labels without a valid explicit basis: %j', async basis => {
    await expect(createLabelAdapter().toSourceResult({ ...basis, nutrients: { protein: 2 } })).rejects.toThrow(/basis|positive/);
});
it('requires gram units and honors an explicit per-100g label basis', async () => {
    const adapter = createLabelAdapter();
    for (const servingSizeUnit of [undefined, 'cup']) {
        const basis = servingSizeUnit ? { servingSizeUnit } : {};
        const result = await adapter.toSourceResult({ servingSize: 50, ...basis, nutrients: { protein: 2 } });
        expect(normalizeSourceResult(result).gaps.protein).toBe('unit_not_convertible');
    }
    const result = await adapter.toSourceResult({ originalBasis: 'per_100g_edible', servingSize: 50, servingSizeUnit: 'g', nutrients: { protein: 2 } });
    expect(normalizeSourceResult(result).nutrients.protein).toBe(2);
    const perServing = await adapter.toSourceResult({ servingSize: 50, servingSizeUnit: 'grams', nutrients: { protein: 2 } });
    expect(normalizeSourceResult(perServing).nutrients.protein).toBe(4);
});
