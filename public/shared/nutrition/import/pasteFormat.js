import { formWordsFor, parseFormWords } from '../variantVocabulary.js';
import { getNutrient, NUTRIENT_REGISTRY_VERSION } from '../nutrientRegistry.js';
import { IMPORT_LIMITS, validateIngredientList } from './ingredientList.js';

export const PASTE_HEADER = 'NUTRITION-INGREDIENTS v1';
const bytes = value => new TextEncoder().encode(value).length;
const formatNum = value => Number.isInteger(value) ? String(value) : String(value);

function fail(errors, line, column, message) {
    errors.push({ path: `paste:${line}:${column}`, line, column, message });
}

function parseAmount(text) {
    const approx = text.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z-]*)\s*≈\s*(\d+(?:\.\d+)?)\s*g(?:\s*\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\))?$/);
    if (approx) {
        const quantity = { g: Number(approx[3]), basis: null, original: { amount: Number(approx[1]), unit: approx[2], text: `${formatNum(Number(approx[1]))} ${approx[2]}` } };
        if (approx[4]) { quantity.gMin = Number(approx[4]); quantity.gMax = Number(approx[5]); }
        return quantity;
    }
    const grams = text.match(/^(\d+(?:\.\d+)?)\s*g(?:\s*\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\))?$/);
    if (grams) {
        const quantity = { g: Number(grams[1]) };
        if (grams[2]) { quantity.gMin = Number(grams[2]); quantity.gMax = Number(grams[3]); }
        return quantity;
    }
    const original = text.match(/^(\d+(?:\.\d+)?)\s+([A-Za-z][A-Za-z-]*)$/);
    if (original) return { g: null, original: { amount: Number(original[1]), unit: original[2], text: `${formatNum(Number(original[1]))} ${original[2]}` } };
    return null;
}

function defaultLineId(number) {
    return `l${number.split('.').join('-')}`;
}

function parseFactBasis(text) {
    const idMatch = text.match(/^(.*)\s+\(id=([a-z0-9_-]{1,24})\)$/);
    const basisText = (idMatch ? idMatch[1] : text).trim();
    const serving = basisText.match(/^(\d+(?:\.\d+)?) servings?$/);
    if (serving) return { id: idMatch?.[2], appliesTo: { scope: 'serving' }, basis: { servings: Number(serving[1]) } };
    if (basisText === 'meal') return { id: idMatch?.[2], appliesTo: { scope: 'meal' }, basis: {} };
    const line = basisText.match(/^line\s+(\d+(?:\.\d+)*)$/);
    if (line) return { id: idMatch?.[2], appliesTo: { scope: 'line', lineRef: line[1] }, basis: {} };
    return null;
}

/**
 * Deterministic paste parser. Syntax errors carry the paste line and column.
 * A successful parse is then checked by the JSON validator.
 */
export function parseIngredientPaste(text) {
    if (typeof text !== 'string') return { ok: false, errors: [{ path: 'paste:1:1', line: 1, column: 1, message: 'expected paste text' }], warnings: [] };
    if (bytes(text) > IMPORT_LIMITS.bytes) return { ok: false, errors: [{ path: 'paste:1:1', line: 1, column: 1, message: 'import exceeds the size limit' }], warnings: [] };
    const errors = [];
    const physical = text.replace(/\r\n/g, '\n').split('\n');
    if (physical.at(-1) === '') physical.pop();
    const first = physical[0] ?? '';
    if (first.startsWith('NUTRITION-INGREDIENTS v') && first !== PASTE_HEADER) {
        const version = Number(first.slice('NUTRITION-INGREDIENTS v'.length));
        fail(errors, 1, 1, version > 1 ? 'site update required' : 'unsupported paste version');
        return { ok: false, errors, warnings: [] };
    }
    if (first !== PASTE_HEADER) fail(errors, 1, 1, 'expected NUTRITION-INGREDIENTS v1');
    if (physical.at(-1) !== 'END') fail(errors, physical.length || 1, 1, 'expected END');
    if (errors.length) return { ok: false, errors, warnings: [] };

    const meal = { servings: {} };
    const ingredients = [];
    const facts = [];
    const constraints = [];
    const assumptions = [];
    const numbers = new Map();
    let confidence = null;
    let mode = 'meta';
    let pendingFact = null;
    const finishFact = () => { if (pendingFact) facts.push(pendingFact); pendingFact = null; };

    for (let index = 1; index < physical.length - 1; index++) {
        const line = physical[index];
        const row = index + 1;
        if (!line.trim()) continue;
        if (line !== line.trim()) fail(errors, row, 1, 'unexpected indentation');
        if (mode === 'assumptions') {
            const match = line.match(/^-\s+(.+?)\s+\[([^\]]+)\](?:\s+\(id=([a-z0-9_-]{1,24})\))?$/);
            if (!match) { fail(errors, row, 1, 'expected an assumption'); continue; }
            const applies = match[2].split(',').map(item => item.trim());
            assumptions.push({ text: match[1], applies, id: match[3] ?? null, row });
            continue;
        }
        if (line === 'Assumptions:') {
            finishFact();
            mode = 'assumptions';
            continue;
        }
        if (line.startsWith('Constraints:')) {
            finishFact();
            if (mode === 'ingredients' || mode === 'facts' || mode === 'meta') mode = 'constraints';
            else fail(errors, row, 1, 'constraints are out of order');
            const body = line.slice('Constraints:'.length).trim();
            const column = line.indexOf(body) + 1;
            if (!body) { fail(errors, row, column, 'expected a constraint'); continue; }
            for (const clause of body.split(/\s*;\s*/)) {
                const fixed = clause.match(/^fixed\s+(\d+(?:\.\d+)*(?:\s*,\s*\d+(?:\.\d+)*)*)$/);
                const order = clause.match(/^order\s+(\d+(?:\.\d+)*(?:\s*>\s*\d+(?:\.\d+)*))$/);
                const ratio = clause.match(/^ratio\s+(\d+(?:\.\d+)*)\/(\d+(?:\.\d+)*)\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
                const tail = clause.match(/^tail(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)*(?:\s*,\s*\d+(?:\.\d+)*))$/);
                if (fixed) constraints.push({ type: 'fixed', numbers: fixed[1].split(/\s*,\s*/) });
                else if (order) constraints.push({ type: 'order', numbers: order[1].split(/\s*>\s*/) });
                else if (ratio) constraints.push({ type: 'ratio', num: ratio[1], den: ratio[2], min: Number(ratio[3]), max: Number(ratio[4]) });
                else if (tail) constraints.push({ type: 'tail_max_percent', maxPercent: Number(tail[1]), numbers: tail[2].split(/\s*,\s*/) });
                else fail(errors, row, column, `unknown constraint "${clause}"`);
            }
            continue;
        }
        if (line.startsWith('Source:')) {
            if (!pendingFact) { fail(errors, row, 1, 'source line has no fact'); continue; }
            const bits = line.slice('Source:'.length).trim().split(' | ');
            if (bits.length !== 4) fail(errors, row, 'Source:'.length + 2, 'expected title, https URL, date, and market');
            else pendingFact.source = { title: bits[0], url: bits[1], capturedAt: bits[2], market: bits[3] };
            continue;
        }
        if (line.startsWith('Fact ')) {
            finishFact();
            mode = 'facts';
            const match = line.match(/^Fact\s+([a-z_]+)\s+per\s+(.+?)\s*:\s*(.*)$/);
            if (!match) { fail(errors, row, 1, 'expected a fact'); continue; }
            const basis = parseFactBasis(match[2]);
            if (!basis) { fail(errors, row, line.indexOf('per ') + 1, 'unknown fact basis'); continue; }
            const nutrients = {};
            if (!match[3].trim()) fail(errors, row, line.indexOf(':') + 1, 'expected nutrients');
            for (const part of match[3].split(/\s*;\s*/).filter(Boolean)) {
                const nutrient = part.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([A-Za-zμµ]+)$/);
                if (!nutrient) fail(errors, row, line.indexOf(part) + 1, `unknown nutrient "${part}"`);
                else nutrients[nutrient[1]] = { value: Number(nutrient[2]), unit: nutrient[3] };
            }
            pendingFact = { provenance: match[1], appliesTo: basis.appliesTo, basis: basis.basis, nutrients, id: basis.id, row };
            continue;
        }
        const ingredient = line.match(/^(\d+(?:\.\d+)*)\.\s+(.*)$/);
        if (ingredient) {
            if (mode === 'facts' || mode === 'constraints' || mode === 'assumptions') {
                fail(errors, row, 1, 'ingredient line is out of order');
                continue;
            }
            mode = 'ingredients';
            const parts = ingredient[2].split('|').map(part => part.trim());
            if (parts.length < 4 || parts.length > 5) { fail(errors, row, 1, 'expected name, form, amount, and basis'); continue; }
            const [name, form, amountText, basis, extras] = parts;
            const amount = parseAmount(amountText);
            if (!amount) fail(errors, row, line.indexOf(amountText) + 1, 'unknown amount');
            if (!['measured', 'label', 'recipe_stated', 'estimated'].includes(basis)) fail(errors, row, line.lastIndexOf(basis) + 1, 'unknown basis');
            const variant = {};
            if (form.trim()) {
                try {
                    const parsed = parseFormWords(form);
                    Object.assign(variant, parsed.dims);
                    if (parsed.unknownWords.length) fail(errors, row, line.indexOf(form) + 1, `unknown form "${parsed.unknownWords.join(', ')}"`);
                } catch (error) {
                    fail(errors, row, line.indexOf(form) + 1, error instanceof Error ? error.message : 'invalid form');
                }
            }
            const lineId = { value: null };
            let kind;
            if (extras) {
                for (const pair of extras.split(/\s*;\s*/).filter(Boolean)) {
                    const eq = pair.indexOf('=');
                    if (eq <= 0) { fail(errors, row, line.indexOf(pair) + 1, 'expected key=value'); continue; }
                    const key = pair.slice(0, eq).trim();
                    const value = pair.slice(eq + 1).trim();
                    if (key === 'id') lineId.value = value;
                    else if (key === 'kind') kind = value;
                    else assignVariant(variant, key, value, errors, row, line.indexOf(pair) + 1);
                }
            }
            const number = ingredient[1];
            if (numbers.has(number)) fail(errors, row, 1, 'duplicate line number');
            const id = lineId.value || defaultLineId(number);
            numbers.set(number, id);
            const quantity = amount ? { ...amount, basis } : { g: null, basis, original: { amount: 1, unit: 'unconverted', text: 'unknown amount' } };
            delete quantity.basis;
            const item = { lineId: id, name, quantity: { ...quantity, basis }, number };
            if (Object.keys(variant).length) item.variant = variant;
            if (kind) item.kind = kind;
            ingredients.push(item);
            continue;
        }
        const meta = line.match(/^(Title|Kind|Servings|Serving weight|Final weight|Confidence):\s*(.*)$/);
        if (!meta || mode !== 'meta') { fail(errors, row, 1, 'unknown paste line'); continue; }
        const [, key, value] = meta;
        if (key === 'Title') meal.title = value;
        else if (key === 'Kind') meal.kind = value;
        else if (key === 'Confidence') confidence = value;
        else if (key === 'Servings') {
            const servings = value.match(/^(\d+(?:\.\d+)?)(?:,\s*consumed\s+(\d+(?:\.\d+)?))?$/);
            if (!servings) fail(errors, row, line.indexOf(value) + 1, 'expected a serving count');
            else {
                meal.servings.count = Number(servings[1]);
                if (servings[2]) meal.servings.consumed = Number(servings[2]);
            }
        } else {
            const split = value.split(' | ');
            const amount = parseAmount(split[0] ?? '');
            if (!amount || split.length !== 2) fail(errors, row, line.indexOf(value) + 1, 'expected an amount and a basis');
            else meal[key === 'Serving weight' ? 'servingWeight' : 'finalWeight'] = { ...amount, basis: split[1] };
        }
    }
    finishFact();
    if (errors.length) return { ok: false, errors, warnings: [] };

    const built = [];
    for (const item of ingredients) {
        const parentNumber = item.number.includes('.') ? item.number.slice(0, item.number.lastIndexOf('.')) : null;
        if (parentNumber && !numbers.has(parentNumber)) {
            fail(errors, 1, 1, `unknown parent line ${parentNumber}`);
            continue;
        }
        const line = { lineId: item.lineId, name: item.name, quantity: item.quantity };
        if (item.kind) line.kind = item.kind;
        if (item.variant) line.variant = item.variant;
        if (parentNumber) line.parentLineId = numbers.get(parentNumber);
        built.push(line);
    }
    const knownFacts = facts.map((fact, index) => {
        const stored = {
            factId: fact.id || `f${index + 1}`,
            provenance: fact.provenance,
            appliesTo: { ...fact.appliesTo },
            basis: fact.basis,
            nutrients: fact.nutrients,
        };
        if (fact.appliesTo.scope === 'line') stored.appliesTo = { scope: 'line', lineId: numbers.get(fact.appliesTo.lineRef) };
        if (fact.source) stored.source = fact.source;
        return stored;
    });
    const builtConstraints = constraints.map(constraint => {
        if (constraint.type === 'ratio') return { type: 'ratio', num: numbers.get(constraint.num), den: numbers.get(constraint.den), min: constraint.min, max: constraint.max };
        return { type: constraint.type, ...(constraint.maxPercent != null ? { maxPercent: constraint.maxPercent } : {}), lineIds: constraint.numbers.map(number => numbers.get(number)) };
    });
    const builtAssumptions = assumptions.map((item, index) => ({
        id: item.id || `a${index + 1}`,
        text: item.text,
        appliesTo: item.applies.map(token => token === 'meal' ? 'meal' : numbers.get(token)),
    }));
    if (errors.length) return { ok: false, errors, warnings: [] };
    const list = {
        kind: 'nutrition.ingredientList',
        schemaVersion: 1,
        ...(knownFacts.length ? { registryVersion: NUTRIENT_REGISTRY_VERSION } : {}),
        meal,
        ingredients: built,
        ...(knownFacts.length ? { knownFacts } : {}),
        ...(builtConstraints.length ? { constraints: builtConstraints } : {}),
        ...(builtAssumptions.length ? { assumptions: builtAssumptions } : {}),
        ...(confidence ? { overallConfidence: { level: confidence } } : {}),
    };
    const validated = validateIngredientList(list);
    if (!validated.ok) return validated;
    return validated;
}

function assignVariant(variant, key, value, errors, row, column) {
    const direct = ['state', 'preparation', 'drained', 'salt', 'fortification', 'fortificationDetail', 'sweetening', 'ediblePortion'];
    const brand = ['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote'];
    if (direct.includes(key)) {
        if (variant[key] && variant[key] !== value) fail(errors, row, column, `conflicting form dimension: ${key}`);
        variant[key] = value;
        return;
    }
    if (key === 'fatPercent' || key === 'leanPercent') {
        if (!/^\d+(?:\.\d+)?$/.test(value)) fail(errors, row, column, `invalid ${key}`);
        else variant[key] = Number(value);
        return;
    }
    if (brand.includes(key)) {
        variant.brand = { ...variant.brand, [key]: value };
        return;
    }
    fail(errors, row, column, `unknown field ${key}`);
}

function outline(list) {
    const children = new Map();
    const roots = [];
    for (const line of list.ingredients) {
        if (!line.parentLineId) roots.push(line);
        else {
            const kids = children.get(line.parentLineId) ?? [];
            kids.push(line);
            children.set(line.parentLineId, kids);
        }
    }
    const numbers = new Map();
    const walk = (line, number) => {
        numbers.set(line.lineId, number);
        (children.get(line.lineId) ?? []).forEach((child, index) => walk(child, `${number}.${index + 1}`));
    };
    roots.forEach((line, index) => walk(line, String(index + 1)));
    return numbers;
}

function amountText(quantity) {
    const range = quantity.gMin != null && quantity.gMax != null ? ` (${formatNum(quantity.gMin)}-${formatNum(quantity.gMax)})` : '';
    if (quantity.original && quantity.original.unit !== 'g' && quantity.g != null)
        return `${formatNum(quantity.original.amount)} ${quantity.original.unit} ≈ ${formatNum(quantity.g)} g${range}`;
    if (quantity.g == null) return `${formatNum(quantity.original.amount)} ${quantity.original.unit}`;
    return `${formatNum(quantity.g)} g${range}`;
}

function jsonOnly(list) {
    const reasons = [];
    const mark = path => reasons.push(path);
    if (list.extensions) mark('$.extensions');
    if (list.producer) mark('$.producer');
    if (list.inputs) mark('$.inputs');
    if (list.registryVersion != null && list.registryVersion !== NUTRIENT_REGISTRY_VERSION) mark('$.registryVersion');
    if (list.meal?.yield) mark('$.meal.yield');
    if (list.overallConfidence?.note) mark('$.overallConfidence.note');
    for (const [index, line] of list.ingredients.entries()) {
        for (const key of ['role', 'confidence', 'order', 'notes', 'assumptionIds']) if (line[key] != null) mark(`$.ingredients[${index}].${key}`);
        if (line.name?.includes('|')) mark(`$.ingredients[${index}].name`);
        for (const key of ['fortificationDetail', 'ediblePortion']) {
            if (typeof line.variant?.[key] === 'string' && /[;|]/.test(line.variant[key])) mark(`$.ingredients[${index}].variant.${key}`);
        }
        for (const key of ['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote']) {
            if (typeof line.variant?.brand?.[key] === 'string' && /[;|]/.test(line.variant.brand[key])) mark(`$.ingredients[${index}].variant.brand.${key}`);
        }
        const quantity = line.quantity ?? {};
        if ((quantity.gMin == null) !== (quantity.gMax == null) || (quantity.g == null && (quantity.gMin != null || quantity.gMax != null))) mark(`$.ingredients[${index}].quantity`);
        if (quantity.original?.unit === 'g' && quantity.original.amount !== quantity.g) mark(`$.ingredients[${index}].quantity.original`);
        if (quantity.original?.text && quantity.original.text !== `${formatNum(quantity.original.amount)} ${quantity.original.unit}`)
            mark(`$.ingredients[${index}].quantity.original.text`);
        try { formWordsFor(line.variant || {}); }
        catch { mark(`$.ingredients[${index}].variant`); }
    }
    for (const [index, fact] of (list.knownFacts ?? []).entries()) {
        for (const observation of Object.values(fact.nutrients ?? {})) {
            if (observation.rounding || observation.qualifier) mark(`$.knownFacts[${index}].nutrients`);
        }
        if (fact.ingredientStatement) mark(`$.knownFacts[${index}].ingredientStatement`);
        if (fact.basis?.servingWeight || fact.basis?.description) mark(`$.knownFacts[${index}].basis`);
        const keys = Object.keys(fact.basis ?? {});
        const scope = fact.appliesTo?.scope;
        const pasteBasis = (scope === 'serving' && keys.length === 1 && keys[0] === 'servings')
            || (scope === 'meal' && keys.length === 0)
            || (scope === 'line' && keys.length === 0 && fact.appliesTo.lineId);
        if (!pasteBasis) mark(`$.knownFacts[${index}].appliesTo`);
        if (fact.source && ['title', 'url', 'capturedAt', 'market'].some(key => String(fact.source[key] ?? '').includes(' | ')))
            mark(`$.knownFacts[${index}].source`);
    }
    for (const [index, constraint] of (list.constraints ?? []).entries()) {
        if (constraint.type === 'sum' || constraint.group) mark(`$.constraints[${index}]`);
    }
    const lineIds = new Set(list.ingredients.map(line => line.lineId));
    for (const [index, assumption] of (list.assumptions ?? []).entries()) {
        if (assumption.text?.includes('[') || assumption.text?.includes(']')) mark(`$.assumptions[${index}]`);
        if ((assumption.appliesTo ?? []).some(id => id !== 'meal' && !lineIds.has(id))) mark(`$.assumptions[${index}].appliesTo`);
    }
    for (const key of ['servingWeight', 'finalWeight']) {
        const quantity = list.meal?.[key];
        if (!quantity) continue;
        if ((quantity.gMin == null) !== (quantity.gMax == null) || (quantity.g == null && (quantity.gMin != null || quantity.gMax != null))) mark(`$.meal.${key}`);
        if (quantity.original?.unit === 'g' && quantity.original.amount !== quantity.g) mark(`$.meal.${key}.original`);
    }
    return reasons;
}

function formatIngredientLine(line, number) {
    const form = formWordsFor(line.variant || {}).join(', ');
    const formText = form ? ` | ${form} | ` : ' | | ';
    const extras = [];
    if (line.lineId !== defaultLineId(number)) extras.push(`id=${line.lineId}`);
    if (line.kind && line.kind !== 'generic') extras.push(`kind=${line.kind}`);
    const variant = line.variant || {};
    for (const key of ['fortificationDetail', 'fatPercent', 'leanPercent', 'ediblePortion']) {
        if (variant[key] != null) extras.push(`${key}=${variant[key]}`);
    }
    for (const key of ['brand', 'product', 'gtin', 'market', 'labelDate', 'formulationNote']) {
        if (variant.brand?.[key]) extras.push(`${key}=${variant.brand[key]}`);
    }
    const tail = extras.length ? ` | ${extras.join('; ')}` : '';
    return `${number}. ${line.name}${formText}${amountText(line.quantity)} | ${line.quantity.basis}${tail}`;
}

/** Render canonical paste, or refuse when the list uses a JSON-only field. */
export function renderIngredientPaste(list) {
    const validated = validateIngredientList(list);
    if (!validated.ok) return { ok: false, reason: 'invalid', errors: validated.errors, warnings: validated.warnings };
    const fields = jsonOnly(validated.list);
    if (fields.length) return { ok: false, reason: 'json-only', fields };
    const source = validated.list;
    const numbers = outline(source);
    const lines = [PASTE_HEADER, `Title: ${source.meal.title}`, `Kind: ${source.meal.kind}`];
    const servings = source.meal.servings;
    lines.push(`Servings: ${formatNum(servings.count)}${servings.consumed != null ? `, consumed ${formatNum(servings.consumed)}` : ''}`);
    for (const [key, label] of [['servingWeight', 'Serving weight'], ['finalWeight', 'Final weight']]) {
        if (source.meal[key]) lines.push(`${label}: ${amountText(source.meal[key])} | ${source.meal[key].basis}`);
    }
    if (source.overallConfidence) lines.push(`Confidence: ${source.overallConfidence.level}`);
    source.ingredients.forEach(line => lines.push(formatIngredientLine(line, numbers.get(line.lineId))));
    (source.knownFacts ?? []).forEach((fact, index) => {
        let basis = 'per meal';
        if (fact.appliesTo.scope === 'serving') {
            const count = fact.basis.servings;
            basis = `per ${formatNum(count)} ${count === 1 ? 'serving' : 'servings'}`;
        } else if (fact.appliesTo.scope === 'line') basis = `per line ${numbers.get(fact.appliesTo.lineId)}`;
        const id = fact.factId === `f${index + 1}` ? '' : ` (id=${fact.factId})`;
        const nutrients = Object.entries(fact.nutrients).map(([key, item]) => `${getNutrient(key).label} ${formatNum(item.value)} ${item.unit}`).join('; ');
        lines.push(`Fact ${fact.provenance} ${basis}${id}: ${nutrients}`);
        if (fact.source) lines.push(`Source: ${fact.source.title} | ${fact.source.url} | ${fact.source.capturedAt} | ${fact.source.market}`);
    });
    if (source.constraints?.length) {
        const clauses = source.constraints.map(constraint => {
            if (constraint.type === 'fixed') return `fixed ${constraint.lineIds.map(id => numbers.get(id)).join(',')}`;
            if (constraint.type === 'order') return `order ${constraint.lineIds.map(id => numbers.get(id)).join('>')}`;
            if (constraint.type === 'ratio') return `ratio ${numbers.get(constraint.num)}/${numbers.get(constraint.den)} ${formatNum(constraint.min)}-${formatNum(constraint.max)}`;
            return `tail${formatNum(constraint.maxPercent)}% ${constraint.lineIds.map(id => numbers.get(id)).join(',')}`;
        });
        lines.push(`Constraints: ${clauses.join('; ')}`);
    }
    if (source.assumptions?.length) {
        lines.push('Assumptions:');
        source.assumptions.forEach((assumption, index) => {
            const refs = assumption.appliesTo.map(id => id === 'meal' ? 'meal' : numbers.get(id)).join(',');
            const id = assumption.id === `a${index + 1}` ? '' : ` (id=${assumption.id})`;
            lines.push(`- ${assumption.text} [${refs}]${id}`);
        });
    }
    lines.push('END');
    return { ok: true, text: `${lines.join('\n')}\n` };
}
