import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { applyEntry, digest, makeDryRun, planMirrors } from '../../scripts/firebase/conflictMigration';

const projectId = 'demo-website-rules-test';
const tracker = 'artifacts/conflict-tracker/trackers/migration';
const originalA = new Timestamp(1700000000, 123456000);
const originalB = new Timestamp(1700000001, 987654000);
let app: App, db: Firestore, env: RulesTestEnvironment;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Migration tests require emulator isolation');
  app = initializeApp({ projectId }, 'migration-tests');
  db = getFirestore(app);
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
afterAll(async () => { await env?.cleanup(); await db?.terminate(); if (app) await deleteApp(app); });
beforeEach(async () => {
  await env.clearFirestore();
  await db.doc(tracker).set({ personAUid: 'a', personBUid: 'b', createdBy: 'a', memberUids: ['a', 'b'], memberEmails: [] });
});
async function seed(id: string, submittedA: Timestamp | null, submittedB: Timestamp | null) {
  const parent = db.doc(`${tracker}/conflicts/${id}`);
  await parent.set({ title: 'synthetic private title', createdBy: 'a', hasReflectionA: true, hasReflectionB: true });
  for (const [side, uid, submittedAt] of [['personA', 'a', submittedA], ['personB', 'b', submittedB]] as const) {
    await parent.collection('reflections').doc(side).set({ id: side, person: side, conflictId: id, authorUid: uid, submittedAt, whatHappened: 'PRIVATE_FIXTURE_DO_NOT_LOG' });
  }
  return parent;
}

describe('trusted migration: preservation, privacy and audit', () => {
  it('dry-runs without writes, preserves nanoseconds/content, backfills each side, and is idempotent', async () => {
    const complete = await seed('complete', originalA, originalB);
    await complete.update({ relatedDocument: db.doc('publicMeta/config') });
    const draft = await seed('draft', null, null);
    const partial = await seed('partial', originalA, null);
    const before = await complete.collection('reflections').get();
    const { plan, backupText } = await makeDryRun(db, projectId);
    expect(plan.counts).toEqual({ scanned: 3, affected: 3, unchanged: 0, blocked: 0, fields: 6 });
    expect(plan.issues).toEqual([]);
    expect((await complete.get()).data()).not.toHaveProperty('personASubmittedAt');
    expect(plan.backupSha256).toBe(digest(backupText));
    expect(backupText).toContain('123456000');
    expect(backupText).toContain('publicMeta/config');
    expect(backupText).toContain(projectId);
    expect(JSON.stringify(plan)).not.toContain('PRIVATE_FIXTURE_DO_NOT_LOG');
    for (const entry of plan.entries) expect(await applyEntry(db, entry)).toBe('applied');
    const data = (await complete.get()).data()!;
    expect(data.personASubmittedAt.isEqual(originalA)).toBe(true);
    expect(data.personBSubmittedAt.isEqual(originalB)).toBe(true);
    expect(data.title).toBe('synthetic private title');
    expect(data.relatedDocument.isEqual(db.doc('publicMeta/config'))).toBe(true);
    for (const reflection of before.docs) expect((await reflection.ref.get()).data()).toEqual(reflection.data());
    expect((await draft.get()).data()).toMatchObject({ personASubmittedAt: null, personBSubmittedAt: null });
    expect((await partial.get()).data()!.personASubmittedAt.isEqual(originalA)).toBe(true);
    for (const entry of plan.entries) expect(await applyEntry(db, entry)).toBe('already-applied');
    expect((await makeDryRun(db, projectId)).plan.counts.affected).toBe(0);
    const a = env.authenticatedContext('a').firestore();
    await assertSucceeds(getDoc(doc(a, `${complete.path}/reflections/personB`)));
    await assertFails(getDoc(doc(a, `${draft.path}/reflections/personB`)));
    await assertFails(getDoc(doc(a, `${partial.path}/reflections/personB`)));
    await assertSucceeds(updateDoc(doc(a, draft.path), { title: 'updated legacy title' }));
  });
  it('initializes absent reflections to null without creating reflection documents', async () => {
    const parent = db.doc(`${tracker}/conflicts/empty`);
    await parent.set({ createdBy: 'a' });
    const { plan } = await makeDryRun(db, projectId);
    await applyEntry(db, plan.entries[0]);
    expect((await parent.get()).data()).toEqual({ createdBy: 'a', personASubmittedAt: null, personBSubmittedAt: null });
    expect((await parent.collection('reflections').get()).empty).toBe(true);
  });
  it.each(['parent', 'reflection', 'tracker'])('rejects concurrent %s changes after the backup', async changed => {
    const parent = await seed('drift', originalA, originalB);
    const { plan } = await makeDryRun(db, projectId);
    const ref = changed === 'parent' ? parent : changed === 'tracker' ? db.doc(tracker) : parent.collection('reflections').doc('personA');
    await ref.update({ changedAfterDryRun: true });
    await expect(applyEntry(db, plan.entries[0])).rejects.toThrow('Source changed');
    expect((await parent.get()).data()).not.toHaveProperty('personASubmittedAt');
  });
  it('quarantines identity errors, false submissions and conflicting mirrors', () => {
    const t = { personAUid: 'a', personBUid: 'b' };
    const r = { id: 'personA', person: 'personA', conflictId: 'c', authorUid: 'a', submittedAt: originalA };
    for (const [parent, reflection] of [
      [{}, { ...r, authorUid: 'b' }],
      [{}, { ...r, submittedAt: true }],
      [{ personASubmittedAt: originalB }, r],
      [{ personASubmittedAt: originalA }, { ...r, submittedAt: null }],
    ]) {
      const result = planMirrors(t, 'c', parent, [reflection, undefined]);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.writes).toEqual({});
    }
  });
  it('executes the CLI dry run and digest-approved emulator apply without logging content', async () => {
    await seed('cli', originalA, originalB);
    const temp = mkdtempSync('/tmp/website-migration-');
    const out = resolve(temp, 'run');
    const run = (args: string[]) => promisify(execFile)(process.execPath, [
      'node_modules/vite-node/vite-node.mjs', 'scripts/firebase/migrateConflictMirrors.ts', '--',
      '--project', projectId, '--emulator', '--out', out, ...args,
    ], { cwd: process.cwd(), timeout: 15000 });
    try {
      const dryRun = await run(['--dry-run']);
      expect(dryRun.stdout).not.toContain('PRIVATE_FIXTURE_DO_NOT_LOG');
      const text = readFileSync(resolve(out, 'plan.json'), 'utf8');
      expect(statSync(resolve(out, 'backup.json')).mode & 0o077).toBe(0);
      await expect(run(['--apply', '--maintenance-confirmed', '--approve-plan-sha256', 'wrong'])).rejects.toThrow();
      const applied = await run(['--apply', '--maintenance-confirmed', '--approve-plan-sha256', digest(text)]);
      expect(JSON.parse(applied.stdout).applied).toBe(1);
      const repeated = await run(['--apply', '--maintenance-confirmed', '--approve-plan-sha256', digest(text)]);
      expect(JSON.parse(repeated.stdout).unchanged).toBe(1);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 20000);
});
