import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each suite has one owner: root unit-core, standalone CalorieTracker,
    // API contracts, or emulator-only rules (see .github/ci/contract.json).
    exclude: ['**/node_modules/**', 'tests/rules/**', 'tests/api/**', 'public/tools/CalorieTracker/**'],
  },
});
