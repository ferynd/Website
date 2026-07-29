import { defineConfig } from 'vitest/config';

// Separate config for `npm run test:rules` (invoked inside
// `firebase emulators:exec`). Kept apart from the root vitest.config.ts,
// which excludes tests/rules/** so plain `npm test` never depends on a
// running emulator.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
