import { it, expect } from 'vitest';
import { buildRevisionDraft, validateRevision, verifyRevisionHash, revisionToStagedRecord, legacyFoodAsProfile } from '../../../shared/nutrition/ingredientProfile.js';
import { fixture } from './ingredientFixtures.js';
it('preserves nulls, unknown absence, and source/status hash integrity', async () => { const { draft } = await fixture(); expect(draft.nutrients.calories).toBeNull(); expect(revisionToStagedRecord(draft).values.protein).toBe(10); expect(revisionToStagedRecord({ ...draft, nutrients: {} }).values.protein).toBeNull(); expect(await verifyRevisionHash(draft)).toBe(true); for (const change of [{ nutrients: { ...draft.nutrients, protein: 11 } }, { nutrientMeta: { ...draft.nutrientMeta, quality: { protein: { status: 'calculated' } } } }, { fieldProvenance: { protein: { sourceKey: 'other' } } }, { sources: { manual: { type: 'manual', title: 'changed' } } }])
    expect(await verifyRevisionHash({ ...draft, ...change })).toBe(false); });
it('requires evidence for zero and all nonnull values', async () => { const { input } = await fixture(0); expect((await buildRevisionDraft(input)).nutrients.protein).toBe(0); await expect(buildRevisionDraft({ ...input, fieldProvenance: {} })).rejects.toThrow('Source'); input.stagedRecord.quality.protein = { status: 'unknown' }; await expect(buildRevisionDraft(input)).rejects.toThrow('Evidence'); });
it('checks per-100g bounds, including salt, allowed keys, and supersedes', async () => { const { input, revision } = await fixture(); input.stagedRecord.values.sodium = 39340; input.stagedRecord.quality.sodium = { status: 'measured' }; input.fieldProvenance.sodium = { sourceKey: 'manual' }; expect((await buildRevisionDraft({ ...input, base: revision })).supersedes.revision).toBe(1); input.stagedRecord.values.protein = 1000; await expect(buildRevisionDraft(input)).rejects.toThrow(); expect(validateRevision({ ...revision, unexpected: true })).toContain('Unknown revision field'); });
it('legacy adapter never asserts a gram basis or known fiber meaning', () => { const p = legacyFoodAsProfile({ protein: 5, fiber: 2 }, 'food', 'default-app-id'); expect(p.basis.kind).toBe('legacy_per_unit'); expect(p.stagedRecord.fiberMeaning).toBe('unknown'); expect(p.stagedRecord.quality.fiber.status).toBe('legacy_unclassified'); });
it('accepts real Firestore timestamp objects outside the hashed payload', async () => { const { revision } = await fixture(); class Timestamp {
    toMillis() { return 0; }
} expect(await verifyRevisionHash({ ...revision, createdAt: new Timestamp() })).toBe(true); });

it.each([
 {nutrientMeta:{registryVersion:2,quality:{protein:{status:'measured',roundingInterval:'2'}}}},
 {nutrientMeta:{registryVersion:2,quality:{protein:{status:'measured',qualifier:42}}}},
 {nutrientMeta:{registryVersion:2,quality:{},fiberMeaning:42}},
 {fieldProvenance:{protein:{sourceKey:'manual',sourceNutrientId:12}}},
 {fieldProvenance:{protein:{sourceKey:'manual',range:{min:'0',max:1}}}},
 {sources:{manual:{type:'manual',recordId:12}}},
])('rejects malformed nested metadata in client drafts too: %j',async changes=>{
 const {draft}=await fixture();expect(validateRevision({...draft,...changes}).length).toBeGreaterThan(0);
});
