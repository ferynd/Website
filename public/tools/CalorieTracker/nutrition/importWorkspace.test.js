import { describe, expect, it } from 'vitest';
import { INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from '../../../shared/nutrition/capabilities.js';
import { clearWorkspaceDraft, parseWorkspaceRecord, readWorkspaceDraft, writeWorkspaceDraft } from '../../../shared/nutrition/importWorkspaceDraft.js';
import {
    applyResearchResponse, calculateWorkspace, cancelWorkspace, confirmWorkspace, createWorkspace, fitWorkspace, importWorkspaceInput, instructionsWorkspace,
    lookupWorkspace, matchWorkspace, packetCopy, packetWorkspace, reviewWorkspace, saveWorkspace,
} from '../../../shared/nutrition/importWorkspace.js';
import { IMPORT_WORKSPACE_ENABLED } from '../../../shared/nutrition/capabilities.js';
import { PROFILE_FIELDS } from '../../../shared/nutrition/research/profileFields.js';
import { onIngredientAuthChange } from '../services/ingredientSession.js';
import { renderIngredientPaste } from '../../../shared/nutrition/import/pasteFormat.js';

const list = {
    kind: 'nutrition.ingredientList', schemaVersion: 1,
    meal: { title: 'Rice', kind: 'single_portion', servings: { count: 1 } },
    ingredients: [{ lineId: 'rice', name: 'white rice', quantity: { g: 100, basis: 'estimated' }, variant: { state: 'cooked' } }],
};
const known = Object.fromEntries(PROFILE_FIELDS.map(key => [key, { value: key === 'calories' ? 130 : 0, status: 'measured' }]));

function memory() {
    const map = new Map();
    return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

describe('import workspace', () => {
    it('runs a matched list through review with zero model calls and export only', async () => {
        expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
        expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
        let step = importWorkspaceInput(createWorkspace('owner-a').workspace, list);
        expect(step.workspace.origins[0].origin).toBe('assistant');
        step = await matchWorkspace(step.workspace, { nutrientsByLine: { rice: known }, lineRefs: { rice: { identityId: 'rice-id', variantId: 'rice-cooked', revision: 1 } }, refDims: { rice: { state: 'cooked' } } });
        expect(step.workspace.resolution.items[0].kind).toBe('resolved');
        const fromCache = await matchWorkspace(importWorkspaceInput(createWorkspace('owner-a').workspace, list).workspace, {
            lineRefs: { rice: { identityId: 'rice-id', variantId: 'rice-cooked', revision: 1 } },
            refDims: { rice: { state: 'cooked' } },
            loadRevision: async () => ({ revision: { nutrients: Object.fromEntries(PROFILE_FIELDS.map(key => [key, key === 'calories' ? 130 : 0])), nutrientMeta: { quality: Object.fromEntries(PROFILE_FIELDS.map(key => [key, { status: 'measured' }])) } } }),
        });
        expect(fromCache.workspace.resolution.items[0].kind).toBe('resolved');
        expect(fromCache.workspace.resolution.items[0].source).toBe('library');
        const offline = await matchWorkspace(importWorkspaceInput(createWorkspace('owner-a').workspace, list).workspace, { privateSearch: async () => { throw new Error('offline'); }, loadRevision: async () => { throw new Error('denied'); } });
        expect(offline.ok).toBe(true);
        expect(offline.workspace.resolution.items[0].kind).toBe('missing_profile');
        expect(IMPORT_WORKSPACE_ENABLED).toBe(true);
        const ambiguous = importWorkspaceInput(createWorkspace('owner-a').workspace, list).workspace;
        ambiguous.match = { lines: [{ lineId: 'rice', name: 'white rice', outcome: 'ambiguous', needsConfirmation: true, candidates: [{ variantId: 'rice-cooked', compatibility: 'exact', canonicalName: 'Rice', ref: { identityId: 'rice-id', variantId: 'rice-cooked', revision: 1 } }] }] };
        const confirmed = await confirmWorkspace(ambiguous, 'rice', 'rice-cooked', { loadRevision: async () => ({ revision: { nutrients: Object.fromEntries(PROFILE_FIELDS.map(key => [key, key === 'calories' ? 130 : 0])), nutrientMeta: { quality: Object.fromEntries(PROFILE_FIELDS.map(key => [key, { status: 'measured' }])) } } }) });
        expect(confirmed.workspace.resolution.items[0]).toMatchObject({ kind: 'resolved', source: 'library' });
        expect(packetCopy({ copyText: null, copyTexts: ['one', 'two'] })).toContain('Packet 2 of 2');
        expect((await packetWorkspace(step.workspace, ['rice'])).error).toBe('matched_line');
        step = calculateWorkspace(step.workspace);
        expect(step.workspace.calculation.nutrients.calories.value).toBe(130);
        step = fitWorkspace(step.workspace);
        expect(step.workspace.fit.reason).toBe('no eligible known facts');
        step = reviewWorkspace(step.workspace);
        expect(step.workspace.review.rows[0].origin).toBe('assistant');
        expect(step.workspace.review.fit.available).toBe(false);
        step = saveWorkspace(step.workspace);
        expect(step.workspace.committed).toBe(false);
        expect(step.workspace.exportCopy.format).toBe('paste');
        expect(step.workspace.modelCalls).toBe(0);
        expect(step.workspace.capabilities.photo).toBe(false);
        expect(step.workspace.capabilities.save).toBe(false);
        expect(importWorkspaceInput(step.workspace, 'picture', { kind: 'photo' }).error).toBe('unsupported_input');
    });

    it('adapts legacy paste, saved meals, and recipes, and copies a packet only after an official miss', async () => {
        const legacy = importWorkspaceInput(createWorkspace('owner-a').workspace, 'Calories: 100\nProtein: 5g', { kind: 'legacy_paste' });
        expect(legacy.workspace.origins[0]).toMatchObject({ origin: 'user', sourceKind: 'legacy_paste' });
        const meal = importWorkspaceInput(createWorkspace('owner-a').workspace, JSON.stringify({ foodItems: [{ id: 'bowl', name: 'Rice bowl', quantity: 1, calories: 200 }] }), { kind: 'saved_meal' });
        expect(meal.ok).toBe(true);
        expect(meal.workspace.origins[0].origin).toBe('deterministic');
        const recipeText = importWorkspaceInput(createWorkspace('owner-a').workspace, JSON.stringify({ name: 'Beans', servings: { baselineServings: 2 }, ingredients: [{ displayName: 'black beans', quantityG: 80 }] }), { kind: 'saved_recipe' });
        expect(recipeText.ok).toBe(true);
        const recipe = importWorkspaceInput(createWorkspace('owner-a').workspace, { name: 'Beans', servings: { baselineServings: 2 }, ingredients: [{ displayName: 'black beans', quantityG: 80 }] }, { kind: 'saved_recipe' });
        expect(recipe.workspace.origins[0].origin).toBe('deterministic');
        let step = await matchWorkspace(importWorkspaceInput(createWorkspace('owner-a').workspace, list).workspace, {});
        expect((await packetWorkspace(step.workspace, ['rice'])).error).toBe('official_lookup_required');
        step = lookupWorkspace(step.workspace, ['rice']);
        const packet = await packetWorkspace(step.workspace, ['rice']);
        expect(packet.workspace.packet.copyText).toContain('nutrition.researchRequest');
        const { responseFor } = await import('./researchPacketFixtures.js');
        const applied = await applyResearchResponse(packet.workspace, JSON.stringify(responseFor(packet.workspace.resolution.pendingRequests[0])));
        expect(applied.ok, JSON.stringify(applied.errors)).toBe(true);
        expect(applied.workspace.resolution.items[0].source).toBe('packet');
        expect(applied.workspace.committed).toBe(false);
        expect(packet.workspace.modelCalls).toBe(0);
        const cancelled = cancelWorkspace(packet.workspace);
        expect(cancelled.workspace.committed).toBe(false);
        expect(cancelled.workspace.resolution.lines).toHaveLength(1);
        expect(cancelled.workspace.preserved[0].jobId).toMatch(/^rj-/);
        const facts = structuredClone(list);
        facts.registryVersion = 2;
        facts.knownFacts = [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 180, unit: 'kcal' } } }];
        const imported = importWorkspaceInput(createWorkspace('owner-a').workspace, facts);
        expect(imported.ok, JSON.stringify(imported.errors)).toBe(true);
        const fitted = fitWorkspace(imported.workspace);
        expect(fitted.workspace.fit).toMatchObject({ ran: false, available: true, facts: 1, reason: 'no numeric fit target' });
        expect(fitted.workspace.fit.quantities[0].grams).toBe(100);
        expect(fitted.workspace.modelCalls).toBe(0);
        expect(instructionsWorkspace().text).toContain('assistant instructions v1');
    });

    it('keeps drafts on the signed-in owner and clears them on sign-out', async () => {
        const store = memory();
        const workspace = importWorkspaceInput(createWorkspace('alice').workspace, list).workspace;
        expect(writeWorkspaceDraft(workspace, store).ok).toBe(true);
        expect(readWorkspaceDraft('bob', store)).toBeNull();
        expect(readWorkspaceDraft('alice', store).draft.import.meal.title).toBe('Rice');
        expect(parseWorkspaceRecord('{"schemaVersion":1}')).toBeNull();
        await onIngredientAuthChange('alice', 'bob', async () => {}, async () => {}, () => clearWorkspaceDraft(store));
        expect(readWorkspaceDraft('alice', store)).toBeNull();
        writeWorkspaceDraft(workspace, store);
        await onIngredientAuthChange('alice', 'alice', async () => {}, async () => {}, () => clearWorkspaceDraft(store));
        expect(readWorkspaceDraft('alice', store).ownerUid).toBe('alice');
    });

    it('keeps finished weight out of the raw sum and accepts a line yield', () => {
        const imported = importWorkspaceInput(createWorkspace('owner-a').workspace, {
            kind: 'nutrition.ingredientList', schemaVersion: 1, registryVersion: 2,
            meal: {
                title: 'Roast', kind: 'single_portion', servings: { count: 1 },
                yield: { rawTotal: { g: 200, basis: 'measured' }, cookedTotal: { g: 150, basis: 'measured' } },
                servingWeight: { g: 150, basis: 'label' },
            },
            ingredients: [{ lineId: 'beef', name: 'beef', quantity: { g: 200, basis: 'measured' }, yield: { waterDeltaG: -50 } }],
            knownFacts: [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 400, unit: 'kcal' } } }],
        });
        expect(imported.ok, JSON.stringify(imported.errors)).toBe(true);
        expect(imported.workspace.draft.import.ingredients[0].waterDeltaG).toBe(-50);
        const paste = renderIngredientPaste({ ...imported.workspace.draft.import, meal: { ...imported.workspace.draft.import.meal, yield: undefined } });
        expect(paste.ok).toBe(false);
        expect(paste.reason).toBe('json-only');
        const fitted = fitWorkspace({
            ...imported.workspace,
            resolution: {
                lines: [{ lineId: 'beef', grams: 200 }],
                items: [{ lineId: 'beef', nutrients: { calories: { value: 200, status: 'measured' } } }],
            },
        });
        expect(fitted.workspace.fit.quantities[0].grams).toBe(200);
        expect(fitted.workspace.calculation.nutrients.calories.value).toBe(400);
        expect(fitted.workspace.calculation.mass.cookedG).toBe(150);
        const waterOnly = fitWorkspace({
            ownerUid: 'owner-a',
            draft: {
                corrections: { lines: {} },
                import: {
                    ingredients: [{ lineId: 'oil', name: 'oil', quantity: { basis: 'estimated', g: 10, gMin: 0, gMax: 100 } }],
                    meal: { yield: { cookedTotal: { g: 5, basis: 'measured' } }, servingWeight: { g: 5, basis: 'label' } },
                    constraints: [],
                    knownFacts: [{ factId: 'menu', provenance: 'user_stated', appliesTo: { scope: 'meal' }, basis: {}, nutrients: { calories: { value: 90, unit: 'kcal' } } }],
                },
            },
            resolution: { lines: [{ lineId: 'oil', grams: 10 }], items: [{ lineId: 'oil', nutrients: { calories: { value: 900, status: 'measured' } } }] },
        });
        expect(waterOnly.workspace.fit.quantities[0].grams).toBeCloseTo(10, 5);
        expect(waterOnly.workspace.calculation.nutrients.calories.value).toBeCloseTo(90, 5);
    });
});
