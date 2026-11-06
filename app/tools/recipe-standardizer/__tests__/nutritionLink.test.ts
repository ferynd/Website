import { describe, expect, it } from 'vitest';
import { resolveNutrientWriteVersion } from '@/public/shared/nutrition/capabilities.js';
import { matchIngredientName } from '../lib/nutritionMatch';
import {
  assessNutritionLink, candidateLink, confirmNutritionLink, linkAfterRename, noMatchLink,
  parseNutritionLink, summarizeLinkReview,
} from '../lib/nutritionLink';
import { parseRecipeJson } from '../lib/schema';
import { fingerprintTrackerFood, fingerprintTrackerFoodV2, TRACKER_NUTRIENT_KEYS, type TrackerFood } from '../lib/trackerFoods';
import { UNLINKED_NUTRITION } from '../lib/types';
import { validRecipeJson } from './fixtures';

const food = (id = 'egg', name = 'Egg'): TrackerFood => ({
  id, name, quantity: 1,
  nutrients: Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, key === 'calories' ? 70 : 1])) as TrackerFood['nutrients'],
  lastUpdated: '2025-01-01T00:00:00.000Z',
});

describe('parseNutritionLink', () => {
  it('maps legacy statuses to candidate and defaults confirmation metadata', () => {
    const warnings: string[] = [];
    expect(parseNutritionLink(undefined, 'p', warnings)).toEqual(UNLINKED_NUTRITION);
    const legacy = parseNutritionLink({ status: 'linked', foodItemId: 'f', matchConfidence: 1, needsUserReview: false }, 'p', warnings);
    expect(legacy).toMatchObject({ status: 'candidate', foodItemId: 'f', needsUserReview: true, gramsPerUnit: null, confirmedAtMs: null, targetRevision: null, targetFingerprint: null });
    expect(parseNutritionLink({ status: 'likely', foodItemId: 'f' }, 'p', warnings).status).toBe('candidate');
    expect(parseNutritionLink({ status: 'linked' }, 'p', warnings)).toEqual(UNLINKED_NUTRITION);
    expect(parseNutritionLink({ status: 'no-match', foodItemId: 'f' }, 'p', warnings)).toMatchObject({ status: 'no-match', foodItemId: null, needsUserReview: false });
    expect(parseNutritionLink({ status: 'candidate', foodItemId: 'f', gramsPerUnit: 50 }, 'p', warnings).gramsPerUnit).toBeNull();
  });

  it('validates confirmed basis, clamps confidence, and parses idempotently', () => {
    const confirmed = { status: 'confirmed', foodItemId: 'egg', matchedName: 'Egg', matchConfidence: 2, needsUserReview: true,
      gramsPerUnit: 50, confirmedAtMs: 10, targetRevision: 'rev', targetFingerprint: 'hash' };
    const warnings: string[] = [];
    expect(parseNutritionLink(confirmed, 'p', warnings)).toMatchObject({ status: 'confirmed', matchConfidence: 1, needsUserReview: false });
    for (const value of [0, -1, null, 'abc', 20000]) {
      const list: string[] = [];
      expect(parseNutritionLink({ ...confirmed, gramsPerUnit: value }, 'ingredients[0].nutritionLink', list).status).toBe('candidate');
      expect(list[0]).toContain('ingredients[0].nutritionLink.gramsPerUnit');
    }
    const cases = [undefined, null, { status: 'linked', foodItemId: 'x' }, { status: 'no-match' }, confirmed];
    cases.forEach((input) => {
      const parsed = parseNutritionLink(input, 'p', []);
      expect(parseNutritionLink(JSON.parse(JSON.stringify(parsed)), 'p', [])).toEqual(parsed);
    });
  });
});

describe('nutrition link lifecycle', () => {
  it('confirms with provenance and rejects invalid basis', () => {
    const suggested = candidateLink(food(), 1);
    expect(confirmNutritionLink(food(), 50, 123, suggested)).toMatchObject({ status: 'confirmed', foodItemId: 'egg', matchedName: 'Egg', gramsPerUnit: 50, confirmedAtMs: 123, targetRevision: food().lastUpdated });
    expect(confirmNutritionLink(food(), 50, 123, suggested).matchConfidence).toBe(1);
    expect(confirmNutritionLink(food('other'), 50, 123, suggested).matchConfidence).toBeNull();
    expect(() => confirmNutritionLink(food(), 0, 1, suggested)).toThrow();
    expect(linkAfterRename(confirmNutritionLink(food(), 50, 1, suggested))).toMatchObject({ status: 'candidate', gramsPerUnit: null, foodItemId: 'egg' });
    expect(linkAfterRename(noMatchLink())).toEqual(UNLINKED_NUTRITION);
    expect(linkAfterRename(suggested)).toEqual(UNLINKED_NUTRITION);
  });

  it('assesses unverified, missing, renamed, revised, and confirmed targets', () => {
    const confirmed = confirmNutritionLink(food(), 50, 1, UNLINKED_NUTRITION);
    expect(assessNutritionLink(confirmed, null).state).toBe('confirmed-unverified');
    expect(assessNutritionLink(confirmed, new Map()).state).toBe('stale-missing');
    expect(assessNutritionLink(confirmed, new Map([['egg', food('egg', 'Large Egg')]])).state).toBe('stale-renamed');
    expect(assessNutritionLink(confirmed, new Map([['egg', { ...food(), nutrients: { ...food().nutrients, calories: 80 } }]])).state).toBe('stale-revised');
    expect(assessNutritionLink(confirmed, new Map([['egg', food('egg', 'Egg!')]])).state).toBe('confirmed');
    expect(assessNutritionLink(candidateLink(food(), 1), new Map()).state).toBe('candidate-missing');
    expect(summarizeLinkReview([
      assessNutritionLink(confirmed, new Map()), assessNutritionLink(candidateLink(food(), 1), null),
      assessNutritionLink(noMatchLink(), null), assessNutritionLink(UNLINKED_NUTRITION, null),
    ])).toEqual({ stale: 1, candidates: 1, unlinked: 1, noMatch: 1, confirmed: 0, confirmedLegacy: 0, unverified: 0 });
  });

  it('keeps exact matches unconfirmed and preserves different gram bases through recipe JSON', () => {
    const suggested = matchIngredientName('egg', [food(), food('whites', 'Egg whites')]);
    expect(suggested).toMatchObject({ status: 'candidate', gramsPerUnit: null, needsUserReview: true });
    const base = validRecipeJson();
    base.ingredients[0].nutritionLink = confirmNutritionLink(food(), 50, 1, suggested) as never;
    const fifty = parseRecipeJson(JSON.stringify(base));
    expect(fifty.ok && fifty.recipe.ingredients[0].nutritionLink.gramsPerUnit).toBe(50);
    base.ingredients[0].nutritionLink = confirmNutritionLink(food(), 100, 2, suggested) as never;
    const hundred = parseRecipeJson(JSON.stringify(base));
    expect(hundred.ok && hundred.recipe.ingredients[0].nutritionLink.gramsPerUnit).toBe(100);
  });

  it('confirmed-legacy state for v1 links on expanded foods', () => {
    const linked = confirmNutritionLink(food(), 100, 1, UNLINKED_NUTRITION);
    const expanded = { ...food(), detail: { fatSaturated: 3 } };
    expect(assessNutritionLink(linked, new Map([['egg', expanded]])).state).toBe('confirmed-legacy');
    expect(assessNutritionLink(linked, new Map([['egg', food()]])).state).toBe('confirmed');
    expect(assessNutritionLink(linked, new Map([['egg', { ...food(), nutrients: { ...food().nutrients, calories: 1 } }]])).state).toBe('stale-revised');
    const summary = summarizeLinkReview([assessNutritionLink(linked, new Map([['egg', expanded]]))]);
    expect(summary.confirmed).toBe(1);
    expect(summary.confirmedLegacy).toBe(1);
    expect(summary.stale).toBe(0);
  });

  it('confirm stores a v1 fingerprint while writes are off', () => {
    expect(resolveNutrientWriteVersion()).toBe(1);
    const link = confirmNutritionLink(food(), 50, 1, UNLINKED_NUTRITION);
    expect(link.targetFingerprint).toBe(fingerprintTrackerFood(food()));
    expect(link.targetFingerprint).not.toMatch(/^v2:/);
  });

  it('a v2 confirmation goes stale when only upperBound, rounding interval, or qualifier changes', () => {
    const bounded = {
      ...food(),
      schema: 2 as const,
      quality: { protein: { status: 'label_reported' as const, upperBound: 5 } },
    };
    const boundedLink = {
      ...confirmNutritionLink(bounded, 50, 1, UNLINKED_NUTRITION),
      targetFingerprint: fingerprintTrackerFoodV2(bounded),
    };
    expect(assessNutritionLink(boundedLink, new Map([['egg', bounded]])).state).toBe('confirmed');
    expect(assessNutritionLink(boundedLink, new Map([['egg', {
      ...bounded,
      quality: { protein: { status: 'label_reported', upperBound: 10 } },
    }]])).state).toBe('stale-revised');

    const rounded = {
      ...food(),
      schema: 2 as const,
      quality: { fiber: { status: 'label_reported' as const, roundingInterval: 1 } },
    };
    const roundedLink = {
      ...confirmNutritionLink(rounded, 50, 1, UNLINKED_NUTRITION),
      targetFingerprint: fingerprintTrackerFoodV2(rounded),
    };
    expect(assessNutritionLink(roundedLink, new Map([['egg', {
      ...rounded,
      quality: { fiber: { status: 'label_reported', roundingInterval: 0.1 } },
    }]])).state).toBe('stale-revised');

    const calculated = {
      ...food(),
      schema: 2 as const,
      quality: { calories: { status: 'calculated' as const, qualifier: 'lower_bound' } },
    };
    const calculatedLink = {
      ...confirmNutritionLink(calculated, 50, 1, UNLINKED_NUTRITION),
      targetFingerprint: fingerprintTrackerFoodV2(calculated),
    };
    expect(assessNutritionLink(calculatedLink, new Map([['egg', {
      ...calculated,
      quality: { calories: { status: 'calculated' } },
    }]])).state).toBe('stale-revised');

    const v1 = confirmNutritionLink(food(), 50, 1, UNLINKED_NUTRITION);
    expect(v1.targetFingerprint).toBe(fingerprintTrackerFood(food()));
    expect(v1.targetFingerprint).not.toMatch(/^v2:/);
    expect(assessNutritionLink(v1, new Map([['egg', bounded]])).state).toBe('confirmed');
    expect(assessNutritionLink(v1, new Map([['egg', calculated]])).state).toBe('confirmed');
  });

  it('a v2 confirmation goes stale when only fiber or carbohydrate convention changes', () => {
    const base = { ...food(), schema: 2 as const, fiberMeaning: 'weighted_legacy' as const, carbConvention: 'includes_fiber' as const };
    const link = {
      ...confirmNutritionLink(base, 50, 1, UNLINKED_NUTRITION),
      targetFingerprint: fingerprintTrackerFoodV2(base),
    };
    expect(assessNutritionLink(link, new Map([['egg', base]])).state).toBe('confirmed');
    expect(assessNutritionLink(link, new Map([['egg', { ...base, fiberMeaning: 'total' }]])).state).toBe('stale-revised');
    expect(assessNutritionLink(link, new Map([['egg', { ...base, carbConvention: 'excludes_fiber' }]])).state).toBe('stale-revised');
    const v1 = confirmNutritionLink(food(), 50, 1, UNLINKED_NUTRITION);
    expect(v1.targetFingerprint).toBe(fingerprintTrackerFood(food()));
    expect(v1.targetFingerprint).not.toMatch(/^v2:/);
    expect(assessNutritionLink(v1, new Map([['egg', { ...food(), fiberMeaning: 'total', carbConvention: 'excludes_fiber' }]])).state).toBe('confirmed');
  });
});
