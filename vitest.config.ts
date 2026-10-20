import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rules tests require the Firebase emulators (`npm run test:rules`,
    // which wraps them in `firebase emulators:exec`); excluded here so
    // plain `npm test` doesn't fail for anyone without the emulators
    // running.
    exclude: ['**/node_modules/**', 'tests/rules/**'],
  },
});
