import { toGrams } from '../ingredientConversion.js';
import { normalizeVariantDims, VARIANT_ENUMS } from '../ingredientVariants.js';
import { convertUnit, getNutrient, lookupLabel, NUTRIENT_REGISTRY_VERSION } from '../nutrientRegistry.js';
import { parseFormWords, PREPARATION_TERMS, STATE_SLUGS } from '../variantVocabulary.js';

/** Ingredient-list import v1. Parsing never calls a model, writes a store, or totals nutrients. */
export const IMPORT_SCHEMA_VERSION = 1;
export const INGREDIENT_LIST_KIND = 'nutrition.ingredientList';
export const MODEL_CALLS = 0;
export const IMPORT_LIMITS = Object.freeze({
    bytes: 200_000,
    ingredients: 100,
    facts: 10,
    constraints: 50,
    assumptions: 30,
    inputs: 20,
    nutrients: 80,
    text: 300,
    title: 120,
    name: 120,
    originalText: 60,
    statement: 2000,
    grams: 1_000_000,
});
export const ASSISTANTS = Object.freeze(['chatgpt', 'claude', 'grok', 'codex', 'gemini', 'other']);
export const INPUT_KINDS = Object.freeze(['photo', 'recipe_text', 'description', 'nutrition_label', 'menu', 'other']);
export const MEAL_KINDS = Object.freeze(['single_portion', 'batch_recipe', 'packaged_food', 'restaurant_item']);
export const LINE_KINDS = Object.freeze(['generic', 'branded', 'additive', 'compound']);
export const QUANTITY_BASES = Object.freeze(['measured', 'label', 'recipe_stated', 'estimated']);
export const ROLES = Object.freeze(['main', 'cooking_fat', 'sauce', 'seasoning', 'garnish', 'beverage', 'other']);
export const CONFIDENCE = Object.freeze(['low', 'medium', 'high']);
export const PROVENANCES = Object.freeze(['official_label', 'restaurant_published', 'manufacturer_site', 'user_measured', 'user_stated']);
export const OFFICIAL_PROVENANCES = Object.freeze(['official_label', 'restaurant_published', 'manufacturer_site']);
export const ROUNDING = Object.freeze(['fda_label', 'exact', 'unknown']);
export const QUALIFIERS = Object.freeze(['less_than']);
const ID_RE = /^[a-z0-9_-]{1,24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/;
const FORBIDDEN = /\bdata:[^\s]+|\bbase64\b|\bblob:|<img\b/i;
const DERIVED_FACT_KEYS = new Set(['fiberWeightedLegacy']);
const SWEETENING = new Set(['unspecified', 'sweetened', 'unsweetened']);

const bytes = value => new TextEncoder().encode(value).length;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const num = value => typeof value === 'number' && Number.isFinite(value);
const gram = value => num(value) && value >= 0 && value <= IMPORT_LIMITS.grams;
const MAX_NESTING = 32;
const freeze = value => {
    const seen = [];
    const stack = [value];
    while (stack.length) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || Object.isFrozen(current) || seen.includes(current)) continue;
        seen.push(current);
        for (const child of Object.values(current)) stack.push(child);
    }
    for (const item of seen) Object.freeze(item);
    return value;
};
const word = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-') : '';

function rejectPayload(root, fail) {
    const stack = [{ value: root, path: '$', depth: 1 }];
    while (stack.length) {
        const { value, path, depth } = stack.pop();
        if (depth > MAX_NESTING) {
            fail(path, 'nesting exceeds the limit');
            return;
        }
        if (typeof value === 'string') {
            if (FORBIDDEN.test(value)) fail(path, 'images and base64 are not accepted');
            continue;
        }
        if (Array.isArray(value)) {
            value.forEach((item, index) => stack.push({ value: item, path: `${path}[${index}]`, depth: depth + 1 }));
            continue;
        }
        if (!plain(value)) continue;
        for (const [key, item] of Object.entries(value)) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype' || FORBIDDEN.test(key) || /^(?:image|images|photo|photos|attachment|attachments|dataUri|dataUrl)$/i.test(key))
                fail(`${path}.${key}`, 'images and base64 are not accepted');
            stack.push({ value: item, path: `${path}.${key}`, depth: depth + 1 });
        }
    }
}

function allow(value, path, keys, fail) {
    if (!plain(value)) {
        fail(path, 'expected object');
        return false;
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown field');
    }
    return true;
}

function textValue(value, path, max, fail, required = false) {
    if (value == null || value === '') {
        if (required) fail(path, 'required');
        return null;
    }
    if (typeof value !== 'string') {
        fail(path, 'expected text');
        return null;
    }
    const text = value.normalize('NFKC').trim();
    if (!text) {
        if (required) fail(path, 'required');
        return null;
    }
    if (text.length > max) fail(path, `text exceeds ${max} characters`);
    return text;
}

function vocabToken(value, names, kind) {
    if (typeof value === 'string' && names.includes(value.normalize('NFKC').trim())) return value.normalize('NFKC').trim();
    const token = word(value);
    if (!token) return null;
    if (token === 'unspecified' || names.includes(token)) return token;
    let parsed;
    try { parsed = parseFormWords([String(value)]); }
    catch { return null; }
    if (parsed.unknownWords.length) return null;
    const keys = Object.keys(parsed.dims);
    if (keys.length === 1 && keys[0] === kind) return parsed.dims[kind];
    return null;
}

function canonicalQuantity(value, path, fail) {
    if (!allow(value, path, ['g', 'gMin', 'gMax', 'basis', 'original'], fail)) return null;
    if (!QUANTITY_BASES.includes(value.basis)) fail(`${path}.basis`, 'invalid basis');
    if (!('g' in value)) fail(`${path}.g`, 'required');
    else if (value.g !== null && !gram(value.g)) fail(`${path}.g`, 'grams must be a finite number or null');
    for (const bound of ['gMin', 'gMax']) {
        if (value[bound] != null && !gram(value[bound])) fail(`${path}.${bound}`, 'invalid gram bound');
    }
    const g = value.g ?? null;
    const gMin = value.gMin ?? null;
    const gMax = value.gMax ?? null;
    if (gMin != null && g != null && gMin > g) fail(path, 'expected gMin ≤ g ≤ gMax');
    if (gMax != null && g != null && g > gMax) fail(path, 'expected gMin ≤ g ≤ gMax');
    if (gMin != null && gMax != null && gMin > gMax) fail(path, 'expected gMin ≤ g ≤ gMax');
    let original = null;
    if (value.original != null) {
        if (!allow(value.original, `${path}.original`, ['amount', 'unit', 'text'], fail)) return null;
        if (!num(value.original.amount) || value.original.amount < 0) fail(`${path}.original.amount`, 'invalid amount');
        const unit = textValue(value.original.unit, `${path}.original.unit`, IMPORT_LIMITS.originalText, fail, true);
        const text = textValue(value.original.text, `${path}.original.text`, IMPORT_LIMITS.originalText, fail);
        if (unit) original = { amount: value.original.amount, unit, ...(text ? { text } : {}) };
    } else if (g == null) fail(`${path}.original`, 'required when grams are null');
    if (!QUANTITY_BASES.includes(value.basis) || (g !== null && !gram(g))) return null;
    return { g, ...(gMin != null ? { gMin } : {}), ...(gMax != null ? { gMax } : {}), basis: value.basis, ...(original ? { original } : {}) };
}

function canonicalVariant(value, path, fail) {
    if (value == null) return {};
    if (!allow(value, path, ['state', 'preparation', 'drained', 'salt', 'fortification', 'fortificationDetail', 'sweetening', 'fatPercent', 'leanPercent', 'ediblePortion', 'brand'], fail))
        return {};
    const out = {};
    const take = (key, token) => {
        if (value[key] == null) return;
        if (!token) fail(`${path}.${key}`, 'unknown vocabulary value');
        else if (token !== 'unspecified') out[key] = token;
    };
    if ('state' in value) take('state', vocabToken(value.state, STATE_SLUGS, 'state'));
    if ('preparation' in value) take('preparation', vocabToken(value.preparation, PREPARATION_TERMS, 'preparation'));
    for (const key of ['drained', 'salt', 'fortification']) {
        if (key in value) take(key, vocabToken(value[key], VARIANT_ENUMS[key], key));
    }
    if ('sweetening' in value) {
        const token = word(value.sweetening);
        if (!SWEETENING.has(token)) fail(`${path}.sweetening`, 'unknown vocabulary value');
        else if (token !== 'unspecified') out.sweetening = token;
    }
    for (const key of ['fatPercent', 'leanPercent']) {
        if (value[key] != null) {
            if (!num(value[key]) || value[key] < 0 || value[key] > 100) fail(`${path}.${key}`, 'expected a percent from 0 to 100');
            else out[key] = value[key];
        }
    }
    const detail = textValue(value.fortificationDetail, `${path}.fortificationDetail`, IMPORT_LIMITS.text, fail);
    const portion = textValue(value.ediblePortion, `${path}.ediblePortion`, IMPORT_LIMITS.text, fail);
    if (detail) out.fortificationDetail = detail;
    if (portion) out.ediblePortion = portion;
    if (value.brand != null) {
        if (!allow(value.brand, `${path}.brand`, ['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote'], fail)) return out;
        const brand = {};
        for (const key of ['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote']) {
            const item = textValue(value.brand[key], `${path}.brand.${key}`, IMPORT_LIMITS.text, fail);
            if (item) brand[key] = item;
        }
        if (Object.keys(brand).length) out.brand = brand;
    }
    return out;
}

function canonicalNutrients(value, path, fail) {
    if (!plain(value) || !Object.keys(value).length) {
        fail(path, 'expected nutrient facts');
        return {};
    }
    if (Object.keys(value).length > IMPORT_LIMITS.nutrients) fail(path, 'too many nutrients');
    const out = {};
    for (const [raw, observation] of Object.entries(value)) {
        const key = getNutrient(raw) ? raw : lookupLabel(raw)?.key;
        const itemPath = `${path}.${raw}`;
        if (!key) {
            fail(itemPath, 'unknown nutrient');
            continue;
        }
        if (DERIVED_FACT_KEYS.has(key)) {
            fail(itemPath, 'derived metric is computed by the calculation module and is not an importable fact');
            continue;
        }
        if (out[key]) fail(itemPath, 'duplicate nutrient');
        if (!allow(observation, itemPath, ['value', 'unit', 'rounding', 'qualifier'], fail)) continue;
        if (!num(observation.value) || observation.value < 0) fail(`${itemPath}.value`, 'expected a finite nonnegative number');
        const unit = textValue(observation.unit, `${itemPath}.unit`, 40, fail, true);
        if (!unit || !num(observation.value)) continue;
        const converted = convertUnit(key, observation.value, unit);
        if (converted.error) fail(`${itemPath}.unit`, 'nutrient unit does not convert through the registry');
        else {
            const stored = { value: converted.value, unit: converted.unit };
            if (observation.rounding != null) {
                if (!ROUNDING.includes(observation.rounding)) fail(`${itemPath}.rounding`, 'invalid rounding');
                else stored.rounding = observation.rounding;
            }
            if (observation.qualifier != null) {
                if (!QUALIFIERS.includes(observation.qualifier)) fail(`${itemPath}.qualifier`, 'invalid qualifier');
                else stored.qualifier = observation.qualifier;
            }
            out[key] = stored;
        }
    }
    return out;
}

function factUse(fact) {
    if (fact.appliesTo?.scope === 'line') return 'research_evidence';
    if (fact.appliesTo?.scope === 'serving') {
        const servings = fact.basis?.servings;
        const weight = fact.basis?.servingWeight?.g;
        return (num(servings) && servings > 0) || (num(weight) && weight > 0) ? 'fit_target' : 'unapplied';
    }
    return 'fit_target';
}

function point(line) {
    return line?.quantity?.g ?? null;
}
function low(line) {
    return line?.quantity?.gMin ?? line?.quantity?.g ?? null;
}
function high(line) {
    return line?.quantity?.gMax ?? line?.quantity?.g ?? null;
}
function fixedLine(line, constraints) {
    return line.quantity.basis !== 'estimated' || constraints.some(item => item.type === 'fixed' && item.lineIds.includes(line.lineId));
}

function checkConstraints(lines, constraints, fail, warn) {
    const byId = new Map(lines.map(line => [line.lineId, line]));
    constraints.forEach((constraint, index) => {
        const path = `$.constraints[${index}]`;
        const ids = constraint.lineIds ?? [constraint.num, constraint.den].filter(Boolean);
        if (ids.some(id => !byId.has(id))) fail(path, 'unknown line');
        const rows = (constraint.lineIds ?? []).map(id => byId.get(id)).filter(Boolean);
        if (constraint.type === 'order' && rows.length >= 2) {
            for (let i = 0; i < rows.length - 1; i++) {
                const left = rows[i], right = rows[i + 1];
                if (fixedLine(left, constraints) && fixedLine(right, constraints) && point(left) != null && point(right) != null && point(left) < point(right))
                    fail(path, `fixed lines already violate order: ${left.lineId}, ${right.lineId}`);
                else if (high(left) != null && low(right) != null && high(left) < low(right))
                    warn(path, `order is infeasible for ${left.lineId}, ${right.lineId}`);
            }
        }
        if (constraint.type === 'ratio') {
            const left = byId.get(constraint.num), right = byId.get(constraint.den);
            if (!left || !right) return;
            if (fixedLine(left, constraints) && fixedLine(right, constraints) && point(right) === 0)
                fail(path, `fixed lines already violate ratio: ${left.lineId}, ${right.lineId}`);
            else if (fixedLine(left, constraints) && fixedLine(right, constraints) && point(left) != null && point(right) > 0) {
                const ratio = point(left) / point(right);
                if (ratio < constraint.min || ratio > constraint.max) fail(path, `fixed lines already violate ratio: ${left.lineId}, ${right.lineId}`);
            } else if ([low(left), high(left), low(right), high(right)].every(item => item != null) && high(right) > 0) {
                const minRatio = low(right) > 0 ? low(left) / high(right) : 0;
                const maxRatio = low(right) > 0 ? high(left) / low(right) : Infinity;
                if (maxRatio < constraint.min || minRatio > constraint.max) warn(path, `ratio is infeasible for ${left.lineId}, ${right.lineId}`);
            }
        }
        if (constraint.type === 'sum' && rows.length) {
            const fixed = rows.filter(line => fixedLine(line, constraints));
            const fixedPoints = fixed.map(point);
            if (fixedPoints.every(item => item != null) && fixedPoints.reduce((sum, item) => sum + item, 0) > constraint.gMax)
                fail(path, `fixed lines already violate sum: ${fixed.map(line => line.lineId).join(', ')}`);
            else if (rows.every(line => fixedLine(line, constraints)) && rows.every(line => point(line) != null)) {
                const sum = rows.reduce((total, line) => total + point(line), 0);
                if (sum < constraint.gMin || sum > constraint.gMax) fail(path, `fixed lines already violate sum: ${rows.map(line => line.lineId).join(', ')}`);
            } else if (rows.every(line => low(line) != null && high(line) != null)) {
                const minSum = rows.reduce((total, line) => total + low(line), 0);
                const maxSum = rows.reduce((total, line) => total + high(line), 0);
                if (maxSum < constraint.gMin || minSum > constraint.gMax) warn(path, `sum is infeasible for ${rows.map(line => line.lineId).join(', ')}`);
            }
        }
        if (constraint.type === 'tail_max_percent') {
            const tops = lines.filter(line => !line.parentLineId);
            const fraction = constraint.maxPercent / 100;
            const fixedTotal = tops.every(line => fixedLine(line, constraints) && point(line) != null) && rows.every(line => fixedLine(line, constraints) && point(line) != null);
            if (fixedTotal) {
                const total = tops.reduce((sum, line) => sum + point(line), 0);
                for (const line of rows) {
                    if (point(line) > total * fraction) fail(path, `fixed lines already violate tail percent: ${line.lineId}`);
                }
            } else if (tops.every(line => high(line) != null) && rows.every(line => low(line) != null)) {
                const total = tops.reduce((sum, line) => sum + high(line), 0);
                for (const line of rows) {
                    if (low(line) > total * fraction) warn(path, `tail percent is infeasible for ${line.lineId}`);
                }
            }
        }
    });
}

function extractJson(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try { return { value: JSON.parse(trimmed) }; }
        catch { return { error: 'strict JSON required' }; }
    }
    const fences = [...trimmed.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
    if (fences.length !== 1) return { error: 'exactly one fenced JSON block required' };
    const label = fences[0][1].trim().toLowerCase();
    if (label && label !== 'json') return { error: 'exactly one fenced JSON block required' };
    try { return { value: JSON.parse(fences[0][2].trim()) }; }
    catch { return { error: 'fenced block is not strict JSON' }; }
}

/**
 * Strict ingredient-list v1 validation.
 * The input is never mutated. `extensions` is ignored. Newer schemaVersion fails closed.
 */
export function validateIngredientList(input) {
    const errors = [];
    const warnings = [];
    const fail = (path, message) => errors.push({ path, message });
    const warn = (path, message, code = 'infeasible') => warnings.push({ path, message, code, level: 'warning' });
    if (typeof input === 'string') {
        if (bytes(input) > IMPORT_LIMITS.bytes) return { ok: false, errors: [{ path: '$', message: 'import exceeds the size limit' }], warnings };
        if (/^\s*NUTRITION-INGREDIENTS\b/.test(input)) return { ok: false, errors: [{ path: '$', message: 'paste format must be parsed by parseIngredientPaste' }], warnings };
        const extracted = extractJson(input);
        if (extracted.error) return { ok: false, errors: [{ path: '$', message: extracted.error }], warnings };
        input = extracted.value;
    }
    if (!plain(input)) return { ok: false, errors: [{ path: '$', message: 'expected object' }], warnings };
    let encoded;
    try { encoded = JSON.stringify(input); }
    catch (error) {
        if (error instanceof RangeError) return { ok: false, errors: [{ path: '$', message: 'nesting exceeds the limit' }], warnings };
        throw error;
    }
    if (bytes(encoded) > IMPORT_LIMITS.bytes) return { ok: false, errors: [{ path: '$', message: 'import exceeds the size limit' }], warnings };
    let source;
    try { source = structuredClone(input); }
    catch (error) {
        if (error instanceof RangeError) return { ok: false, errors: [{ path: '$', message: 'nesting exceeds the limit' }], warnings };
        throw error;
    }
    rejectPayload(source, fail);
    if (typeof source.schemaVersion === 'number' && source.schemaVersion > IMPORT_SCHEMA_VERSION)
        return { ok: false, errors: [{ path: '$.schemaVersion', message: 'site update required' }], warnings };
    if (source.schemaVersion !== IMPORT_SCHEMA_VERSION) fail('$.schemaVersion', 'unsupported schemaVersion');
    if (source.kind !== INGREDIENT_LIST_KIND) fail('$.kind', 'expected nutrition.ingredientList');
    allow(source, '$', ['kind', 'schemaVersion', 'registryVersion', 'producer', 'inputs', 'meal', 'ingredients', 'knownFacts', 'constraints', 'assumptions', 'overallConfidence', 'extensions'], fail);
    if (source.extensions != null && !plain(source.extensions)) fail('$.extensions', 'expected object');
    if (errors.some(error => error.message === 'images and base64 are not accepted' || error.message === 'nesting exceeds the limit' || error.path === '$.schemaVersion'))
        return { ok: false, errors, warnings };

    const list = { kind: INGREDIENT_LIST_KIND, schemaVersion: IMPORT_SCHEMA_VERSION };
    if (plain(source.extensions)) list.extensions = source.extensions;
    if (source.producer != null) {
        if (allow(source.producer, '$.producer', ['assistant', 'label', 'instructionsVersion'], fail) && ASSISTANTS.includes(source.producer.assistant)) {
            const label = textValue(source.producer.label, '$.producer.label', IMPORT_LIMITS.text, fail);
            const version = source.producer.instructionsVersion;
            if (version != null && (!Number.isInteger(version) || version < 1)) fail('$.producer.instructionsVersion', 'expected a positive integer');
            list.producer = { assistant: source.producer.assistant, ...(label ? { label } : {}), ...(Number.isInteger(version) ? { instructionsVersion: version } : {}) };
        } else fail('$.producer.assistant', 'unknown assistant');
    }
    if (source.inputs != null) {
        if (!Array.isArray(source.inputs) || source.inputs.length > IMPORT_LIMITS.inputs || source.inputs.some(item => !INPUT_KINDS.includes(item)))
            fail('$.inputs', 'unknown input kind');
        else list.inputs = [...source.inputs];
    }
    if (!allow(source.meal, '$.meal', ['title', 'kind', 'servings', 'servingWeight', 'finalWeight', 'yield'], fail))
        return { ok: false, errors, warnings };
    const title = textValue(source.meal.title, '$.meal.title', IMPORT_LIMITS.title, fail, true);
    if (!MEAL_KINDS.includes(source.meal.kind)) fail('$.meal.kind', 'invalid meal kind');
    if (!allow(source.meal.servings, '$.meal.servings', ['count', 'consumed'], fail)) return { ok: false, errors, warnings };
    if (!num(source.meal.servings.count) || source.meal.servings.count <= 0) fail('$.meal.servings.count', 'expected a count greater than 0');
    if (source.meal.servings.consumed != null && (!num(source.meal.servings.consumed) || source.meal.servings.consumed <= 0))
        fail('$.meal.servings.consumed', 'expected a count greater than 0');
    list.meal = {
        title: title ?? '',
        kind: source.meal.kind,
        servings: { count: source.meal.servings.count, ...(source.meal.servings.consumed != null ? { consumed: source.meal.servings.consumed } : {}) },
    };
    for (const key of ['servingWeight', 'finalWeight']) {
        if (source.meal[key] != null) {
            const quantity = canonicalQuantity(source.meal[key], `$.meal.${key}`, fail);
            if (quantity) list.meal[key] = quantity;
        }
    }
    if (source.meal.yield != null) {
        if (allow(source.meal.yield, '$.meal.yield', ['rawTotal', 'cookedTotal'], fail)) {
            const yieldValue = {};
            for (const key of ['rawTotal', 'cookedTotal']) {
                if (source.meal.yield[key] != null) {
                    const quantity = canonicalQuantity(source.meal.yield[key], `$.meal.yield.${key}`, fail);
                    if (quantity) yieldValue[key] = quantity;
                }
            }
            if (Object.keys(yieldValue).length) list.meal.yield = yieldValue;
        }
    }

    if (!Array.isArray(source.ingredients) || source.ingredients.length < 1 || source.ingredients.length > IMPORT_LIMITS.ingredients)
        fail('$.ingredients', `expected 1 to ${IMPORT_LIMITS.ingredients} ingredients`);
    const ingredients = [];
    const seen = new Set();
    for (const [index, raw] of (Array.isArray(source.ingredients) ? source.ingredients : []).entries()) {
        const path = `$.ingredients[${index}]`;
        if (!allow(raw, path, ['lineId', 'name', 'kind', 'variant', 'quantity', 'role', 'parentLineId', 'order', 'confidence', 'notes', 'assumptionIds', 'yield', 'waterDeltaG', 'fatAbsorbedG', 'fatDiscardedG', 'fatAbsorbedExternal', 'yieldRetention'], fail)) continue;
        if (typeof raw.lineId !== 'string' || !ID_RE.test(raw.lineId) || raw.lineId === 'meal') fail(`${path}.lineId`, 'invalid line id');
        else if (seen.has(raw.lineId)) fail(`${path}.lineId`, 'duplicate line id');
        seen.add(raw.lineId);
        const name = textValue(raw.name, `${path}.name`, IMPORT_LIMITS.name, fail, true);
        const line = { lineId: raw.lineId, name: name ?? '' };
        if (raw.kind != null) {
            if (!LINE_KINDS.includes(raw.kind)) fail(`${path}.kind`, 'invalid kind');
            else line.kind = raw.kind;
        }
        if (raw.variant != null) {
            const variant = canonicalVariant(raw.variant, `${path}.variant`, fail);
            if (Object.keys(variant).length) line.variant = variant;
            else line.variant = {};
        }
        const quantity = canonicalQuantity(raw.quantity, `${path}.quantity`, fail);
        if (quantity) line.quantity = quantity;
        if (raw.role != null) {
            if (!ROLES.includes(raw.role)) fail(`${path}.role`, 'invalid role');
            else line.role = raw.role;
        }
        if (raw.parentLineId != null) {
            if (typeof raw.parentLineId !== 'string' || !ID_RE.test(raw.parentLineId)) fail(`${path}.parentLineId`, 'invalid line id');
            else line.parentLineId = raw.parentLineId;
        }
        if (raw.order != null && allow(raw.order, `${path}.order`, ['group', 'position', 'tail'], fail)) {
            const order = {};
            const group = textValue(raw.order.group, `${path}.order.group`, IMPORT_LIMITS.text, fail);
            if (group) order.group = group;
            if (raw.order.position != null) {
                if (!Number.isInteger(raw.order.position) || raw.order.position < 1) fail(`${path}.order.position`, 'expected a positive integer');
                else order.position = raw.order.position;
            }
            if (raw.order.tail != null) {
                if (typeof raw.order.tail !== 'boolean') fail(`${path}.order.tail`, 'expected true or false');
                else order.tail = raw.order.tail;
            }
            if (Object.keys(order).length) line.order = order;
        }
        if (raw.confidence != null && allow(raw.confidence, `${path}.confidence`, ['identity', 'quantity'], fail)) {
            const confidence = {};
            for (const key of ['identity', 'quantity']) {
                if (raw.confidence[key] != null) {
                    if (!CONFIDENCE.includes(raw.confidence[key])) fail(`${path}.confidence.${key}`, 'invalid confidence');
                    else confidence[key] = raw.confidence[key];
                }
            }
            if (Object.keys(confidence).length) line.confidence = confidence;
        }
        const notes = textValue(raw.notes, `${path}.notes`, IMPORT_LIMITS.text, fail);
        if (notes) line.notes = notes;
        if (raw.assumptionIds != null) {
            if (!Array.isArray(raw.assumptionIds) || raw.assumptionIds.some(id => typeof id !== 'string' || !ID_RE.test(id))) fail(`${path}.assumptionIds`, 'invalid assumption id');
            else line.assumptionIds = [...raw.assumptionIds];
        }
        const yieldSource = raw.yield && typeof raw.yield === 'object' ? raw.yield : raw;
        const yieldPath = raw.yield ? `${path}.yield` : path;
        if (raw.yield != null && !allow(raw.yield, `${path}.yield`, ['waterDeltaG', 'fatAbsorbedG', 'fatDiscardedG', 'fatAbsorbedExternal', 'nutrientRetention'], fail)) {
            /* the field errors are already recorded */
        } else {
            const water = yieldSource.waterDeltaG ?? raw.waterDeltaG;
            if (water != null) {
                if (typeof water !== 'number' || !Number.isFinite(water)) fail(`${yieldPath}.waterDeltaG`, 'expected a finite number');
                else line.waterDeltaG = water;
            }
            for (const key of ['fatAbsorbedG', 'fatDiscardedG']) {
                const value = yieldSource[key] ?? raw[key];
                if (value == null) continue;
                if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${yieldPath}.${key}`, 'expected a non-negative number');
                else line[key] = value;
            }
            const external = yieldSource.fatAbsorbedExternal ?? raw.fatAbsorbedExternal;
            if (external != null) {
                if (typeof external !== 'boolean') fail(`${yieldPath}.fatAbsorbedExternal`, 'expected true or false');
                else line.fatAbsorbedExternal = external;
            }
            const retention = yieldSource.nutrientRetention ?? raw.yieldRetention;
            if (retention != null) {
                if (typeof retention !== 'number' || !Number.isFinite(retention) || retention < 0) fail(`${yieldPath}.nutrientRetention`, 'expected a non-negative number');
                else line.yieldRetention = retention;
            }
        }
        ingredients.push(line);
    }
    list.ingredients = ingredients;
    for (const line of ingredients) {
        if (!line.parentLineId) continue;
        if (!seen.has(line.parentLineId)) fail(`$.ingredients.${line.lineId}.parentLineId`, 'unknown parent line');
    }
    const visiting = new Set(), visited = new Set();
    const cycle = id => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        const parent = ingredients.find(line => line.lineId === id)?.parentLineId;
        const found = parent ? cycle(parent) : false;
        visiting.delete(id);
        visited.add(id);
        return found;
    };
    if (ingredients.some(line => cycle(line.lineId))) fail('$.ingredients', 'compound ingredients form a cycle');

    const facts = [];
    const factUses = {};
    if (source.knownFacts != null && (!Array.isArray(source.knownFacts) || source.knownFacts.length > IMPORT_LIMITS.facts))
        fail('$.knownFacts', `expected at most ${IMPORT_LIMITS.facts} facts`);
    const factIds = new Set();
    for (const [index, raw] of (Array.isArray(source.knownFacts) ? source.knownFacts : []).entries()) {
        const path = `$.knownFacts[${index}]`;
        if (!allow(raw, path, ['factId', 'provenance', 'source', 'appliesTo', 'basis', 'nutrients', 'ingredientStatement'], fail)) continue;
        if (typeof raw.factId !== 'string' || !ID_RE.test(raw.factId) || raw.factId === 'meal') fail(`${path}.factId`, 'invalid fact id');
        else if (factIds.has(raw.factId) || seen.has(raw.factId)) fail(`${path}.factId`, 'duplicate fact id');
        factIds.add(raw.factId);
        if (!PROVENANCES.includes(raw.provenance)) {
            fail(`${path}.provenance`, 'facts need real provenance');
            continue;
        }
        let factSource;
        if (raw.source != null) {
            if (allow(raw.source, `${path}.source`, ['title', 'url', 'capturedAt', 'market'], fail)) {
                const titleText = textValue(raw.source.title, `${path}.source.title`, IMPORT_LIMITS.text, fail, true);
                const market = textValue(raw.source.market, `${path}.source.market`, IMPORT_LIMITS.text, fail, true);
                if (typeof raw.source.url !== 'string' || !raw.source.url.startsWith('https://') || /\s/.test(raw.source.url)) fail(`${path}.source.url`, 'expected an https URL');
                else if (raw.source.url.length > IMPORT_LIMITS.text) fail(`${path}.source.url`, `text exceeds ${IMPORT_LIMITS.text} characters`);
                if (typeof raw.source.capturedAt !== 'string' || !DATE_RE.test(raw.source.capturedAt)) fail(`${path}.source.capturedAt`, 'expected an ISO date');
                if (titleText && market) factSource = { title: titleText, url: raw.source.url, capturedAt: raw.source.capturedAt, market };
            }
        } else if (OFFICIAL_PROVENANCES.includes(raw.provenance)) fail(`${path}.source`, 'official facts require a source');
        if (!allow(raw.appliesTo, `${path}.appliesTo`, ['scope', 'lineId'], fail)) continue;
        if (!['meal', 'serving', 'line'].includes(raw.appliesTo.scope)) fail(`${path}.appliesTo.scope`, 'invalid scope');
        if (raw.appliesTo.scope === 'line') {
            if (!seen.has(raw.appliesTo.lineId)) fail(`${path}.appliesTo.lineId`, 'unknown line');
        } else if (raw.appliesTo.lineId != null) fail(`${path}.appliesTo.lineId`, 'lineId is only valid for a line scope');
        const basis = {};
        if (raw.basis != null && allow(raw.basis, `${path}.basis`, ['servings', 'servingWeight', 'description'], fail)) {
            if (raw.basis.servings != null) {
                if (!num(raw.basis.servings) || raw.basis.servings <= 0) fail(`${path}.basis.servings`, 'expected a count greater than 0');
                else basis.servings = raw.basis.servings;
            }
            if (raw.basis.servingWeight != null) {
                const quantity = canonicalQuantity(raw.basis.servingWeight, `${path}.basis.servingWeight`, fail);
                if (quantity) basis.servingWeight = quantity;
            }
            const description = textValue(raw.basis.description, `${path}.basis.description`, IMPORT_LIMITS.text, fail);
            if (description) basis.description = description;
        }
        const nutrients = canonicalNutrients(raw.nutrients, `${path}.nutrients`, fail);
        const statement = textValue(raw.ingredientStatement, `${path}.ingredientStatement`, IMPORT_LIMITS.statement, fail);
        const fact = {
            factId: raw.factId,
            provenance: raw.provenance,
            ...(factSource ? { source: factSource } : {}),
            appliesTo: raw.appliesTo.scope === 'line' ? { scope: 'line', lineId: raw.appliesTo.lineId } : { scope: raw.appliesTo.scope },
            basis,
            nutrients,
            ...(statement ? { ingredientStatement: statement } : {}),
        };
        facts.push(fact);
        factUses[fact.factId] = factUse(fact);
        if (factUses[fact.factId] === 'unapplied') warn(path, 'serving fact has no applicable basis and is not a fit target', 'unapplied_fact');
        if (factUses[fact.factId] === 'research_evidence') warnings.push({ path, message: 'line fact is research evidence, not a fit target', code: 'line_fact_evidence', level: 'info', factId: fact.factId, lineId: fact.appliesTo.lineId });
    }
    if ((source.knownFacts ?? []).length) {
        if (source.registryVersion == null) fail('$.registryVersion', 'required when known facts are present');
        else if (typeof source.registryVersion === 'number' && source.registryVersion > NUTRIENT_REGISTRY_VERSION) fail('$.registryVersion', 'site update required');
        else if (source.registryVersion !== NUTRIENT_REGISTRY_VERSION) fail('$.registryVersion', 'unsupported registryVersion');
        else list.registryVersion = NUTRIENT_REGISTRY_VERSION;
    } else if (source.registryVersion != null && source.registryVersion !== NUTRIENT_REGISTRY_VERSION) {
        fail('$.registryVersion', source.registryVersion > NUTRIENT_REGISTRY_VERSION ? 'site update required' : 'unsupported registryVersion');
    }
    if (facts.length) list.knownFacts = facts;

    const constraints = [];
    if (source.constraints != null && (!Array.isArray(source.constraints) || source.constraints.length > IMPORT_LIMITS.constraints))
        fail('$.constraints', `expected at most ${IMPORT_LIMITS.constraints} constraints`);
    for (const [index, raw] of (Array.isArray(source.constraints) ? source.constraints : []).entries()) {
        const path = `$.constraints[${index}]`;
        if (!plain(raw) || !['fixed', 'ratio', 'order', 'tail_max_percent', 'sum'].includes(raw.type)) {
            fail(`${path}.type`, 'invalid constraint');
            continue;
        }
        const idsOf = key => {
            const ids = raw[key];
            if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !seen.has(id)) || new Set(ids).size !== ids.length)
                fail(`${path}.${key}`, 'expected known line ids');
            return ids ?? [];
        };
        if (raw.type === 'fixed') {
            allow(raw, path, ['type', 'lineIds'], fail);
            constraints.push({ type: 'fixed', lineIds: idsOf('lineIds') });
        } else if (raw.type === 'order') {
            allow(raw, path, ['type', 'lineIds', 'group'], fail);
            const lineIds = idsOf('lineIds');
            if (lineIds.length < 2) fail(path, 'order requires at least two lines');
            const group = textValue(raw.group, `${path}.group`, IMPORT_LIMITS.text, fail);
            constraints.push({ type: 'order', lineIds, ...(group ? { group } : {}) });
        } else if (raw.type === 'ratio') {
            allow(raw, path, ['type', 'num', 'den', 'min', 'max'], fail);
            if (!seen.has(raw.num) || !seen.has(raw.den) || raw.num === raw.den) fail(path, 'ratio lines must be two different known lines');
            if (!num(raw.min) || !num(raw.max) || raw.min < 0 || raw.min > raw.max) fail(path, 'invalid ratio bounds');
            constraints.push({ type: 'ratio', num: raw.num, den: raw.den, min: raw.min, max: raw.max });
        } else if (raw.type === 'tail_max_percent') {
            allow(raw, path, ['type', 'lineIds', 'maxPercent'], fail);
            if (!num(raw.maxPercent) || raw.maxPercent <= 0 || raw.maxPercent > 100) fail(`${path}.maxPercent`, 'expected a percent from above 0 through 100');
            constraints.push({ type: 'tail_max_percent', lineIds: idsOf('lineIds'), maxPercent: raw.maxPercent });
        } else {
            allow(raw, path, ['type', 'lineIds', 'gMin', 'gMax'], fail);
            if (!gram(raw.gMin) || !gram(raw.gMax) || raw.gMin > raw.gMax) fail(path, 'invalid sum bounds');
            constraints.push({ type: 'sum', lineIds: idsOf('lineIds'), gMin: raw.gMin, gMax: raw.gMax });
        }
    }
    if (constraints.length) list.constraints = constraints;

    const assumptions = [];
    const assumptionIds = new Set();
    if (source.assumptions != null && (!Array.isArray(source.assumptions) || source.assumptions.length > IMPORT_LIMITS.assumptions))
        fail('$.assumptions', `expected at most ${IMPORT_LIMITS.assumptions} assumptions`);
    for (const [index, raw] of (Array.isArray(source.assumptions) ? source.assumptions : []).entries()) {
        const path = `$.assumptions[${index}]`;
        if (!allow(raw, path, ['id', 'text', 'appliesTo'], fail)) continue;
        if (typeof raw.id !== 'string' || !ID_RE.test(raw.id) || raw.id === 'meal') fail(`${path}.id`, 'invalid assumption id');
        else if (assumptionIds.has(raw.id)) fail(`${path}.id`, 'duplicate assumption id');
        assumptionIds.add(raw.id);
        const text = textValue(raw.text, `${path}.text`, IMPORT_LIMITS.text, fail, true);
        if (!Array.isArray(raw.appliesTo) || !raw.appliesTo.length || raw.appliesTo.some(id => id !== 'meal' && !seen.has(id) && !factIds.has(id)))
            fail(`${path}.appliesTo`, 'expected line ids, fact ids, or meal');
        else if (raw.appliesTo.some(id => seen.has(id) && factIds.has(id))) fail(`${path}.appliesTo`, 'line and fact ids must stay distinct');
        if (text && Array.isArray(raw.appliesTo)) assumptions.push({ id: raw.id, text, appliesTo: [...raw.appliesTo] });
    }
    if (assumptions.length) list.assumptions = assumptions;
    for (const line of ingredients) {
        for (const id of line.assumptionIds ?? []) {
            if (!assumptionIds.has(id)) fail(`$.ingredients.${line.lineId}.assumptionIds`, 'unknown assumption');
        }
    }
    if (source.overallConfidence != null && allow(source.overallConfidence, '$.overallConfidence', ['level', 'note'], fail)) {
        if (!CONFIDENCE.includes(source.overallConfidence.level)) fail('$.overallConfidence.level', 'invalid confidence');
        const note = textValue(source.overallConfidence.note, '$.overallConfidence.note', IMPORT_LIMITS.text, fail);
        if (CONFIDENCE.includes(source.overallConfidence.level)) list.overallConfidence = { level: source.overallConfidence.level, ...(note ? { note } : {}) };
    }
    if (!errors.length && constraints.length) checkConstraints(ingredients, constraints, fail, warn);
    if (errors.length) return { ok: false, errors, warnings };
    return { ok: true, list: freeze(list), warnings: freeze(warnings), factUses: freeze(factUses) };
}

/** Parents and their children are reported together. Callers count one side; this module does not. */
export function compoundGroups(list) {
    const groups = new Map();
    for (const line of list?.ingredients ?? []) {
        if (!line.parentLineId) continue;
        const children = groups.get(line.parentLineId) ?? [];
        children.push(line.lineId);
        groups.set(line.parentLineId, children);
    }
    return [...groups].map(([parentLineId, childLineIds]) => ({ parentLineId, childLineIds }));
}

/** Fitting may move only estimated lines that are not named by a fixed constraint. Ranges on fixed lines stay tolerance. */
export function isFreeQuantity(line, constraints = []) {
    if (line?.quantity?.basis !== 'estimated') return false;
    return !constraints.some(item => item?.type === 'fixed' && item.lineIds?.includes(line.lineId));
}

export function fitTargets(list) {
    return (list?.knownFacts ?? []).filter(fact => factUse(fact) === 'fit_target');
}

export function researchEvidence(list) {
    return (list?.knownFacts ?? []).filter(fact => factUse(fact) === 'research_evidence').map(fact => ({ factId: fact.factId, lineId: fact.appliesTo.lineId, nutrients: fact.nutrients, provenance: fact.provenance, source: fact.source ?? null, basis: fact.basis ?? {} }));
}

/** Convert a null-gram quantity only through #61 conversion records. Does not mutate the line. */
export function resolveLineQuantity(line, conversions = []) {
    const quantity = line?.quantity;
    if (!quantity) return { error: 'missing_quantity', converted: false };
    if (typeof quantity.g === 'number') return { quantity: { ...quantity }, conversionId: null, converted: false };
    const state = line.variant?.state || 'unspecified';
    const result = toGrams(quantity.original?.amount, quantity.original?.unit, '', conversions, state);
    if (result.error || !Number.isFinite(result.grams)) return { quantity: { ...quantity }, error: result.error || 'missing_conversion', converted: false };
    if ((quantity.gMin != null && result.grams < quantity.gMin) || (quantity.gMax != null && result.grams > quantity.gMax))
        return { quantity: { ...quantity }, error: 'conversion_conflict', converted: false };
    return { quantity: { ...quantity, g: result.grams }, conversionId: result.conversionId, converted: true };
}

export function normalizeMatchDims(variant = {}) {
    return normalizeVariantDims(variant);
}
