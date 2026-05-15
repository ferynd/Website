/**
 * @file state/schema.test.js
 * @description Unit tests for the pure schema normalization and save-prep functions.
 *
 * All tests are pure — no Firebase, no DOM, no state mutations.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeEntry,
  normalizeUserProfile,
  normalizeGoalSettings,
  prepareEntryForSave,
  prepareProfileForSave,
  prepareGoalSettingsForSave,
} from './schema.js';
import { SCHEMA_VERSIONS, DEFAULT_USER_PROFILE, DEFAULT_GOAL_SETTINGS } from '../constants.js';

// ---------------------------------------------------------------------------
// normalizeEntry
// ---------------------------------------------------------------------------

describe('normalizeEntry', () => {
  it('upgrades a legacy entry (no schemaVersion) to the current v2 shape', () => {
    const legacy = {
      date: '2023-06-01',
      calories: 1800,
      protein: 140,
      carbs: 200,
      fat: 55,
      trainingBump: 280,
      foodItems: [{ id: 'a', name: 'Chicken', calories: 200, protein: 30, quantity: 1 }],
    };

    const n = normalizeEntry(legacy);

    expect(n.schemaVersion).toBe(SCHEMA_VERSIONS.ENTRY);
    expect(n.entryType).toBe('logged');
    expect(n.exerciseSessions).toEqual([]);
    expect(n.calorieAdjustmentItems).toEqual([]);
    expect(n.dayActivityLevel).toBeNull();
    expect(n.vacationDayType).toBeNull();
    expect(n.manualLock).toBe(false);
    expect(n.estimateMeta).toBeNull();
  });

  it('preserves all existing legacy field values', () => {
    const legacy = {
      date: '2023-06-01',
      calories: 1800,
      protein: 140,
      trainingBump: 100,
      foodItems: [{ id: 'x', name: 'Egg', calories: 90, quantity: 2 }],
    };

    const n = normalizeEntry(legacy);

    expect(n.calories).toBe(1800);
    expect(n.protein).toBe(140);
    expect(n.trainingBump).toBe(100);
    expect(n.foodItems).toHaveLength(1);
    expect(n.foodItems[0].name).toBe('Egg');
    expect(n.date).toBe('2023-06-01');
  });

  it('stamps _storedSchemaVersion when the original is less than current', () => {
    const old = { date: '2023-01-01', schemaVersion: 0, calories: 1500 };
    const n = normalizeEntry(old);

    expect(n.schemaVersion).toBe(SCHEMA_VERSIONS.ENTRY);
    expect(n._storedSchemaVersion).toBe(0);
  });

  it('does not add _storedSchemaVersion when already at current schema', () => {
    const current = {
      date: '2023-01-01',
      schemaVersion: SCHEMA_VERSIONS.ENTRY,
      entryType: 'logged',
      exerciseSessions: [],
      calorieAdjustmentItems: [],
      dayActivityLevel: null,
      vacationDayType: null,
      manualLock: false,
      estimateMeta: null,
    };
    const n = normalizeEntry(current);

    expect(n._storedSchemaVersion).toBeUndefined();
    expect(n.schemaVersion).toBe(SCHEMA_VERSIONS.ENTRY);
  });

  it('converts undefined exerciseSessions to an empty array', () => {
    const entry = { date: '2024-01-01' };
    expect(normalizeEntry(entry).exerciseSessions).toEqual([]);
  });

  it('converts undefined calorieAdjustmentItems to an empty array', () => {
    const entry = { date: '2024-01-01' };
    expect(normalizeEntry(entry).calorieAdjustmentItems).toEqual([]);
  });

  it('preserves an existing non-empty exerciseSessions array', () => {
    const entry = {
      date: '2024-01-01',
      exerciseSessions: [{ id: 'e1', type: 'strength', durationMin: 45 }],
    };
    const n = normalizeEntry(entry);
    expect(n.exerciseSessions).toHaveLength(1);
    expect(n.exerciseSessions[0].id).toBe('e1');
  });

  it('merges a partial estimateMeta object with defaults', () => {
    const entry = {
      date: '2024-03-01',
      entryType: 'estimate',
      estimateMeta: {
        method: 'tdee_weight_delta',
        locked: true,
      },
    };
    const n = normalizeEntry(entry);

    expect(n.estimateMeta.method).toBe('tdee_weight_delta');
    expect(n.estimateMeta.locked).toBe(true);
    // Missing sub-fields should receive defaults.
    expect(n.estimateMeta.modelVersion).toBeNull();
    expect(n.estimateMeta.confidence).toBeNull();
    expect(n.estimateMeta.previousEstimate).toBeNull();
    expect(n.estimateMeta.sourceDataWindow).toBeNull();
  });

  it('keeps estimateMeta as null for a non-estimate entry', () => {
    const entry = { date: '2024-01-01', entryType: 'logged' };
    expect(normalizeEntry(entry).estimateMeta).toBeNull();
  });

  it('adds vacationDayType: null when absent', () => {
    const entry = { date: '2024-01-01' };
    expect(normalizeEntry(entry).vacationDayType).toBeNull();
  });

  it('is idempotent — normalizing twice gives the same result', () => {
    const entry = { date: '2024-01-01', calories: 2000 };
    const once = normalizeEntry(entry);
    const twice = normalizeEntry(once);
    expect(twice.schemaVersion).toBe(SCHEMA_VERSIONS.ENTRY);
    expect(twice.calories).toBe(2000);
    expect(twice.exerciseSessions).toEqual([]);
  });

  it('converts missing foodItems to an empty array', () => {
    const entry = { date: '2024-01-01' };
    expect(normalizeEntry(entry).foodItems).toEqual([]);
  });

  it('converts null foodItems to an empty array', () => {
    const entry = { date: '2024-01-01', foodItems: null };
    expect(normalizeEntry(entry).foodItems).toEqual([]);
  });

  it('preserves an existing non-empty foodItems array', () => {
    const items = [{ id: 'f1', name: 'Oats', calories: 150, quantity: 1 }];
    const entry = { date: '2024-01-01', foodItems: items };
    const n = normalizeEntry(entry);
    expect(n.foodItems).toHaveLength(1);
    expect(n.foodItems[0].id).toBe('f1');
  });
});

// ---------------------------------------------------------------------------
// normalizeUserProfile
// ---------------------------------------------------------------------------

describe('normalizeUserProfile', () => {
  it('returns all defaults for an empty object (first-time user)', () => {
    const p = normalizeUserProfile({});
    expect(p.schemaVersion).toBe(SCHEMA_VERSIONS.PROFILE);
    expect(p.sex).toBeNull();
    expect(p.heightUnit).toBe('in');
    expect(p.useUploadedWeightForCurrentWeight).toBe(true);
    expect(p.baselineActivityLevel).toBeNull();
  });

  it('existing fields override defaults', () => {
    const p = normalizeUserProfile({ sex: 'male', age: 30, heightUnit: 'cm' });
    expect(p.sex).toBe('male');
    expect(p.age).toBe(30);
    expect(p.heightUnit).toBe('cm');
    // Unfilled defaults still present.
    expect(p.useUploadedWeightForCurrentWeight).toBe(true);
  });

  it('handles null input without throwing', () => {
    const p = normalizeUserProfile(null);
    expect(p.heightUnit).toBe('in');
  });
});

// ---------------------------------------------------------------------------
// normalizeGoalSettings
// ---------------------------------------------------------------------------

describe('normalizeGoalSettings', () => {
  it('returns all defaults for an empty object (first-time user)', () => {
    const g = normalizeGoalSettings({});
    expect(g.schemaVersion).toBe(SCHEMA_VERSIONS.GOAL);
    expect(g.goalType).toBe('maintenance');
    expect(g.useRollingBanking).toBe(true);
    expect(g.manualTargetOverrides).toEqual({});
  });

  it('existing fields override defaults', () => {
    const g = normalizeGoalSettings({ goalType: 'fatLoss', targetWeightLb: 160 });
    expect(g.goalType).toBe('fatLoss');
    expect(g.targetWeightLb).toBe(160);
    expect(g.useRollingBanking).toBe(true); // default filled in
  });

  it('merges manualTargetOverrides without wiping existing overrides', () => {
    const raw = { goalType: 'fatLoss', manualTargetOverrides: { protein: 180, calcium: 1200 } };
    const g = normalizeGoalSettings(raw);
    expect(g.manualTargetOverrides.protein).toBe(180);
    expect(g.manualTargetOverrides.calcium).toBe(1200);
  });

  it('handles null input without throwing', () => {
    const g = normalizeGoalSettings(null);
    expect(g.goalType).toBe('maintenance');
  });
});

// ---------------------------------------------------------------------------
// prepareEntryForSave
// ---------------------------------------------------------------------------

describe('prepareEntryForSave', () => {
  it('produces a v2 entry with SCHEMA_VERSIONS.ENTRY', () => {
    const entry = { date: '2024-01-01', calories: 1900 };
    const saved = prepareEntryForSave(entry);
    expect(saved.schemaVersion).toBe(SCHEMA_VERSIONS.ENTRY);
  });

  it('strips _storedSchemaVersion so it is never persisted', () => {
    const entry = { date: '2024-01-01', schemaVersion: 0, calories: 1600 };
    const normalized = normalizeEntry(entry); // adds _storedSchemaVersion
    const saved = prepareEntryForSave(normalized);
    expect(saved._storedSchemaVersion).toBeUndefined();
  });

  it('applies opts overrides before normalization', () => {
    const entry = { date: '2024-01-01' };
    const saved = prepareEntryForSave(entry, { entryType: 'estimate' });
    expect(saved.entryType).toBe('estimate');
  });

  it('does not mutate the incoming entry', () => {
    const entry = { date: '2024-01-01', calories: 2100 };
    prepareEntryForSave(entry);
    expect((entry).schemaVersion).toBeUndefined(); // original unchanged
  });

  it('preserves legacy nutrition fields', () => {
    const entry = { date: '2024-01-01', calories: 2000, protein: 155, trainingBump: 100 };
    const saved = prepareEntryForSave(entry);
    expect(saved.calories).toBe(2000);
    expect(saved.protein).toBe(155);
    expect(saved.trainingBump).toBe(100);
  });

  it('save-ready entry always includes vacationDayType: null', () => {
    const saved = prepareEntryForSave({ date: '2024-01-01' });
    expect(saved).toHaveProperty('vacationDayType', null);
  });
});

// ---------------------------------------------------------------------------
// prepareProfileForSave
// ---------------------------------------------------------------------------

describe('prepareProfileForSave', () => {
  it('forces schemaVersion to SCHEMA_VERSIONS.PROFILE', () => {
    const saved = prepareProfileForSave({ sex: 'female' });
    expect(saved.schemaVersion).toBe(SCHEMA_VERSIONS.PROFILE);
  });

  it('does not wipe current fields not present in incoming', () => {
    const current = { sex: 'male', age: 28, heightUnit: 'in', bodyFatPercent: 18 };
    const incoming = { age: 29 }; // only updating age
    const saved = prepareProfileForSave(incoming, current);
    expect(saved.sex).toBe('male'); // from current
    expect(saved.age).toBe(29);     // from incoming
    expect(saved.bodyFatPercent).toBe(18); // from current
  });

  it('incoming values override current values', () => {
    const current = { sex: 'male' };
    const incoming = { sex: 'female' };
    const saved = prepareProfileForSave(incoming, current);
    expect(saved.sex).toBe('female');
  });
});

// ---------------------------------------------------------------------------
// prepareGoalSettingsForSave
// ---------------------------------------------------------------------------

describe('prepareGoalSettingsForSave', () => {
  it('forces schemaVersion to SCHEMA_VERSIONS.GOAL', () => {
    const saved = prepareGoalSettingsForSave({ goalType: 'fatLoss' });
    expect(saved.schemaVersion).toBe(SCHEMA_VERSIONS.GOAL);
  });

  it('does not wipe existing manualTargetOverrides when saving partial update', () => {
    const current = { manualTargetOverrides: { protein: 175, zinc: 15 } };
    const incoming = { goalType: 'recomp', manualTargetOverrides: { protein: 180 } };
    const saved = prepareGoalSettingsForSave(incoming, current);
    // protein updated, zinc preserved
    expect(saved.manualTargetOverrides.protein).toBe(180);
    expect(saved.manualTargetOverrides.zinc).toBe(15);
  });

  it('does not wipe current goal fields not present in incoming', () => {
    const current = { targetWeightLb: 165, useRollingBanking: false };
    const incoming = { goalType: 'muscleGain' };
    const saved = prepareGoalSettingsForSave(incoming, current);
    expect(saved.targetWeightLb).toBe(165);
    expect(saved.useRollingBanking).toBe(false);
    expect(saved.goalType).toBe('muscleGain');
  });
});
