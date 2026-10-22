/* --- CONFIGURATION: namespace parity --- */
/** Pin both namespaces without accessing Firebase or production data. */

import {
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
});
import { appId } from '../../../../public/tools/CalorieTracker/config.js';
import { CALORIE_TRACKER_APP_ID, RECIPE_APP_ID } from '../lib/namespaces';

afterAll(() => vi.unstubAllGlobals());

describe('namespaces', () => {
  it('CALORIE_TRACKER_APP_ID mirrors the CalorieTracker config fallback appId', () => {
    expect(CALORIE_TRACKER_APP_ID).toBe(appId);
  });
  it('RECIPE_APP_ID matches the recipe-standardizer rules path', () => {
    expect(RECIPE_APP_ID).toBe('recipe-standardizer');
  });
});
