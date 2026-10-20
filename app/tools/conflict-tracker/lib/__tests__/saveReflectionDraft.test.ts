import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

// Client unit test (no emulator): saveReflectionDraft must refuse to turn a
// submitted reflection back into a draft, and must write nothing when it does.
const tx = vi.hoisted(() => ({ existing: undefined as Record<string, unknown> | undefined, set: vi.fn(), update: vi.fn() }));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (...parts: unknown[]) => ({ path: parts.filter(p => typeof p === 'string').join('/') }),
    collection: (...parts: unknown[]) => ({ path: parts.filter(p => typeof p === 'string').join('/') }),
    serverTimestamp: () => 'SERVER_TS',
    runTransaction: async (_db: unknown, fn: (t: unknown) => Promise<unknown>) => fn({
      get: async () => ({ data: () => tx.existing }), set: tx.set, update: tx.update,
    }),
  };
});
const { saveReflectionDraft, SubmittedReflectionError } = await import('../db');
const input = {
  whatHappened: 'x', whatIFelt: 'x', whatIThoughtTheyMeant: 'x', whatINeeded: 'x',
  whatIAmOwning: 'x', whatIWillDoDifferently: 'x', tags: [], feelsResolved: 'no' as const,
};

describe('saveReflectionDraft', () => {
  beforeEach(() => { tx.set.mockClear(); tx.update.mockClear(); });
  it('refuses once submitted and writes nothing', async () => {
    tx.existing = { submittedAt: Timestamp.fromMillis(1) };
    await expect(saveReflectionDraft('t', 'c', 'personA', 'a-uid', input)).rejects.toBeInstanceOf(SubmittedReflectionError);
    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
  it('saves a new or existing draft with submittedAt null and the draft flag', async () => {
    for (const existing of [undefined, { submittedAt: null, createdAt: 'OLD' }]) {
      tx.existing = existing;
      await saveReflectionDraft('t', 'c', 'personB', 'b-uid', input);
      const written = tx.set.mock.calls.at(-1)![1] as Record<string, unknown>;
      expect(written).toMatchObject({ id: 'personB', person: 'personB', authorUid: 'b-uid', submittedAt: null });
      expect(written.createdAt).toBe(existing ? 'OLD' : 'SERVER_TS');
      expect(tx.update.mock.calls.at(-1)![1]).toEqual({ hasReflectionB: true, updatedAt: 'SERVER_TS' });
    }
  });
});
