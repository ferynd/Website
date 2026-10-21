/* Nutrition intake row matching, review, and commit planning. */

import { assessNutritionLink, isValidGramsPerUnit, type LinkAssessment, type LinkReviewState } from './nutritionLink';
import { normalizeIngredientName } from './shoppingList';
import { MAX_INTAKE_ITEMS, type IntakeGroup, type ParsedNutritionItem } from './nutritionIntake';
import {
  TRACKER_NUTRIENT_KEYS,
  trackerFoodId,
  validateTrackerFoodName,
  type TrackerFood,
  type TrackerNutrientKey,
} from './trackerFoods';
import type { NutritionLink, Recipe } from './types';

/* CONFIGURATION: intake eligibility and review decisions */
/** Link states whose ingredients can receive nutrition intake rows. */
export const INTAKE_ELIGIBLE_STATES: ReadonlySet<LinkReviewState> = new Set([
  'unlinked',
  'candidate-missing',
  'stale-missing',
]);

/** Action selected for one pasted nutrition item. */
export type IntakeDecision = 'create' | 'link-existing' | 'skip';

/** Editable review state for one pasted nutrition item. */
export interface IntakeRow {
  rowId: string;
  item: ParsedNutritionItem;
  targetKey: string | null;
  matchedBy: 'id' | 'name' | null;
  decision: IntakeDecision;
  foodName: string;
  nameEdited: boolean;
  linkGrams: string;
}

/** Collision, validation, and action availability for a review row. */
export interface RowEvaluation {
  slug: string | null;
  nameError: string | null;
  collision: { foodId: string; food: TrackerFood | null } | null;
  baseBlockers: string[];
  batchConflictRow: number | null;
  canCreate: boolean;
  linkAvailable: boolean;
  canLinkExisting: boolean;
}

/** Existing ingredient link state expected when a planned link is applied. */
export interface IntakeExpectedLink {
  ingredientId: string;
  status: NutritionLink['status'];
  foodItemId: string | null;
}

/** Food creation and link operations produced by a completed review. */
export interface IntakeCommitPlan {
  creates: {
    foodId: string;
    name: string;
    nutrients: Record<TrackerNutrientKey, number>;
    ingredients: IntakeExpectedLink[];
  }[];
  links: {
    food: TrackerFood;
    gramsPerUnit: number;
    ingredients: IntakeExpectedLink[];
  }[];
  skipped: number;
}

/** Keep one prompt/review batch within the parser's supported item limit. */
export const limitIntakeGroups = (
  groups: IntakeGroup[],
  offset = 0,
): { batch: IntakeGroup[]; remaining: number; offset: number } => {
  const start = Math.min(groups.length, Math.max(0, Math.floor(offset)));
  const batch = groups.slice(start, start + MAX_INTAKE_ITEMS);
  return {
    batch,
    remaining: Math.max(0, groups.length - (start + batch.length)),
    offset: start,
  };
};

/** Replace link-existing snapshots with the latest loaded foods before commit. */
export const refreshPlanLinkTargets = (
  plan: IntakeCommitPlan,
  fresh: TrackerFood[],
): { plan: IntakeCommitPlan; missingIds: string[] } => {
  const foodsById = new Map(fresh.map((food) => [food.id, food]));
  const missingIds = [...new Set(plan.links
    .map((link) => link.food.id)
    .filter((id) => !foodsById.has(id)))];
  return {
    plan: {
      ...plan,
      links: plan.links.flatMap((link) => {
        const food = foodsById.get(link.food.id);
        return food ? [{ ...link, food }] : [];
      }),
    },
    missingIds,
  };
};

/** Find planned ingredient links that are no longer eligible with the refreshed foods. */
export const findNoLongerEligible = (
  plan: IntakeCommitPlan,
  recipe: Recipe,
  fresh: TrackerFood[],
): string[] => {
  const foodsById = new Map(fresh.map((food) => [food.id, food]));
  const ineligible = new Set<string>();
  const members = [...plan.creates, ...plan.links].flatMap((operation) => operation.ingredients);

  for (const member of members) {
    const ingredient = recipe.ingredients.find((item) => item.id === member.ingredientId);
    if (!ingredient) continue;
    const assessment = assessNutritionLink(ingredient.nutritionLink, foodsById);
    if (!INTAKE_ELIGIBLE_STATES.has(assessment.state)) ineligible.add(ingredient.id);
  }

  return [...ineligible];
};

/** Result returned after a nutrition intake commit attempt. */
export type IntakeCommitOutcome =
  | { status: 'done'; created: number; linked: number; skippedIngredients: number }
  | { status: 'conflict'; foodIds: string[]; unreadableIds: string[] }
  | { status: 'created-unlinked'; created: number }
  | { status: 'error'; message: string };

/** Group eligible recipe ingredients by normalized display name. */
export const selectIntakeGroups = (
  recipe: Recipe,
  assessments: Map<string, LinkAssessment>,
): IntakeGroup[] => {
  const groups = new Map<string, IntakeGroup>();

  for (const ingredient of recipe.ingredients) {
    const assessment = assessments.get(ingredient.id);
    if (!assessment || !INTAKE_ELIGIBLE_STATES.has(assessment.state)) continue;

    const normalizedName = normalizeIngredientName(ingredient.displayName);
    if (!normalizedName) continue;

    const existing = groups.get(normalizedName);
    if (existing) {
      existing.ingredientIds.push(ingredient.id);
    } else {
      groups.set(normalizedName, {
        key: ingredient.id,
        displayName: ingredient.displayName,
        normalizedName,
        ingredientIds: [ingredient.id],
        note: [ingredient.equivalent, ingredient.prepNote]
          .map((value) => value.trim())
          .filter(Boolean)
          .join('; ')
          .slice(0, 120),
      });
    }
  }

  return [...groups.values()];
};

/** Make the default Nutrition Tracker name for a new 100 g food. */
export const defaultFoodName = (displayName: string): string => {
  const suffix = ' (per 100 g)';
  const base = displayName ? displayName[0].toUpperCase() + displayName.slice(1) : 'Food';
  return `${base.slice(0, 80 - suffix.length)}${suffix}`;
};

/** Match a pasted item to an eligible ingredient by ID, then normalized name. */
export const resolveTarget = (
  item: ParsedNutritionItem,
  groups: IntakeGroup[],
  recipe?: Recipe,
): { targetKey: string | null; matchedBy: 'id' | 'name' | null; warning?: string } => {
  const byId = groups.find((group) => group.ingredientIds.includes(item.ingredientId ?? ''));
  if (byId) return { targetKey: byId.key, matchedBy: 'id' };

  const byName = groups.find((group) => normalizeIngredientName(item.name) === group.normalizedName);
  if (byName) return { targetKey: byName.key, matchedBy: 'name' };

  const ineligible = recipe?.ingredients.find((ingredient) => ingredient.id === item.ingredientId);
  return {
    targetKey: null,
    matchedBy: null,
    ...(ineligible
      ? { warning: `${item.path}.ingredientId "${item.ingredientId}" is no longer unlinked in this recipe — assign another ingredient or skip.` }
      : {}),
  };
};

/** Evaluate row blockers, naming collisions, and available review actions. */
export const evaluateIntakeRows = (
  rows: IntakeRow[],
  groups: IntakeGroup[],
  foods: TrackerFood[],
  unreadableIds: ReadonlySet<string>,
): RowEvaluation[] => {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const bySlug = new Map<string, TrackerFood[]>();
  foods.forEach((food) => {
    const slug = trackerFoodId(food.name);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), food]);
  });

  return rows.map((row, index) => {
    const group = groups.find((candidate) => candidate.key === row.targetKey);
    const blockers: string[] = [];
    if (row.item.errors.length) blockers.push('Fix this row in ChatGPT and paste again, or skip it.');
    if (!group) blockers.push('Choose the ingredient this row belongs to.');

    const duplicate = row.targetKey === null
      ? undefined
      : rows.slice(0, index).find((candidate) => (
        candidate.decision !== 'skip' && candidate.targetKey === row.targetKey
      ));
    if (duplicate) {
      blockers.push(`Row ${rows.indexOf(duplicate) + 1} already fills ${group?.displayName ?? 'this ingredient'}.`);
    }

    const nameError = validateTrackerFoodName(row.foodName);
    const slug = nameError ? null : trackerFoodId(row.foodName);
    let collision: RowEvaluation['collision'] = null;
    if (slug) {
      const food = byId.get(slug) ?? bySlug.get(slug)?.[0] ?? null;
      if (food) {
        collision = { foodId: byId.has(slug) ? slug : food.id, food };
      } else if (unreadableIds.has(slug)) {
        collision = { foodId: slug, food: null };
      }
    }

    const batchConflictRow = slug
      ? rows.slice(0, index).findIndex((candidate) => (
        candidate.decision === 'create'
        && !validateTrackerFoodName(candidate.foodName)
        && trackerFoodId(candidate.foodName) === slug
      ))
      : -1;
    const batch = batchConflictRow >= 0 ? batchConflictRow : null;
    const canCreate = !blockers.length && !nameError && !collision && batch === null;
    const linkAvailable = !blockers.length && collision?.food !== null && collision !== null;

    return {
      slug,
      nameError,
      collision,
      baseBlockers: blockers,
      batchConflictRow: batch,
      canCreate,
      linkAvailable,
      canLinkExisting: linkAvailable && isValidGramsPerUnit(Number(row.linkGrams.trim() || NaN)),
    };
  });
};

/** Build initial review rows and skip rows that cannot be created yet. */
export const initialIntakeRows = (
  items: ParsedNutritionItem[],
  groups: IntakeGroup[],
  foods: TrackerFood[],
  unreadableIds: ReadonlySet<string>,
  recipe?: Recipe,
): IntakeRow[] => {
  let rows: IntakeRow[] = [];

  for (const item of items) {
    const target = resolveTarget(item, groups, recipe);
    const group = groups.find((candidate) => candidate.key === target.targetKey);
    const row: IntakeRow = {
      rowId: `${item.index}`,
      item: {
        ...item,
        warnings: target.warning ? [...item.warnings, target.warning] : item.warnings,
      },
      targetKey: target.targetKey,
      matchedBy: target.matchedBy,
      decision: 'create',
      foodName: defaultFoodName(group?.displayName ?? (item.name || 'Food')),
      nameEdited: false,
      linkGrams: '',
    };
    rows = [...rows, row];

    const evaluation = evaluateIntakeRows(rows, groups, foods, unreadableIds).at(-1);
    if (!evaluation?.canCreate) rows[rows.length - 1] = { ...row, decision: 'skip' };
  }

  return rows;
};

/** Reassign a row while preserving a manually edited food name. */
export const reassignRow = (
  row: IntakeRow,
  newKey: string | null,
  groups: IntakeGroup[],
): IntakeRow => ({
  ...row,
  targetKey: newKey,
  matchedBy: null,
  foodName: row.nameEdited
    ? row.foodName
    : defaultFoodName(groups.find((group) => group.key === newKey)?.displayName ?? 'Food'),
});

/** Check whether every non-skipped row has a valid commit action. */
export const canCommitIntake = (rows: IntakeRow[], evals: RowEvaluation[]): boolean => (
  rows.some((row) => row.decision !== 'skip')
  && rows.every((row, index) => (
    row.decision === 'skip'
    || (row.decision === 'create' && evals[index].canCreate)
    || (row.decision === 'link-existing' && evals[index].canLinkExisting)
  ))
);

const expected = (recipe: Recipe, group: IntakeGroup): IntakeExpectedLink[] => (
  group.ingredientIds.map((id) => {
    const ingredient = recipe.ingredients.find((item) => item.id === id)!;
    return {
      ingredientId: id,
      status: ingredient.nutritionLink.status,
      foodItemId: ingredient.nutritionLink.foodItemId,
    };
  })
);

/** Build the food and link operations from a valid review. */
export const buildIntakeCommitPlan = (
  rows: IntakeRow[],
  evals: RowEvaluation[],
  groups: IntakeGroup[],
  recipe: Recipe,
): IntakeCommitPlan => {
  if (!canCommitIntake(rows, evals)) throw new Error('Nutrition review is not ready to commit.');

  const plan: IntakeCommitPlan = {
    creates: [],
    links: [],
    skipped: rows.filter((row) => row.decision === 'skip').length,
  };

  rows.forEach((row, index) => {
    if (row.decision === 'skip') return;

    const group = groups.find((candidate) => candidate.key === row.targetKey)!;
    const ingredients = expected(recipe, group);
    if (row.decision === 'create') {
      plan.creates.push({
        foodId: evals[index].slug!,
        name: row.foodName,
        nutrients: Object.fromEntries(
          TRACKER_NUTRIENT_KEYS.map((key) => [key, row.item.nutrients[key]!]),
        ) as Record<TrackerNutrientKey, number>,
        ingredients,
      });
    } else {
      const food = evals[index].collision!.food!;
      plan.links.push({ food, gramsPerUnit: Number(row.linkGrams), ingredients });
    }
  });

  return plan;
};

/** Find new-food IDs that collide with the currently loaded tracker foods. */
export const findPlanCollisions = (plan: IntakeCommitPlan, foods: TrackerFood[]): string[] => {
  const ids = new Set<string>();
  const slugs = new Set(foods.map((food) => trackerFoodId(food.name)));
  plan.creates.forEach((create) => {
    if (foods.some((food) => food.id === create.foodId) || slugs.has(create.foodId)) {
      ids.add(create.foodId);
    }
  });
  return [...ids];
};

/** Apply planned links only when the ingredient still has its expected link state. */
export const applyIntakeLinks = (
  recipe: Recipe,
  entries: { expected: IntakeExpectedLink; link: NutritionLink }[],
): { recipe: Recipe; applied: string[]; skipped: string[] } => {
  const applied: string[] = [];
  const skipped: string[] = [];
  const byId = new Map(entries.map((entry) => [entry.expected.ingredientId, entry]));
  const ingredients = recipe.ingredients.map((ingredient) => {
    const entry = byId.get(ingredient.id);
    if (!entry) return ingredient;
    if (
      ingredient.nutritionLink.status !== entry.expected.status
      || ingredient.nutritionLink.foodItemId !== entry.expected.foodItemId
    ) {
      skipped.push(ingredient.id);
      return ingredient;
    }
    applied.push(ingredient.id);
    return { ...ingredient, nutritionLink: entry.link };
  });

  for (const entry of entries) {
    if (!recipe.ingredients.some((ingredient) => ingredient.id === entry.expected.ingredientId)) {
      skipped.push(entry.expected.ingredientId);
    }
  }

  return { recipe: { ...recipe, ingredients }, applied, skipped };
};
