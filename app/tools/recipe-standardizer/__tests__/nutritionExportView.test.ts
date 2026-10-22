/* --- CONFIGURATION: export review behavior matrix --- */
/** Pure modal regression coverage without a DOM or new dependencies. */

import { describe, expect, it } from 'vitest';
import {
  initialExportName,
  exportReviewIdentity,
  exportSubmitDisabled,
  nameAfterReviewAgain,
  exportOutcomeActions,
  exportCommitLabel,
  canDismissExport,
} from '../lib/nutritionExportView';
import {
  buildExportPayload,
  calculateExportNutrition,
  deriveExportStatuses,
  type ExportCommitOutcome,
} from '../lib/nutritionExport';
import {
  butterCookiesRecipe,
  exportedRef,
  sourceFoodsReady,
  trackerFood,
} from './exportFixtures';

const base = () => {
  const recipe = butterCookiesRecipe();
  const foods = sourceFoodsReady();
  const result = calculateExportNutrition(recipe, foods);
  const payload = buildExportPayload(recipe, result, 'perPortion');
  if (!payload.ok) throw new Error('Invalid fixture');
  const statuses = deriveExportStatuses(recipe, 'recipe-1', result, foods);
  return {
    submitting: false,
    action: 'create' as const,
    name: 'Cookies',
    foods,
    status: statuses[0],
    payload: payload.payload,
    partialConfirmed: true,
    overwriteConfirmed: true,
  };
};
const ownMissing = () => ({
  ...base().status,
  ownership: 'own' as const,
  target: 'missing' as const,
  ref: exportedRef({ foodName: 'My old export' }),
});
const identity = () => ({
  basis: 'perPortion' as const,
  payloadResult: { ok: true as const, payload: base().payload },
  action: 'update' as const,
  targetFood: trackerFood('cookies', 'Cookies'),
});
const retry = (outcome: ExportCommitOutcome) => nameAfterReviewAgain({
  outcome,
  currentName: 'Typed name',
  recipeName: 'Recipe',
  statuses: [],
  basis: 'perPortion',
});

describe('nutritionExportView', () => {
  it('initial name reuses a deleted own export\'s food name', () => {
    expect(initialExportName('Recipe', [ownMissing()], 'perPortion')).toBe('My old export');
  });
  it('initial name defaults to the recipe name with the basis suffix', () => {
    expect(initialExportName('Recipe', [], 'perPortion')).toBe('Recipe (per portion)');
  });
  it('initial name ignores a foreign reference', () => {
    expect(initialExportName('Recipe', [{ ...ownMissing(), ownership: 'foreign' }], 'perPortion'))
      .toBe('Recipe (per portion)');
  });
  it('review identity changes when the target food revision changes', () => {
    const input = identity();
    expect(exportReviewIdentity(input)).not.toBe(exportReviewIdentity({
      ...input,
      targetFood: { ...input.targetFood, lastUpdated: '2025-02-01T00:00:00.000Z' },
    }));
  });
  it('review identity is stable across equal recomputations', () => {
    expect(exportReviewIdentity(identity())).toBe(exportReviewIdentity(identity()));
  });
  it('submit is disabled while submitting', () => {
    expect(exportSubmitDisabled({ ...base(), submitting: true })).toBe(true);
  });
  it('submit is disabled for an invalid create name', () => {
    expect(exportSubmitDisabled({ ...base(), name: '' })).toBe(true);
  });
  it('submit is disabled for a colliding create name', () => {
    expect(exportSubmitDisabled({ ...base(), name: 'Flour' })).toBe(true);
  });
  it('submit is disabled until partial coverage is confirmed', () => {
    const input = { ...base(), payload: { ...base().payload, coverage: 'partial' as const } };
    expect(exportSubmitDisabled({ ...input, partialConfirmed: false })).toBe(true);
    expect(exportSubmitDisabled({ ...input, partialConfirmed: true })).toBe(false);
  });
  it('submit is disabled until replacing tracker edits is confirmed', () => {
    const input = { ...base(), action: 'update-overwrite-tracker-edits' as const };
    expect(exportSubmitDisabled({ ...input, overwriteConfirmed: false })).toBe(true);
    expect(exportSubmitDisabled({ ...input, overwriteConfirmed: true })).toBe(false);
  });
  it('submit is disabled for a blocked action', () => {
    expect(exportSubmitDisabled({ ...base(), action: 'blocked' })).toBe(true);
  });
  it('submit ignores name validity for updates', () => {
    expect(exportSubmitDisabled({
      ...base(),
      name: '',
      action: 'update',
    })).toBe(false);
  });
  it('review again after a collision keeps the typed name', () => {
    expect(retry({ status: 'collision', foodId: 'typed_name' })).toBe('Typed name');
  });
  it('review again after review-changed resets the name', () => {
    expect(retry({ status: 'review-changed', message: 'Changed' })).toBe('Recipe (per portion)');
  });
  it.each([
    {
      status: 'done',
      mode: 'create',
      foodName: 'Cookies',
      expected: { reviewAgain: false, close: true },
    },
    {
      status: 'collision',
      foodId: 'cookies',
      expected: { reviewAgain: true, close: false },
    },
    {
      status: 'review-changed',
      message: 'Changed',
      expected: { reviewAgain: true, close: false },
    },
    {
      status: 'error',
      message: 'Offline',
      expected: { reviewAgain: false, close: true },
    },
  ] as const)('outcome $status offers $expected', (outcome) => {
    expect(exportOutcomeActions(outcome)).toEqual(outcome.expected);
  });
  it.each([
    ['create', 'Create food'], ['blocked', 'Create food'], ['recreate', 'Create food again'],
    ['update', 'Update food'], ['update-overwrite-tracker-edits', 'Update food'],
  ] as const)('commit label for %s', (action, expected) => {
    expect(exportCommitLabel(action)).toBe(expected);
  });
  it('dismiss is blocked while submitting', () => {
    expect(canDismissExport(true)).toBe(false);
    expect(canDismissExport(false)).toBe(true);
  });
});
