import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { INGREDIENT_STORE_WRITES_ENABLED, NUTRIENT_V2_WRITES_ENABLED } from '../../public/shared/nutrition/capabilities.js';
import { importIngredientList, parseIngredientPaste, renderIngredientPaste, validateIngredientList } from '../../public/shared/nutrition/import/index.js';

const examples = readFileSync('docs/nutrition/assistant-contracts.md', 'utf8').split('## Examples')[1];
const example = JSON.parse(examples.match(/```json\n([\s\S]*?)```/)?.[1] ?? '');
const paste = examples.match(/```text\n([\s\S]*?)```/)?.[1] ?? '';

it('validates the documented ingredient list and paste round trip', () => {
    const validated = validateIngredientList(example);
    expect(validated.ok, JSON.stringify(validated.errors)).toBe(true);
    const parsed = parseIngredientPaste(paste);
    expect(parsed.ok, JSON.stringify(parsed.errors)).toBe(true);
    expect(renderIngredientPaste(parsed.list).text).toBe(paste);
    const copy = structuredClone(example);
    delete copy.producer;
    delete copy.inputs;
    for (const line of copy.ingredients) {
        delete line.role;
        delete line.confidence;
    }
    for (const fact of copy.knownFacts) {
        for (const nutrient of Object.values(fact.nutrients as Record<string, { rounding?: string }>)) delete nutrient.rounding;
    }
    expect(renderIngredientPaste(copy).text).toBe(paste);
    expect(importIngredientList({ ...example, schemaVersion: 2 }).errors?.[0]?.message).toBe('site update required');
    expect(renderIngredientPaste(example).reason).toBe('json-only');
    expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
});
