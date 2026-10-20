import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { type RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import {
  createConflict, deleteConflict, saveReflectionDraft, setResolved, submitReflection, updateConflictShared, watchReflections,
} from '../../app/tools/conflict-tracker/lib/db';
import type { Reflection, ReflectionInput } from '../../app/tools/conflict-tracker/lib/types';

const client = vi.hoisted(() => ({ db: null as unknown as Firestore }));
vi.mock('../../app/tools/conflict-tracker/lib/firebase', () => ({ get db() { return client.db; } }));

// The corrected Conflict Tracker client (identical files ship in the main
// backport PR) must work against BOTH the currently deployed ruleset and the
// AR-03 rules, so the client can be released first. Each rule set runs in its
// own emulator project.
const RULE_SETS = [
  { name: 'live 7c3d1850', projectId: 'demo-website-rules-live', file: 'tests/rules/fixtures/firestore.live-7c3d1850.rules', live: true },
  { name: 'AR-03 firestore.rules', projectId: 'demo-website-rules-test', file: 'firestore.rules', live: false },
] as const;
const TRACKER = 'artifacts/conflict-tracker/trackers/tracker1';
const CONFLICT = `${TRACKER}/conflicts/conflict1`;
const input: ReflectionInput = {
  whatHappened: 'synthetic fixture', whatIFelt: 'x', whatIThoughtTheyMeant: 'x',
  whatINeeded: 'x', whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no',
};
const T1 = new Timestamp(1_700_000_000, 111_000_000);
const T2 = new Timestamp(1_700_000_500, 222_000_000);

describe.each(RULE_SETS)('corrected client under $name rules', ruleSet => {
  let env: RulesTestEnvironment;
  const use = (uid: string) => {
    client.db = env.authenticatedContext(uid, { email_verified: true, email: `${uid}@example.com` }).firestore() as unknown as Firestore;
    return client.db;
  };
  const read = async (path: string) => {
    let data: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async admin => { data = (await getDoc(doc(admin.firestore(), path))).data(); });
    return data;
  };
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: ruleSet.projectId,
      firestore: { rules: readFileSync(ruleSet.file, 'utf8'), host: '127.0.0.1', port: 8080 },
    });
  });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async admin => {
      await setDoc(doc(admin.firestore(), TRACKER), {
        name: 'Us', personAUid: 'a-uid', personAName: 'A', personBUid: 'b-uid', personBEmail: 'b-uid@example.com',
        personBName: 'B', memberUids: ['a-uid', 'b-uid'], memberEmails: ['b-uid@example.com'], customTags: [], createdBy: 'a-uid',
      });
    });
  });

  it('creates, drafts, submits both sides, reveals, resolves and edits the shared section', async () => {
    use('a-uid');
    const id = await createConflict('tracker1', { title: 'T', date: '2026-01-01', severity: 2, tags: [], createdBy: 'a-uid' });
    await saveReflectionDraft('tracker1', id, 'personA', 'a-uid', input);
    await submitReflection('tracker1', id, 'personA', 'a-uid', input);
    use('b-uid');
    await submitReflection('tracker1', id, 'personB', 'b-uid', input);
    use('a-uid');
    const received: Reflection[][] = [];
    const stop = watchReflections('tracker1', id, 'personA', list => received.push(list), 'a-uid');
    try {
      await vi.waitFor(() => expect(received.at(-1)?.map(r => r.id)).toEqual(['personA', 'personB']));
    } finally { stop(); }
    await setResolved('tracker1', id, 'personA', true);
    await updateConflictShared('tracker1', id, { sharedClarification: 'fixture' }, 'a-uid');
    expect((await read(`${TRACKER}/conflicts/${id}`))?.status).toBe('partially_resolved');
  });

  it('self-heals each historical own-side mirror on load (exact value), then reveals', async () => {
    await env.withSecurityRulesDisabled(async admin => {
      const fs = admin.firestore();
      await setDoc(doc(fs, CONFLICT), {
        trackerId: 'tracker1', title: 'T', date: '2026-01-01', severity: 2, tags: [], personAResolved: false,
        personBResolved: false, status: 'open', hasReflectionA: true, hasReflectionB: true, createdBy: 'a-uid',
      });
      await setDoc(doc(fs, `${CONFLICT}/reflections/personA`), { ...input, id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'a-uid', submittedAt: T1 });
      await setDoc(doc(fs, `${CONFLICT}/reflections/personB`), { ...input, id: 'personB', person: 'personB', conflictId: 'conflict1', authorUid: 'b-uid', submittedAt: T2 });
    });
    use('a-uid');
    const aLists: Reflection[][] = [];
    const stopA = watchReflections('tracker1', 'conflict1', 'personA', list => aLists.push(list), 'a-uid');
    try {
      await vi.waitFor(async () => expect((await read(CONFLICT))?.personASubmittedAt).toEqual(T1));
      expect((await read(CONFLICT))?.personBSubmittedAt ?? null).toBeNull(); // Never the partner side.
      if (!ruleSet.live) expect(aLists.at(-1)?.map(r => r.id)).toEqual(['personA']);
      use('b-uid');
      const stopB = watchReflections('tracker1', 'conflict1', 'personB', () => {}, 'b-uid');
      try {
        await vi.waitFor(async () => expect((await read(CONFLICT))?.personBSubmittedAt).toEqual(T2));
      } finally { stopB(); }
      await vi.waitFor(() => expect(aLists.at(-1)?.map(r => r.id)).toEqual(['personA', 'personB']));
    } finally { stopA(); }
  });

  it('does not heal drafts and attempts at most once when the write is rejected', async () => {
    await env.withSecurityRulesDisabled(async admin => {
      const fs = admin.firestore();
      await setDoc(doc(fs, CONFLICT), {
        trackerId: 'tracker1', title: 'T', date: '2026-01-01', severity: 2, tags: [], personAResolved: false,
        personBResolved: false, status: 'open', hasReflectionA: true, hasReflectionB: false, createdBy: 'a-uid',
      });
      // Identity mismatch (historically written by the wrong UID): heal must not be attempted.
      await setDoc(doc(fs, `${CONFLICT}/reflections/personA`), { ...input, id: 'personA', person: 'personA', conflictId: 'conflict1', authorUid: 'b-uid', submittedAt: T1 });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    use('a-uid');
    const stop = watchReflections('tracker1', 'conflict1', 'personA', () => {}, 'a-uid');
    await new Promise(resolve => setTimeout(resolve, 300));
    stop();
    expect((await read(CONFLICT))?.personASubmittedAt ?? null).toBeNull();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain('synthetic fixture');
    warn.mockRestore();
  });

  it('lets Person A delete a conflict with no reflections (fallback covers live rules)', async () => {
    use('a-uid');
    const id = await createConflict('tracker1', { title: 'T', date: '2026-01-01', severity: 2, tags: [], createdBy: 'a-uid' });
    await deleteConflict('tracker1', id);
    expect(await read(`${TRACKER}/conflicts/${id}`)).toBeUndefined();
  });

  it(ruleSet.live
    ? 'KNOWN until AR-03 rules ship: non-admin delete of a conflict that has reflections is denied (same as the old client)'
    : 'lets Person A delete a conflict with reflections atomically', async () => {
    use('a-uid');
    const id = await createConflict('tracker1', { title: 'T', date: '2026-01-01', severity: 2, tags: [], createdBy: 'a-uid' });
    await saveReflectionDraft('tracker1', id, 'personA', 'a-uid', input);
    if (ruleSet.live) {
      await expect(deleteConflict('tracker1', id)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(await read(`${TRACKER}/conflicts/${id}`)).toBeDefined();
    } else {
      await deleteConflict('tracker1', id);
      expect(await read(`${TRACKER}/conflicts/${id}`)).toBeUndefined();
      expect(await read(`${TRACKER}/conflicts/${id}/reflections/personA`)).toBeUndefined();
    }
  });
});
