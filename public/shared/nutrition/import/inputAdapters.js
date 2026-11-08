import { V2_KEYS } from '../nutrientRegistry.js';
import { parseNutritionText } from '../nutrientText.js';
import { IMPORT_LIMITS } from './ingredientList.js';
import { createImportDraft } from './importDraft.js';

const clean = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';
const usedId = (preferred, index, used) => {
    const cleaned = clean(preferred).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    let id = /^[a-z0-9_-]{1,24}$/.test(cleaned) && cleaned !== 'meal' ? cleaned : `l${index + 1}`;
    if (!used.has(id)) { used.add(id); return id; }
    for (let suffix = 2; suffix < 1000; suffix++) {
        const tail = `-${suffix}`;
        const next = `${id.slice(0, 24 - tail.length)}${tail}`;
        if (!used.has(next)) { used.add(next); return next; }
    }
    return `l${index + 1}`;
};

function snapshotOf(item) {
    const nutrients = {};
    for (const key of V2_KEYS) {
        if (Object.prototype.hasOwnProperty.call(item, key)) nutrients[key] = item[key];
    }
    return {
        foodId: item?.id ?? null,
        name: item?.name ?? null,
        quantity: item?.quantity ?? null,
        timestamp: item?.timestamp ?? null,
        nutrients,
        nutrientSchemaVersion: item?.nutrientSchemaVersion ?? null,
        nutrientMeta: item?.nutrientMeta ? structuredClone(item.nutrientMeta) : null,
    };
}

function trackerQuantity(amount) {
    const value = typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 ? amount : 1;
    return { g: null, basis: 'label', original: { amount: value, unit: 'tracker_unit', text: 'diary quantity' } };
}

/**
 * Recipe Standardizer recipe → ingredient-list v1.
 * Gram quantities stay recipe-stated. Nutrient totals are not copied or recalculated.
 */
export function fromRecipeStandardizerRecipe(recipe, meta = {}) {
    const ingredients = recipe?.ingredients;
    if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > IMPORT_LIMITS.ingredients)
        return { ok: false, errors: [{ path: '$.ingredients', message: 'expected 1 to 100 recipe ingredients' }] };
    const count = [recipe.servings?.baselineServings, recipe.servings?.portionCount].find(value => typeof value === 'number' && value > 0);
    const title = clean(recipe.name);
    if (!count || !title || title.length > IMPORT_LIMITS.title)
        return { ok: false, errors: [{ path: '$.meal', message: 'recipe needs a title and a positive serving count' }] };
    const used = new Set();
    const lines = [];
    const assumptions = [];
    const lineRefs = {};
    const errors = [];
    ingredients.forEach((item, index) => {
        const lineId = usedId(item?.id, index, used);
        const name = clean(item?.displayName);
        if (!name || name.length > IMPORT_LIMITS.name) {
            errors.push({ path: `$.ingredients[${index}].name`, message: 'invalid ingredient name' });
            return;
        }
        let quantity;
        if (typeof item.quantityG === 'number' && Number.isFinite(item.quantityG) && item.quantityG >= 0 && item.quantityG <= IMPORT_LIMITS.grams)
            quantity = { g: item.quantityG, basis: 'recipe_stated' };
        else if (item.quantityG == null) {
            const equivalent = clean(item.equivalent).slice(0, IMPORT_LIMITS.originalText) || 'unknown weight';
            quantity = { g: null, basis: 'estimated', original: { amount: 1, unit: 'unconverted', text: equivalent } };
        } else {
            errors.push({ path: `$.ingredients[${index}].quantity`, message: 'invalid gram quantity' });
            return;
        }
        lines.push({ lineId, name, quantity });
        for (const note of [item.prepNote, item.substitutionNotes]) {
            const noteText = clean(note);
            if (!noteText) continue;
            if (noteText.length > IMPORT_LIMITS.text) {
                errors.push({ path: `$.ingredients[${index}].notes`, message: 'note exceeds 300 characters' });
                continue;
            }
            const id = `a${assumptions.length + 1}`;
            assumptions.push({ id, text: noteText, appliesTo: [lineId] });
        }
        if (item.nutritionLink?.ingredientRef) lineRefs[lineId] = structuredClone(item.nutritionLink.ingredientRef);
    });
    if (errors.length) return { ok: false, errors };
    const meal = { title, kind: 'batch_recipe', servings: { count } };
    if (typeof recipe.yield?.actualFinalWeightG === 'number' && recipe.yield.actualFinalWeightG > 0)
        meal.finalWeight = { g: recipe.yield.actualFinalWeightG, basis: 'measured' };
    else if (typeof recipe.yield?.estimatedFinalWeightG === 'number' && recipe.yield.estimatedFinalWeightG > 0)
        meal.finalWeight = { g: recipe.yield.estimatedFinalWeightG, basis: 'estimated' };
    const list = { kind: 'nutrition.ingredientList', schemaVersion: 1, meal, ingredients: lines, ...(assumptions.length ? { assumptions } : {}) };
    const draft = createImportDraft(list, { kind: 'recipe_standardizer', recipeId: meta.savedId ?? recipe.id ?? null, lineRefs, modelCalls: 0 });
    return draft.ok ? draft : draft;
}

/** Diary foods keep their stored per-unit snapshot. Quantity is not multiplied back into those numbers. */
export function fromSavedMeal(entry) {
    const foods = entry?.foodItems;
    if (!Array.isArray(foods) || foods.length < 1 || foods.length > IMPORT_LIMITS.ingredients)
        return { ok: false, errors: [{ path: '$.foodItems', message: 'expected 1 to 100 saved foods' }] };
    const used = new Set();
    const snapshots = {};
    const ingredients = [];
    for (const [index, item] of foods.entries()) {
        const name = clean(item?.name);
        if (!name || name.length > IMPORT_LIMITS.name) return { ok: false, errors: [{ path: `$.foodItems[${index}].name`, message: 'invalid food name' }] };
        const lineId = usedId(item?.id, index, used);
        snapshots[lineId] = snapshotOf(item);
        ingredients.push({ lineId, name, quantity: trackerQuantity(item?.quantity) });
    }
    const title = clean(entry.title || entry.date || 'Saved meal').slice(0, IMPORT_LIMITS.title);
    const list = { kind: 'nutrition.ingredientList', schemaVersion: 1, meal: { title, kind: 'single_portion', servings: { count: 1, consumed: 1 } }, ingredients };
    return createImportDraft(list, { kind: 'saved_meal', entryId: entry.id ?? null, snapshots, modelCalls: 0 });
}

function fromTrackerFood(food) {
    const name = clean(food.name);
    if (!name || name.length > IMPORT_LIMITS.name) return { ok: false, errors: [{ path: '$.name', message: 'invalid food name' }] };
    const list = {
        kind: 'nutrition.ingredientList',
        schemaVersion: 1,
        meal: { title: name, kind: 'packaged_food', servings: { count: 1 } },
        ingredients: [{ lineId: 'l1', name, quantity: trackerQuantity(food.quantity) }],
    };
    return createImportDraft(list, { kind: 'saved_recipe', foodId: food.id ?? null, snapshots: { l1: snapshotOf(food) }, modelCalls: 0 });
}

/** A saved recipe document, a Recipe Standardizer recipe, or one tracker food. */
export function fromSavedRecipe(doc) {
    if (doc?.recipe?.ingredients) return fromRecipeStandardizerRecipe(doc.recipe, { savedId: doc.id ?? null });
    if (Array.isArray(doc?.ingredients) && doc.ingredients.some(item => item && Object.prototype.hasOwnProperty.call(item, 'displayName')))
        return fromRecipeStandardizerRecipe(doc, { savedId: doc.id ?? null });
    if (doc && typeof doc.name === 'string' && V2_KEYS.some(key => Object.prototype.hasOwnProperty.call(doc, key))) return fromTrackerFood(doc);
    return { ok: false, errors: [{ path: '$', message: 'unrecognized saved recipe' }] };
}

/**
 * Legacy 24-field paste stays on the draft source. Those numbers are not known facts:
 * the legacy block has no provenance the import contract accepts.
 */
export function fromLegacyPaste(text, options = {}) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: [{ path: '$', message: 'expected legacy paste text' }] };
    const name = clean(options.name) || 'Legacy paste';
    if (name.length > IMPORT_LIMITS.name) return { ok: false, errors: [{ path: '$.name', message: 'invalid name' }] };
    const amount = typeof options.quantity === 'number' && Number.isFinite(options.quantity) && options.quantity > 0 ? options.quantity : 1;
    const record = parseNutritionText(text);
    const list = {
        kind: 'nutrition.ingredientList',
        schemaVersion: 1,
        meal: { title: name, kind: 'packaged_food', servings: { count: 1 } },
        ingredients: [{ lineId: 'l1', name, quantity: { g: null, basis: 'estimated', original: { amount, unit: 'tracker_unit', text: 'legacy paste quantity' } } }],
    };
    return createImportDraft(list, { kind: 'legacy_paste', legacyRecord: record, modelCalls: 0 });
}
