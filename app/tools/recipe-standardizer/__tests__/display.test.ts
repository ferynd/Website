/* --- CONFIGURATION: equivalent suffix expectations --- */
/** Display caveats must survive both baked and live scaling. */

import { describe, expect, it } from 'vitest';
import { describeEquivalent, equivalentSuffix, type EquivalentNote } from '../lib/display';

describe('equivalent display', () => {
  it.each([
    { kind: 'none', expected: '' },
    { kind: 'unscaled', expected: ' at 1×' },
    {
      kind: 'stale-after-bake',
      bakeFactor: 3,
      expected: ' — not rescaled after 3× bake',
    },
  ] as const)('suffix for $kind', (note) => {
    expect(equivalentSuffix(note as EquivalentNote)).toBe(note.expected);
  });
  it('describeEquivalent never live-scales an annotated equivalent', () => {
    expect(describeEquivalent({ equivalent: '2 cups', equivalentBakeFactor: 3 }, 2)).toEqual({
      text: '2 cups', note: { kind: 'stale-after-bake', bakeFactor: 3 },
    });
  });
  it('describeEquivalent marks an unparseable equivalent unscaled only when the factor is not 1', () => {
    const ingredient = { equivalent: 'to taste', equivalentBakeFactor: null };
    expect(describeEquivalent(ingredient, 1).note.kind).toBe('none');
    expect(describeEquivalent(ingredient, 3).note.kind).toBe('unscaled');
  });
});
