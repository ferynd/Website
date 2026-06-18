import { describe, it, expect, vi } from 'vitest';

// ui.js → config.js calls getComputedStyle(document.documentElement) at module
// load time. Stub the required DOM globals before importing the module under test.
globalThis.document ??= { documentElement: {} };
globalThis.getComputedStyle ??= () => ({ getPropertyValue: () => '' });

const { escapeHtml, clampNutrient } = await import('./ui.js');

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes double and single quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#39;world&#39;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers to string', () => {
    expect(escapeHtml(42)).toBe('42');
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Chicken Breast')).toBe('Chicken Breast');
  });

  it('handles XSS payload in food name', () => {
    const xss = '<img src=x onerror=alert(1)>';
    expect(escapeHtml(xss)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('clampNutrient', () => {
  it('returns 0 for NaN', () => {
    expect(clampNutrient('calories', NaN)).toBe(0);
  });

  it('clamps negative values to 0', () => {
    expect(clampNutrient('protein', -5)).toBe(0);
  });

  it('passes through in-range values', () => {
    expect(clampNutrient('calories', 2000)).toBe(2000);
    expect(clampNutrient('protein', 150)).toBe(150);
  });

  it('clamps values exceeding max bounds', () => {
    expect(clampNutrient('calories', 99999)).toBe(10000);
    expect(clampNutrient('protein', 5000)).toBe(1000);
    expect(clampNutrient('fat', 2000)).toBe(1000);
  });

  it('handles nutrients without explicit bounds', () => {
    expect(clampNutrient('unknownNutrient', 5000)).toBe(5000);
  });

  it('allows exact boundary values', () => {
    expect(clampNutrient('calories', 10000)).toBe(10000);
    expect(clampNutrient('protein', 1000)).toBe(1000);
  });

  it('clamps zero correctly', () => {
    expect(clampNutrient('calories', 0)).toBe(0);
  });
});
