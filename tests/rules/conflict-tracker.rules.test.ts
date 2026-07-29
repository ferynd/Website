import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

// AR-03/F-036 and related Conflict Tracker authorization coverage. This is
// the highest-stakes rule set in the repo — a real pre-reveal privacy
// boundary between two authenticated people — so it gets its own dedicated
// suite rather than folding into the AR-02 foundational matrix.

const PROJECT_ID = 'demo-website-rules-test-conflict';
const TRACKER = 'artifacts/conflict-tracker/trackers/tracker1';
const CONFLICT = `${TRACKER}/conflicts/conflict1`;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedTrackerAndConflict() {
  await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
    const fs = adminCtx.firestore();
    await setDoc(doc(fs, TRACKER), {
      name: 'Us',
      personAUid: 'a-uid',
      personAName: 'A',
      personBUid: 'b-uid',
      personBEmail: 'b@example.com',
      personBName: 'B',
      memberUids: ['a-uid', 'b-uid'],
      memberEmails: ['b@example.com'],
      customTags: [],
      createdBy: 'a-uid',
    });
    await setDoc(doc(fs, CONFLICT), {
      trackerId: 'tracker1',
      title: 'Dishes',
      date: '2026-01-01',
      severity: 2,
      tags: [],
      personAResolved: false,
      personBResolved: false,
      status: 'open',
      hasReflectionA: false,
      hasReflectionB: false,
      personASubmittedAt: null,
      personBSubmittedAt: null,
      createdBy: 'a-uid',
    });
  });
}

function ctxFor(uid: string) {
  return testEnv.authenticatedContext(uid, { email_verified: true });
}

describe('F-036: reflection privacy before mutual submission', () => {
  it("denies Person A reading Person B's unsubmitted draft", async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), `${CONFLICT}/reflections/personB`), {
        id: 'personB', person: 'personB', conflictId: 'conflict1', authorUid: 'b-uid',
        whatHappened: 'private', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: null,
      });
    });
    const a = ctxFor('a-uid');
    await assertFails(getDoc(doc(a.firestore(), `${CONFLICT}/reflections/personB`)));
  });

  it('lets Person A read their own draft', async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), `${CONFLICT}/reflections/personA`), {
        id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'a-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: null,
      });
    });
    const a = ctxFor('a-uid');
    await assertSucceeds(getDoc(doc(a.firestore(), `${CONFLICT}/reflections/personA`)));
  });

  it('lets both read both reflections once the conflict doc shows both submitted', async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const fs = adminCtx.firestore();
      await setDoc(doc(fs, `${CONFLICT}/reflections/personA`), {
        id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'a-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: new Date('2026-01-01'),
      });
      await setDoc(doc(fs, `${CONFLICT}/reflections/personB`), {
        id: 'personB', person: 'personB', conflictId: 'conflict1', authorUid: 'b-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: new Date('2026-01-01'),
      });
      await updateDoc(doc(fs, CONFLICT), {
        personASubmittedAt: new Date('2026-01-01'),
        personBSubmittedAt: new Date('2026-01-01'),
      });
    });
    const a = ctxFor('a-uid');
    const b = ctxFor('b-uid');
    await assertSucceeds(getDoc(doc(a.firestore(), `${CONFLICT}/reflections/personB`)));
    await assertSucceeds(getDoc(doc(b.firestore(), `${CONFLICT}/reflections/personA`)));
  });

  it('denies an outsider (non-member) reading either reflection even post-reveal', async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      const fs = adminCtx.firestore();
      await setDoc(doc(fs, `${CONFLICT}/reflections/personA`), {
        id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'a-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: new Date(),
      });
      await updateDoc(doc(fs, CONFLICT), {
        personASubmittedAt: new Date(), personBSubmittedAt: new Date(),
      });
    });
    const outsider = ctxFor('outsider-uid');
    await assertFails(getDoc(doc(outsider.firestore(), `${CONFLICT}/reflections/personA`)));
  });
});

describe('F-036/F-037: reflection write cannot reassign authorship', () => {
  it("denies Person A overwriting Person B's reflection document", async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), `${CONFLICT}/reflections/personB`), {
        id: 'personB', person: 'personB', conflictId: 'conflict1', authorUid: 'b-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: null,
      });
    });
    const a = ctxFor('a-uid');
    await assertFails(
      setDoc(doc(a.firestore(), `${CONFLICT}/reflections/personB`), {
        id: 'personB', person: 'personB', conflictId: 'conflict1', authorUid: 'a-uid',
        whatHappened: 'tampered', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: null,
      }, { merge: true }),
    );
  });

  it('denies un-submitting (resetting submittedAt back to null)', async () => {
    await seedTrackerAndConflict();
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), `${CONFLICT}/reflections/personA`), {
        id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'a-uid',
        whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
        whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
        submittedAt: new Date(),
      });
    });
    const a = ctxFor('a-uid');
    await assertFails(updateDoc(doc(a.firestore(), `${CONFLICT}/reflections/personA`), { submittedAt: null }));
  });
});

describe('F-037/F-072: conflict doc field-scoped updates', () => {
  it('denies Person A setting personBResolved', async () => {
    await seedTrackerAndConflict();
    const a = ctxFor('a-uid');
    await assertFails(
      updateDoc(doc(a.firestore(), CONFLICT), { personBResolved: true, status: 'partially_resolved' }),
    );
  });

  it('lets Person A set personAResolved with correctly derived status', async () => {
    await seedTrackerAndConflict();
    const a = ctxFor('a-uid');
    await assertSucceeds(
      updateDoc(doc(a.firestore(), CONFLICT), { personAResolved: true, status: 'partially_resolved' }),
    );
  });

  it('denies an ordinary member rewriting title/severity fields (Person A/creator only)', async () => {
    await seedTrackerAndConflict();
    const b = ctxFor('b-uid');
    await assertFails(updateDoc(doc(b.firestore(), CONFLICT), { title: 'Renamed' }));
  });
});

describe('F-071: Person B claim is a rules-enforced one-time transition', () => {
  async function seedUnclaimedTracker() {
    await testEnv.withSecurityRulesDisabled(async (adminCtx) => {
      await setDoc(doc(adminCtx.firestore(), TRACKER), {
        name: 'Us', personAUid: 'a-uid', personAName: 'A',
        personBUid: null, personBEmail: 'b@example.com', personBName: 'B',
        memberUids: ['a-uid'], memberEmails: ['b@example.com'], customTags: [], createdBy: 'a-uid',
      });
    });
  }

  it('lets the invited email claim Person B', async () => {
    await seedUnclaimedTracker();
    const b = testEnv.authenticatedContext('b-uid', { email: 'b@example.com', email_verified: true });
    await assertSucceeds(
      updateDoc(doc(b.firestore(), TRACKER), { personBUid: 'b-uid', memberUids: ['a-uid', 'b-uid'] }),
    );
  });

  it('denies a caller whose email does not match the invitation', async () => {
    await seedUnclaimedTracker();
    const stranger = testEnv.authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true });
    await assertFails(
      updateDoc(doc(stranger.firestore(), TRACKER), { personBUid: 'stranger-uid', memberUids: ['a-uid', 'stranger-uid'] }),
    );
  });

  it('denies re-claiming an already-claimed Person B slot', async () => {
    await seedTrackerAndConflict(); // personBUid already 'b-uid'
    const stranger = testEnv.authenticatedContext('stranger-uid', { email: 'b@example.com', email_verified: true });
    await assertFails(
      updateDoc(doc(stranger.firestore(), TRACKER), { personBUid: 'stranger-uid', memberUids: ['a-uid', 'b-uid', 'stranger-uid'] }),
    );
  });
});

describe('F-074: deletion authority', () => {
  it('lets Person A delete the conflict', async () => {
    await seedTrackerAndConflict();
    const a = ctxFor('a-uid');
    await assertSucceeds(deleteDoc(doc(a.firestore(), CONFLICT)));
  });

  it('denies Person B (non-creator, non-Person-A) deleting the conflict', async () => {
    await seedTrackerAndConflict();
    const b = ctxFor('b-uid');
    await assertFails(deleteDoc(doc(b.firestore(), CONFLICT)));
  });
});
