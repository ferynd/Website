import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { researchCli, packetForJobs } from './researchCli';
import { createFileResearchStore } from './fileResearchStore';
import { buildResearchPackets, canonicalRequestBody } from '../../public/shared/nutrition/research/researchPacket.js';
import { responseFor } from '../../public/tools/CalorieTracker/nutrition/researchPacketFixtures.js';
const temp: string[] = [];
const output = () => { };
afterEach(async () => { await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true }))); vi.unstubAllEnvs(); });
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct62-cli-')); temp.push(p); return p; }
it('CLI/app build identical canonical bodies/digests, with new IDs per issue', async () => {
    const root = await dir();
    await researchCli(['plan', '--max', '3', '--fields', 'protein', '--write', '--store', root], { output });
    const store = await createFileResearchStore(root), { items: jobs } = await store.list();
    const app = await buildResearchPackets(jobs), cli = await packetForJobs(jobs);
    expect(cli.map(canonicalRequestBody)).toEqual(app.map(canonicalRequestBody));
    expect(cli.map(r => r.requestDigest)).toEqual(app.map(r => r.requestDigest));
    expect(cli[0].requestId).not.toBe(app[0].requestId);
});
it('plan/packet/import/review/coverage are dry-run by default and never fetch', async () => {
    const root = await dir(), fetch = vi.fn(() => { throw new Error('network forbidden'); });
    await researchCli(['plan', '--store', root, '--max', '1'], { output, fetch });
    expect(await readdir(root)).toEqual([]);
    await researchCli(['plan', '--store', root, '--max', '1', '--fields', 'protein', '--write'], { output, fetch });
    const file = path.join(root, 'jobs.json'), before = await readFile(file, 'utf8');
    const capture: unknown[] = [];
    await researchCli(['packet', '--store', root], { output: v => capture.push(v), fetch });
    expect(await readFile(file, 'utf8')).toBe(before);
    await researchCli(['packet', '--store', root, '--write'], { output: v => capture.push(v), fetch });
    const packet = (capture[1] as {
        request: Parameters<typeof responseFor>[0];
    }[])[0].request;
    const response = path.join(root, 'response.json');
    await writeFile(response, JSON.stringify(responseFor(packet)));
    const issued = await readFile(file, 'utf8');
    await researchCli(['import-packet', '--store', root, '--input', response], { output, fetch });
    expect(await readFile(file, 'utf8')).toBe(issued);
    await researchCli(['import-packet', '--store', root, '--input', response, '--write'], { output, fetch });
    const store = await createFileResearchStore(root), job = (await store.list()).items[0];
    expect(job.state).toBe('needs_review');
    await researchCli(['review', '--store', root, '--job', job.jobId], { output, fetch });
    await researchCli(['coverage', '--store', root], { output, fetch });
    expect(fetch).not.toHaveBeenCalled();
});
it('refuses fdc-api without --live and writes without --store; curated manifest remains empty', async () => {
    const fetch = vi.fn();
    await expect(researchCli(['run', '--source', 'fdc-api'], { output, fetch })).rejects.toThrow('--live');
    await expect(researchCli(['plan', '--write'], { output, fetch })).rejects.toThrow('--store');
    expect(fetch).not.toHaveBeenCalled();
    const manifest = JSON.parse(await readFile('public/shared/nutrition/catalog/nutrition-curated/manifest.json', 'utf8'));
    expect(manifest.profileCount).toBe(0);
});
