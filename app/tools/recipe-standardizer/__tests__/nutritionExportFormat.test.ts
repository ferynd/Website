/* --- CONFIGURATION: export formatting test matrix --- */
/** Regression coverage for nutritionExportFormat.test. Fixtures remain local and do not access production data. */

const BLOCK_REASONS = [
  'foods-unavailable',
  'no-coverage',
  'no-portion-data',
  'no-final-weight',
  'estimated-final-weight',
  'over-tracker-cap',
  'non-finite',
] as const;

/**
 * Verifies user-facing copy for export availability, status, warnings, and outcomes.
 */

import { describe, expect, it } from 'vitest';
import {
  butterCookiesRecipe,
  exportedRef,
  gapFoodsReady,
  gapRecipe,
  sourceFoodsReady,
} from './exportFixtures';
import {
  buildExportPayload,
  calculateExportNutrition,
  deriveExportStatuses,
  type ExportStatus,
} from '../lib/nutritionExport';
import {
  buildExportCardModel,
  exportRowLabel,
  describeExportBlock,
  describeExportBlocks,
  describeExportOutcome,
  describeExportStatus,
  exportDisabledReason,
  exportQuantityHint,
  exportSubtitleSuffix,
  partialExportWarning,
  zeroFilledNote,
} from '../lib/nutritionExportFormat';

const completePayload = () => {
  const recipe = butterCookiesRecipe();
  const result = buildExportPayload(
    recipe,
    calculateExportNutrition(recipe, sourceFoodsReady()),
    'perPortion',
  );
  if (!result.ok) throw new Error('Expected exportable test payload.');
  return result.payload;
};

const status = (overrides: Partial<ExportStatus> = {}): ExportStatus => ({
  basis: 'perPortion',
  ref: exportedRef(),
  ownership: 'own',
  recipe: 'current',
  target: 'unchanged',
  targetFood: null,
  stale: false,
  ...overrides,
});

describe('nutritionExportFormat', () => {
  it('keeps each blocked explanation attached to its export basis', () => {
    const blocks = describeExportBlocks({
      perPortion: {
        ok: true,
        payload: completePayload(),
      },
      per100gCooked: {
        ok: false,
        reason: 'no-final-weight',
        overCapKeys: [],
      },
    });
    expect(blocks.perPortion).toBeNull();
    expect(blocks.per100gCooked).toContain('Per 100 g cooked needs a measured cooked weight');
  });

  it.each(BLOCK_REASONS)('describeExportBlock covers every ExportBlockReason', (reason) => {
    const copy = describeExportBlock(reason, 'perPortion', ['calories']);
    expect(copy.length).toBeGreaterThan(10);
  });

  it.each([
    [status(), 'Up to date', 'success'],
    [
      status({ recipe: 'changed', stale: true }),
      'Out of date — recipe nutrition changed since export',
      'warning',
    ],
    [
      status({ recipe: 'unavailable', stale: true }),
      'Out of date — can\'t recompute this basis now',
      'warning',
    ],
    [
      status({ target: 'modified', stale: true }),
      'Edited in the Nutrition Tracker since export',
      'warning',
    ],
    [status({ target: 'missing', stale: true }), 'Deleted from the Nutrition Tracker', 'error'],
    [
      status({
        ownership: 'foreign',
        recipe: 'unknown',
        target: 'unknown',
      }),
      'Exported from another copy of this recipe — exporting creates a new food',
      'muted',
    ],
    [status({ target: 'unknown' }), 'Can\'t check — Nutrition Tracker foods aren\'t loaded', 'muted'],
  ] as const)('describeExportStatus maps each state combination to label and tone', (value, label, tone) => {
    expect(describeExportStatus(value)).toEqual({ label, tone });
  });

  it('exportQuantityHint per portion includes count and ~grams when known, omits grams when unknown', () => {
    const payload = completePayload();
    expect(exportQuantityHint(payload)).toContain('1 of 4');
    expect(exportQuantityHint(payload)).toContain('~80 g');
    expect(exportQuantityHint({ ...payload, portionSizeG: null })).not.toContain('~ g');
  });

  it('exportQuantityHint per 100 g explains grams ÷ 100 with the 250 g → 2.5 example', () => {
    expect(exportQuantityHint({ ...completePayload(), basis: 'per100gCooked' })).toContain('250 g → 2.5');
  });

  it('partialExportWarning lists counted/total, percent and excluded names', () => {
    const payload = {
      ...completePayload(),
      coverage: 'partial' as const,
      includedCount: 2,
      totalCount: 3,
      coveragePercent: '79%',
      excludedNames: ['sugar'],
    };
    expect(partialExportWarning(payload)).toContain('2 of 3');
    expect(partialExportWarning(payload)).toContain('79%');
    expect(partialExportWarning(payload)).toContain('Not counted: sugar');
  });

  it('zeroFilledNote is empty without zero-filled keys and lists labels in canonical order otherwise', () => {
    const payload = completePayload();
    expect(zeroFilledNote(payload)).toBe('');
    expect(zeroFilledNote({ ...payload, zeroFilledKeys: ['vitaminD', 'fiber', 'calories'] })).toBe(
      'Saved as 0 because no counted ingredient has data: Calories, Fiber, Vitamin D.',
    );
  });

  it('nutrient gaps on a fully linked recipe use partial coverage and name the missing nutrients', () => {
    const recipe = gapRecipe();
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, gapFoodsReady()),
      'perPortion',
    );
    if (!result.ok) throw new Error('Expected export payload for a fully linked recipe.');
    expect(result.payload.coverage).toBe('partial');
    expect(result.payload.includedCount).toBe(result.payload.totalCount);
    expect(result.payload.zeroFilledKeys).toContain('vitaminD');
    expect(result.payload.lowerBoundKeys).toContain('fiber');
    const warning = partialExportWarning(result.payload);
    expect(warning).toContain('linked foods omit some nutrients');
    expect(warning).toContain('Fiber');
    expect(warning).toContain('Vitamin D');
    expect(warning).not.toContain(`${result.payload.includedCount} of ${result.payload.totalCount}`);
    expect(zeroFilledNote(result.payload)).toContain('Vitamin D');
  });

  it('exportSubtitleSuffix is empty when nothing is stale and set when any own export is stale', () => {
    expect(exportSubtitleSuffix([status()])).toBe('');
    expect(exportSubtitleSuffix([status({ stale: true, recipe: 'changed' })])).toBe(
      ' · tracker food out of date',
    );
    expect(exportSubtitleSuffix([status({ ownership: 'foreign', stale: true })])).toBe('');
  });

  it('exportDisabledReason prioritizes unsaved > dirty > foods not ready > null', () => {
    expect(exportDisabledReason({
      saved: false,
      dirty: true,
      foodsStatus: 'error',
    })).toContain(
      'Save the recipe',
    );
    expect(exportDisabledReason({
      saved: true,
      dirty: true,
      foodsStatus: 'error',
    })).toContain(
      'Save your changes',
    );
    expect(exportDisabledReason({
      saved: true,
      dirty: false,
      foodsStatus: 'loading',
    })).toContain(
      'Load Nutrition Tracker',
    );
    expect(exportDisabledReason({
      saved: true,
      dirty: false,
      foodsStatus: 'ready',
    })).toBeNull();
  });

  it('describeExportOutcome covers done(create/update), collision, review-changed, error', () => {
    expect(describeExportOutcome({
      status: 'done',
      mode: 'create',
      foodName: 'Cookies',
    })).toContain(
      'Created “Cookies”',
    );
    expect(describeExportOutcome({
      status: 'done',
      mode: 'create',
      foodName: 'Cookies',
    })).toContain(
      'quantity 1 = one portion / 100 g',
    );
    expect(describeExportOutcome({
      status: 'done',
      mode: 'update',
      foodName: 'Cookies',
    })).toBe(
      'Updated “Cookies”.',
    );
    expect(describeExportOutcome({ status: 'collision', foodId: 'cookies' })).toContain(
      'Choose another name',
    );
    expect(describeExportOutcome({ status: 'review-changed', message: 'Review again.' })).toBe(
      'Review again.',
    );
    expect(describeExportOutcome({ status: 'error', message: 'Failed.' })).toBe('Failed.');
  });
});

const cardInput = (own = false, measured = true) => {
  const recipe = butterCookiesRecipe();
  if (!measured) recipe.yield.actualFinalWeightG = null;
  if (own) recipe.nutritionExports = { perPortion: exportedRef() };
  const foods = sourceFoodsReady();
  const result = calculateExportNutrition(recipe, foods);
  return {
    recipe,
    result,
    recipeId: 'recipe-1' as string | null,
    dirty: false,
    foodsStatus: 'ready' as const,
    statuses: deriveExportStatuses(recipe, 'recipe-1', result, foods),
  };
};

describe('buildExportCardModel', () => {
  it('primary export is disabled when the only exportable basis is already owned', () => {
    expect(buildExportCardModel(cardInput(true, false)).primaryDisabled).toBe(true);
  });
  it('owned basis stays re-exportable from its row while the primary button is disabled', () => {
    const model = buildExportCardModel(cardInput(true, false));
    expect(model.primaryDisabled).toBe(true);
    expect(model.rows[0]).toMatchObject({
      showButton: true,
      disabled: false,
      action: 'recreate',
    });
  });
  it('primary export opens the missing basis directly when another basis is owned', () => {
    expect(buildExportCardModel(cardInput(true)).primaryTarget).toBe('per100gCooked');
  });
  it('primary export opens the chooser on a first export', () => {
    expect(buildExportCardModel(cardInput()).primaryTarget).toBe('choose');
  });
  it('primary export is enabled for a basis that has only a foreign reference', () => {
    const input = cardInput(true, false);
    input.statuses[0] = { ...input.statuses[0], ownership: 'foreign' };
    expect(buildExportCardModel(input).primaryDisabled).toBe(false);
  });
  it('primary export is disabled when no basis is exportable', () => {
    const input = cardInput(false, false);
    input.recipe.servings.portionCount = null;
    input.recipe.servings.portionSizeG = null;
    input.result = calculateExportNutrition(input.recipe, sourceFoodsReady());
    expect(buildExportCardModel(input).primaryDisabled).toBe(true);
  });
  it('primary export and rows share the unsaved/dirty/foods disabled reason', () => {
    const input = cardInput(true);
    for (const extra of [{ recipeId: null }, { dirty: true }, { foodsStatus: 'error' as const }]) {
      const model = buildExportCardModel({ ...input, ...extra });
      expect(model.primaryDisabled).toBe(true);
      expect(model.disabledReason).not.toBeNull();
      expect(model.rows[0].disabledReason).toBe(model.disabledReason);
      expect(model.rows[0].disabled).toBe(true);
    }
  });
  it('foreign rows render no action button', () => {
    const input = cardInput(true);
    input.statuses[0] = { ...input.statuses[0], ownership: 'foreign' };
    expect(buildExportCardModel(input).rows[0].showButton).toBe(false);
  });
  it('all-exported note shows only when every exportable basis is owned and nothing else blocks', () => {
    const input = cardInput(true, false);
    expect(buildExportCardModel(input).primaryNote).toContain('Every available basis is already exported');
    expect(buildExportCardModel({ ...input, dirty: true }).primaryNote).toBeNull();
    expect(buildExportCardModel(cardInput(true)).primaryNote).toBeNull();
    expect(buildExportCardModel(cardInput()).primaryNote).toBeNull();
  });
  it.each([
    ['create', 'Export to Nutrition Tracker'], ['blocked', 'Export to Nutrition Tracker'],
    ['update', 'Update tracker food'], ['update-overwrite-tracker-edits', 'Update tracker food'],
    ['recreate', 'Create it again'],
  ] as const)('row label for %s', (action, label) => {
    expect(exportRowLabel(action)).toBe(label);
  });
});
