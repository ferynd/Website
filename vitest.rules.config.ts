import { defineConfig } from 'vitest/config';

// Separate config for `npm run test:rules` (invoked inside
// `firebase emulators:exec`). Kept apart from the root vitest.config.ts,
// which excludes tests/rules/** so plain `npm test` never depends on a
// running emulator.
export default defineConfig({
  test: {
    // All suites share the CLI's demo project for Storage-to-Firestore lookups.
    fileParallelism: false,
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
