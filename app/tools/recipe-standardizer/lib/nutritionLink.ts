import {parseIngredientRef} from '@/public/shared/nutrition/ingredientRefs.js';
import type {ResolvedIngredientProfile} from '@/public/shared/nutrition/ingredientStore.js';
import {assessIngredientLink,type ProfilesState} from './ingredientLink';
import {
  MAX_GRAMS_PER_UNIT,
  UNLINKED_NUTRITION,
  type FoodItemRef,
  type NutritionLink,
} from './types';
import { normalizeIngredientName } from './shoppingList';
import { currentFingerprint, verifyTrackerFoodFingerprint, type TrackerFood } from './trackerFoods';

export const isValidGramsPerUnit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_GRAMS_PER_UNIT;

const nullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const confidenceValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

const nonConfirmed = (status: NutritionLink['status'], id: string | null, name: string | null, confidence: number | null): NutritionLink => ({
  status,
  foodItemId: id,
  matchedName: name,
  matchConfidence: confidence,
  needsUserReview: status === 'unlinked' || status === 'candidate',
  gramsPerUnit: null,
  confirmedAtMs: null,
  targetRevision: null,
  targetFingerprint: null,
});

/** Defensive read of a stored/pasted link. Never throws. */
export const parseNutritionLink = (value: unknown, path: string, warnings: string[]): NutritionLink => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...UNLINKED_NUTRITION };
  const raw = value as Record<string, unknown>;
  if (raw.status === 'no-match') return nonConfirmed('no-match', null, null, null);
  const id = nullableString(raw.foodItemId);
  if (raw.ingredientRef != null) {
    const ref = parseIngredientRef(raw.ingredientRef, path + '.ingredientRef', warnings);
    if (!ref) return id ? nonConfirmed('candidate', id, nullableString(raw.matchedName), confidenceValue(raw.matchConfidence)) : {...UNLINKED_NUTRITION};
    // Parse legacy fields through the same defensive reader, then layer on the
    // pinned ref. A profile-only confirmation does not require a legacy basis.
    const legacy = parseNutritionLink({ ...raw, ingredientRef: null }, path, []);
    return {...legacy, ingredientRef:ref, status:raw.status === 'confirmed' ? 'confirmed':'candidate', needsUserReview:raw.status !== 'confirmed', foodItemId:id, matchedName:nullableString(raw.matchedName), confirmedAtMs:typeof raw.confirmedAtMs === 'number' && Number.isFinite(raw.confirmedAtMs) && raw.confirmedAtMs >= 0 ? raw.confirmedAtMs:null};
  }
  if (!id) return { ...UNLINKED_NUTRITION };
  const name = nullableString(raw.matchedName);
  const confidence = confidenceValue(raw.matchConfidence);
  if (raw.status === 'confirmed') {
    if (!isValidGramsPerUnit(raw.gramsPerUnit)) {
      warnings.push(`${path}.gramsPerUnit is missing or invalid — the confirmed link needs re-confirmation.`);
      return nonConfirmed('candidate', id, name, confidence);
    }
    return {
      status: 'confirmed',
      foodItemId: id,
      matchedName: name,
      matchConfidence: confidence,
      needsUserReview: false,
      gramsPerUnit: raw.gramsPerUnit,
      confirmedAtMs: typeof raw.confirmedAtMs === 'number' && Number.isFinite(raw.confirmedAtMs) && raw.confirmedAtMs >= 0 ? raw.confirmedAtMs : null,
      targetRevision: nullableString(raw.targetRevision),
      targetFingerprint: nullableString(raw.targetFingerprint),
    };
  }
  if (raw.status === 'candidate' || raw.status === 'linked' || raw.status === 'likely') {
    return nonConfirmed('candidate', id, name, confidence);
  }
  return { ...UNLINKED_NUTRITION };
};

export const candidateLink = (food: FoodItemRef, score: number): NutritionLink => nonConfirmed(
  'candidate', food.id, food.name, confidenceValue(score),
);

export const confirmNutritionLink = (
  food: TrackerFood,
  gramsPerUnit: number,
  nowMs: number,
  previous: NutritionLink,
): NutritionLink => {
  if (!isValidGramsPerUnit(gramsPerUnit)) throw new Error('gramsPerUnit must be > 0 and <= MAX');
  return {
    status: 'confirmed',
    foodItemId: food.id,
    matchedName: food.name,
    matchConfidence: previous.foodItemId === food.id ? previous.matchConfidence : null,
    needsUserReview: false,
    gramsPerUnit,
    confirmedAtMs: Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : null,
    targetRevision: food.lastUpdated,
    targetFingerprint: currentFingerprint(food),
  };
};

export const noMatchLink = (): NutritionLink => nonConfirmed('no-match', null, null, null);

export const linkAfterRename = (link: NutritionLink): NutritionLink =>
  link.status === 'confirmed' && link.ingredientRef
    ? { ...link }
    : link.status === 'confirmed'
    ? nonConfirmed('candidate', link.foodItemId, link.matchedName, link.matchConfidence)
    : { ...UNLINKED_NUTRITION };

export type LinkReviewState =
  | 'unlinked' | 'no-match' | 'candidate' | 'candidate-missing'
  | 'confirmed' | 'confirmed-legacy' | 'confirmed-unverified'
  | 'confirmed-profile' | 'profile-missing' | 'profile-unavailable' | 'profile-corrupt' | 'profile-newer-available'
  | 'stale-missing' | 'stale-renamed' | 'stale-revised';

export interface LinkAssessment { state: LinkReviewState; food: TrackerFood | null; currentName: string | null; profile?: ResolvedIngredientProfile; }

export const assessNutritionLink = (link: NutritionLink, foodsById: Map<string, TrackerFood> | null, profiles?: ProfilesState): LinkAssessment => {
  if (link.ingredientRef && link.status === 'confirmed') return assessIngredientLink(link.ingredientRef, profiles);
  if (link.status === 'unlinked') return { state: 'unlinked', food: null, currentName: null };
  if (link.status === 'no-match') return { state: 'no-match', food: null, currentName: null };
  if (link.status === 'candidate') {
    const food = foodsById && link.foodItemId ? foodsById.get(link.foodItemId) ?? null : null;
    return { state: foodsById && !food ? 'candidate-missing' : 'candidate', food, currentName: food?.name ?? null };
  }
  if (!foodsById) return { state: 'confirmed-unverified', food: null, currentName: null };
  const food = link.foodItemId ? foodsById.get(link.foodItemId) ?? null : null;
  if (!food) return { state: 'stale-missing', food: null, currentName: null };
  if (normalizeIngredientName(food.name) !== normalizeIngredientName(link.matchedName ?? '')) {
    return { state: 'stale-renamed', food, currentName: food.name };
  }
  if (link.targetFingerprint !== null) {
    const verdict = verifyTrackerFoodFingerprint(food, link.targetFingerprint);
    if (verdict === 'mismatch') return { state: 'stale-revised', food, currentName: food.name };
    if (verdict === 'match-v1-expanded') return { state: 'confirmed-legacy', food, currentName: food.name };
  }
  return { state: 'confirmed', food, currentName: food.name };
};

export const isStale = (state: LinkReviewState): boolean => state.startsWith('stale-') || state === 'profile-missing' || state === 'profile-corrupt';

export interface LinkReviewSummary { stale: number; candidates: number; unlinked: number; noMatch: number; confirmed: number; confirmedLegacy: number; unverified: number; }

export const summarizeLinkReview = (assessments: Iterable<LinkAssessment>): LinkReviewSummary => {
  const summary: LinkReviewSummary = { stale: 0, candidates: 0, unlinked: 0, noMatch: 0, confirmed: 0, confirmedLegacy: 0, unverified: 0 };
  for (const { state } of assessments) {
    if (isStale(state)) summary.stale += 1;
    else if (state === 'candidate' || state === 'candidate-missing') summary.candidates += 1;
    else if (state === 'unlinked') summary.unlinked += 1;
    else if (state === 'no-match') summary.noMatch += 1;
    else if (state === 'confirmed' || state === 'confirmed-legacy' || state === 'confirmed-profile' || state === 'profile-newer-available') {
      summary.confirmed += 1;
      if (state === 'confirmed-legacy') summary.confirmedLegacy += 1;
    }
    else if ((state === 'confirmed-unverified' || state === 'profile-unavailable')) summary.unverified += 1;
  }
  return summary;
};

