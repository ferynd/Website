import { it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readPinnedBulk } from './fdcBulkReader';
import { suggestCandidates, suggestFromBulk, suggestionTokens } from './matchSuggest';
import { researchCli } from './researchCli';
const temp: string[] = [];
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct63-suggest-')); temp.push(p); return p; }
const fixture = async (name: string) => JSON.parse(await readFile(`scripts/fixtures/nutrition/fdc/${name}`, 'utf8'));
it('ranks candidates by name and alias word hits and drops foods with no hit', async () => {
    const foods = [await fixture('legume-bulk.json'), await fixture('oil-bulk.json'), await fixture('apple-bulk.json')];
    expect(suggestionTokens({ name: 'Oil, olive, extra-virgin', aliases: ['EVOO'] })).toEqual(['oil', 'olive', 'extra', 'virgin', 'evoo']);
    const ranked = suggestCandidates({ name: 'Oil, olive, extra-virgin' }, foods);
    expect(ranked.map(c => c.fdcId)).toEqual([foods[1].fdcId]);
    expect(ranked[0]).toMatchObject({ score: 4, description: foods[1].description });
    // A plural description word still matches the singular name word, and aliases count.
    expect(suggestCandidates({ name: 'Lentil', aliases: ['boiled'] }, foods)[0]).toMatchObject({ fdcId: foods[0].fdcId, score: 2 });
    expect(suggestCandidates({ name: 'Unrelated zzz' }, foods)).toEqual([]);
});
it('searches a release with a malformed record through the audit path, which the strict reader refuses', async () => {
    const root = await dir(), file = path.join(root, 'foundation.json');
    const foods = [await fixture('oil-bulk.json'), await fixture('malformed-string-amount.json'), await fixture('legume-bulk.json')];
    await writeFile(file, JSON.stringify({ _fixture: 'synthetic; not nutrition data', FoundationFoods: foods }));
    const pin = { id: 'foundation', release: 'fixture-f-v1', sha256: 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex'), fixtureOnly: true };
    await expect(readPinnedBulk(file, pin)).rejects.toThrow('Non-numeric');
    const found = await suggestFromBulk(file, pin, { name: 'Olive oil' });
    expect(found.candidates.map(c => c.fdcId)).toEqual([foods[0].fdcId]);
    expect(found).toMatchObject({ skippedRecords: 1, skippedFdcIds: [foods[1].fdcId] });
    // Pin checks still throw on the audit path.
    await expect(suggestFromBulk(file, { ...pin, sha256: 'sha256:' + '0'.repeat(64) }, { name: 'Olive oil' })).rejects.toThrow('checksum');
});
it('suggest stays review-only and returns no candidates without a pinned file', async () => {
    const id = JSON.parse(await readFile('docs/nutrition/ingredient-catalog.json', 'utf8')).entries[0].id;
    const result = await researchCli(['suggest', '--manifest-id', id], { output: () => { } });
    expect(result).toMatchObject({ reviewOnly: true, dataset: null, candidates: [], skippedRecords: 0 });
    expect(JSON.parse(await readFile('docs/nutrition/source-match-table.json', 'utf8')).entries).toEqual([]);
});
