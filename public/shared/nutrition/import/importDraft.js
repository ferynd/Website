import { IMPORT_LIMITS, QUANTITY_BASES, validateIngredientList } from './ingredientList.js';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.normalize('NFKC').trim() : '';

function quantityError(quantity) {
    if (!plain(quantity)) return 'expected a quantity';
    for (const key of Object.keys(quantity)) {
        if (!['g', 'gMin', 'gMax', 'basis', 'original'].includes(key)) return 'unknown quantity field';
    }
    if (!QUANTITY_BASES.includes(quantity.basis)) return 'invalid basis';
    if (quantity.g !== null && (typeof quantity.g !== 'number' || !Number.isFinite(quantity.g) || quantity.g < 0 || quantity.g > IMPORT_LIMITS.grams))
        return 'invalid grams';
    for (const bound of ['gMin', 'gMax']) {
        if (quantity[bound] != null && (typeof quantity[bound] !== 'number' || quantity[bound] < 0 || quantity[bound] > IMPORT_LIMITS.grams))
            return 'invalid gram bound';
    }
    if (quantity.gMin != null && quantity.g != null && quantity.gMin > quantity.g) return 'expected gMin ≤ g ≤ gMax';
    if (quantity.gMax != null && quantity.g != null && quantity.g > quantity.gMax) return 'expected gMin ≤ g ≤ gMax';
    if (quantity.gMin != null && quantity.gMax != null && quantity.gMin > quantity.gMax) return 'expected gMin ≤ g ≤ gMax';
    if (quantity.g == null && !quantity.original) return 'required when grams are null';
    return '';
}

/** The validated import stays frozen. Corrections live beside it. */
export function createImportDraft(list, source = { kind: 'ingredient_list' }) {
    const validated = validateIngredientList(list);
    if (!validated.ok) return validated;
    return {
        ok: true,
        draft: {
            schemaVersion: 1,
            import: validated.list,
            corrections: { lines: {} },
            source: Object.freeze(structuredClone(source)),
            warnings: validated.warnings,
            factUses: validated.factUses,
            modelCalls: 0,
        },
    };
}

export function applyLineCorrection(draft, lineId, patch) {
    const line = draft?.import?.ingredients?.find(item => item.lineId === lineId);
    if (!line) return { ok: false, errors: [{ path: '$.corrections', message: 'unknown line' }] };
    if (!plain(patch)) return { ok: false, errors: [{ path: '$.corrections', message: 'expected a correction' }] };
    for (const key of Object.keys(patch)) {
        if (key !== 'name' && key !== 'quantity') return { ok: false, errors: [{ path: `$.corrections.${key}`, message: 'unknown correction' }] };
    }
    const next = { ...(draft.corrections.lines[lineId] ?? {}) };
    if ('name' in patch) {
        const name = text(patch.name);
        if (!name || name.length > IMPORT_LIMITS.name) return { ok: false, errors: [{ path: '$.corrections.name', message: 'invalid name' }] };
        next.name = name;
    }
    if ('quantity' in patch) {
        if (!plain(patch.quantity)) return { ok: false, errors: [{ path: '$.corrections.quantity', message: 'expected a quantity' }] };
        const merged = { ...line.quantity, ...(next.quantity ?? {}), ...patch.quantity };
        const message = quantityError(merged);
        if (message) return { ok: false, errors: [{ path: '$.corrections.quantity', message }] };
        next.quantity = merged;
    }
    return {
        ok: true,
        draft: { ...draft, corrections: { lines: { ...draft.corrections.lines, [lineId]: next } }, modelCalls: 0 },
    };
}

export function effectiveLine(draft, lineId) {
    const line = draft.import.ingredients.find(item => item.lineId === lineId);
    if (!line) return null;
    const patch = draft.corrections.lines[lineId] ?? {};
    return { ...line, name: patch.name ?? line.name, quantity: patch.quantity ?? line.quantity };
}
