import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildResolution, cancelResolution, cookedTotal, chooseExisting, lookupOfficial, manualEntry, recalculateResolution, researchPacket, reviewResolution, saveIncomplete } from '../../../shared/nutrition/resolution.js';
import { PROFILE_FIELDS } from '../../../shared/nutrition/research/profileFields.js';
import { validateResearchResponse } from '../../../shared/nutrition/research/researchPacket.js';

const lines = [
    { lineId: 'rice', name: 'white rice', grams: 100, quantityBasis: 'estimated', variant: { state: 'cooked' } },
    { lineId: 'salsa', name: 'tomato salsa', grams: 60, quantityBasis: 'measured', variant: {} },
];
const matches = [
    { lineId: 'rice', outcome: 'missing' },
    { lineId: 'salsa', outcome: 'exact', needsResearch: false },
];

describe('missing ingredient resolution', () => {
    it('separates a missing profile from missing fields and keeps repeats once', () => {
        const state = buildResolution({ lines: [...lines, lines[0]], matches, nutrientsByLine: { salsa: { calories: { value: 20, status: 'measured' }, protein: { value: null, status: 'unknown' } } } });
        expect(state.items.map(item => item.lineId)).toEqual(['rice', 'salsa']);
        expect(state.items[0].kind).toBe('missing_profile');
        expect(state.items[0].missingFields).toEqual([]);
        expect(state.items[1].kind).toBe('missing_fields');
        expect(state.items[1].missingFields).toContain('protein');
        expect(state.modelCalls).toBe(0);
        expect(state.capabilities.fitPanel).toBe(false);
    });

    it('walks the ladder without researching a matched line or dropping an ingredient', async () => {
        let state = buildResolution({ lines, matches });
        expect((await researchPacket(state, ['rice'])).error).toBe('official_lookup_required');
        state = lookupOfficial(state, 'rice', { outcome: 'not_found', reason: 'not in curated catalog' }).state;
        expect(state.items[0].resolved).toBe(false);
        expect(state.lines).toHaveLength(2);
        const packet = await researchPacket(state, ['rice', 'salsa']);
        expect(packet.error).toBe('official_lookup_required');
        const known = Object.fromEntries(PROFILE_FIELDS.map(key => [key, { value: 0, status: 'measured' }]));
        const matched = buildResolution({ lines: [lines[1]], matches: [matches[1]], nutrientsByLine: { salsa: known } });
        expect(matched.items[0].kind).toBe('resolved');
        expect((await researchPacket(matched, ['salsa'])).error).toBe('matched_line');
        const unresolved = await researchPacket(state, ['rice']);
        expect(unresolved.ok).toBe(true);
        expect(unresolved.copyText).toContain('nutrition.researchRequest');
        expect(unresolved.packets[0].targets.some(target => target.identity.name === 'tomato salsa')).toBe(false);
        expect(unresolved.modelCalls).toBe(0);
        const overridden = await researchPacket(buildResolution({ lines, matches }), ['rice'], { override: true });
        expect(overridden.ok).toBe(true);
        const chosen = chooseExisting(state, 'salsa', { mode: 'substitute', nutrients: { calories: { value: 30, status: 'estimated_from_comparable' } } });
        expect(chosen.state.items[1].estimate).toBe(true);
        const manual = manualEntry(state, 'rice', { calories: { value: 130, status: 'measured' } }).state;
        const again = recalculateResolution(manual);
        expect(again.calculation.nutrients.calories.value).toBe(130);
        expect(again.modelCalls).toBe(0);
        const cancelled = cancelResolution(state);
        expect(cancelled.committed).toBe(false);
        expect(cancelled.lines.map(line => line.lineId)).toEqual(['rice', 'salsa']);
        expect(saveIncomplete(state).items).toHaveLength(2);
        const response = { kind: 'nutrition.researchResponse', schemaVersion: 1, requestId: unresolved.packets[0].requestId, requestDigest: unresolved.packets[0].requestDigest, responder: { assistant: 'claude', webAccess: false }, results: [] };
        await expect(validateResearchResponse(response, { request: unresolved.packets[0], jobs: [] })).rejects.toThrow();
    });

    it('reviews known facts against the calculation and leaves fitting unavailable', async () => {
        const state = manualEntry(buildResolution({ lines, matches }), 'rice', { calories: { value: 100, status: 'measured' } }).state;
        const calculation = recalculateResolution(state).calculation;
        const review = reviewResolution(state, calculation, [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 180, unit: 'kcal' } } }]);
        expect(review.comparisons[0].rows[0]).toMatchObject({ known: 180, calculated: 100, difference: -80 });
        const rounded = reviewResolution(state, calculation, [{ factId: 'label', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 180, unit: 'kcal', rounding: 'fda_label' } } }]);
        expect(rounded.comparisons[0].rows[0]).toMatchObject({ comparison: 'interval', difference: null, rounding: 'fda_label' });
        expect(review.rows[0].text).toContain('white rice');
        expect(review.fit.available).toBe(false);
        const substituted = chooseExisting(buildResolution({ lines, matches }), 'salsa', { mode: 'substitute', ref: { identityId: 'pi-salsa', variantId: 'pv-salsa' }, nutrients: { calories: { value: 10, status: 'measured' } } }).state;
        const substituteReview = reviewResolution(substituted, recalculateResolution(substituted).calculation);
        expect(substituteReview.rows[1].basis).toBe('estimated');
        expect(substituteReview.rows[1].text).toContain('estimated');
        expect(substituteReview.rows[1].text).not.toContain('measured');
        expect(substituted.items[1].selectedRef.variantId).toBe('pv-salsa');
        expect(manualEntry(state, 'missing', {}).error).toBe('unknown_line');
        const bounded = reviewResolution(state, { nutrients: { calories: { value: 4 } } }, [{ factId: 'cap', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 5, unit: 'kcal', qualifier: 'less_than' } } }]);
        expect(bounded.comparisons[0].rows[0]).toMatchObject({ consistent: true, difference: null, qualifier: 'less_than' });
        const served = buildResolution({ lines, matches, servings: 4 });
        const scaled = reviewResolution(served, { nutrients: { calories: { value: 180 } } }, [{ factId: 'one', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: { servings: 1 }, nutrients: { calories: { value: 45, unit: 'kcal' } } }]);
        expect(scaled.comparisons[0].rows[0]).toMatchObject({ known: 180, difference: 0 });
        const unscaled = reviewResolution(buildResolution({ lines, matches }), { nutrients: { calories: { value: 180 } } }, [{ factId: 'one', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: {}, nutrients: { calories: { value: 45, unit: 'kcal' } } }]);
        expect(unscaled.comparisons[0].rows[0]).toMatchObject({ difference: null, note: 'basis_not_comparable' });
        const byWeight = reviewResolution(buildResolution({ lines, matches }), { nutrients: { calories: { value: 90 } } }, [{ factId: 'weight', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: { servingWeight: { g: 80 } }, nutrients: { calories: { value: 45, unit: 'kcal' } } }]);
        expect(byWeight.comparisons[0].rows[0]).toMatchObject({ known: 90, difference: 0 });
        const boiled = reviewResolution(buildResolution({ lines: [{ lineId: 'pasta', name: 'pasta', grams: 100, yieldRetention: 2 }] }), { nutrients: { calories: { value: 350 } } }, [{ factId: 'serve', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: { servingWeight: { g: 100 } }, nutrients: { calories: { value: 175, unit: 'kcal' } } }]);
        expect(boiled.comparisons[0].rows[0]).toMatchObject({ known: 350, difference: 0 });
        const terminal = buildResolution({ lines: [lines[1]], matches: [matches[1]], nutrientsByLine: { salsa: { calories: { value: null, status: 'not_applicable' }, protein: { value: null, status: 'unknown' } } } });
        expect(terminal.items[0].missingFields).not.toContain('calories');
        expect(terminal.items[0].missingFields).toContain('protein');
        const { buildRevisionDraft } = await import('../../../shared/nutrition/ingredientProfile.js');
        const { emptyStagedRecord } = await import('../../../shared/nutrition/nutrientRegistry.js');
        const record = emptyStagedRecord();
        record.values.calories = 40;
        record.quality.calories = { status: 'measured' };
        const revision = await buildRevisionDraft({ identityId: 'synthetic-identity', variantId: 'synthetic-variant', stagedRecord: record, basis: { kind: 'per_100g_edible', state: 'raw' }, sources: { s1: { type: 'fdc', recordId: '9900002', title: 'Synthetic base', version: 'fixture', accessedAt: '2026-11-06', permittedUse: 'CC0' } }, fieldProvenance: { calories: { sourceKey: 's1' } } });
        revision.revision = 1;
        revision.revisionId = revision.variantId + '~r1';
        const ref = { identityId: revision.identityId, variantId: revision.variantId, contentHash: revision.contentHash, revision: 1 };
        const pinned = buildResolution({ lines: [lines[1]], matches: [{ lineId: 'salsa', outcome: 'exact', ref }], revisionsByLine: { salsa: revision } });
        const missingRevision = lookupOfficial(buildResolution({ lines: [lines[1]], matches: [{ lineId: 'salsa', outcome: 'exact', ref }] }), 'salsa', { outcome: 'not_found', unresolvedFields: ['protein'] }).state;
        expect((await researchPacket(missingRevision, ['salsa'])).error).toBe('base_revision_required');
        const fieldPacket = await researchPacket(lookupOfficial(pinned, 'salsa', { outcome: 'not_found', unresolvedFields: ['protein'] }).state, ['salsa']);
        let both = lookupOfficial(buildResolution({ lines, matches }), 'rice', { outcome: 'not_found' }).state;
        both = lookupOfficial(both, 'salsa', { outcome: 'not_found', unresolvedFields: ['protein'] }).state;
        const onePacket = await researchPacket(both, ['rice', 'salsa']);
        expect(onePacket.packets).toHaveLength(1);
        expect(onePacket.pendingJobs).toHaveLength(2);
        expect(fieldPacket.pendingJobs[0].target.identityId).toBe('synthetic-identity');
        expect(fieldPacket.pendingJobs[0].target.baseRevision.nutrients.calories).toBe(40);
        expect(fieldPacket.pendingJobs[0].target.baseRef.variantId).toBe('synthetic-variant');
        expect(fieldPacket.pendingJobs[0].target.dims.state).toBe('raw');
        const { packetProposal } = await import('../../../shared/nutrition/research/packetProposal.js');
        const { responseFor } = await import('./researchPacketFixtures.js');
        const proposed = await packetProposal({ ...fieldPacket.pendingJobs[0], scope: 'private' }, responseFor(fieldPacket.packets[0]).results[0]);
        expect(proposed.revisionDraft.basis.state).toBe('raw');
        expect(proposed.revisionDraft.nutrients.calories).toBe(40);
        expect(fieldPacket.pendingJobs[0].state).toBe('awaiting_response');
        expect(fieldPacket.pendingJobs[0].pendingRequest.status).toBe('pending');
        expect(review.modelCalls).toBe(0);
    });
});

describe('cooked mass for serving-weight review (#72 fix round 2)', () => {
    const serve = { factId: 'serve', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: { servingWeight: { g: 100 } }, nutrients: { calories: { value: 100, unit: 'kcal' } } };
    const partial = [{ lineId: 'rice', name: 'rice', grams: 100 }, { lineId: 'sauce', name: 'sauce', grams: null }];

    it('does not sum a partial cooked mass when a counted line has no grams', () => {
        expect(cookedTotal(partial)).toBeNull();
        expect(cookedTotal([{ lineId: 'rice', grams: 100 }, { lineId: 'pasta', grams: 50, yieldRetention: 2 }])).toBe(200);
        const state = buildResolution({ lines: partial });
        expect(state.totalGrams).toBeNull();
        const calculation = recalculateResolution(state).calculation;
        expect(calculation.mass.cookedG).toBe(100);
        const row = reviewResolution(state, calculation, [serve]).comparisons[0].rows[0];
        expect(row).toMatchObject({ known: null, difference: null, note: 'basis_not_comparable' });
    });

    it('uses an explicit meal cooked total when line mass is incomplete', () => {
        const state = buildResolution({ lines: partial, totalGrams: 300 });
        const calculation = recalculateResolution(state).calculation;
        const row = reviewResolution(state, calculation, [serve]).comparisons[0].rows[0];
        expect(row.known).toBe(300);
        expect(row.note).toBeUndefined();
    });
});

describe('nutrition declarations match the runtime (#72 fix round 2)', () => {
    const read = name => readFileSync(new URL(`../../../shared/nutrition/${name}.d.ts`, import.meta.url), 'utf8');

    it.each(['calculate', 'fit', 'resolution'])('%s.d.ts declares every export and its version literal', async name => {
        const module = await import(`../../../shared/nutrition/${name}.js`);
        const declarations = read(name);
        for (const key of Object.keys(module)) {
            expect(declarations).toMatch(new RegExp(`export (const|function) ${key}\\b`));
            if (/_VERSION$/.test(key)) expect(declarations).toContain(`export const ${key}: ${module[key]};`);
        }
    });

    it('pins version 2 and declares the cooked-total inputs', () => {
        expect(read('calculate')).toContain('export const CALCULATION_VERSION: 2;');
        expect(read('calculate')).toMatch(/export function countedLines\b/);
        expect(read('calculate')).toMatch(/export function nutrientBasis\b/);
        expect(read('fit')).toContain('export const FIT_VERSION: 2;');
        expect(read('fit')).toMatch(/fitQuantities\(input\?: \{[^}]*cookedTotal\?: number \| null/);
        expect(read('resolution')).toMatch(/export function cookedTotal\(lines: any\[\]\): number \| null;/);
    });
});

describe('official lookup outcomes (#74)', () => {
    it('keeps the pinned curated release on a genuine not_found attempt', async () => {
        const state = lookupOfficial(buildResolution({ lines, matches }), 'rice', { outcome: 'not_found', reason: 'not in curated catalog' }).state;
        expect(state.items[0].officialAttempts).toEqual([{ adapter: 'curated', release: 'nutrition-curated@0', outcome: 'not_found' }]);
        const pinned = lookupOfficial(buildResolution({ lines, matches }), 'rice', { outcome: 'not_found', adapter: 'fdc', release: 'fdc-sr-legacy@2018-04' }).state;
        expect(pinned.items[0].officialAttempts[0]).toEqual({ adapter: 'fdc', release: 'fdc-sr-legacy@2018-04', outcome: 'not_found' });
        const packet = await researchPacket(state, ['rice']);
        expect(packet.packets[0].targets[0].triedSources).toEqual([{ adapter: 'curated', release: 'nutrition-curated@0', outcome: 'not_found' }]);
    });

    it('records not_performed without a release, ignoring a supplied adapter or release', async () => {
        const result = lookupOfficial(buildResolution({ lines, matches }), 'rice', { outcome: 'not_performed', adapter: 'curated', release: 'nutrition-curated@0' });
        expect(result.ok).toBe(true);
        expect(result.state.items[0].officialAttempts).toEqual([{ adapter: 'none', release: null, outcome: 'not_performed', reason: 'live official sources are not enabled' }]);
        expect(result.state.items[0].resolved).toBe(false);
        expect((await researchPacket(result.state, ['rice'])).ok).toBe(true);
    });

    it('rejects an attempt with no recognized outcome', () => {
        const state = buildResolution({ lines, matches });
        expect(lookupOfficial(state, 'rice', {}).error).toBe('invalid_outcome');
        expect(lookupOfficial(state, 'rice', { outcome: 'missing' }).error).toBe('invalid_outcome');
    });
});
