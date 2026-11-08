import { expect, it } from 'vitest';
import { buildResolution, researchPacket } from '../../public/shared/nutrition/resolution.js';

it('offers one research packet only after an official miss', async () => {
    const state = buildResolution({ lines: [{ lineId: 'beans', name: 'black beans', grams: 50, variant: { state: 'canned', drained: 'drained' } }], matches: [{ lineId: 'beans', outcome: 'ambiguous' }] });
    expect(state.items[0].kind).toBe('needs_confirmation');
    expect((await researchPacket(state, ['beans'])).error).toBe('official_lookup_required');
});
