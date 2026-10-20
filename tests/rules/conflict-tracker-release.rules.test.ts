import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
} from 'firebase/firestore';

// PR #160 release review (AR-02/AR-03): tracker-creation membership, member
// tag edits, shared-section authorization, Person B positive paths, and the
// exact behavior of the *currently deployed* (origin/main) client calls under
// the new rules. The legacy-client cases document why the corrected client
// must be live before these rules are released.

const PROJECT_ID = 'demo-website-rules-test';
const TRACKERS = 'artifacts/conflict-tracker/trackers';
const TRACKER = `${TRACKERS}/tracker1`;
const CONFLICT = `${TRACKER}/conflicts/conflict1`;
const reflection = (side: 'personA' | 'personB', uid: string, submittedAt: Timestamp | null) => ({
  id: side, person: side, conflictId: 'conflict1', authorUid: uid,
  whatHappened: 'fixture', whatIFelt: 'fixture', whatIThoughtTheyMeant: 'fixture', whatINeeded: 'fixture',
  whatIAmOwning: 'fixture', whatIWillDoDifferently: 'fixture', tags: [], feelsResolved: 'no', submittedAt,
});

let testEnv: RulesTestEnvironment;
beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

const ctx = (uid: string, email?: string) =>
  testEnv.authenticatedContext(uid, { email_verified: true, ...(email ? { email } : {}) }).firestore();

async function seed(options: { submittedA?: Timestamp | null; submittedB?: Timestamp | null; mirrors?: boolean } = {}) {
  const { submittedA = null, submittedB = null, mirrors = true } = options;
  await testEnv.withSecurityRulesDisabled(async admin => {
    const fs = admin.firestore();
    await setDoc(doc(fs, TRACKER), {
      name: 'Us', personAUid: 'a-uid', personAName: 'A', personBUid: 'b-uid', personBEmail: 'b@example.com',
      personBName: 'B', memberUids: ['a-uid', 'b-uid'], memberEmails: ['b@example.com'], customTags: [], createdBy: 'a-uid',
    });
    await setDoc(doc(fs, CONFLICT), {
      trackerId: 'tracker1', title: 'T', date: '2026-01-01', severity: 2, tags: [],
      personAResolved: false, personBResolved: false, status: 'open',
      hasReflectionA: submittedA !== null, hasReflectionB: submittedB !== null, createdBy: 'a-uid',
      ...(mirrors ? { personASubmittedAt: submittedA, personBSubmittedAt: submittedB } : {}),
    });
    if (submittedA) await setDoc(doc(fs, `${CONFLICT}/reflections/personA`), reflection('personA', 'a-uid', submittedA));
    if (submittedB) await setDoc(doc(fs, `${CONFLICT}/reflections/personB`), reflection('personB', 'b-uid', submittedB));
  });
}
const T1 = Timestamp.fromMillis(1_700_000_000_000);
const T2 = Timestamp.fromMillis(1_700_000_100_000);

describe('tracker creation cannot seat hidden observers', () => {
  const base = {
    name: 'Us', personAUid: 'a-uid', personAName: 'A', personBUid: null, personBName: 'B',
    customTags: [], createdBy: 'a-uid', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  it('allows the real client shape with and without an invite email', async () => {
    const fs = ctx('a-uid', 'a@example.com');
    await assertSucceeds(setDoc(doc(fs, `${TRACKERS}/t1`), {
      ...base, personBEmail: 'b@example.com', memberUids: ['a-uid'], memberEmails: ['b@example.com'],
    }));
    await assertSucceeds(setDoc(doc(fs, `${TRACKERS}/t2`), {
      ...base, personBEmail: null, memberUids: ['a-uid'], memberEmails: [],
    }));
  });
  it('denies extra member UIDs, extra/mismatched member emails, and non-normalized invites', async () => {
    const fs = ctx('a-uid', 'a@example.com');
    await assertFails(setDoc(doc(fs, `${TRACKERS}/t3`), {
      ...base, personBEmail: null, memberUids: ['a-uid', 'spy-uid'], memberEmails: [],
    }));
    await assertFails(setDoc(doc(fs, `${TRACKERS}/t4`), {
      ...base, personBEmail: 'b@example.com', memberUids: ['a-uid'], memberEmails: ['b@example.com', 'spy@example.com'],
    }));
    await assertFails(setDoc(doc(fs, `${TRACKERS}/t5`), {
      ...base, personBEmail: null, memberUids: ['a-uid'], memberEmails: ['spy@example.com'],
    }));
    await assertFails(setDoc(doc(fs, `${TRACKERS}/t6`), {
      ...base, personBEmail: 'B@Example.com', memberUids: ['a-uid'], memberEmails: ['B@Example.com'],
    }));
  });
});

describe('tracker custom tags', () => {
  it('lets Person B add a custom tag but nothing else', async () => {
    await seed();
    const b = ctx('b-uid', 'b@example.com');
    await assertSucceeds(updateDoc(doc(b, TRACKER), { customTags: ['money'], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(b, TRACKER), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(b, TRACKER), { customTags: ['x'], memberUids: ['a-uid', 'b-uid', 'spy'] }));
  });
  it('lets Person A rename; denies an outsider tagging', async () => {
    await seed();
    await assertSucceeds(updateDoc(doc(ctx('a-uid'), TRACKER), { name: 'Renamed', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(ctx('outsider'), TRACKER), { customTags: ['x'] }));
  });
});

describe('F-069 shared section', () => {
  const patch = (uid: string) => ({
    sharedClarification: 'fixture', sharedUpdatedBy: uid, sharedUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  it('allows Person A after both genuine submissions', async () => {
    await seed({ submittedA: T1, submittedB: T2 });
    await assertSucceeds(updateDoc(doc(ctx('a-uid'), CONFLICT), patch('a-uid')));
  });
  it('denies with drafts only or one side submitted', async () => {
    await seed({ submittedA: T1 });
    await assertFails(updateDoc(doc(ctx('a-uid'), CONFLICT), patch('a-uid')));
    await seed({ submittedA: null, submittedB: null });
    await testEnv.withSecurityRulesDisabled(async admin => {
      await updateDoc(doc(admin.firestore(), CONFLICT), { hasReflectionA: true, hasReflectionB: true });
    });
    await assertFails(updateDoc(doc(ctx('a-uid'), CONFLICT), patch('a-uid')));
  });
  it('denies misattributed editor and Person B editing', async () => {
    await seed({ submittedA: T1, submittedB: T2 });
    await assertFails(updateDoc(doc(ctx('a-uid'), CONFLICT), patch('b-uid')));
    await assertFails(updateDoc(doc(ctx('b-uid'), CONFLICT), patch('b-uid')));
  });
});

describe('Person B positive paths', () => {
  it('submits atomically with the mirror, resolves own side, and reads A after reveal', async () => {
    await seed({ submittedA: T1 });
    const b = ctx('b-uid', 'b@example.com');
    const batch = writeBatch(b);
    batch.set(doc(b, `${CONFLICT}/reflections/personB`), reflection('personB', 'b-uid', T2));
    batch.update(doc(b, CONFLICT), { hasReflectionB: true, personBSubmittedAt: T2, updatedAt: serverTimestamp() });
    await assertSucceeds(batch.commit());
    await assertSucceeds(getDoc(doc(b, `${CONFLICT}/reflections/personA`)));
    await assertSucceeds(updateDoc(doc(b, CONFLICT), { personBResolved: true, status: 'partially_resolved', updatedAt: serverTimestamp() }));
  });
  it("denies Person B forging Person A's mirror", async () => {
    await seed({ submittedB: T2 });
    await assertFails(updateDoc(doc(ctx('b-uid'), CONFLICT), { personASubmittedAt: T1 }));
  });
});

describe('Person B claim through arrayUnion (real client shape)', () => {
  it('allows the invited, matching email exactly once', async () => {
    await testEnv.withSecurityRulesDisabled(async admin => {
      await setDoc(doc(admin.firestore(), TRACKER), {
        name: 'Us', personAUid: 'a-uid', personAName: 'A', personBUid: null, personBEmail: 'b@example.com',
        personBName: 'B', memberUids: ['a-uid'], memberEmails: ['b@example.com'], customTags: [], createdBy: 'a-uid',
      });
    });
    const b = ctx('b-uid', 'B@example.com');
    await assertSucceeds(updateDoc(doc(b, TRACKER), { personBUid: 'b-uid', memberUids: arrayUnion('b-uid'), updatedAt: serverTimestamp() }));
  });
});

describe('deployed origin/main client calls under the new rules (release-order evidence)', () => {
  it('legacy createConflict without mirror fields is still allowed', async () => {
    await seed();
    await assertSucceeds(setDoc(doc(ctx('a-uid'), `${TRACKER}/conflicts/legacy`), {
      trackerId: 'tracker1', title: 'T', date: '2026-01-02', severity: 1, tags: [],
      personAResolved: false, personBResolved: false, status: 'open',
      hasReflectionA: false, hasReflectionB: false, createdBy: 'a-uid',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  it('legacy reflections collection listener/query is denied before reveal (needs corrected client)', async () => {
    await seed({ submittedA: T1, mirrors: false });
    await assertFails(getDocs(collection(ctx('a-uid'), `${CONFLICT}/reflections`)));
  });
  it('historical submissions without mirrors stay private until migrated, then reveal', async () => {
    await seed({ submittedA: T1, submittedB: T2, mirrors: false });
    await assertFails(getDoc(doc(ctx('a-uid'), `${CONFLICT}/reflections/personB`)));
    await assertSucceeds(getDoc(doc(ctx('a-uid'), `${CONFLICT}/reflections/personA`)));
    await testEnv.withSecurityRulesDisabled(async admin => {
      await updateDoc(doc(admin.firestore(), CONFLICT), { personASubmittedAt: T1, personBSubmittedAt: T2 });
    });
    await assertSucceeds(getDoc(doc(ctx('a-uid'), `${CONFLICT}/reflections/personB`)));
    await assertSucceeds(getDocs(collection(ctx('b-uid'), `${CONFLICT}/reflections`)));
  });
});
