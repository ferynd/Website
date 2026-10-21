import { describe, expect, it } from 'vitest';
import { allNutrients, nutrients } from '../../../../public/tools/CalorieTracker/constants.js';
import {
  type NutritionCoverage,
  type NutritionBasis,
  type RecipeNutritionResult,
  type NutritionExclusionReason,
} from '../lib/nutritionCalc';
import { TRACKER_NUTRIENT_KEYS } from '../lib/trackerFoods';
import {
  BASIS_LABELS,
  coverageDetail,
  coverageHeadline,
  defaultBasis,
  describeBasisCaption,
  describeBasisUnavailable,
  describeExclusionReason,
  exclusionTone,
  formatCoveragePercent,
  formatCount,
  formatNutrientAmount,
  formatNutrientNumber,
  formatWholeGrams,
  HEADLINE_NUTRIENT_KEYS,
  LOWER_BOUND_PREFIX,
  NUTRIENT_DISPLAY_GROUPS,
  nutrientGapNote,
  nutrientLabel,
  nutritionPanelSubtitle,
} from '../lib/nutritionFormat';

const coverage = (overrides: Partial<NutritionCoverage> = {}): NutritionCoverage => ({
  status: 'complete',
  includedCount: 2,
  totalCount: 2,
  coveredGrams: 200,
  knownGrams: 200,
  unknownWeightCount: 0,
  optionalIncludedCount: 0,
  nutrientGaps: [],
  ...overrides,
});

const basis = (
  key: NutritionBasis['key'],
  overrides: Partial<NutritionBasis> = {},
): NutritionBasis => ({
  key,
  available: true,
  unavailableReason: null,
  estimated: false,
  servings: null,
  portionMode: null,
  portionCount: null,
  portionSizeG: null,
  finalWeightG: null,
  weightSource: null,
  amounts: null,
  ...overrides,
});

const result = (
  state: RecipeNutritionResult['foodsStatus'],
  stateCoverage = coverage(),
  basisOverrides: Partial<RecipeNutritionResult['bases']> = {},
): RecipeNutritionResult => ({
  foodsStatus: state,
  factor: 1,
  coverage: stateCoverage,
  bases: {
    total: basis('total'),
    perServing: basis('perServing'),
    perPortion: basis('perPortion'),
    per100gCooked: basis('per100gCooked'),
    ...basisOverrides,
  },
  included: [],
  excluded: [],
});

describe('nutrient display metadata', () => {
  it('keeps headline nutrient keys aligned with CalorieTracker macros', () => {
    expect([...HEADLINE_NUTRIENT_KEYS]).toEqual(nutrients.macros);
  });

  it('mirrors tracker nutrient groups and canonical key order', () => {
    const flattened = NUTRIENT_DISPLAY_GROUPS.flatMap((group) => [...group.nutrients]);
    expect(NUTRIENT_DISPLAY_GROUPS.map((group) => group.key)).toEqual(Object.keys(nutrients));
    expect(flattened).toEqual(allNutrients);
    expect(flattened).toEqual(TRACKER_NUTRIENT_KEYS);
    expect(flattened).toHaveLength(24);
  });

  it('provides a label and supported unit for every nutrient', () => {
    for (const key of TRACKER_NUTRIENT_KEYS) {
      expect(nutrientLabel(key)).toBeTruthy();
      expect(['kcal', 'g', 'mg', 'mcg']).toContain(formatNutrientAmount(key, { value: 1, isLowerBound: false }).split(' ')[1]);
    }
  });
});

describe('nutrient rounding and formatting', () => {
  it('rounds calories to whole kcal and shows small nonzero values below one', () => {
    expect(formatNutrientNumber(1092.6, 'kcal')).toBe('1093 kcal');
    expect(formatNutrientNumber(0.4, 'kcal')).toBe('<1 kcal');
  });

  it.each([
    [123.45, '123 g'],
    [44.94, '44.9 g'],
    [5.06, '5.1 g'],
    [0.456, '0.46 g'],
    [0.004, '<0.01 g'],
  ])('rounds gram amounts by tier: %s', (value, expected) => {
    expect(formatNutrientNumber(value, 'g')).toBe(expected);
  });

  it.each([
    [2345.6, '2346 mg'],
    [45.67, '45.7 mg'],
    [2.346, '2.35 mg'],
    [0.004, '<0.01 mcg'],
  ])('rounds mg and mcg amounts by tier: %s', (value, expected) => {
    const unit = expected.endsWith('mcg') ? 'mcg' : 'mg';
    expect(formatNutrientNumber(value, unit)).toBe(expected);
  });

  it('formats zero and negative zero as zero', () => {
    expect(formatNutrientNumber(0, 'g')).toBe('0 g');
    expect(formatNutrientNumber(-0, 'g')).toBe('0 g');
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'formats missing or non-finite values as an unadorned dash: %s',
    (value) => expect(formatNutrientNumber(value, 'g')).toBe('—'),
  );

  it('prefixes lower bounds with the canonical marker', () => {
    expect(formatNutrientAmount('protein', { value: 44.94, isLowerBound: true })).toBe(`${LOWER_BOUND_PREFIX}44.9 g`);
  });

  it('is deterministic for repeated values and decimal sums', () => {
    const value = 0.1 + 0.2;
    expect(formatNutrientNumber(value, 'g')).toBe(formatNutrientNumber(value, 'g'));
    expect(formatNutrientNumber(value, 'g')).toBe('0.3 g');
  });

  it('formats whole grams and counts without locale-dependent separators', () => {
    expect(formatWholeGrams(625.4)).toBe('625 g');
    expect(formatCount(1.236)).toBe('1.24');
  });
});

describe('coverage display', () => {
  it('floors partial coverage percent so it cannot show 100 percent early', () => {
    expect(formatCoveragePercent(coverage({ status: 'partial', coveredGrams: 99.6, knownGrams: 100 }))).toBe('99%');
  });

  it('returns 100 percent for complete coverage and null when known grams are zero', () => {
    expect(formatCoveragePercent(coverage())).toBe('100%');
    expect(formatCoveragePercent(coverage({ status: 'partial', coveredGrams: 0, knownGrams: 0 }))).toBeNull();
  });

  it.each([
    ['loading', 'Loading Nutrition Tracker foods…'],
    ['error', "Couldn't load Nutrition Tracker foods — nutrition can't be checked."],
    ['idle', "Nutrition Tracker foods aren't loaded yet."],
  ] as const)('builds the %s headline', (status, expected) => {
    expect(coverageHeadline(result(status))).toBe(expected);
  });

  it('builds the empty recipe headline', () => {
    expect(coverageHeadline(result('ready', coverage({ totalCount: 0, includedCount: 0, status: 'none' })))).toBe('This recipe has no ingredients.');
  });

  it('builds the complete coverage headline', () => {
    expect(coverageHeadline(result('ready'))).toBe('Complete — all 2 ingredients counted.');
  });

  it('builds the partial coverage headline', () => {
    expect(coverageHeadline(result('ready', coverage({ status: 'partial', includedCount: 1 })))).toContain('Partial — 1 of 2');
  });

  it('builds the none-counted headline', () => {
    expect(coverageHeadline(result('ready', coverage({ status: 'none', includedCount: 0 })))).toContain('Not calculated yet');
  });

  it('adds unknown-weight and optional ingredient details when present', () => {
    const line = coverageDetail(result('ready', coverage({ unknownWeightCount: 1, optionalIncludedCount: 2 })));
    expect(line).toContain('1 ingredient(s) with no gram weight');
    expect(line).toContain('includes 2 optional ingredient(s)');
  });
});

describe('exclusion copy and basis copy', () => {
  it.each([
    ['unlinked', {}, 'Not linked to a Nutrition Tracker food.'],
    ['no-match', {}, 'Marked as having no Nutrition Tracker match.'],
    ['candidate', {}, 'Suggested match "Milk" isn\'t confirmed — confirm it with a gram basis to count it.'],
    ['candidate-missing', {}, 'The suggested food "Milk" no longer exists in the Nutrition Tracker.'],
    ['stale-missing', {}, 'Needs review: the confirmed food "Milk" was deleted from the Nutrition Tracker.'],
    ['stale-renamed', {}, 'Needs review: the confirmed food was renamed from "Milk" to "Oat Milk".'],
    ['stale-revised', {}, 'Needs review: "Milk" changed in the Nutrition Tracker since you confirmed it.'],
    ['unverifiable-target', {}, 'Confirmed without change tracking — re-confirm the link to count it.'],
    ['invalid-basis', {}, 'The grams in one Nutrition Tracker unit are missing or invalid — re-confirm the link.'],
    ['foods-unavailable', {}, "Confirmed, but Nutrition Tracker foods aren't loaded, so the link can't be checked."],
    ['missing-quantity', { equivalent: '2 cloves' }, 'No gram weight (listed as "2 cloves") — add grams to count it.'],
    ['missing-quantity', {}, 'No gram weight — add grams to count it.'],
    ['zero-quantity', {}, 'Weight is 0 g — enter the real gram weight to count it.'],
    ['invalid-quantity', {}, "The gram weight isn't a valid amount — edit the ingredient."],
    ['duplicate-id', {}, 'Duplicate ingredient entry (same id as an earlier row) — not counted.'],
  ] satisfies Array<[NutritionExclusionReason, { equivalent?: string }, string]>)('matches the copy table for %s', (reason, row, expected) => {
    expect(describeExclusionReason(reason, {
      ...row,
      matchedName: 'Milk',
      currentName: 'Oat Milk',
    })).toBe(expected);
  });

  it('interpolates stale matched and current names and falls back for null names', () => {
    expect(describeExclusionReason('stale-renamed', { matchedName: 'Milk', currentName: 'Oat Milk' })).toContain('Milk" to "Oat Milk');
    expect(describeExclusionReason('stale-renamed', { matchedName: null, currentName: null })).toContain('the linked food');
  });

  it('quotes equivalent text only when it is present for missing quantity', () => {
    expect(describeExclusionReason('missing-quantity', { equivalent: '2 cloves' })).toContain('"2 cloves"');
    expect(describeExclusionReason('missing-quantity', {})).not.toContain('"');
  });

  it.each([
    ['no-coverage', 'total', 'No ingredients are counted yet.'],
    ['no-servings', 'perServing', "This recipe doesn't list servings."],
    ['no-portion-data', 'perPortion', 'This recipe has no portion count or portion size.'],
    ['no-final-weight', 'perPortion', 'portion size is known'],
    ['no-final-weight', 'per100gCooked', 'actual cooked weight'],
  ] as const)('describes unavailable %s basis %s', (reason, key, text) => {
    expect(describeBasisUnavailable(reason, key)).toContain(text);
  });

  it.each([
    [basis('total'), 'Whole recipe'],
    [basis('perServing', { servings: 4 }), '1 of 4 servings'],
    [basis('perPortion', { portionMode: 'override', portionCount: 10, portionSizeG: 150 }), '1 of 10 portions of ~150 g'],
    [basis('perPortion', { portionMode: 'count', portionCount: 8, portionSizeG: 50 }), '1 of 8 portions · ~50 g each'],
    [basis('perPortion', { portionMode: 'count', portionCount: 8, portionSizeG: null }), '1 of 8 portions'],
    [basis('perPortion', { portionMode: 'size', portionSizeG: 100, finalWeightG: 1000 }), 'One 100 g portion of a 1000 g batch'],
    [basis('per100gCooked', { finalWeightG: 900, estimated: true }), 'Final weight 900 g (estimated)'],
  ])('captions the %s basis', (value, expected) => {
    expect(describeBasisCaption(value, 1)).toBe(expected);
  });

  it('labels a scaled measured cooked weight as a projection', () => {
    const actualWeight = basis('per100gCooked', {
      finalWeightG: 1800,
      weightSource: 'actual',
      estimated: true,
    });
    expect(describeBasisCaption(actualWeight, 2)).toBe('Final weight 1800 g (scaled from measured)');
  });

  it('labels an unscaled actual cooked weight as measured', () => {
    const actualWeight = basis('per100gCooked', {
      finalWeightG: 900,
      weightSource: 'actual',
      estimated: false,
    });
    expect(describeBasisCaption(actualWeight, 1)).toBe('Final weight 900 g (measured)');
  });
});

describe('panel status helpers', () => {
  it.each([
    ['loading', coverage(), 'Checking Nutrition Tracker foods…'],
    ['error', coverage(), "Nutrition Tracker foods couldn't be loaded"],
    ['idle', coverage(), 'Nutrition Tracker foods not loaded'],
    ['ready', coverage({ totalCount: 0, includedCount: 0, status: 'none' }), 'No ingredients'],
    ['ready', coverage({ status: 'complete' }), 'Complete — 2 of 2 ingredients counted'],
    ['ready', coverage({ status: 'partial', includedCount: 1 }), 'Partial — 1 of 2 ingredients counted'],
    ['ready', coverage({ status: 'none', includedCount: 0 }), 'None counted yet — confirm links to see nutrition'],
  ] as const)('builds subtitle for %s state', (status, statusCoverage, expected) => {
    expect(nutritionPanelSubtitle(result(status, statusCoverage))).toBe(expected);
  });

  it('lists nutrient gap labels in canonical order', () => {
    const text = nutrientGapNote(coverage({ nutrientGaps: ['protein', 'calories'] }));
    expect(text.indexOf('Calories')).toBeLessThan(text.indexOf('Protein'));
  });

  it('picks per-serving, then per-portion, then total as the default basis', () => {
    const first = result('ready', coverage(), { perServing: basis('perServing'), perPortion: basis('perPortion') });
    expect(defaultBasis(first)).toBe('perServing');
    const second = result('ready', coverage(), { perServing: basis('perServing', { available: false }), perPortion: basis('perPortion') });
    expect(defaultBasis(second)).toBe('perPortion');
    const third = result('ready', coverage(), { perServing: basis('perServing', { available: false }), perPortion: basis('perPortion', { available: false }) });
    expect(defaultBasis(third)).toBe('total');
  });

  it.each([
    [{ reasons: ['stale-missing'] as NutritionExclusionReason[] }, 'error'],
    [{ reasons: ['candidate'] as NutritionExclusionReason[] }, 'warning'],
    [{ reasons: ['unlinked'] as NutritionExclusionReason[] }, 'muted'],
  ])('assigns the expected exclusion tone', (row, expected) => {
    expect(exclusionTone(row)).toBe(expected);
  });

  it('keeps basis labels available for all selector choices', () => {
    expect(Object.keys(BASIS_LABELS)).toEqual(['total', 'perServing', 'perPortion', 'per100gCooked']);
  });
});
