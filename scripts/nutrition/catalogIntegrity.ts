/**
 * #63 V4 catalog integrity: batches only add.
 *
 * verifyCatalog checks one published or staged catalog ({ manifest, files }):
 * manifest shape, shard hashes and filenames, orphan files, duplicate variants,
 * variant shard buckets, head revisions, and that every variant has an
 * up-to-date search entry. verifyAppendOnly compares two catalogs and flags any
 * previous profile that is dropped or changed, or any previous search entry
 * that disappears. mergeCatalogRecords and combineCatalogs are the cumulative
 * layer beside stageCatalog (which stays per-batch): identical reruns dedupe,
 * conflicting duplicates throw.
 *
 * Defect strings are `<code>:<catalog id or shard key>` only. No nutrient value
 * and no record content leaves this module. Nothing here writes to disk.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCatalogShards } from '../../public/shared/nutrition/ingredientCatalog.js';
import { canonicalJson, contentHashOf } from '../../public/shared/nutrition/contentHash.js';
import { CURATED_CATALOG_ID, normalizeIdentityName } from '../../public/shared/nutrition/ingredientIds.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CatalogFiles = Record<string, unknown>;
export interface CatalogInput { manifest: any; files: CatalogFiles }
export interface CatalogSummary {
    profileCount: number;
    variantShardCount: number;
    searchShardCount: number;
    searchEntryCount: number;
    revisionCount: number;
    variantIds: string[];
    defects: string[];
}
export interface AppendOnlySummary { added: string[]; preserved: number; defects: string[] }

/** The pattern createCuratedCatalogSource enforces before fetching a shard. */
export const SHARD_FILE_PATTERN = /^(search|variants)\/([a-z0-9_-]+)\.([a-f0-9]{64})\.json$/;
const SHARD_KINDS = [['searchShards', 'search'], ['variantShards', 'variants']] as const;

/**
 * Replicates the private `bucket` helper in public/shared/nutrition/ingredientCatalog.js
 * (not exported there). Keep the two in step; the rebuild check below catches drift.
 */
export const catalogBucket = (s: string) => normalizeIdentityName(s).slice(0, 2).padEnd(2, '_').replace(/[^a-z0-9_-]/g, '_');

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (record: any): string | null => (isObject(record) && isObject(record.variant) && typeof record.variant.variantId === 'string' && record.variant.variantId ? record.variant.variantId : null);
const byId = (a: string, b: string) => a.localeCompare(b);
async function hashOrNull(value: unknown) {
    try {
        return await contentHashOf(value);
    }
    catch {
        return null;
    }
}
function canonicalOrNull(value: unknown) {
    try {
        return canonicalJson(value);
    }
    catch {
        return null;
    }
}

/** Shard entries of one manifest kind, as [bucket key, entry] pairs. */
function shardEntries(manifest: any, kind: 'searchShards' | 'variantShards'): [string, any][] {
    return isObject(manifest) && isObject(manifest[kind]) ? Object.entries(manifest[kind]) : [];
}

/** Variant records in manifest bucket order, with the bucket key each was found in. */
function variantRecordsOf(input: CatalogInput): { bucket: string; record: any }[] {
    const out: { bucket: string; record: any }[] = [];
    for (const [bucket, entry] of shardEntries(input.manifest, 'variantShards')) {
        const data = isObject(entry) && typeof entry.file === 'string' ? input.files?.[entry.file] : undefined;
        if (Array.isArray(data))
            for (const record of data)
                out.push({ bucket, record });
    }
    return out;
}

function searchEntriesOf(input: CatalogInput): { bucket: string; entry: any }[] {
    const out: { bucket: string; entry: any }[] = [];
    for (const [bucket, shard] of shardEntries(input.manifest, 'searchShards')) {
        const data = isObject(shard) && typeof shard.file === 'string' ? input.files?.[shard.file] : undefined;
        if (Array.isArray(data))
            for (const entry of data)
                out.push({ bucket, entry });
    }
    return out;
}

const headMatches = (ref: any, variant: any) => isObject(ref)
    && ref.variantId === variant.variantId && ref.identityId === variant.identityId
    && ref.revision === variant.headRevision && ref.revisionId === variant.headRevisionId && ref.contentHash === variant.headContentHash;

export async function verifyCatalog(input: CatalogInput): Promise<CatalogSummary> {
    const defects: string[] = [];
    const manifest = input?.manifest;
    const files: CatalogFiles = isObject(input?.files) ? input.files : {};
    if (!isObject(manifest) || manifest.schemaVersion !== 1 || manifest.catalogId !== CURATED_CATALOG_ID
        || !Number.isSafeInteger(manifest.profileCount) || manifest.profileCount < 0
        || !isObject(manifest.searchShards) || !isObject(manifest.variantShards))
        defects.push('manifest_schema:manifest');

    // Shards: presence, hash, filename hash segment, path shape.
    const referenced = new Set<string>();
    for (const [kind, dir] of SHARD_KINDS) {
        for (const [bucket, entry] of shardEntries(manifest, kind)) {
            const key = `${dir}/${bucket}`;
            const file = isObject(entry) && typeof entry.file === 'string' ? entry.file : null;
            if (!file) {
                defects.push(`shard_path_invalid:${key}`);
                continue;
            }
            referenced.add(file);
            const match = SHARD_FILE_PATTERN.exec(file);
            if (!match || match[1] !== dir || match[2] !== bucket)
                defects.push(`shard_path_invalid:${key}`);
            if (!Object.prototype.hasOwnProperty.call(files, file)) {
                defects.push(`shard_missing:${key}`);
                continue;
            }
            const data = files[file];
            if (!Array.isArray(data))
                defects.push(`shard_shape_invalid:${key}`);
            const hash = await hashOrNull(data);
            if (!hash || hash !== entry.contentHash)
                defects.push(`shard_hash_mismatch:${key}`);
            if (match && `sha256:${match[3]}` !== entry.contentHash)
                defects.push(`shard_filename_hash_mismatch:${key}`);
        }
    }
    for (const file of Object.keys(files).sort())
        if (!referenced.has(file))
            defects.push(`orphan_file:${file}`);

    // Variant records: duplicates, bucket, head revision.
    const variants = new Map<string, any>();
    let revisionCount = 0;
    for (const { bucket, record } of variantRecordsOf({ manifest, files })) {
        const id = idOf(record);
        if (!id) {
            defects.push(`record_shape_invalid:variants/${bucket}`);
            continue;
        }
        if (variants.has(id)) {
            defects.push(`duplicate_variant:${id}`);
            continue;
        }
        variants.set(id, record);
        if (catalogBucket(id) !== bucket)
            defects.push(`variant_bucket_mismatch:${id}`);
        const revisions = Array.isArray(record.revisions) ? record.revisions : [];
        revisionCount += revisions.length;
        const head = revisions.find((r: any) => isObject(r) && r.revision === record.variant.headRevision);
        if (!head)
            defects.push(`head_revision_missing:${id}`);
        else if (head.revisionId !== record.variant.headRevisionId || head.contentHash !== record.variant.headContentHash)
            defects.push(`head_revision_mismatch:${id}`);
    }
    const variantIds = [...variants.keys()].sort(byId);
    if (isObject(manifest) && manifest.profileCount !== variantIds.length)
        defects.push('profile_count_mismatch:manifest');

    // Search entries: known variant, head ref, coverage.
    const searchEntries = searchEntriesOf({ manifest, files });
    const searched = new Set<string>();
    for (const { bucket, entry } of searchEntries) {
        const id = isObject(entry) && typeof entry.variantId === 'string' ? entry.variantId : null;
        if (!id || !variants.has(id)) {
            defects.push(`search_unknown_variant:${id ?? `search/${bucket}`}`);
            continue;
        }
        searched.add(id);
        const variant = variants.get(id).variant;
        if (!headMatches(entry.ref, variant) || entry.headRevision !== variant.headRevision
            || entry.headRevisionId !== variant.headRevisionId || entry.headContentHash !== variant.headContentHash)
            defects.push(`search_ref_mismatch:${id}`);
        if (!Array.isArray(entry.searchTokens) || !entry.searchTokens.some((t: unknown) => typeof t === 'string' && catalogBucket(t) === bucket))
            defects.push(`search_bucket_mismatch:${id}`);
    }
    for (const id of variantIds)
        if (!searched.has(id))
            defects.push(`search_missing_variant:${id}`);

    // Rebuild: the shards must be exactly what buildCatalogShards makes from these records,
    // so no search entry or shard can be dropped, added, or stale. Skipped when the records
    // themselves are already ambiguous (duplicates or bad shapes are reported above).
    if (!defects.some(d => /^(duplicate_variant|record_shape_invalid|shard_missing|shard_shape_invalid):/.test(d))) {
        try {
            const rebuilt = await buildCatalogShards(variantIds.map(id => variants.get(id)));
            const want = canonicalJson({ manifest: rebuilt.manifest, files: rebuilt.files });
            const got = canonicalOrNull({ manifest, files: Object.fromEntries([...referenced].filter(f => f in files).map(f => [f, files[f]])) });
            if (want !== got)
                defects.push('rebuild_mismatch:catalog');
        }
        catch {
            defects.push('rebuild_mismatch:catalog');
        }
    }

    return {
        profileCount: variantIds.length,
        variantShardCount: shardEntries(manifest, 'variantShards').length,
        searchShardCount: shardEntries(manifest, 'searchShards').length,
        searchEntryCount: searchEntries.length,
        revisionCount,
        variantIds,
        defects: [...new Set(defects)],
    };
}

function recordMap(input: CatalogInput) {
    const map = new Map<string, any>();
    for (const { record } of variantRecordsOf(input)) {
        const id = idOf(record);
        if (id && !map.has(id))
            map.set(id, record);
    }
    return map;
}

export async function verifyAppendOnly(previous: CatalogInput, next: CatalogInput): Promise<AppendOnlySummary> {
    const [before, after] = await Promise.all([verifyCatalog(previous), verifyCatalog(next)]);
    const defects = [...before.defects.map(d => `previous:${d}`), ...after.defects.map(d => `next:${d}`)];
    const prev = recordMap(previous), nxt = recordMap(next);
    let preserved = 0;
    for (const [id, record] of [...prev].sort(([a], [b]) => byId(a, b))) {
        if (!nxt.has(id))
            defects.push(`dropped_profile:${id}`);
        else if (canonicalOrNull(record) === null || canonicalOrNull(record) !== canonicalOrNull(nxt.get(id)))
            defects.push(`changed_profile:${id}`);
        else
            preserved++;
    }
    // Every previous search entry must survive unchanged in the same bucket.
    const nextSearch = new Set(searchEntriesOf(next).map(({ bucket, entry }) => `${bucket}|${canonicalOrNull(entry)}`));
    for (const { bucket, entry } of searchEntriesOf(previous))
        if (!nextSearch.has(`${bucket}|${canonicalOrNull(entry)}`))
            defects.push(`dropped_search_entry:${bucket}:${isObject(entry) ? entry.variantId : 'unknown'}`);
    const added = [...nxt.keys()].filter(id => !prev.has(id)).sort(byId);
    return { added, preserved, defects: [...new Set(defects)] };
}

/**
 * Cumulative merge. Identical duplicates (an idempotent rerun) collapse to one copy;
 * a variantId seen twice with different content throws instead of overwriting.
 */
export function mergeCatalogRecords<T = any>(previousRecords: readonly T[], newRecords: readonly T[]): T[] {
    if (!Array.isArray(previousRecords) || !Array.isArray(newRecords))
        throw new TypeError('mergeCatalogRecords requires two record arrays');
    const merged = new Map<string, { record: T; json: string }>();
    for (const record of [...previousRecords, ...newRecords]) {
        const id = idOf(record);
        if (!id)
            throw new TypeError('Catalog record is missing variant.variantId');
        const json = canonicalJson(record);
        const seen = merged.get(id);
        if (!seen)
            merged.set(id, { record, json });
        else if (seen.json !== json)
            throw new TypeError(`Catalog record conflict: ${id}; a published profile cannot be overwritten`);
    }
    return [...merged.entries()].sort(([a], [b]) => byId(a, b)).map(([, v]) => v.record);
}

/** Verifies both catalogs, merges their records, and rebuilds the combined shards. Writes nothing. */
export async function combineCatalogs(previous: CatalogInput, next: CatalogInput): Promise<CatalogInput> {
    for (const [label, input] of [['previous', previous], ['next', next]] as const) {
        const { defects } = await verifyCatalog(input);
        if (defects.length)
            throw new TypeError(`Cannot combine a ${label} catalog with defects: ${defects.join(', ')}`);
    }
    const records = mergeCatalogRecords(variantRecordsOf(previous).map(r => r.record), variantRecordsOf(next).map(r => r.record));
    const { manifest, files } = await buildCatalogShards(records);
    return { manifest, files };
}

/**
 * Reads manifest.json and exactly the shard files it references. A referenced path that
 * fails the reader's filename pattern is not opened; verifyCatalog then reports it.
 */
export async function readCatalogDirectory(dir: string): Promise<CatalogInput> {
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const files: CatalogFiles = {};
    for (const [kind] of SHARD_KINDS) {
        for (const [, entry] of shardEntries(manifest, kind)) {
            const file = isObject(entry) && typeof entry.file === 'string' ? entry.file : null;
            if (!file || !SHARD_FILE_PATTERN.test(file) || file in files)
                continue;
            let text: string;
            try {
                text = await readFile(path.join(dir, ...file.split('/')), 'utf8');
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
                    continue;
                throw error;
            }
            files[file] = JSON.parse(text);
        }
    }
    return { manifest, files };
}
