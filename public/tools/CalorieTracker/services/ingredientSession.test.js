import { it, expect, vi } from 'vitest';
import { onIngredientAuthChange } from './ingredientSession.js';
it('clears on sign-out and owner switch, keeps same-uid refresh', async () => { const clear = vi.fn(); await onIngredientAuthChange('a', 'a', clear); expect(clear).not.toHaveBeenCalled(); await onIngredientAuthChange('a', null, clear); await onIngredientAuthChange('a', 'b', clear); expect(clear).toHaveBeenCalledTimes(2); });
