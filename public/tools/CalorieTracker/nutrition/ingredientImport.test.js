import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { buildConversion } from '../../../shared/nutrition/ingredientConversion.js';
import { INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from '../../../shared/nutrition/capabilities.js';
import { fixture } from './ingredientFixtures.js';
import * as imported from '../../../shared/nutrition/import/index.js';

const { importIngredientList, parseIngredientPaste, renderIngredientPaste, validateIngredientList, applyLineCorrection,
    effectiveLine, isFreeQuantity, fitTargets, researchEvidence, compoundGroups, resolveLineQuantity, fromLegacyPaste,
    fromSavedMeal, fromSavedRecipe, fromRecipeStandardizerRecipe, reconcileImport, confirmMatch, copyAssistantInstructions,
    INSTRUCTIONS_VERSION, MODEL_CALLS } = imported;

const contract = readFileSync(new URL('../../../../docs/nutrition/assistant-contracts.md', import.meta.url), 'utf8');
const examples = contract.split('## Examples')[1];
const example = JSON.parse(examples.match(/```json\n([\s\S]*?)```/)[1]);
const paste = examples.match(/```text\n([\s\S]*?)```/)[1];

function subset(list) {
    const copy = structuredClone(list);
    delete copy.producer;
    delete copy.inputs;
    for (const line of copy.ingredients) {
        delete line.role;
        delete line.confidence;
    }
    for (const fact of copy.knownFacts ?? []) {
        for (const nutrient of Object.values(fact.nutrients)) delete nutrient.rounding;
    }
    return copy;
}

describe('ingredient-list import v1', () => {
    it('validates the documented JSON example and keeps the caller unchanged', () => {
        const snapshot = structuredClone(example);
        const result = validateIngredientList(example);
        expect(result.ok, JSON.stringify(result.errors)).toBe(true);
        expect(example).toEqual(snapshot);
        expect(Object.isFrozen(result.list)).toBe(true);
        expect(result.list.knownFacts[0].nutrients.calories).toEqual({ value: 690, unit: 'kcal', rounding: 'fda_label' });
        expect(result.factUses.menu).toBe('fit_target');
        expect(fitTargets(result.list).map(fact => fact.factId)).toEqual(['menu']);
        expect(isFreeQuantity(result.list.ingredients[0], result.list.constraints)).toBe(true);
        expect(isFreeQuantity(result.list.ingredients[3], result.list.constraints)).toBe(false);
    });

    it('round trips the documented paste and refuses to drop JSON-only fields', () => {
        const parsed = parseIngredientPaste(paste);
        expect(parsed.ok, JSON.stringify(parsed.errors)).toBe(true);
        expect(parsed.list.registryVersion).toBe(2);
        expect(parsed.list.ingredients.map(line => line.lineId)).toEqual(['rice', 'chicken', 'beans', 'salsa']);
        expect(parsed.list.ingredients[1].variant).toEqual({ state: 'cooked', preparation: 'grilled' });
        expect(parsed.list.ingredients[2].variant).toEqual({ state: 'canned', drained: 'drained' });
        expect(renderIngredientPaste(parsed.list).text).toBe(paste);
        expect(renderIngredientPaste(subset(example)).text).toBe(paste);
        const blocked = renderIngredientPaste(example);
        expect(blocked).toMatchObject({ ok: false, reason: 'json-only' });
        expect(blocked.fields).toEqual(expect.arrayContaining(['$.producer', '$.inputs', '$.ingredients[0].role']));
        expect(JSON.stringify(blocked)).not.toContain('"text"');
    });

    it('rejects a newer schema, unknown fields, images, bad provenance, cycles, contradictions, and oversize input', () => {
        expect(validateIngredientList({ ...example, schemaVersion: 2 }).errors[0].message).toBe('site update required');
        expect(validateIngredientList({ ...example, photo: 'x' }).errors.some(error => error.path === '$.photo')).toBe(true);
        expect(validateIngredientList({ ...example, ingredients: example.ingredients.map((line, index) => index ? line : { ...line, notes: 'data:image/png;base64,aaaa' }) }).errors.some(error => /base64/.test(error.message))).toBe(true);
        const invented = structuredClone(example);
        invented.knownFacts[0].provenance = 'assistant_inferred';
        expect(validateIngredientList(invented).errors.some(error => error.message === 'facts need real provenance')).toBe(true);
        const derived = structuredClone(example);
        derived.knownFacts[0].nutrients.fiberWeightedLegacy = { value: 4, unit: 'g' };
        expect(validateIngredientList(derived).errors.some(error => /derived metric/.test(error.message))).toBe(true);
        const fiber = structuredClone(example);
        fiber.knownFacts[0].nutrients = { Fiber: { value: 8, unit: 'g' }, 'Weighted fiber': { value: 1, unit: 'g' } };
        const fiberResult = validateIngredientList(fiber);
        expect(fiberResult.ok).toBe(false);
        fiber.knownFacts[0].nutrients = { Fiber: { value: 8, unit: 'g' } };
        expect(validateIngredientList(fiber).list.knownFacts[0].nutrients.fiber.value).toBe(8);
        expect(validateIngredientList(fiber).list.knownFacts[0].nutrients.fiberTotal).toBeUndefined();
        const cycle = structuredClone(example);
        cycle.ingredients[0].parentLineId = 'chicken';
        cycle.ingredients[1].parentLineId = 'rice';
        expect(validateIngredientList(cycle).errors.some(error => /cycle/.test(error.message))).toBe(true);
        const order = subset(example);
        order.ingredients = order.ingredients.map(line => ({ ...line, quantity: { ...line.quantity, basis: 'measured' } }));
        order.constraints = [{ type: 'order', lineIds: ['salsa', 'rice'] }];
        expect(validateIngredientList(order).ok).toBe(false);
        const loose = structuredClone(subset(example));
        loose.constraints = [{ type: 'ratio', num: 'rice', den: 'chicken', min: 10, max: 12 }];
        const looseResult = validateIngredientList(loose);
        expect(looseResult.ok).toBe(true);
        expect(looseResult.warnings.some(warning => warning.code === 'infeasible')).toBe(true);
        expect(validateIngredientList({ ...subset(example), ingredients: Array.from({ length: 101 }, (_, index) => ({ lineId: `l${index + 1}`.slice(0, 24), name: 'salt', quantity: { g: 1, basis: 'measured' } })) }).ok).toBe(false);
        expect(validateIngredientList(`intro\n\`\`\`json\n${JSON.stringify(subset(example))}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``).errors[0].message).toContain('exactly one fenced');
        const broken = parseIngredientPaste('NUTRITION-INGREDIENTS v1\nTitle: Soup\nKind: single_portion\nServings: 1\n1. rice | not-a-form | 10 g | estimated\nEND\n');
        expect(broken.ok).toBe(false);
        expect(broken.errors[0]).toMatchObject({ line: 5, column: expect.any(Number) });
        expect(parseIngredientPaste('NUTRITION-INGREDIENTS v9\nEND\n').errors[0].message).toBe('site update required');
        const summed = subset(example);
        summed.constraints = [{ type: 'sum', lineIds: ['rice', 'chicken'], gMin: 200, gMax: 400 }];
        expect(validateIngredientList(summed).ok).toBe(true);
        const svg = structuredClone(example);
        svg.ingredients[0] = { ...svg.ingredients[0], notes: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' };
        expect(validateIngredientList(svg).ok).toBe(false);
        const extended = { ...subset(example), extensions: { note: 'kept' } };
        expect(validateIngredientList(extended).list.extensions).toEqual({ note: 'kept' });
        expect(renderIngredientPaste(extended).fields).toContain('$.extensions');
        const ranged = subset(example);
        ranged.ingredients[0] = { ...ranged.ingredients[0], quantity: { g: null, gMin: 10, gMax: 30, basis: 'estimated', original: { amount: 1, unit: 'cup', text: '1 cup' } } };
        expect(renderIngredientPaste(ranged).reason).toBe('json-only');
        const doubled = subset(example);
        doubled.ingredients[3] = { ...doubled.ingredients[3], quantity: { g: 60, basis: 'measured', original: { amount: 2, unit: 'g', text: '2 g' } } };
        expect(renderIngredientPaste(doubled).reason).toBe('json-only');
    });

    it('stores an unapplied serving fact and line evidence without making either a fit target', () => {
        const list = subset(example);
        list.knownFacts.push({ factId: 'bare', provenance: 'user_stated', appliesTo: { scope: 'serving' }, basis: {}, nutrients: { sodium: { value: 10, unit: 'mg' } } });
        list.knownFacts.push({ factId: 'label', provenance: 'official_label', source: example.knownFacts[0].source, appliesTo: { scope: 'line', lineId: 'beans' }, basis: {}, nutrients: { protein: { value: 7, unit: 'g' } } });
        const result = validateIngredientList(list);
        expect(result.ok, JSON.stringify(result.errors)).toBe(true);
        expect(result.factUses.bare).toBe('unapplied');
        expect(result.factUses.label).toBe('research_evidence');
        expect(fitTargets(result.list).map(fact => fact.factId)).toEqual(['menu']);
        expect(researchEvidence(result.list)).toEqual([expect.objectContaining({ factId: 'label', lineId: 'beans' })]);
        expect(result.list.ingredients.some(line => line.nutrients)).toBe(false);
    });

    it('converts quantity units only through conversion records and nutrient units through the registry', async () => {
        const line = { variant: { state: 'raw' }, quantity: { g: null, basis: 'estimated', original: { amount: 100, unit: 'mL', text: '100 mL' } } };
        expect(resolveLineQuantity(line, []).error).toBe('missing_conversion');
        expect(resolveLineQuantity(line, []).quantity.g).toBeNull();
        const { ref } = await fixture();
        const conversion = await buildConversion({ variantRef: ref, kind: 'density', unit: 'mL', amount: 1, gramsPerMl: 0.92, state: 'raw', source: { type: 'manual' }, confidence: 1 });
        expect(resolveLineQuantity(line, [conversion]).quantity.g).toBeCloseTo(92);
        expect(resolveLineQuantity({ quantity: { g: 28, basis: 'measured', original: { amount: 2, unit: 'tbsp', text: '2 tbsp' } } }, []).converted).toBe(false);
        const energy = subset(example);
        energy.knownFacts[0].nutrients.calories = { value: 1000, unit: 'kJ' };
        expect(validateIngredientList(energy).list.knownFacts[0].nutrients.calories.unit).toBe('kcal');
    });

    it('keeps corrections off the frozen import', () => {
        const draft = importIngredientList(subset(example)).draft;
        const corrected = applyLineCorrection(draft, 'rice', { quantity: { basis: 'estimated' } }).draft;
        expect(corrected.import).toBe(draft.import);
        expect(draft.import.ingredients[0].quantity.basis).toBe('estimated');
        expect(effectiveLine(corrected, 'salsa').quantity.basis).toBe('measured');
        const stated = applyLineCorrection(draft, 'salsa', { quantity: { basis: 'estimated' } }).draft;
        expect(draft.import.ingredients[3].quantity.basis).toBe('measured');
        expect(isFreeQuantity(effectiveLine(stated, 'salsa'), stated.import.constraints)).toBe(false);
        expect(compoundGroups({ ingredients: [{ lineId: 'sauce', quantity: { g: 1, basis: 'measured' } }, { lineId: 'tomato', parentLineId: 'sauce' }] })).toEqual([{ parentLineId: 'sauce', childLineIds: ['tomato'] }]);
    });

    it('matches exact profiles, lists underspecified aliases, and does not auto-resolve raw/cooked or drained conflicts', async () => {
        const draft = importIngredientList(subset(example)).draft;
        const ref = { variantId: 'pv-rice', namespace: 'default-app-id', revision: 1, contentHash: `sha256:${'ab'.repeat(32)}` };
        const items = [{ canonicalName: 'white rice', dims: { state: 'cooked' }, ref, aliases: [{ kind: 'confirmed', text: 'white rice' }] }];
        const search = async () => ({ items });
        const exact = await reconcileImport(draft, { privateSearch: search, curatedSearch: async () => ({ items: [] }) });
        expect(exact.modelCalls).toBe(0);
        expect(exact.lines.find(line => line.lineId === 'rice')).toMatchObject({ outcome: 'exact', needsResearch: false, ref });
        items[0].dims = { state: 'raw' };
        const conflict = await reconcileImport(draft, { privateSearch: search, curatedSearch: async () => ({ items: [] }) });
        expect(conflict.lines.find(line => line.lineId === 'rice')).toMatchObject({ outcome: 'conflict', ref: null, needsConfirmation: true });
        expect(confirmMatch(conflict, 'rice', 'pv-rice').reason).toBe('conflict_not_auto_resolved');
        const chosen = confirmMatch(conflict, 'rice', 'pv-rice', { acknowledgeConflict: true });
        expect(chosen.result.lines.find(line => line.lineId === 'rice').aliasProposal.writes).toBe(false);
        const beans = { canonicalName: 'black beans', dims: { state: 'canned', drained: 'undrained' }, ref: { ...ref, variantId: 'pv-beans' }, aliases: [{ kind: 'confirmed', text: 'black beans' }] };
        const drained = await reconcileImport(draft, { privateSearch: async () => ({ items: [] }), curatedSearch: async () => ({ items: [beans] }) });
        expect(drained.lines.find(line => line.lineId === 'beans').outcome).toBe('conflict');
        const plainRice = structuredClone(items[0]);
        plainRice.dims = { state: 'cooked' };
        plainRice.aliases = [{ kind: 'candidate', text: 'white rice' }];
        const underspecified = await reconcileImport(importIngredientList({ ...subset(example), ingredients: subset(example).ingredients.map(line => line.lineId === 'rice' ? { ...line, variant: {} } : line) }).draft, {
            privateSearch: async () => ({ items: [plainRice] }), curatedSearch: async () => ({ items: [] }),
        });
        expect(underspecified.lines.find(line => line.lineId === 'rice')).toMatchObject({ outcome: 'underspecified', ref: null });
        const mixed = await reconcileImport(draft, { privateSearch: async () => ({ items: [plainRice, { ...plainRice, dims: { state: 'raw' }, ref: { ...ref, variantId: 'pv-raw' } }] }), curatedSearch: async () => ({ items: [] }) });
        expect(mixed.lines.find(line => line.lineId === 'rice')).toMatchObject({ outcome: 'ambiguous', needsResearch: false, ref: null });
        const aliased = { canonicalName: 'Beans, black, mature seeds', dims: { state: 'canned' }, ref: { ...ref, variantId: 'pv-beans' }, aliases: [{ kind: 'confirmed', text: 'black beans' }] };
        const aliasMatch = await reconcileImport(draft, { privateSearch: async () => ({ items: [aliased] }), curatedSearch: async () => ({ items: [] }) });
        expect(aliasMatch.lines.find(line => line.lineId === 'beans')).toMatchObject({ outcome: 'underspecified', needsResearch: false });
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
        await reconcileImport(draft, { privateSearch: async () => ({ items: [] }), curatedSearch: async () => ({ items: [] }) });
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('adapts recipes, saved meals, and legacy paste without inventing facts or scaling snapshots', () => {
        const recipe = fromRecipeStandardizerRecipe({
            name: 'Cookies',
            servings: { baselineServings: 24 },
            yield: { estimatedFinalWeightG: 1080, actualFinalWeightG: null },
            ingredients: [
                { id: 'ing-flour', displayName: 'all-purpose flour', quantityG: 300, prepNote: 'sifted', nutritionLink: { ingredientRef: { variantId: 'pv-flour' } } },
                { id: 'ing-salt', displayName: 'salt', quantityG: null, equivalent: '1 tsp' },
            ],
        });
        expect(recipe.ok, JSON.stringify(recipe.errors)).toBe(true);
        expect(recipe.draft.import.knownFacts).toBeUndefined();
        expect(recipe.draft.import.ingredients[0].quantity).toEqual({ g: 300, basis: 'recipe_stated' });
        expect(recipe.draft.import.ingredients[1].quantity.g).toBeNull();
        expect(recipe.draft.source.lineRefs['ing-flour'].variantId).toBe('pv-flour');
        expect(JSON.stringify(recipe.draft.import)).not.toContain('calories');
        const entry = { id: 'day-1', date: '2026-11-06', foodItems: [{ id: 'oats', name: 'oats', quantity: 2, calories: 150, protein: 5 }] };
        const meal = fromSavedMeal(entry);
        expect(meal.draft.source.snapshots.oats.nutrients).toEqual({ calories: 150, protein: 5 });
        expect(meal.draft.source.snapshots.oats.quantity).toBe(2);
        expect(meal.draft.import.knownFacts).toBeUndefined();
        expect(entry.foodItems[0].calories).toBe(150);
        const saved = fromSavedRecipe({ id: 'food-1', name: 'Oats', quantity: 2, calories: 150 });
        expect(saved.draft.source.snapshots.l1.nutrients.calories).toBe(150);
        const legacy = fromLegacyPaste('Calories: 165 kcal\nProtein: 10 g\nWeighted fiber: 4 g', { name: 'Bowl' });
        expect(legacy.ok, JSON.stringify(legacy.errors)).toBe(true);
        expect(legacy.draft.import.knownFacts).toBeUndefined();
        expect(legacy.draft.source.legacyRecord.values.calories).toBe(165);
        expect(JSON.stringify(legacy.draft.import)).not.toContain('fiberWeightedLegacy');
        expect(legacy.draft.modelCalls).toBe(MODEL_CALLS);
    });

    it('publishes versioned assistant instructions and makes no model calls from the module', async () => {
        const instructions = copyAssistantInstructions();
        expect(instructions.instructionsVersion).toBe(INSTRUCTIONS_VERSION);
        expect(example.producer.instructionsVersion).toBe(INSTRUCTIONS_VERSION);
        for (const phrase of ['6.5-inch', 'official_label', 'restaurant_published', 'manufacturer_site', 'user_measured', 'user_stated', 'exactly one fenced JSON block', 'NUTRITION-INGREDIENTS v1', 'research response v1', 'photo-only'])
            expect(instructions.text).toContain(phrase);
        const source = readdirSync(new URL('../../../shared/nutrition/import/', import.meta.url)).filter(name => name.endsWith('.js')).map(name => readFileSync(new URL(`../../../shared/nutrition/import/${name}`, import.meta.url), 'utf8')).join('\n');
        expect(source).not.toMatch(/from ['"].*research\//);
        expect(source).not.toContain('nutritionCalc');
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
        expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
        for (const name of ['ingredientList', 'pasteFormat', 'importDraft', 'inputAdapters', 'reconcile', 'assistantInstructions', 'index']) {
            const module = await import(`../../../shared/nutrition/import/${name}.js`);
            const declarations = readFileSync(new URL(`../../../shared/nutrition/import/${name}.d.ts`, import.meta.url), 'utf8');
            for (const key of Object.keys(module)) expect(declarations).toContain(key);
        }
    });
});
