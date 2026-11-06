import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-website-rules-test';

const v2Food = {
  name: 'Salt',
  quantity: 1,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  potassium: 0,
  magnesium: 0,
  sodium: 39340,
  calcium: 0,
  choline: 0,
  vitaminB12: 0,
  folate: 0,
  vitaminC: 0,
  vitaminB6: 0,
  vitaminA: 0,
  vitaminD: 0,
  vitaminE: 0,
  vitaminK: 0,
  selenium: 0,
  iodine: 0,
  phosphorus: 0,
  iron: 0,
  zinc: 0,
  omega3: null,
  fatSaturated: null,
  omega3EPA: 0,
  nutrientSchemaVersion: 2,
  nutrientMeta: {
    registryVersion: 2,
    quality: { sodium: { status: 'measured' } },
    fiberMeaning: 'unknown',
  },
  lastUpdated: '2026-11-05T00:00:00.000Z',
};

const v2Day = {
  date: '2026-11-05',
  schemaVersion: 2,
  foodItems: [
    {
      id: 'item-1',
      name: 'Salt',
      quantity: 1,
      timestamp: '2026-11-05T00:00:00.000Z',
      calories: null,
      sodium: 39340,
      fatSaturated: null,
      nutrientSchemaVersion: 2,
      nutrientMeta: { registryVersion: 2, quality: {} },
    },
  ],
};

const v2Recipe = {
  name: 'Cookies',
  recipe: {
    name: 'Cookies',
    ingredients: [
      {
        id: 'ing-1',
        nutritionLink: {
          status: 'confirmed',
          foodItemId: 'salt',
          targetFingerprint: 'v2:68da78c4',
          gramsPerUnit: 100,
        },
      },
    ],
    nutritionExports: {
      perPortion: {
        basis: 'perPortion',
        recipeId: 'cookies',
        foodId: 'cookies',
        foodName: 'Cookies per portion',
        foodLastUpdated: '2026-11-05T00:00:00.000Z',
        nutritionFingerprint: 'v2:8194e8a5',
        exportedAtMs: 1,
        coverage: 'complete',
        includedCount: 1,
        totalCount: 1,
      },
    },
  },
};

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('calorie tracker nutrient v2 documents', () => {
  it('owner can write v2-shaped foodItems and dailyEntries docs with nulls and nutrientMeta', async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    const db = ctx.firestore();
    await assertSucceeds(setDoc(doc(db, 'artifacts/default-app-id/users/user-1/foodItems/salt'), v2Food));
    await assertSucceeds(setDoc(doc(db, 'artifacts/default-app-id/users/user-1/dailyEntries/2026-11-05'), v2Day));
  });

  it('owner can write a recipe with v2-prefixed fingerprints', async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    await assertSucceeds(setDoc(
      doc(ctx.firestore(), 'artifacts/recipe-standardizer/users/user-1/recipes/cookies'),
      v2Recipe,
    ));
  });

  it('another user is denied', async () => {
    const owner = testEnv.authenticatedContext('user-1', { email_verified: true });
    await assertSucceeds(setDoc(doc(owner.firestore(), 'artifacts/default-app-id/users/user-1/foodItems/salt'), v2Food));
    const other = testEnv.authenticatedContext('user-2', { email_verified: true });
    const db = other.firestore();
    await assertFails(setDoc(doc(db, 'artifacts/default-app-id/users/user-1/foodItems/salt'), v2Food));
    await assertFails(setDoc(doc(db, 'artifacts/default-app-id/users/user-1/dailyEntries/2026-11-05'), v2Day));
    await assertFails(setDoc(doc(db, 'artifacts/recipe-standardizer/users/user-1/recipes/cookies'), v2Recipe));
  });
});
