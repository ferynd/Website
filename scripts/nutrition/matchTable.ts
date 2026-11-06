import { readFile } from 'node:fs/promises';
import { contentHashOf } from '../../public/shared/nutrition/contentHash.js';
export interface MatchEntry {
    manifestId: string;
    adapter: 'fdc_bulk' | 'fdc_api';
    dataType: string;
    fdcId: string;
    release: string;
    description: string;
    stateEvidence: string;
    rationale: string;
    reviewer: string;
    reviewedAt: string;
    checklistVersion: 1;
    sharedJustification?: string;
}
export async function validateMatchTable(raw: unknown) {
    const doc = raw as {
        schemaVersion: number;
        entries: MatchEntry[];
    };
    if (doc?.schemaVersion !== 1 || !Array.isArray(doc.entries))
        throw new TypeError('Invalid match table');
    const seen = new Set<string>(), fdc = new Map<string, MatchEntry>();
    for (const e of doc.entries) {
        if (!['fdc_bulk', 'fdc_api'].includes(e.adapter) || !/^\d+$/.test(e.fdcId) || e.checklistVersion !== 1 || !Number.isFinite(Date.parse(e.reviewedAt)) || ['manifestId', 'dataType', 'release', 'description', 'stateEvidence', 'rationale', 'reviewer'].some(k => !String(e[k as keyof MatchEntry] || '').trim()))
            throw new TypeError('Invalid reviewed match');
        const key = e.manifestId + ':' + e.adapter, source = e.adapter + ':' + e.release + ':' + e.fdcId;
        if (seen.has(key))
            throw new TypeError('Duplicate manifest match');
        const previous = fdc.get(source);
        if (previous && (!e.sharedJustification || !previous.sharedJustification))
            throw new TypeError('Shared FDC record requires justification on both matches');
        seen.add(key);
        fdc.set(source, e);
    }
    return Promise.all(doc.entries.map(async (e) => ({ ...e, hash: await contentHashOf(e) })));
}
export async function readMatchTable(file = 'docs/nutrition/source-match-table.json') { return validateMatchTable(JSON.parse(await readFile(file, 'utf8'))); }
export function matchFor(entries: MatchEntry[], manifestId: string, adapter: string) { const e = entries.find(e => e.manifestId === manifestId && e.adapter === adapter); return e ? { ...e, sourceAdapter: adapter, sourceId: e.fdcId, sourceRelease: e.release } : null; }
