import { it, expect, vi } from 'vitest';
import { buildCatalogShards, createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
import empty from '../../../shared/nutrition/catalog/nutrition-curated/manifest.json';
import { fixture } from './ingredientFixtures.js';
it('opens manifest only, bounds search shards, pages deterministically, resolves old revisions', async () => { const f = await fixture(); const records = Array.from({ length: 40 }, (_, i) => ({ identity: { canonicalName: 'chicken ' + i, aliases: [] }, variant: { variantId: 'chicken-' + String(i).padStart(2, '0'), headRevision: 2 }, revisions: [f.revision, { ...f.revision, revision: 2 }] })); const built = await buildCatalogShards(records); const fetchJson = vi.fn(async (url) => url.endsWith('manifest.json') ? built.manifest : built.files[url.split('/nutrition-curated/')[1]]); const c = createCuratedCatalogSource({ fetchJson }); await c.open(); expect(fetchJson).toHaveBeenCalledTimes(1); const page = await c.search('chicken', { pageSize: 10 }); expect(page.items).toHaveLength(10); expect(fetchJson.mock.calls.length).toBeLessThanOrEqual(3); const next = await c.search('chicken', { pageSize: 10, cursor: page.cursor }); expect(next.items[0].variantId > page.items.at(-1).variantId).toBe(true); expect((await c.getRevision('chicken-00', 1)).revision).toBe(1); expect(c.stats().shards).toBeLessThanOrEqual(32); });
it('rejects shard tampering and ships empty', async () => { const c = createCuratedCatalogSource({ fetchJson: async () => empty }); expect(await c.search('anything')).toEqual({ items: [], cursor: null }); expect(empty.profileCount).toBe(0); const built = await buildCatalogShards([{ identity: { canonicalName: 'Salt' }, variant: { variantId: 'salt' }, revisions: [] }]); const broken = createCuratedCatalogSource({ fetchJson: async (url) => url.endsWith('manifest.json') ? built.manifest : [] }); await expect(broken.search('salt')).rejects.toThrow('hash mismatch'); });
it('evicts least recently used shards at the 32 shard cap', async () => {
    const records = Array.from({ length: 40 }, (_, i) => ({ identity: { canonicalName: 'item ' + i }, variant: { variantId: i.toString(36).padStart(2, '0') + '-item' }, revisions: [] }));
    const built = await buildCatalogShards(records);
    const fetchJson = vi.fn(async (url) => url.endsWith('manifest.json') ? built.manifest : built.files[url.split('/nutrition-curated/')[1]]);
    const c = createCuratedCatalogSource({ fetchJson });
    for (const record of records)
        await c.getVariant(record.variant.variantId);
    expect(c.stats().shards).toBe(32);
    const before = fetchJson.mock.calls.length;
    await c.getVariant(records[0].variant.variantId);
    expect(fetchJson).toHaveBeenCalledTimes(before + 1);
});
