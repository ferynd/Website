import { it, expect, vi, afterEach } from 'vitest';
import { memoryIndexedDb } from './memoryIndexedDb.js';
import { openResearchJobStore, clearResearchJobs, RESEARCH_DB_NAME } from '../../../shared/nutrition/research/indexedDbResearchStore.js';
import { packetFixture } from './researchPacketFixtures.js';
import { onIngredientAuthChange } from '../services/ingredientSession.js';
afterEach(() => vi.useRealTimers());
it('resumes same owner awaiting response and deletes jobs on owner change/signout, invalidating old handles', async () => {
    const idb = memoryIndexedDb(), a = await openResearchJobStore({ ownerUid: 'a', idb });
    const f = await packetFixture({ store: a, scope: 'private' });
    a.close();
    const resumed = await openResearchJobStore({ ownerUid: 'a', idb });
    expect((await resumed.get(f.job.jobId)).state).toBe('awaiting_response');
    const b = await openResearchJobStore({ ownerUid: 'b', idb });
    expect((await b.list()).items).toEqual([]);
    await expect(resumed.save(f.job)).rejects.toThrow('closed');
    await expect(b.save(f.job)).rejects.toThrow('owner mismatch');
    await onIngredientAuthChange('b', null, async () => { }, () => clearResearchJobs({ idb }));
    expect(idb.databases.has(RESEARCH_DB_NAME)).toBe(false);
    await expect(b.list()).rejects.toThrow('closed');
});
it('enforces CAS and atomically rejects a group with one stale version', async () => {
    const store = await openResearchJobStore({ ownerUid: 'a', idb: memoryIndexedDb() }), f = await packetFixture({ store });
    const j = await store.get(f.job.jobId);
    await expect(store.save({ ...j, version: j.version + 1 }, { expectedVersion: 999 })).rejects.toThrow('Compare-and-swap');
    expect((await store.get(j.jobId)).version).toBe(j.version);
    store.close();
});
it('fails closed when unavailable or deletion fails during owner change', async () => {
    await expect(openResearchJobStore({ ownerUid: 'a', idb: null })).rejects.toThrow('unavailable');
    const idb = memoryIndexedDb(), a = await openResearchJobStore({ ownerUid: 'a', idb });
    await packetFixture({ store: a });
    idb.deleteDatabase = () => { throw new Error('denied'); };
    await expect(openResearchJobStore({ ownerUid: 'b', idb })).rejects.toThrow('could not be cleared');
});
it.each(['throw', 'error', 'blocked', 'silent'])('bounds clear when storage %s', async (mode) => {
    vi.useFakeTimers();
    const idb = { deleteDatabase() {
            if (mode === 'throw')
                throw new Error('denied');
            const req = {};
            queueMicrotask(() => {
                if (mode === 'error')
                    req.onerror();
                if (mode === 'blocked')
                    req.onblocked();
            });
            return req;
        } };
    const result = clearResearchJobs({ idb });
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
});
it('same-owner auth refresh retains jobs and both cleanups run even if one throws', async () => {
    const clear = vi.fn(async () => { throw new Error('denied'); }), jobs = vi.fn();
    await onIngredientAuthChange('a', 'a', clear, jobs);
    expect(jobs).not.toHaveBeenCalled();
    await onIngredientAuthChange('a', 'b', clear, jobs);
    expect(clear).toHaveBeenCalledOnce();
    expect(jobs).toHaveBeenCalledOnce();
});
