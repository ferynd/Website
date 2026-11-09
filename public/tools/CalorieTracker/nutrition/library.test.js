import { describe, expect, it } from 'vitest';
import { INGREDIENT_STORE_WRITES_ENABLED } from '../../../shared/nutrition/capabilities.js';
import { commitLibraryEdit, filterLibraryGaps, researchLibraryFields, reviewLibraryProfile, searchLibrary, stageLibraryEdit } from '../../../shared/nutrition/library.js';

const rice = { canonicalName: 'Rice', variantId: 'pv-rice', aliases: [{ text: 'white rice' }], ref: { variantId: 'pv-rice', scope: 'curated' } };
const override = { canonicalName: 'Rice', variantId: 'ov-rice', aliases: [{ text: 'my rice' }], overrides: { catalogId: 'nutrition-curated', variantId: 'pv-rice' }, ref: { variantId: 'ov-rice', scope: 'private' } };

describe('ingredient library', () => {
    it('searches aliases, prefers a private override, and pages deterministically', async () => {
        const first = await searchLibrary({
            query: 'rice',
            pageSize: 25,
            sources: [
                { scope: 'curated', search: async () => ({ items: [rice, { canonicalName: 'Oats', variantId: 'pv-oats' }], cursor: 'c2' }) },
                { scope: 'private', search: async () => ({ items: [override], cursor: null }) },
            ],
        });
        expect(first.items.map(item => item.variantId)).toEqual(['pv-oats', 'ov-rice']);
        expect(first.items[1].scope).toBe('private');
        expect(first.items[1].aliases[0].text).toBe('my rice');
        expect(first.cursor.curated).toBe('c2');
        const page = await searchLibrary({ query: 'rice', pageSize: 1, sources: [{ scope: 'curated', search: async () => ({ items: [rice, { canonicalName: 'Oats', variantId: 'pv-oats' }], cursor: 'c2' }) }] });
        expect(page.items.map(item => item.canonicalName)).toEqual(['Rice']);
        expect(page.cursor.curated).toBeNull();
        const failed = await searchLibrary({ query: 'rice', sources: [{ scope: 'curated', search: async () => { throw new Error('offline'); } }] });
        expect(failed.errors).toEqual(['curated']);
        expect(failed.items).toEqual([]);
        const more = await searchLibrary({ query: 'rice', cursor: { curated: null, private: 'p2' }, sources: [
            { scope: 'curated', search: async () => { throw new Error('should not rerun'); } },
            { scope: 'private', search: async () => ({ items: [{ canonicalName: 'Rye', variantId: 'pv-rye' }], cursor: null }) },
        ] });
        expect(more.items.map(item => item.variantId)).toEqual(['pv-rye']);
        expect(more.cursor).toEqual({ curated: null, private: null });
    });

    it('keeps missing fields distinct from missing conversions and refuses curated edits', () => {
        const review = reviewLibraryProfile({ revision: { revision: 2, nutrients: { calories: 100 }, nutrientMeta: { quality: { calories: { status: 'measured' } } } }, conversions: [] });
        expect(review.missingFields).not.toContain('calories');
        expect(review.missingFields.length).toBeGreaterThan(0);
        expect(review.missingConversions).toEqual(['household']);
        expect(reviewLibraryProfile({ conversions: [{ kind: 'household', unit: 'piece' }] }).missingConversions).toEqual([]);
        expect(reviewLibraryProfile({ conversions: [{ kind: 'mass', unit: 'piece' }] }).missingConversions).toEqual(['household']);
        expect(review.affectedMeals.available).toBe(false);
        expect(filterLibraryGaps([review, { missingFields: [], missingConversions: ['household'] }], 'fields')).toHaveLength(1);
        expect(filterLibraryGaps([review], 'conversions')).toHaveLength(1);
        expect(stageLibraryEdit({ scope: 'curated', ownerUid: 'a', viewerUid: 'a', base: { revision: 1 } }).error).toBe('curated_read_only');
        expect(stageLibraryEdit({ scope: 'private', ownerUid: 'a', viewerUid: 'b' }).error).toBe('owner_mismatch');
        const staged = stageLibraryEdit({ scope: 'private', ownerUid: 'a', viewerUid: 'a', base: { revision: 2, nutrients: { calories: 100 }, contentHash: 'sha256:ab' }, patch: { nutrients: { protein: 3 }, source: { type: 'manual' } } });
        expect(staged.draft.nextRevision).toBe(3);
        expect(staged.draft.pendingNutrients).toMatchObject({ protein: 3 });
        expect(staged.readyForSave).toBe(false);
        expect(staged.diaryUntouched).toBe(true);
        expect(staged.writes).toBe(false);
        expect(commitLibraryEdit()).toMatchObject({ ok: false, error: 'writes_disabled', committed: false });
        expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
    });

    it('builds a research packet for selected fields and does not save it', async () => {
        const beans = await researchLibraryFields({ name: 'black beans', ownerUid: 'owner-a' });
        const ricePacket = await researchLibraryFields({ name: 'white rice', ownerUid: 'owner-a' });
        expect(beans.ok).toBe(true);
        expect(beans.pendingJobs[0].jobId).not.toBe(ricePacket.pendingJobs[0].jobId);
        expect(beans.state.pendingJobs[0].state).toBe('awaiting_response');
        const packet = beans;
        expect(packet.writes).toBe(false);
        expect(packet.modelCalls).toBe(0);
    });
});
