import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteField, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { deleteConflict, saveReflectionDraft, submitReflection, watchReflections, createConflict } from '../../app/tools/conflict-tracker/lib/db';
import type { Reflection, ReflectionInput } from '../../app/tools/conflict-tracker/lib/types';

const client = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('../../app/tools/conflict-tracker/lib/firebase', () => ({ get db() { return client.db; } }));
// Wrap the real SDK so assertions also check which remote documents are requested.
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, onSnapshot: vi.fn(actual.onSnapshot) };
});

// AR-03/F-036 and related Conflict Tracker authorization coverage. This is
// the highest-stakes rule set in the repo — a real pre-reveal privacy
// boundary between two authenticated people — so it gets its own dedicated
// suite rather than folding into the AR-02 foundational matrix.

const PROJECT_ID = 'demo-website-rules-test';
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
  vi.mocked(onSnapshot).mockClear();
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

const input: ReflectionInput = {
  whatHappened: 'synthetic fixture', whatIFelt: 'x', whatIThoughtTheyMeant: 'x',
  whatINeeded: 'x', whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
};
function reflection(side: 'personA' | 'personB', authorUid: string) {
  return { ...input, id: side, person: side, authorUid, conflictId: 'conflict1', submittedAt: null };
}
function useClient(uid: string) { client.db = ctxFor(uid).firestore() as unknown as Firestore; return client.db; }

describe('assigned-side identity and historical documents', () => {
  beforeEach(seedTrackerAndConflict);
  it.each([['a-uid', 'personB'], ['b-uid', 'personA']] as const)('denies %s occupying %s with their own UID or forged authorship', async (uid, side) => {
    const fs = useClient(uid);
    await assertFails(setDoc(doc(fs, `${CONFLICT}/reflections/${side}`), reflection(side, uid)));
    await assertFails(setDoc(doc(fs, `${CONFLICT}/reflections/${side}`), reflection(side, side === 'personA' ? 'a-uid' : 'b-uid')));
  });
  it('requires matching document ID, person, conflictId and authorUid on create and update', async () => {
    const fs = useClient('a-uid');
    const target = doc(fs, `${CONFLICT}/reflections/personA`);
    for (const patch of [{ id: 'personB' }, { person: 'personB' }, { conflictId: 'other' }, { authorUid: 'b-uid' }]) {
      await assertFails(setDoc(target, { ...reflection('personA', 'a-uid'), ...patch }));
    }
    await assertSucceeds(setDoc(target, reflection('personA', 'a-uid')));
    for (const patch of [{ id: 'personB' }, { person: 'personB' }, { conflictId: 'other' }, { authorUid: 'b-uid' }]) {
      await assertFails(updateDoc(target, patch));
    }
  });
  it('preserves admin read/delete authority without enabling author impersonation', async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${CONFLICT}/reflections/personB`), reflection('personB', 'b-uid'));
    });
    const admin = testEnv.authenticatedContext('admin', { email: 'arkkahdarkkahd@gmail.com', email_verified: true }).firestore();
    await assertSucceeds(getDoc(doc(admin, `${CONFLICT}/reflections/personB`)));
    await assertFails(setDoc(doc(admin, `${CONFLICT}/reflections/personA`), reflection('personA', 'admin')));
    await assertFails(updateDoc(doc(admin, `${CONFLICT}/reflections/personB`), { authorUid: 'admin' }));
    await assertSucceeds(deleteDoc(doc(admin, `${CONFLICT}/reflections/personB`)));
  });
  it('creates a conflict with null mirrors through the real client', async () => {
    const fs = useClient('a-uid');
    const id = await createConflict('tracker1', { title: 'New', date: '2026-01-01', severity: 2, tags: [], createdBy: 'a-uid' });
    const data = (await getDoc(doc(fs, `${TRACKER}/conflicts/${id}`))).data();
    expect(data?.personASubmittedAt).toBeNull();
    expect(data?.personBSubmittedAt).toBeNull();
  });
  it('supports draft, edit and atomic submit on legacy parents with missing mirrors; retry preserves exact timestamp', async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), CONFLICT), { personASubmittedAt: deleteField(), personBSubmittedAt: deleteField() });
    });
    const fs = useClient('a-uid');
    await assertSucceeds(saveReflectionDraft('tracker1', 'conflict1', 'personA', 'a-uid', input));
    await assertSucceeds(saveReflectionDraft('tracker1', 'conflict1', 'personA', 'a-uid', { ...input, whatHappened: 'edited fixture' }));
    await assertSucceeds(submitReflection('tracker1', 'conflict1', 'personA', 'a-uid', input));
    const submittedAt = (await getDoc(doc(fs, `${CONFLICT}/reflections/personA`))).data()!.submittedAt;
    expect(submittedAt).toBeInstanceOf(Timestamp);
    expect((await getDoc(doc(fs, CONFLICT))).data()!.personASubmittedAt.isEqual(submittedAt)).toBe(true);
    await assertSucceeds(submitReflection('tracker1', 'conflict1', 'personA', 'a-uid', input));
    expect((await getDoc(doc(fs, CONFLICT))).data()!.personASubmittedAt.isEqual(submittedAt)).toBe(true);
    await assertFails(updateDoc(doc(fs, `${CONFLICT}/reflections/personA`), { submittedAt: Timestamp.now() }));
    await assertFails(getDoc(doc(fs, `${CONFLICT}/reflections/personB`)));
  });
  it('rejects forged mirrors and non-timestamp submissions', async () => {
    const fs = useClient('a-uid');
    await assertFails(updateDoc(doc(fs, CONFLICT), { personASubmittedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(fs, `${CONFLICT}/reflections/personA`), { ...reflection('personA', 'a-uid'), submittedAt: true }));
    await assertFails(updateDoc(doc(fs, CONFLICT), { personBSubmittedAt: Timestamp.now() }));
  });
});

describe('real client listeners and deletion under restricted queries', () => {
  beforeEach(seedTrackerAndConflict);
  it('subscribes only to self before mutual submission, then reveals both and cleans up', async () => {
    const fsA = useClient('a-uid');
    // The previously used collection listener is prohibited, including when empty.
    await assertFails(getDocs(collection(fsA, `${CONFLICT}/reflections`)));
    await new Promise<void>((resolve, reject) => {
      const stop = onSnapshot(collection(fsA, `${CONFLICT}/reflections`), () => { stop(); reject(new Error('Collection listener unexpectedly allowed')); }, error => {
        stop(); expect(error.code).toBe('permission-denied'); resolve();
      });
    });
    vi.mocked(onSnapshot).mockClear();
    const received: Reflection[][] = [];
    const errors: string[] = [];
    const stop = watchReflections('tracker1', 'conflict1', 'personA', (list, error) => {
      received.push(list); if (error) errors.push(error.code);
    });
    try {
      await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
      expect(errors).toEqual([]); // Own nonexistent document is readable.
      await saveReflectionDraft('tracker1', 'conflict1', 'personA', 'a-uid', input);
      useClient('b-uid');
      await saveReflectionDraft('tracker1', 'conflict1', 'personB', 'b-uid', input);
      await vi.waitFor(() => expect(received.at(-1)?.map(r => r.id)).toEqual(['personA']));
      const requestedPaths = () => vi.mocked(onSnapshot).mock.calls.map(call => (call[0] as { path?: string }).path);
      expect(requestedPaths()).not.toContain(`${CONFLICT}/reflections/personB`);
      useClient('a-uid');
      await submitReflection('tracker1', 'conflict1', 'personA', 'a-uid', input);
      expect(requestedPaths()).not.toContain(`${CONFLICT}/reflections/personB`);
      useClient('b-uid');
      await submitReflection('tracker1', 'conflict1', 'personB', 'b-uid', input);
      await vi.waitFor(() => expect(received.at(-1)?.map(r => r.id)).toEqual(['personA', 'personB']));
      expect(requestedPaths()).toContain(`${CONFLICT}/reflections/personB`);
      expect(errors).toEqual([]);
      await assertSucceeds(getDocs(collection(fsA, `${CONFLICT}/reflections`)));
      stop();
      const count = received.length;
      await updateDoc(doc(fsA, `${CONFLICT}/reflections/personA`), { whatHappened: 'after unsubscribe' });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(received).toHaveLength(count);
    } finally { stop(); }
  });
  it('reports authorization errors and clears stale reflection data', async () => {
    useClient('outsider');
    const callback = vi.fn();
    const stop = watchReflections('tracker1', 'conflict1', null, callback);
    try {
      await vi.waitFor(() => expect(callback).toHaveBeenCalledWith([], expect.objectContaining({ code: 'permission-denied' })));
      expect(vi.mocked(onSnapshot).mock.calls).toHaveLength(1); // Parent only.
    } finally { stop(); }
  });
  it('does not request partner data for missing, null, or invalid mirrors', async () => {
    useClient('a-uid');
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), CONFLICT), { personASubmittedAt: 'not a timestamp', personBSubmittedAt: true });
    });
    const callback = vi.fn();
    const stop = watchReflections('tracker1', 'conflict1', 'personA', callback);
    try {
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      expect(vi.mocked(onSnapshot).mock.calls.map(call => (call[0] as { path?: string }).path)).not.toContain(`${CONFLICT}/reflections/personB`);
    } finally { stop(); }
  });
  it.each([false, true])('deletes canonical reflection documents with the parent (has partner draft: %s)', async hasPartner => {
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), `${CONFLICT}/reflections/personA`), reflection('personA', 'a-uid'));
      if (hasPartner) await setDoc(doc(ctx.firestore(), `${CONFLICT}/reflections/personB`), reflection('personB', 'b-uid'));
    });
    useClient('b-uid');
    await assertFails(deleteConflict('tracker1', 'conflict1'));
    useClient('a-uid');
    await assertSucceeds(deleteConflict('tracker1', 'conflict1'));
    await testEnv.withSecurityRulesDisabled(async ctx => {
      for (const path of [CONFLICT, `${CONFLICT}/reflections/personA`, `${CONFLICT}/reflections/personB`]) {
        expect((await getDoc(doc(ctx.firestore(), path))).exists()).toBe(false);
      }
    });
  });
});
