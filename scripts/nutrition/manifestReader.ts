import { readFile } from 'node:fs/promises';
import { stateToDims } from '../../public/shared/nutrition/variantVocabulary.js';
export { stateToDims };
export interface ManifestEntry {
    id: string;
    name: string;
    category: string;
    kind: string;
    state: string;
    priority: number;
    sourceStrategy: string;
    status: 'queued';
    aliases?: string[];
    notes?: string;
    variant?: string;
}
export function validateManifest(raw: unknown, expectedCount?: number): ManifestEntry[] {
    const doc = raw as {
        schemaVersion: number;
        entries: ManifestEntry[];
    };
    if (doc?.schemaVersion !== 1 || !Array.isArray(doc.entries) || (expectedCount !== undefined && doc.entries.length !== expectedCount))
        throw new TypeError('Invalid manifest version/count');
    const ids = new Set();
    for (const e of doc.entries) {
        if (Object.keys(e).some(k => !['id', 'name', 'category', 'kind', 'state', 'priority', 'sourceStrategy', 'status', 'aliases', 'notes', 'variant'].includes(k)))
            throw new TypeError('Manifest contains values or unknown fields');
        if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id) || ids.has(e.id) || !e.name?.trim() || !e.category?.trim() || !e.state?.trim() || ![1, 2, 3].includes(e.priority) || e.status !== 'queued' || !['generic', 'additive', 'branded'].includes(e.kind) || !['usda-first', 'manufacturer-first', 'compound-reference'].includes(e.sourceStrategy))
            throw new TypeError('Invalid manifest entry: ' + e.id);
        if (e.aliases && (!Array.isArray(e.aliases) || e.aliases.some(a => typeof a !== 'string' || !a.trim())))
            throw new TypeError('Invalid aliases');
        ids.add(e.id);
    }
    return doc.entries;
}
export async function readManifest(file = 'docs/nutrition/ingredient-catalog.json', expectedCount = 1114) { return validateManifest(JSON.parse(await readFile(file, 'utf8')), expectedCount); }
// Waves A-C are the deterministic usda-first lanes (by priority). Every
// non-branded entry that is not usda-first (compound-reference, or
// manufacturer-first, i.e. formulation-dependent) belongs to wave D, matching
// the playbook's "formulation-dependent" wave and the documented wave-A
// eligible set (priority 1, generic, usda-first) used by batches A1 and A2.
// Branded entries stay in E. coverageReport groups by this same function, so
// its wave:* counts follow the planner's lanes.
export function waveOf(e: ManifestEntry) { return e.kind === 'branded' ? 'E' : e.sourceStrategy !== 'usda-first' ? 'D' : e.priority === 1 ? 'A' : e.priority === 2 ? 'B' : 'C'; }
export function selectNextBatch(entries: ManifestEntry[], jobs: {
    target: {
        manifestId?: string;
    };
}[] = [], { wave, max = 25 }: {
    wave?: string;
    max?: number;
} = {}) {
    const active = new Set(jobs.map(j => j.target.manifestId));
    return entries.filter(e => (!wave || waveOf(e) === wave) && !active.has(e.id)).sort((a, b) => a.priority - b.priority || a.category.localeCompare(b.category) || a.id.localeCompare(b.id)).slice(0, Math.max(1, Math.min(25, max)));
}
