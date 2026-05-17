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

  it('returns override when nutrient is in manualTargetOverrides', () => {
    // Even if baseline matches default, explicit override wins
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, { vitaminC: 75 })).toBe('override');
  });

  it('returns override regardless of baseline value', () => {
    expect(classifyTargetSource('zinc', { zinc: 20 }, defaults, { zinc: 15 })).toBe('override');
  });

  it('returns dri when baseline matches default exactly', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, {})).toBe('dri');
  });

  it('returns dri when baseline is absent (not yet set)', () => {
    expect(classifyTargetSource('vitaminC', {}, defaults, {})).toBe('dri');
  });

  it('returns custom when baseline differs from default', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 120 }, defaults, {})).toBe('custom');
  });

  it('returns custom when baseline is zero but default is non-zero', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 0 }, defaults, {})).toBe('custom');
  });

  it('returns dri when manualOverrides is undefined', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, undefined)).toBe('dri');
  });

  it('returns dri when manualOverrides is null', () => {
    expect(classifyTargetSource('vitaminC', { vitaminC: 90 }, defaults, null)).toBe('dri');
  });
});
