import { auditPinnedBulk, type DatasetPin } from './fdcBulkReader';
import type { ManifestEntry } from './manifestReader';
/**
 * Review-only candidate search for `suggest` (#63). Candidates are ranked by
 * how many name/alias words appear in the FDC description; the operator still
 * decides physical/formulation fit. Nothing here edits the reviewed match table.
 */
const STOPWORDS = new Set(['and', 'with', 'the', 'for', 'percent', 'from']);
function words(text: string) {
    return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function suggestionTokens(entry: Pick<ManifestEntry, 'name' | 'aliases'>) {
    const all = [entry.name, ...(entry.aliases || [])].flatMap(words);
    return [...new Set(all.filter(w => !STOPWORDS.has(w) && (w.length >= 3 || /^\d+$/.test(w))))];
}
function tokenHits(token: string, description: string[]) {
    return description.some(w => w === token || w.startsWith(token) || (w.length >= 4 && token.startsWith(w)));
}
export interface Suggestion {
    fdcId: unknown;
    description: string;
    dataType: string | null;
    score: number;
}
export function suggestCandidates(entry: Pick<ManifestEntry, 'name' | 'aliases'>, foods: Record<string, unknown>[], max = 20): Suggestion[] {
    const tokens = suggestionTokens(entry);
    return foods
        .map(f => {
            const description = String(f.description || '');
            const descWords = words(description);
            return { fdcId: f.fdcId, description, dataType: typeof f.dataType === 'string' ? f.dataType : null, score: tokens.filter(t => tokenHits(t, descWords)).length };
        })
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score || Number(a.fdcId) - Number(b.fdcId))
        .slice(0, Math.max(1, max));
}
/**
 * Uses the per-record audit path, never the strict reader: the real Foundation
 * release has records the parser rejects, and those are skipped and counted
 * (by id only) instead of aborting the search.
 */
export async function suggestFromBulk(file: string, pin: DatasetPin, entry: Pick<ManifestEntry, 'name' | 'aliases'>, max = 20) {
    const audit = await auditPinnedBulk(file, pin);
    return { candidates: suggestCandidates(entry, audit.foods, max), skippedRecords: audit.failures.length, skippedFdcIds: audit.failures.map(f => f.fdcId) };
}
