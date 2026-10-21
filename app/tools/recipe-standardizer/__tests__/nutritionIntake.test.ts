import { describe, expect, it } from 'vitest';
import { buildNutritionPrompt, NUTRIENT_INTAKE_SPEC, parseNutritionJson } from '../lib/nutritionIntake';
import { TRACKER_NUTRIENT_KEYS } from '../lib/trackerFoods';
import { validRecipeJson } from './fixtures';

const nutrients = () => Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, key === 'calories' ? 100 : 0]));
const item = (overrides: Record<string, unknown> = {}) => ({ ingredientId: 'butter-id', name: 'Butter', assumptions: '', nutrients: nutrients(), ...overrides });
const document = (items: unknown[] = [item()], extra: Record<string, unknown> = {}) => ({ kind: 'recipe-nutrition', schemaVersion: 1, basis: 'per-100g', items, ...extra });
const parseItem = (value: unknown) => {
  const parsed = parseNutritionJson(JSON.stringify(document([value])));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.items[0];
};

describe('nutrition intake prompt', () => {
  const group = { key: 'ing-1', displayName: 'Butter', normalizedName: 'butter', ingredientIds: ['ing-1'], note: '1 cup; softened' };

  it('includes all 24 nutrient keys in the JSON shape', () => {
    const prompt = buildNutritionPrompt('Cake', [group]);
    for (const key of TRACKER_NUTRIENT_KEYS) expect(prompt).toContain(`"${key}":0`);
  });

  it('includes canonical nutrient unit pairs and contract literals', () => {
    const prompt = buildNutritionPrompt('Cake', [group]);
    for (const pair of ['vitaminD mcg (not IU)', 'sodium mg', 'omega3 g']) expect(prompt).toContain(pair);
    for (const literal of ['"kind":"recipe-nutrition"', '"schemaVersion":1', '"basis":"per-100g"', 'Output one valid JSON object only', 'per 100 g']) expect(prompt).toContain(literal);
  });

  it('lists each ingredient as a JSON line with its exact ID', () => {
    const second = { ...group, key: 'ing-2', displayName: 'Flour', ingredientIds: ['ing-2'] };
    const prompt = buildNutritionPrompt('Cake', [group, second]);
    expect(prompt).toContain(JSON.stringify({ ingredientId: 'ing-1', name: 'Butter', note: '1 cup; softened' }));
    expect(prompt).toContain(JSON.stringify({ ingredientId: 'ing-2', name: 'Flour', note: '1 cup; softened' }));
  });

  it('keeps quotes and newlines inside one parseable JSON line', () => {
    const name = 'Butter "salted"\nsecond line';
    const prompt = buildNutritionPrompt('Cake', [{ ...group, displayName: name }]);
    const lines = prompt.split('\n');
    const line = lines.find((candidate) => candidate.includes('"ingredientId":"ing-1"'))!;
    expect(JSON.parse(line)).toEqual({ ingredientId: 'ing-1', name, note: group.note });
  });

  it('excludes internal recipe fields and keeps the base prompt under 3500 characters', () => {
    const prompt = buildNutritionPrompt('', []);
    expect(prompt).not.toContain('nutritionLink');
    expect(prompt).not.toContain('shoppingList');
    expect(prompt.length).toBeLessThan(3500);
  });
});

describe('nutrition JSON parser fatal cases', () => {
  it('rejects empty input', () => expect(parseNutritionJson('  ')).toEqual({ ok: false, errors: ['Paste the JSON ChatGPT returned.'] }));

  it('rejects non-JSON with a strict-format hint', () => {
    const result = parseNutritionJson('{oops');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/Invalid JSON:.*Do not include markdown fences, commentary, or trailing text/);
  });

  it('rejects an array root', () => expect(parseNutritionJson('[]')).toEqual({ ok: false, errors: ['The pasted JSON must be a single object (starting with "{").'] }));

  it('recognizes pasted recipe JSON and includes the import hint', () => {
    const result = parseNutritionJson(JSON.stringify(validRecipeJson()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(expect.arrayContaining(['kind must be "recipe-nutrition".', 'This looks like recipe JSON — paste it into Import recipe instead.']));
  });

  it('rejects a newer schema version', () => {
    const result = parseNutritionJson(JSON.stringify(document([item()], { schemaVersion: 2 })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('schemaVersion 2 is newer than this tool supports (1).');
  });

  it('rejects a non per-100g basis', () => {
    const result = parseNutritionJson(JSON.stringify(document([item()], { basis: 'per-serving' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('basis must be "per-100g" — values must be per 100 g.');
  });

  it('rejects non-array items', () => {
    const result = parseNutritionJson(JSON.stringify(document({} as unknown as unknown[])));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('items must be an array.');
  });

  it('rejects an empty items array', () => {
    const result = parseNutritionJson(JSON.stringify(document([])));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('items is empty — the prompt lists at least one ingredient.');
  });

  it('rejects more than 100 items', () => {
    const result = parseNutritionJson(JSON.stringify(document(Array.from({ length: 101 }, () => item()))));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('items has 101 entries; at most 100 are supported.');
  });

  it('reports multiple document-level errors together', () => {
    const result = parseNutritionJson(JSON.stringify({ kind: 'wrong', schemaVersion: 0, basis: 'cup', items: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual([
      'kind must be "recipe-nutrition".', 'schemaVersion must be 1.',
      'basis must be "per-100g" — values must be per 100 g.', 'items must be an array.',
    ]);
  });
});

describe('nutrition JSON parser item cases', () => {
  it('accepts a complete item and preserves nutrient numbers', () => {
    const parsed = parseItem(item());
    expect(parsed.errors).toEqual([]);
    expect(parsed.nutrients.calories).toBe(100);
    expect(parsed.nutrients.fat).toBe(0);
  });

  it('reports a missing nutrient with its exact path and unit', () => {
    const ns = nutrients(); delete ns.fiber;
    expect(parseItem(item({ nutrients: ns })).errors.join(' ')).toContain('items[0].nutrients.fiber is missing (g per 100 g)');
  });

  it('rejects quoted nutrient units, nulls, and negative values', () => {
    expect(parseItem(item({ nutrients: { ...nutrients(), sodium: '12 mg' } })).errors.join(' ')).toContain('items[0].nutrients.sodium must be a number in mg without units');
    expect(parseItem(item({ nutrients: { ...nutrients(), sodium: null } })).errors.join(' ')).toContain('estimate it, or use 0 only');
    expect(parseItem(item({ nutrients: { ...nutrients(), sodium: -1 } })).errors.join(' ')).toContain('0 or more');
  });

  it('rejects non-finite values parsed from raw JSON', () => {
    const raw = JSON.stringify(document([item()])).replace('"calories":100', '"calories":1e999');
    const parsed = parseNutritionJson(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.items[0].errors.join(' ')).toContain('items[0].nutrients.calories must be a finite number.');
  });

  it('enforces plausible and tracker storage maxima while accepting the exact boundary', () => {
    const atBoundary = parseItem(item({ nutrients: { ...nutrients(), calories: 900 } }));
    expect(atBoundary.errors).toEqual([]);
    expect(parseItem(item({ nutrients: { ...nutrients(), calories: 900.01 } })).errors.join(' ')).toContain('above the plausible maximum of 900 kcal');
    expect(parseItem(item({ nutrients: { ...nutrients(), vitaminD: 400 } })).errors.join(' ')).toContain('above the plausible maximum of 300 mcg');
    expect(parseItem(item({ nutrients: { ...nutrients(), sodium: 38758 } })).errors.join(' ')).toContain('above the 23000 mg per 100 g the Nutrition Tracker can store');
  });

  it('flags per-serving macros and omega-3 above total fat', () => {
    const macro = parseItem(item({ nutrients: { ...nutrients(), protein: 60, carbs: 40, fat: 10 } }));
    expect(macro.errors.join(' ')).toContain('the values look per serving, not per 100 g');
    const omega = parseItem(item({ nutrients: { ...nutrients(), omega3: 5, fat: 1 } }));
    expect(omega.errors.join(' ')).toContain('omega3 (5 g) cannot exceed fat (1 g)');
  });

  it('treats energy mismatch as a warning only', () => {
    const parsed = parseItem(item({ nutrients: { ...nutrients(), calories: 500, protein: 10 } }));
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.join(' ')).toContain('differs from protein/carbs/fat');
  });

  it('warns when ingredientId is missing without making the row invalid', () => {
    const parsed = parseItem(item({ ingredientId: '' }));
    expect(parsed.ingredientId).toBeNull();
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.join(' ')).toContain('ingredientId is missing — assign the ingredient manually');
  });

  it('rejects a non-string name and warns for unknown nutrient keys', () => {
    const parsed = parseItem(item({ name: 7, nutrients: { ...nutrients(), mystery: 2 } }));
    expect(parsed.errors.join(' ')).toContain('items[0].name must be a string');
    expect(parsed.warnings.join(' ')).toContain('items[0].nutrients.mystery is not a tracked nutrient and was ignored');
  });

  it('truncates long assumptions and warns', () => {
    const parsed = parseItem(item({ assumptions: 'a'.repeat(400) }));
    expect(parsed.assumptions).toHaveLength(300);
    expect(parsed.warnings).toContain('items[0].assumptions was shortened to 300 characters.');
  });

  it('keeps a valid sibling isolated from an invalid item', () => {
    const bad = item({ nutrients: { ...nutrients(), sodium: -1 } });
    const result = parseNutritionJson(JSON.stringify(document([bad, item({ ingredientId: 'sibling' })])));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.items[0].errors.length).toBeGreaterThan(0); expect(result.items[1].errors).toEqual([]); }
  });

  it('normalizes negative zero to zero', () => {
    const raw = JSON.stringify(document([item()])).replace('"protein":0', '"protein":-0');
    const result = parseNutritionJson(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.is(result.items[0].nutrients.protein, -0)).toBe(false);
  });

  it('warns about unknown document fields', () => {
    const result = parseNutritionJson(JSON.stringify(document([item()], { futureField: true })));
    expect(result.ok && result.warnings).toContain('Ignored unknown field "futureField".');
    expect(NUTRIENT_INTAKE_SPEC).toHaveProperty('omega3');
  });
});
