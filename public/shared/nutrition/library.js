import { INGREDIENT_STORE_WRITES_ENABLED } from './capabilities.js';
import { buildRevisionDraft, revisionToStagedRecord, validateRevision, verifyRevisionHash } from './ingredientProfile.js';
import { CURATED_CATALOG_ID, overrideVariantId, privateIdentityId, privateVariantId } from './ingredientIds.js';
import { IdentityKeyCollisionError, IngredientWritesDisabledError, NeedsReviewError, RevisionConflictError } from './ingredientStore.js';
import { convertUnit, emptyStagedRecord, getNutrient, V2_KEYS } from './nutrientRegistry.js';
import { PROFILE_FIELDS } from './research/profileFields.js';
import { buildResolution, LIVE_SOURCES_DISABLED, lookupOfficial, researchPacket } from './resolution.js';

/** Library reads and stages. Private production writes stay on the ingredient-store flag. */
export function libraryCapabilities() {
    return Object.freeze({
        affectedMeals: false,
        curatedWrites: false,
        privateWrites: INGREDIENT_STORE_WRITES_ENABLED,
        directAi: false,
    });
}

function pageSizeOf(pageSize) {
    const size = Math.floor(pageSize || 25);
    return Math.max(1, Math.min(25, size));
}

/** Merge private and curated search pages. A private hit wins over the same variant. */
export async function searchLibrary({ query = '', sources = [], pageSize = 25, cursor = null } = {}) {
    const size = pageSizeOf(pageSize);
    const active = cursor ? sources.filter(source => cursor[source.scope]) : sources;
    const pages = await Promise.all(active.map(async source => {
        try {
            const page = await source.search(query, { pageSize: size, cursor: cursor?.[source.scope] || null });
            const raw = page?.items || [];
            return { scope: source.scope, items: raw.slice(0, size), cursor: raw.length > size ? null : (page?.cursor || null), error: null };
        } catch {
            return { scope: source.scope, items: [], cursor: null, error: 'search_failed' };
        }
    }));
    const byVariant = new Map();
    for (const page of pages) {
        for (const item of page.items) {
            const id = item.variantId || item.ref?.variantId;
            if (!id) continue;
            const curatedId = page.scope === 'private' ? item.overrides?.variantId || item.ref?.overrides?.variantId : null;
            const key = curatedId || id;
            const existing = byVariant.get(key);
            if (existing?.scope === 'private' && page.scope !== 'private') continue;
            byVariant.set(key, { ...item, scope: page.scope, variantId: id });
        }
    }
    const items = [...byVariant.values()].sort((a, b) => String(a.canonicalName || '').localeCompare(String(b.canonicalName || '')) || String(a.variantId).localeCompare(String(b.variantId)));
    return {
        items,
        cursor: Object.fromEntries(sources.map(source => [source.scope, pages.find(page => page.scope === source.scope)?.cursor || null])),
        errors: pages.filter(page => page.error).map(page => page.scope),
        modelCalls: 0,
    };
}

/** Missing fields and missing conversions stay separate. Curated profiles are read-only. */
export function reviewLibraryProfile({ revision = null, conversions = [], scope = 'private', ownerUid = null, viewerUid = null } = {}) {
    if (scope === 'private' && ownerUid && viewerUid && ownerUid !== viewerUid) return { ok: false, error: 'owner_mismatch', writes: false };
    const nutrients = revision?.nutrients || {};
    const quality = revision?.nutrientMeta?.quality || {};
    const missingFields = PROFILE_FIELDS.filter(key => quality[key]?.status === 'not_applicable' ? false : nutrients[key] == null);
    const missingConversions = conversions.some(item => item?.kind === 'household') ? [] : ['household'];
    return {
        ok: true,
        missingFields,
        missingConversions,
        provenance: revision?.fieldProvenance || {},
        revision: revision?.revision || null,
        readOnly: scope !== 'private',
        affectedMeals: { available: false, reason: 'affected meals need ingredient-graph references from #64 Part B' },
        writes: false,
        diaryUntouched: true,
        modelCalls: 0,
    };
}

export function filterLibraryGaps(rows = [], kind = 'all') {
    if (kind === 'fields') return rows.filter(row => row.missingFields?.length);
    if (kind === 'conversions') return rows.filter(row => row.missingConversions?.length);
    return [...rows];
}

/**
 * A private edit is a new staged revision. It does not write and does not touch diary snapshots.
 * `patch.nutrients` holds manual or label values (a number, or an object with value, status, unit,
 * qualifier, roundingInterval, upperBound, range or uncertainty, confidence, comparator, derivation,
 * sourceNutrientId, and an optional per-field source). `patch.source` is the source for fields
 * without their own. `patch.research` is an applied #73 research item (nutrients plus researchEvidence).
 * Staging stays synchronous; buildLibraryDraft() builds the revision draft, so a bare stage is
 * never readyForSave.
 */
export function stageLibraryEdit({ scope = 'private', ownerUid, viewerUid, base = null, patch = {} } = {}) {
    if (scope !== 'private') return { ok: false, error: 'curated_read_only', writes: false, diaryUntouched: true };
    if (!viewerUid || viewerUid !== ownerUid) return { ok: false, error: 'owner_mismatch', writes: false, diaryUntouched: true };
    return {
        ok: true,
        writes: false,
        staged: true,
        committed: false,
        readyForSave: false,
        diaryUntouched: true,
        draft: {
            ownerUid,
            baseRevision: base?.revision || null,
            baseRevisionId: base?.revisionId || null,
            baseContentHash: base?.contentHash || null,
            nextRevision: (base?.revision || 0) + 1,
            pendingNutrients: patch.nutrients || {},
            pendingSource: patch.source || null,
            pendingResearch: patch.research || null,
        },
    };
}

const SOURCE_KEYS = ['type', 'datasetId', 'recordId', 'title', 'url', 'version', 'publishedAt', 'accessedAt', 'originalBasis', 'permittedUse', 'checksum'];
const SOURCE_TYPES = ['fdc', 'label', 'manufacturer', 'manual', 'comparable', 'legacy_food', 'curated_catalog'];
const FIELD_KEYS = ['value', 'status', 'unit', 'qualifier', 'roundingInterval', 'upperBound', 'range', 'uncertainty', 'confidence', 'comparator', 'derivation', 'sourceNutrientId', 'source', 'sourceIds', 'requestId'];

/** Copy a source into the stored shape. Keys or values the revision cannot hold are reported. */
function storedSource(raw, field, note, { mapType = false, extraKeys = [] } = {}) {
    if (!raw || typeof raw !== 'object') return { error: 'Source required: ' + field };
    let type = raw.type;
    if (!SOURCE_TYPES.includes(type)) {
        if (!mapType) return { error: 'Invalid source type: ' + field };
        note(field + '.type', 'stored as comparable; the revision has no slot for this source type', type);
        type = 'comparable';
    }
    const source = { type };
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'type' || extraKeys.includes(key)) continue;
        if (!SOURCE_KEYS.includes(key)) { note(field + '.' + key, 'the revision has no slot for this source field', value); continue; }
        if (value == null) continue;
        if (typeof value !== 'string') { note(field + '.' + key, 'source fields are stored as text only', value); continue; }
        source[key] = value;
    }
    return { source };
}

function freeKey(sources, wanted) {
    let key = wanted.slice(0, 200), n = 2;
    while (sources[key]) key = wanted.slice(0, 190) + '#' + n++;
    return key;
}

/** Convert a value and its bounds into the registry unit. Not ok when that is not defensible. */
function inRegistryUnit(key, field) {
    const def = getNutrient(key);
    if (!field.unit || field.unit === def.unit) return { ok: true, field };
    const convert = value => value == null ? { value } : convertUnit(key, value, field.unit);
    const parts = { value: convert(field.value), upperBound: convert(field.upperBound), roundingInterval: convert(field.roundingInterval) };
    const range = field.range ? { min: convert(field.range.min), max: convert(field.range.max) } : null;
    if ([...Object.values(parts), ...(range ? [range.min, range.max] : [])].some(part => part.error)) return { ok: false };
    return { ok: true, field: { ...field, unit: def.unit, value: parts.value.value, upperBound: parts.upperBound.value, roundingInterval: parts.roundingInterval.value, ...(range ? { range: { min: range.min.value, max: range.max.value } } : {}) } };
}

/** Uncertainty maps to provenance.range ({min,max}) and quality upperBound/roundingInterval only. */
function uncertaintyOf(field, key, note) {
    const u = field.uncertainty;
    if (u == null) return field;
    const next = { ...field };
    delete next.uncertainty;
    if (typeof u !== 'object') { note(key + '.uncertainty', 'uncertainty must be a range or bound', u); return next; }
    for (const [part, value] of Object.entries(u)) {
        if ((part === 'min' || part === 'max') && (!field.range || field.range[part] === value)) continue;
        if ((part === 'upperBound' || part === 'roundingInterval') && field[part] == null) { next[part] = value; continue; }
        note(key + '.uncertainty.' + part, 'no matching revision field or already set', value);
    }
    if (!field.range && ('min' in u || 'max' in u)) {
        if (Number.isFinite(u.min) && Number.isFinite(u.max)) next.range = { min: u.min, max: u.max };
        else note(key + '.uncertainty', 'a range needs both min and max', u);
    }
    return next;
}

/** Fold one patched field into the record. Returns an error string, or null. */
function applyField({ key, raw, sourceKey, record, fieldProvenance, note, origin, gapReason }) {
    if (!V2_KEYS.includes(key) || key === 'fiberWeightedLegacy') { note(key, 'not a storable registry nutrient', raw); return null; }
    let field = typeof raw === 'number' || raw === null ? { value: raw } : { ...raw };
    for (const extra of Object.keys(field)) if (!FIELD_KEYS.includes(extra)) note(key + '.' + extra, 'the revision has no slot for this field', field[extra]);
    field = uncertaintyOf(field, key, note);
    const converted = inRegistryUnit(key, field);
    if (!converted.ok) { note(key, 'unit ' + field.unit + ' cannot be converted to ' + getNutrient(key).unit, raw); return null; }
    field = converted.field;
    if (field.value === null || field.value === undefined) {
        if (record.values[key] != null) { note(key, 'kept the base value; the patch has no value', raw); return null; }
        const status = field.status && field.status !== 'legacy_unclassified' ? field.status : 'unknown';
        const qualifier = field.qualifier || (status === 'unknown' ? 'gap:' + (gapReason || 'unknown') : undefined);
        record.values[key] = null;
        record.quality[key] = { status, ...(qualifier ? { qualifier } : {}) };
        delete fieldProvenance[key];
        return null;
    }
    if (typeof field.value !== 'number' || !Number.isFinite(field.value)) return 'Invalid nutrient: ' + key;
    if (!field.status) return 'Evidence status required: ' + key;
    if (!sourceKey) return 'Source required: ' + key;
    record.values[key] = field.value;
    record.quality[key] = { status: field.status, ...(field.roundingInterval != null ? { roundingInterval: field.roundingInterval } : {}), ...(field.upperBound != null ? { upperBound: field.upperBound } : {}), ...(field.qualifier ? { qualifier: field.qualifier } : {}) };
    const comparatorRef = field.comparator == null ? undefined : typeof field.comparator === 'string' ? field.comparator : JSON.stringify(field.comparator);
    fieldProvenance[key] = {
        sourceKey,
        ...(typeof field.sourceNutrientId === 'string' ? { sourceNutrientId: field.sourceNutrientId } : {}),
        ...(typeof field.derivation === 'string' ? { derivation: field.derivation } : {}),
        ...(comparatorRef ? { comparatorRef } : {}),
        ...(field.confidence != null ? { confidence: field.confidence } : {}),
        ...(field.range ? { range: { min: field.range.min, max: field.range.max } } : {}),
    };
    if (origin === 'research' && field.sourceIds?.length > 1) note(key + '.sourceIds', 'only the first cited source is linked per field; all cited sources are kept in sources', field.sourceIds.slice(1));
    return null;
}

/**
 * Build a valid revision draft from a staged edit and its base revision document. Unpatched fields
 * keep the base value, quality, and provenance. Patched fields take the new value with their own
 * source, status, uncertainty, confidence, comparator, and derivation. Anything the revision cannot
 * hold is listed in `unrepresented`, never dropped silently. Nothing is written.
 * `create` builds a first revision instead: `{ identity, variant: { dims, overrides? }, basis?, basedOn? }`;
 * with overrides, `base` is the curated revision whose content the private override copies.
 */
export async function buildLibraryDraft({ staged, base = null, create = null } = {}) {
    const fail = (error, extra = {}) => ({ ok: false, error, readyForSave: false, writes: false, diaryUntouched: true, ...extra });
    if (!staged?.ok || !staged.draft) return fail(staged?.error || 'nothing_staged');
    const pending = staged.draft;
    if (!create && !base) return fail('base_revision_required');
    if (base && !create && (base.revision !== pending.baseRevision || (pending.baseContentHash && base.contentHash !== pending.baseContentHash))) return fail('base_mismatch');
    let identityId, variantId;
    try {
        if (!create) ({ identityId, variantId } = base);
        else if (create.variant?.overrides) {
            identityId = base?.identityId || create.identityId;
            variantId = await overrideVariantId(create.variant.overrides.catalogId || CURATED_CATALOG_ID, create.variant.overrides.variantId);
        } else {
            identityId = await privateIdentityId(create.identity);
            variantId = await privateVariantId(identityId, create.variant?.dims ?? create.variant ?? {});
        }
    } catch (error) { return fail('invalid_target', { errors: [error.message] }); }
    const basis = create?.basis || base?.basis;
    if (!basis) return fail('basis_required');
    const record = base ? revisionToStagedRecord(base) : emptyStagedRecord();
    const sources = structuredClone(base?.sources || {});
    const fieldProvenance = structuredClone(base?.fieldProvenance || {});
    const unrepresented = [], errors = [], patchedFields = new Set();
    const note = (field, reason, value) => unrepresented.push({ field, reason, ...(value !== undefined ? { value: structuredClone(value) } : {}) });

    const research = pending.pendingResearch;
    if (research) {
        const evidence = new Map((research.researchEvidence || []).map(entry => [entry.requestId, entry]));
        const keys = new Set();
        for (const entry of evidence.values()) {
            for (const raw of entry.sources || []) {
                const key = entry.requestId + ':' + raw.sourceId;
                const built = storedSource(raw, 'sources.' + key, note, { mapType: true, extraKeys: ['sourceId'] });
                // The response is unverified; the stored source says so through permittedUse.
                sources[key] = { ...built.source, recordId: built.source.recordId || raw.sourceId, permittedUse: 'review_required' };
                keys.add(key);
            }
            for (const text of entry.assumptions || []) note('assumptions', 'the revision has no slot for research assumptions', text);
        }
        for (const [key, field] of Object.entries(research.nutrients || {})) {
            const entry = evidence.get(field?.requestId);
            if (!entry) { note(key, 'no research evidence record for this field', field); continue; }
            const sourceKey = field.sourceIds?.length ? entry.requestId + ':' + field.sourceIds[0] : null;
            if (sourceKey && !keys.has(sourceKey)) { errors.push('Source required: ' + key); continue; }
            const gapReason = (entry.unresolved || []).find(u => u.field === key)?.reason;
            const { requestId, ...rest } = field;
            const error = applyField({ key, raw: rest, sourceKey, record, fieldProvenance, note, origin: 'research', gapReason });
            if (error) errors.push(error); else patchedFields.add(key);
        }
        for (const entry of evidence.values()) {
            for (const u of entry.unresolved || []) if (!(u.field in (research.nutrients || {}))) note('unresolved.' + u.field, 'unresolved field with no staged value', u.reason);
        }
    }

    const manual = pending.pendingNutrients || {};
    let sharedKey = null;
    if (Object.keys(manual).length && pending.pendingSource) {
        const built = storedSource(pending.pendingSource, 'source', note);
        if (built.error) errors.push(built.error);
        else { sharedKey = freeKey(sources, 'edit' + pending.nextRevision + ':' + built.source.type); sources[sharedKey] = built.source; }
    }
    for (const [key, raw] of Object.entries(manual)) {
        let sourceKey = sharedKey;
        if (raw && typeof raw === 'object' && raw.source) {
            const built = storedSource(raw.source, key + '.source', note);
            if (built.error) { errors.push(built.error); continue; }
            sourceKey = freeKey(sources, 'edit' + pending.nextRevision + ':' + key);
            sources[sourceKey] = built.source;
        }
        const { source, ...field } = raw && typeof raw === 'object' ? raw : { value: raw };
        // A label value is label_reported unless the patch says otherwise; other values need a status.
        if (!field.status && sources[sourceKey]?.type === 'label') field.status = 'label_reported';
        const error = applyField({ key, raw: field, sourceKey, record, fieldProvenance, note, origin: 'manual' });
        if (error) errors.push(error); else patchedFields.add(key);
    }
    if (errors.length) return fail('invalid_patch', { errors, unrepresented });
    if (!patchedFields.size) return fail('no_changes', { unrepresented });
    let draft;
    try {
        draft = await buildRevisionDraft({ identityId, variantId, stagedRecord: record, fieldProvenance, sources, basis, basedOn: create?.basedOn ?? base?.basedOn ?? null, base: create ? null : base });
    } catch (error) {
        return fail('invalid_draft', { errors: String(error.message).split('; '), unrepresented });
    }
    if (validateRevision(draft).length || !await verifyRevisionHash(draft)) return fail('invalid_draft', { errors: validateRevision(draft), unrepresented });
    if (base && !create && draft.contentHash === base.contentHash) return fail('no_changes', { unrepresented });
    return { ok: true, readyForSave: true, writes: false, committed: false, diaryUntouched: true, draft, patchedFields: [...patchedFields].sort(), unrepresented };
}

function disabled() {
    return { ok: false, error: 'writes_disabled', writes: INGREDIENT_STORE_WRITES_ENABLED, committed: false, diaryUntouched: true };
}

/**
 * Commit a staged private edit through the ingredient store. With the flag off this returns
 * writes_disabled synchronously and writes nothing. An edit saves the next revision of `base`
 * (store.saveRevision); `create` saves a first revision (store.createIngredient), including a private
 * override of a curated profile. A conflict keeps the draft in the store's pending-save outbox.
 * Diary documents and saved diary snapshots are never read or written here.
 */
export function commitLibraryEdit({ store = null, staged = null, base = null, create = null, scope = 'private' } = {}) {
    if (!INGREDIENT_STORE_WRITES_ENABLED) return disabled();
    return commitEnabled({ store, staged, base, create, scope });
}

async function commitEnabled({ store, staged, base, create, scope }) {
    const refuse = (error, extra = {}) => ({ ok: false, error, writes: false, committed: false, diaryUntouched: true, ...extra });
    if (staged?.ok === false && ['curated_read_only', 'owner_mismatch'].includes(staged.error)) return refuse(staged.error);
    if (!staged?.ok) return refuse('nothing_staged');
    if (scope !== 'private' && !create) return refuse('curated_read_only');
    if (!create && base?.ownerUid && base.ownerUid !== staged.draft.ownerUid) return refuse('owner_mismatch');
    if (!store) return refuse('store_unavailable');
    const built = await buildLibraryDraft({ staged, base, create });
    if (!built.ok) return refuse(built.error, { errors: built.errors || [], unrepresented: built.unrepresented || [], staged });
    try {
        const ref = create
            ? await store.createIngredient({ identity: create.identity, variant: create.variant, revisionDraft: built.draft, conversions: [], confirmNew: !!create.confirmNew })
            : await store.saveRevision({ variantId: base.variantId, baseRevision: base.revision, revisionDraft: built.draft });
        return { ok: true, committed: true, writes: true, ref, diaryUntouched: true, patchedFields: built.patchedFields, unrepresented: built.unrepresented };
    } catch (error) {
        if (error instanceof IngredientWritesDisabledError) return disabled();
        const retained = { staged, draft: built.draft, unrepresented: built.unrepresented };
        if (error instanceof RevisionConflictError) return refuse('revision_conflict', { retained: true, ...retained });
        if (error instanceof NeedsReviewError) return refuse('needs_review', retained);
        if (error instanceof IdentityKeyCollisionError) return refuse('identity_collision', retained);
        return refuse('save_failed', { message: String(error?.message || error), retained: true, ...retained });
    }
}

/**
 * Research selected fields through the shared #62 packet. Nothing is saved. With a `ref`, the job
 * target pins that ref and its base `revision` (or `revisionsByLine[lineId]`), and only the chosen
 * `missingFields` are requested.
 */
export async function researchLibraryFields({ lineId = null, name = 'ingredient', missingFields = [], revisionsByLine = {}, revision = null, ref = null, ownerUid = null, namespace = null } = {}) {
    const id = lineId || String(name || 'profile').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'profile';
    let resolution = buildResolution({
        lines: [{ lineId: id, name, grams: 100, quantityBasis: 'estimated', variant: {} }],
        matches: [{ lineId: id, outcome: ref ? 'exact' : 'missing', ref }],
        revisionsByLine: revision ? { ...revisionsByLine, [id]: revision } : revisionsByLine,
    });
    // No live official source is wired, so the ladder step is recorded as not performed, never as a miss.
    const lookup = lookupOfficial(resolution, id, { outcome: 'not_performed', reason: LIVE_SOURCES_DISABLED, unresolvedFields: missingFields });
    if (!lookup.ok) return { ok: false, error: lookup.error, modelCalls: 0 };
    resolution = lookup.state;
    const packet = await researchPacket(resolution, [id], { ...(ownerUid ? { ownerUid } : {}), ...(namespace ? { namespace } : {}) });
    return packet.ok ? { ...packet, modelCalls: 0, writes: false, staged: true } : { ...packet, modelCalls: 0, writes: false };
}
