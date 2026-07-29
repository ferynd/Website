import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setDoc, doc, getDoc } from 'firebase/firestore';

// Foundational Firestore rules coverage for AR-02 (F-137/F-041 admin
// identity, F-138 legacy wildcard, and a baseline default-deny/ownership
// smoke matrix across every top-level namespace). Deep per-tool field-
// transition and business-logic coverage (Conflict Tracker reveal timing,
// Trip Cost conservation, etc.) belongs to AR-03/AR-04's own test suites,
// which build on this harness rather than duplicating it here.

const ADMIN_EMAIL = 'arkkahdarkkahd@gmail.com';
const PROJECT_ID = 'demo-website-rules-test-firestore';

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

describe('isAdmin() — F-137/F-041', () => {
  it('denies an unverified account with the admin email', async () => {
    const ctx = testEnv.authenticatedContext('unverified-admin-uid', {
      email: ADMIN_EMAIL,
      email_verified: false,
    });
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-cost/trips/trip1'), {
        participantIds: ['someone-else'],
      });
    });
    await assertFails(getDoc(doc(ctx.firestore(), 'artifacts/trip-cost/trips/trip1')));
  });

  it('allows a verified account with the admin email', async () => {
    const ctx = testEnv.authenticatedContext('verified-admin-uid', {
      email: ADMIN_EMAIL,
      email_verified: true,
    });
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-cost/trips/trip1'), {
        participantIds: ['someone-else'],
      });
    });
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'artifacts/trip-cost/trips/trip1')));
  });

  it('denies a verified account with a different email', async () => {
    const ctx = testEnv.authenticatedContext('ordinary-uid', {
      email: 'someone-else@example.com',
      email_verified: true,
    });
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-cost/trips/trip1'), {
        participantIds: ['someone-else'],
      });
    });
    await assertFails(getDoc(doc(ctx.firestore(), 'artifacts/trip-cost/trips/trip1')));
  });

  it('denies a signed-out caller entirely', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-cost/trips/trip1'), {
        participantIds: ['someone-else'],
      });
    });
    await assertFails(getDoc(doc(ctx.firestore(), 'artifacts/trip-cost/trips/trip1')));
  });
});

describe('legacy CalorieTracker wildcard pinned to default-app-id — F-138', () => {
  it('allows a user to read/write their own document under default-app-id', async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    await assertSucceeds(
      setDoc(doc(ctx.firestore(), 'artifacts/default-app-id/users/user-1/foodItems/apple'), {
        name: 'Apple',
      }),
    );
  });

  it("denies a user reading another user's document under default-app-id", async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/default-app-id/users/user-2/foodItems/apple'), {
        name: 'Apple',
      });
    });
    await assertFails(getDoc(doc(ctx.firestore(), 'artifacts/default-app-id/users/user-2/foodItems/apple')));
  });

  it('denies access under a different appId even for the same UID (no wildcard fallback)', async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    await assertFails(
      setDoc(doc(ctx.firestore(), 'artifacts/some-future-tool/users/user-1/data/doc1'), {
        value: 1,
      }),
    );
  });
});

describe('default-deny baseline', () => {
  it('denies reads/writes on any unmatched top-level path, including for a signed-in user', async () => {
    const ctx = testEnv.authenticatedContext('user-1', { email_verified: true });
    await assertFails(getDoc(doc(ctx.firestore(), 'randomCollection/doc1')));
    await assertFails(setDoc(doc(ctx.firestore(), 'randomCollection/doc1'), { x: 1 }));
  });

  it('denies a signed-out caller on the same path', async () => {
    const ctx = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(ctx.firestore(), 'randomCollection/doc1')));
  });
});

describe('per-namespace participant/non-participant smoke matrix', () => {
  it('Trip Cost: participant can read their trip, non-participant cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-cost/trips/trip1'), {
        participantIds: ['participant-uid'],
      });
    });
    const participant = testEnv.authenticatedContext('participant-uid', { email_verified: true });
    const outsider = testEnv.authenticatedContext('outsider-uid', { email_verified: true });
    await assertSucceeds(getDoc(doc(participant.firestore(), 'artifacts/trip-cost/trips/trip1')));
    await assertFails(getDoc(doc(outsider.firestore(), 'artifacts/trip-cost/trips/trip1')));
  });

  it('Trip Planner: participant can read their planner, non-participant cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/trip-planner/planners/planner1'), {
        ownerUid: 'participant-uid',
        participantUids: ['participant-uid'],
      });
    });
    const participant = testEnv.authenticatedContext('participant-uid', { email_verified: true });
    const outsider = testEnv.authenticatedContext('outsider-uid', { email_verified: true });
    await assertSucceeds(getDoc(doc(participant.firestore(), 'artifacts/trip-planner/planners/planner1')));
    await assertFails(getDoc(doc(outsider.firestore(), 'artifacts/trip-planner/planners/planner1')));
  });

  it('Date Night: participant can read the couple doc, non-participant cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/date-night/couples/main'), {
        participantUids: ['participant-uid'],
      });
    });
    const participant = testEnv.authenticatedContext('participant-uid', { email_verified: true });
    const outsider = testEnv.authenticatedContext('outsider-uid', { email_verified: true });
    await assertSucceeds(getDoc(doc(participant.firestore(), 'artifacts/date-night/couples/main')));
    await assertFails(getDoc(doc(outsider.firestore(), 'artifacts/date-night/couples/main')));
  });

  it('Conflict Tracker: member can read the tracker, non-member cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/conflict-tracker/trackers/tracker1'), {
        memberUids: ['member-uid'],
        personAUid: 'member-uid',
        createdBy: 'member-uid',
      });
    });
    const member = testEnv.authenticatedContext('member-uid', { email_verified: true });
    const outsider = testEnv.authenticatedContext('outsider-uid', { email_verified: true });
    await assertSucceeds(getDoc(doc(member.firestore(), 'artifacts/conflict-tracker/trackers/tracker1')));
    await assertFails(getDoc(doc(outsider.firestore(), 'artifacts/conflict-tracker/trackers/tracker1')));
  });

  it('Show Tracker: list member can read the list, non-member cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), 'artifacts/shows/lists/list1'), {
        ownerId: 'member-uid',
        memberUids: ['member-uid'],
        adminUids: ['member-uid'],
      });
    });
    const member = testEnv.authenticatedContext('member-uid', { email_verified: true });
    const outsider = testEnv.authenticatedContext('outsider-uid', { email_verified: true });
    await assertSucceeds(getDoc(doc(member.firestore(), 'artifacts/shows/lists/list1')));
    await assertFails(getDoc(doc(outsider.firestore(), 'artifacts/shows/lists/list1')));
  });
});
