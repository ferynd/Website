import { describe, expect, it } from 'vitest';
import { suggestVersionName } from '../lib/naming';

describe('suggestVersionName', () => {
  it('appends v2 to a plain name', () => {
    expect(suggestVersionName('Cookies', [])).toBe('Cookies v2');
  });

  it('bumps an existing version suffix', () => {
    expect(suggestVersionName('Cookies v2', [])).toBe('Cookies v3');
  });

  it('skips names already in use (case-insensitive)', () => {
    expect(suggestVersionName('Cookies', ['cookies v2', 'Cookies v3'])).toBe('Cookies v4');
  });
});
