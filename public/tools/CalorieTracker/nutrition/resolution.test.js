import { describe, expect, it } from 'vitest';
import { buildResolution, cancelResolution, chooseExisting, lookupOfficial, manualEntry, recalculateResolution, researchPacket, reviewResolution, saveIncomplete } from '../../../shared/nutrition/resolution.js';
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

    it('reviews known facts against the calculation and leaves fitting unavailable', () => {
        const state = manualEntry(buildResolution({ lines, matches }), 'rice', { calories: { value: 100, status: 'measured' } }).state;
        const calculation = recalculateResolution(state).calculation;
        const review = reviewResolution(state, calculation, [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 180, unit: 'kcal', rounding: 'fda_label' } } }]);
        expect(review.comparisons[0].rows[0]).toMatchObject({ known: 180, calculated: 100, difference: -80, rounding: 'fda_label' });
        expect(review.rows[0].text).toContain('white rice');
        expect(review.fit.available).toBe(false);
        expect(review.modelCalls).toBe(0);
    });
});
