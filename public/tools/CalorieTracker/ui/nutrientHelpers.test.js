/**
 * @file ui/nutrientHelpers.test.js
 * Unit tests for pure nutrient-display helpers.
 * No DOM, Firebase, or state access.
 */

import { describe, it, expect } from 'vitest';
import { computeTrendDirection, classifyTargetSource } from './nutrientHelpers.js';

// ---------------------------------------------------------------------------
// computeTrendDirection
// ---------------------------------------------------------------------------

describe('computeTrendDirection', () => {
  it('returns stable when priorVal is null (insufficient history)', () => {
    expect(computeTrendDirection(100, null)).toBe('stable');
  });

  it('returns stable when priorVal is 0 (avoid divide-by-zero)', () => {
    expect(computeTrendDirection(100, 0)).toBe('stable');
  });

  it('returns stable when recentVal is 0 (no recent data)', () => {
    expect(computeTrendDirection(0, 100)).toBe('stable');
  });

  it('returns up when recent is >5% above prior', () => {
    // +10% above prior → up
    expect(computeTrendDirection(110, 100)).toBe('up');
  });

  it('returns down when recent is >5% below prior', () => {
    // -10% below prior → down
    expect(computeTrendDirection(90, 100)).toBe('down');
  });

  it('returns stable when difference is within ±5%', () => {
    expect(computeTrendDirection(103, 100)).toBe('stable'); // +3%
    expect(computeTrendDirection(97, 100)).toBe('stable');  // -3%
  });

  it('returns stable at exactly 5% threshold', () => {
    // Exactly 5% — the threshold is strict (> not >=)
    expect(computeTrendDirection(105, 100)).toBe('stable');
    expect(computeTrendDirection(95, 100)).toBe('stable');
  });

  it('returns up just above 5% threshold', () => {
    expect(computeTrendDirection(105.1, 100)).toBe('up');
  });

  it('returns down just below -5% threshold', () => {
    expect(computeTrendDirection(94.9, 100)).toBe('down');
  });
});

// ---------------------------------------------------------------------------
// classifyTargetSource
// ---------------------------------------------------------------------------

describe('classifyTargetSource', () => {
  const defaults = { vitaminC: 90, zinc: 11 };

  it('returns manual_override when nutrient is in manualTargetOverrides', () => {
    // Even if baseline matches default, explicit override wins
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, { vitaminC: 75 })).toBe('manual_override');
  });

  it('returns manual_override regardless of baseline value', () => {
    expect(classifyTargetSource('zinc', { zinc: 20 }, defaults, { zinc: 15 })).toBe('manual_override');
  });

  it('returns dri when baseline matches default exactly (manual mode)', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, {})).toBe('dri');
  });

  it('returns dri when baseline is absent (not yet set)', () => {
    expect(classifyTargetSource('vitaminC', {}, defaults, {})).toBe('dri');
  });

  it('returns manual_baseline when baseline differs from default (manual mode)', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 120 }, defaults, {})).toBe('manual_baseline');
  });

  it('returns manual_baseline when baseline is zero but default is non-zero (manual mode)', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 0 }, defaults, {})).toBe('manual_baseline');
  });

  it('returns auto_goal when baseline differs from default in autoGoal mode', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 120 }, defaults, {}, 'autoGoal')).toBe('auto_goal');
  });

  it('returns dri in autoGoal mode when value matches DRI', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, {}, 'autoGoal')).toBe('dri');
  });

  it('manual_override takes priority over auto_goal mode', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 120 }, defaults, { vitaminC: 100 }, 'autoGoal')).toBe('manual_override');
  });

  it('returns dri when manualOverrides is undefined', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, undefined)).toBe('dri');
  });

  it('returns dri when manualOverrides is null', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, null)).toBe('dri');
  });

  it('defaults to manual mode when targetMode omitted', () => {
    // Existing call sites that don't pass targetMode get manual_baseline (not breaking)
    expect(classifyTargetSource('vitaminC', { vitaminC: 120 }, defaults, {})).toBe('manual_baseline');
  });

  // ── profileDriTargets (6th parameter) ──────────────────────────────────────

  it('returns dri_profile_default when effective matches profileDriTargets but not DEFAULT_TARGETS', () => {
    // Older female calcium: profile DRI = 1200, generic DEFAULT_TARGETS = 1000
    // → labeled as profile DRI default, not custom/auto_goal
    const defaultsLow = { calcium: 1000 };
    const profileDri  = { calcium: 1200 };
    expect(classifyTargetSource('calcium', { calcium: 1200 }, defaultsLow, {}, 'manual', profileDri)).toBe('dri_profile_default');
  });

  it('returns dri_profile_default in autoGoal mode when value matches profile DRI', () => {
    const defaultsLow = { calcium: 1000 };
    const profileDri  = { calcium: 1200 };
    // Profile DRI match takes priority over auto_goal classification
    expect(classifyTargetSource('calcium', { calcium: 1200 }, defaultsLow, {}, 'autoGoal', profileDri)).toBe('dri_profile_default');
  });

  it('returns dri when effective matches generic DEFAULT_TARGETS (profile DRI is same)', () => {
    // When generic and profile DRI agree, generic match fires first → plain 'dri'
    const defaults   = { calcium: 1000 };
    const profileDri = { calcium: 1000 }; // same as defaults
    expect(classifyTargetSource('calcium', { calcium: 1000 }, defaults, {}, 'manual', profileDri)).toBe('dri');
  });

  it('returns auto_goal when value differs from both DEFAULT_TARGETS and profileDriTargets', () => {
    const defaultsLow = { calcium: 1000 };
    const profileDri  = { calcium: 1200 };
    // 1300 differs from both 1000 and 1200 → auto_goal in autoGoal mode
    expect(classifyTargetSource('calcium', { calcium: 1300 }, defaultsLow, {}, 'autoGoal', profileDri)).toBe('auto_goal');
  });

  it('returns manual_baseline when value differs from both defaults in manual mode', () => {
    const defaultsLow = { calcium: 1000 };
    const profileDri  = { calcium: 1200 };
    expect(classifyTargetSource('calcium', { calcium: 1500 }, defaultsLow, {}, 'manual', profileDri)).toBe('manual_baseline');
  });

  it('manual_override still wins when profileDriTargets is provided', () => {
    const defaultsLow = { calcium: 1000 };
    const profileDri  = { calcium: 1200 };
    expect(classifyTargetSource('calcium', { calcium: 1200 }, defaultsLow, { calcium: 1300 }, 'autoGoal', profileDri)).toBe('manual_override');
  });

  it('profileDriTargets null falls back to DEFAULT_TARGETS comparison only', () => {
    const defaultsLow = { calcium: 1000 };
    // 1200 differs from 1000 default, no profileDri provided → auto_goal
    expect(classifyTargetSource('calcium', { calcium: 1200 }, defaultsLow, {}, 'autoGoal', null)).toBe('auto_goal');
  });
});
