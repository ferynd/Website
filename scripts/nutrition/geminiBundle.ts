/**
 * #63 Gemini research bundle (PR 1 of the Gemini-assisted workflow).
 *
 * Builds a value-free research bundle for source identity research: the next
 * N eligible catalog targets, each with up to six FDC candidates from the two
 * pinned bulk releases, deterministic distinctions/conflicts, and prior
 * decisions as precedents. The bundle carries no nutrient values, only field
 * coverage counts and missing key field names.
 *
 * Gemini (operated by hand through its web interface, no API) proposes; issue
 * #215 adjudicates; only reviewed match-table entries are ever imported. This
 * module reads the manifest, the match table, and the pinned files; it never
 * writes the match table, the catalog, or any capability flag.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
import { parseFdcFood } from '../../public/shared/nutrition/research/fdcFood.js';
import { normalizeSourceResult } from '../../public/shared/nutrition/research/sourceResult.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { auditPinnedBulk, type DatasetPin } from './fdcBulkReader';
import { selectNextBatch, stateToDims, waveOf, type ManifestEntry } from './manifestReader';
import { suggestCandidates, suggestionTokens } from './matchSuggest';
import type { MatchEntry } from './matchTable';

export const BUNDLE_SCHEMA_VERSION = 1;
export const MAX_CANDIDATES = 6;
export const DEFAULT_COUNT = 200;
export const MATCH_TABLE_DOC = 'docs/nutrition/source-match-table.json';
export const SELECTION_RULE = 'priority,category,id over eligible generic usda-first; excluded published match-table ids and A1-A3 assigned ids';

export type BundleDatasetId = 'foundation' | 'sr-legacy';
export interface BundleDataset {
    pin: DatasetPin & { id: BundleDatasetId; fileName: string };
    /** Local path of the pinned extracted JSON file (operator-local, never in the bundle). */
    file: string;
}

// ---------------------------------------------------------------------------
// Canonical JSON digests

/** sha256 hex of the canonical (sorted-key) JSON of a value. Used for both bundle digests. */
export function canonicalDigest(value: unknown) {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

// ---------------------------------------------------------------------------
// Selection

export function isEligible(e: ManifestEntry) {
    return e.kind === 'generic' && e.sourceStrategy === 'usda-first' && e.status === 'queued';
}
/** The planner comparator from selectNextBatch, applied globally across waves A/B/C. */
export function plannerOrder(a: ManifestEntry, b: ManifestEntry) {
    return a.priority - b.priority || a.category.localeCompare(b.category) || a.id.localeCompare(b.id);
}
/**
 * Replays the wave-A planner `batches` times cumulatively (A1 on empty
 * exclusions, A2 excluding A1, A3 excluding A1+A2) and returns the assigned ids
 * in batch order.
 */
export function replayAssignedBatches(entries: ManifestEntry[], { batchMax = 25, batches = 3 } = {}) {
    const assigned: string[][] = [];
    const seen: string[] = [];
    for (let i = 0; i < batches; i++) {
        const next = selectNextBatch(entries, seen.map(id => ({ target: { manifestId: id } })), { wave: 'A', max: batchMax }).map(e => e.id);
        assigned.push(next);
        seen.push(...next);
    }
    return assigned;
}
export interface BundleSelection {
    selected: ManifestEntry[];
    eligibleCount: number;
    excludedPublishedCount: number;
    excludedAssignedCount: number;
    assignedBatches: string[][];
}
/**
 * Eligible = generic, usda-first (waves A/B/C), queued. Excluded: every
 * published match-table id, and the A1-A3 assigned ids. excludedAssignedCount
 * counts only eligible assigned ids that are not already published, so the two
 * exclusion counts are disjoint and add up to the total excluded.
 */
export function selectBundleTargets(entries: ManifestEntry[], matchTable: Pick<MatchEntry, 'manifestId'>[], { count = DEFAULT_COUNT, batchMax = 25, batches = 3 } = {}): BundleSelection {
    if (!Number.isSafeInteger(count) || count < 1)
        throw new Error('count must be a positive integer');
    const assignedBatches = replayAssignedBatches(entries, { batchMax, batches });
    const assigned = assignedBatches.flat();
    if (assigned.length !== batchMax * batches || new Set(assigned).size !== assigned.length)
        throw new Error(`Batch replay yielded ${assigned.length} ids, expected ${batchMax * batches}`);
    const published = new Set(matchTable.map(m => m.manifestId));
    const assignedSet = new Set(assigned);
    // Sanity check: every published id was imported through one of the
    // replayed batches. A published id outside them means the replay no longer
    // reproduces the batches that were actually run.
    const outside = [...published].filter(id => !assignedSet.has(id));
    if (outside.length)
        throw new Error('Published match-table ids outside the replayed batches: ' + outside.sort().join(', '));
    const eligible = entries.filter(isEligible);
    const excludedPublishedCount = eligible.filter(e => published.has(e.id)).length;
    const excludedAssignedCount = eligible.filter(e => assignedSet.has(e.id) && !published.has(e.id)).length;
    const remaining = eligible.filter(e => !published.has(e.id) && !assignedSet.has(e.id)).sort(plannerOrder);
    for (const e of remaining)
        if (!['A', 'B', 'C'].includes(waveOf(e)))
            throw new Error('Eligible entry outside waves A-C: ' + e.id);
    return { selected: remaining.slice(0, count), eligibleCount: eligible.length, excludedPublishedCount, excludedAssignedCount, assignedBatches };
}

// ---------------------------------------------------------------------------
// Coverage (counts only, never values)

/** Registry keys of the key subset reported as missing when absent. */
export const KEY_FIELDS = Object.freeze([
    'calories', 'protein', 'carbs', 'fat', 'fiberTotal', 'sugarsTotal', 'sodium', 'potassium', 'calcium', 'iron',
    'vitaminD', 'vitaminC', 'folate', 'vitaminB12', 'vitaminA', 'vitaminE', 'vitaminK', 'magnesium', 'zinc', 'phosphorus',
]);
for (const key of KEY_FIELDS)
    if (!PROFILE_FIELDS.includes(key as never))
        throw new Error('Key field is not a profile field: ' + key);

export interface Coverage {
    fieldsPresent: number;
    fieldsTotal: number;
    missingKeyFields: string[];
}
/**
 * Maps one pinned record through the pipeline's own parser and normalizer
 * (parseFdcFood + normalizeSourceResult) and counts the quality-tracked profile
 * fields that resolve to a value. Returns counts and field names only.
 */
export async function coverageOf(raw: Record<string, unknown>, release: string): Promise<Coverage> {
    const parsed = await parseFdcFood(raw, { release, accessedAt: '1970-01-01' });
    const normalized = normalizeSourceResult(parsed, {}) as { nutrients: Record<string, unknown> };
    const present = (key: string) => normalized.nutrients[key] !== null && normalized.nutrients[key] !== undefined;
    return {
        fieldsPresent: PROFILE_FIELDS.filter(present).length,
        fieldsTotal: PROFILE_FIELDS.length,
        missingKeyFields: KEY_FIELDS.filter(key => !present(key)),
    };
}

// ---------------------------------------------------------------------------
// Description facts: distinctions and conflicts

const lower = (text: string) => String(text || '').normalize('NFKC').toLowerCase();

const COOK_WORDS = ['cooked', 'boiled', 'roasted', 'baked', 'fried', 'grilled', 'braised', 'steamed', 'broiled', 'stewed', 'microwaved', 'poached', 'scrambled', 'simmered', 'toasted', 'sauteed', 'pan-fried', 'pan-browned'];
const COOK_RE = new RegExp(`\\b(?:${COOK_WORDS.join('|')})\\b`);
const RAW_RE = /\braw\b/;
const CANNED_RE = /\bcanned\b/;
const FROZEN_RE = /\bfrozen\b/;
const DRIED_RE = /\b(?:dried|dehydrated|freeze-dried)\b/;
const SWEETENED_RE = /(?<!un)\bsweetened\b|\bwith added sugar|\b(?:heavy|light|extra heavy|extra light) syrup\b|\bsugar added\b/;
const UNSWEETENED_RE = /\bunsweetened\b|\bwithout added sugar|\bno sugar added\b|\bno added sugar\b/;
const SALTED_RE = /\bwith (?:added )?salt\b|(?<!un)\bsalted\b/;
const UNSALTED_RE = /\bwithout (?:added )?salt\b|\bunsalted\b|\bno (?:added )?salt\b|\bno salt added\b/;
const UNDRAINED_RE = /\bundrained\b|\bsolids and liquids?\b/;
const DRAINED_RE = /(?<!un)\bdrained\b/;
const UNFORTIFIED_RE = /\bunenriched\b|\bunfortified\b|\bnot (?:enriched|fortified)\b/;
const FORTIFIED_RE = /(?<!un)\benriched\b|(?<!un)\bfortified\b|\bwith added (?:vitamin|calcium|iron|nutrients?)\b/;
const BABYFOOD_RE = /\bbaby ?food\b|\binfant\b/;
const WITH_SKIN_RE = /\bwith (?:skin|peel)\b|\bunpeeled\b/;
const WITHOUT_SKIN_RE = /\bwithout (?:skin|peel)\b|\bpeeled\b|\bskinless\b/;

/** Juice as the product, not as a packing medium ("in juice", "juice pack"). */
function mentionsJuiceProduct(text: string) {
    return [...text.matchAll(/\bjuices?\b/g)].some(m => {
        const before = text.slice(0, m.index), after = text.slice(m.index! + m[0].length);
        return !/\b(?:in|with|packed in|pack(?:ed)?|in its own)\s*$/.test(before) && !/^\s*pack/.test(after);
    });
}
const NECTAR_RE = /\bnectar\b|\bdrink\b|\bcocktail\b|\bconcentrate\b/;

interface PercentFact { noun: 'fat' | 'lean' | 'cacao' | 'abv' | 'juice' | 'other'; value: string }
function percentFacts(text: string): PercentFact[] {
    const facts: PercentFact[] = [];
    const re = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%\s*(milkfat|fat|lean|cacao|cocoa|abv|juice)?/g;
    for (const m of text.matchAll(re)) {
        const noun = m[3] === 'milkfat' ? 'fat' : m[3] === 'cocoa' ? 'cacao' : (m[3] as PercentFact['noun'] | undefined) || 'other';
        facts.push({ noun, value: m[2] ? `${m[1]}-${m[2]}` : m[1] });
    }
    return facts;
}

const VARIETY_WORDS = [
    'fuji', 'gala', 'granny smith', 'red delicious', 'golden delicious', 'honeycrisp', 'mcintosh', 'braeburn', 'bartlett', 'bosc', 'anjou', 'asian',
    'hass', 'florida', 'california', 'navel', 'valencia', 'mandarin', 'tangerine', 'clementine', 'cavendish', 'plantain', 'concord', 'thompson',
    'seedless', 'purple', 'yellow', 'red', 'green', 'white', 'black', 'golden', 'russet', 'sweet', 'sour', 'tart', 'wild', 'cultivated',
    'highbush', 'lowbush', 'roma', 'cherry', 'grape', 'plum', 'baby', 'mature', 'immature', 'sprouted',
];

/**
 * Identity-relevant facts read deterministically from a description, in a fixed
 * rule order: preparation state, enrichment/fortification, fat percentages,
 * drained state, sweetening, salt, product form, skin, varieties, and
 * parenthetical qualifiers.
 */
export function extractDistinctions(description: string): string[] {
    const text = lower(description);
    const out: string[] = [];
    const add = (fact: string) => { if (!out.includes(fact)) out.push(fact); };
    if (RAW_RE.test(text)) add('state:raw');
    for (const w of COOK_WORDS) if (new RegExp(`\\b${w}\\b`).test(text)) add('state:' + w);
    if (CANNED_RE.test(text)) add('state:canned');
    if (FROZEN_RE.test(text)) add('state:frozen');
    if (DRIED_RE.test(text)) add('state:dried');
    if (/\bfresh\b/.test(text)) add('state:fresh');
    if (/\bfrom concentrate\b/.test(text)) add('state:from-concentrate');
    else if (/\bconcentrate\b/.test(text)) add('state:concentrate');
    if (/\bpowder(?:ed)?\b/.test(text)) add('state:powder');
    if (/\b(?:unprepared)\b/.test(text)) add('state:unprepared');
    if (/\bprepared\b/.test(text) && !/\bunprepared\b/.test(text)) add('state:prepared');
    if (UNFORTIFIED_RE.test(text)) add('fortification:unenriched-or-unfortified');
    if (FORTIFIED_RE.test(text)) add('fortification:enriched-or-fortified');
    for (const f of percentFacts(text)) add(`percent:${f.value}%${f.noun === 'other' ? '' : ' ' + f.noun}`);
    for (const fat of ['nonfat', 'fat free', 'fat-free', 'lowfat', 'low fat', 'reduced fat', 'whole milk', 'skim', 'part skim', 'part-skim', 'lean only', 'lean and fat'])
        if (new RegExp(`\\b${fat}\\b`).test(text)) add('fat:' + fat.replace(/ /g, '-'));
    if (UNDRAINED_RE.test(text)) add('drained:undrained-or-solids-and-liquids');
    else if (DRAINED_RE.test(text)) add('drained:drained');
    if (UNSWEETENED_RE.test(text)) add('sweetening:unsweetened');
    if (SWEETENED_RE.test(text)) add('sweetening:sweetened');
    for (const syrup of ['extra heavy syrup', 'heavy syrup', 'extra light syrup', 'light syrup', 'juice pack', 'water pack'])
        if (text.includes(syrup)) { add('packing:' + syrup.replace(/ /g, '-')); break; }
    if (UNSALTED_RE.test(text)) add('salt:unsalted');
    if (SALTED_RE.test(text)) add('salt:salted');
    if (/\b(?:low|reduced) sodium\b/.test(text)) add('salt:low-or-reduced-sodium');
    if (mentionsJuiceProduct(text)) add('form:juice');
    if (/\bnectar\b/.test(text)) add('form:nectar');
    if (BABYFOOD_RE.test(text)) add('form:babyfood');
    if (/\bpuree[ds]?\b|\bpur[eé]e\b|\bstrained\b/.test(text)) add('form:pureed-or-strained');
    if (WITH_SKIN_RE.test(text)) add('skin:with-skin');
    if (WITHOUT_SKIN_RE.test(text)) add('skin:without-skin');
    for (const v of VARIETY_WORDS) if (new RegExp(`\\b${v}\\b`).test(text)) add('variety:' + v.replace(/ /g, '-'));
    for (const m of String(description || '').matchAll(/\(([^()]{1,80})\)/g)) add('qualifier:' + m[1].trim());
    return out;
}

export interface MaterialAttribute { attribute: string; value: string }
type StateClass = 'raw' | 'cooked' | 'canned' | 'frozen' | 'dried';
const COOKING_PREPARATIONS = new Set(['boiled', 'roasted', 'fried', 'grilled', 'braised', 'baked', 'poached', 'steamed', 'pan-browned', 'pan-fried', 'dry-roasted', 'grilled-without-added-fat', 'roasted-without-added-fat', 'baked-without-added-fat', 'dry-heat-without-added-fat', 'moist-heat']);

/** The target facts conflicts are checked against (manifest state via stateToDims, variant, kind, name tokens). */
function targetFacts(entry: ManifestEntry) {
    const { dims } = stateToDims(entry.state);
    const name = lower(entry.name);
    const variant = lower(entry.variant || '');
    let stateClass: StateClass | null = null;
    if (['raw', 'fresh'].includes(dims.state)) stateClass = 'raw';
    else if (dims.state === 'cooked' || COOKING_PREPARATIONS.has(dims.preparation)) stateClass = 'cooked';
    else if (dims.state === 'canned') stateClass = 'canned';
    else if (dims.state === 'frozen') stateClass = 'frozen';
    else if (dims.state === 'dried') stateClass = 'dried';
    const sweetening = dims.sweetening !== 'unspecified' ? dims.sweetening
        : UNSWEETENED_RE.test(name) ? 'unsweetened' : SWEETENED_RE.test(name) ? 'sweetened' : 'unspecified';
    const salt = dims.salt !== 'unspecified' ? dims.salt
        : UNSALTED_RE.test(name) ? 'unsalted' : SALTED_RE.test(name) ? 'salted' : 'unspecified';
    const fortification = dims.fortification !== 'unspecified' ? dims.fortification
        : UNFORTIFIED_RE.test(name) ? 'unfortified' : FORTIFIED_RE.test(name) ? 'fortified' : 'unspecified';
    const juice = mentionsJuiceProduct(name) || (/\bjuice\b/.test(entry.id) && !/in-juice/.test(entry.id));
    const percents = percentFacts(name);
    const formulation = variant.match(/formulation-(\d+)-(\d+)$/);
    if (formulation) percents.push({ noun: 'lean', value: formulation[1] }, { noun: 'fat', value: formulation[2] });
    const skin = WITH_SKIN_RE.test(name) || /with-skin/.test(entry.id) ? 'with-skin' : WITHOUT_SKIN_RE.test(name) || /without-skin|peeled/.test(entry.id) ? 'without-skin' : null;
    const babyfood = BABYFOOD_RE.test(name);
    return { dims, stateClass, sweetening, salt, fortification, juice, percents, skin, babyfood };
}

/** Documented target attributes, in a fixed order; unspecified dimensions are omitted. */
export function materialAttributesOf(entry: ManifestEntry): MaterialAttribute[] {
    const t = targetFacts(entry);
    const out: MaterialAttribute[] = [{ attribute: 'kind', value: entry.kind }, { attribute: 'catalogState', value: entry.state }];
    for (const key of ['state', 'preparation', 'drained'] as const)
        if (t.dims[key] !== 'unspecified') out.push({ attribute: key, value: t.dims[key] });
    if (t.salt !== 'unspecified') out.push({ attribute: 'salt', value: t.salt });
    if (t.fortification !== 'unspecified') out.push({ attribute: 'fortification', value: t.fortification });
    if (t.sweetening !== 'unspecified') out.push({ attribute: 'sweetening', value: t.sweetening });
    if (t.juice) out.push({ attribute: 'productForm', value: 'juice' });
    for (const p of t.percents) out.push({ attribute: 'percent', value: `${p.value}%${p.noun === 'other' ? '' : ' ' + p.noun}` });
    if (t.skin) out.push({ attribute: 'skin', value: t.skin });
    if (entry.variant) out.push({ attribute: 'variant', value: entry.variant });
    return out;
}

export interface Conflict { attribute: string; reason: string }
/**
 * Explicit contradictions between the target's material attributes and a
 * candidate description, following the documented-attributes rubric
 * (docs/nutrition/a1-evidence-matrix.md): only explicit evidence in the
 * description counts. The absence of a qualifier is never a conflict.
 */
export function findConflicts(entry: ManifestEntry, description: string): Conflict[] {
    const t = targetFacts(entry);
    const text = lower(description);
    const out: Conflict[] = [];
    const classes: Record<StateClass, boolean> = { raw: RAW_RE.test(text), cooked: COOK_RE.test(text), canned: CANNED_RE.test(text), frozen: FROZEN_RE.test(text), dried: DRIED_RE.test(text) };
    if (t.stateClass && !classes[t.stateClass]) {
        const incompatible: Record<StateClass, StateClass[]> = { raw: ['cooked', 'canned', 'frozen', 'dried'], cooked: ['raw'], canned: ['raw', 'frozen', 'dried'], frozen: ['raw', 'canned', 'dried'], dried: ['raw', 'canned', 'frozen'] };
        const found = incompatible[t.stateClass].filter(c => classes[c]);
        if (found.length)
            out.push({ attribute: 'state', reason: `target state ${t.stateClass} (${entry.state}); description says ${found.join('/')}` });
    }
    if (t.stateClass === 'cooked' && COOKING_PREPARATIONS.has(t.dims.preparation)) {
        const method = t.dims.preparation.split('-')[0] === 'dry' ? 'roasted' : t.dims.preparation.split('-')[0];
        const other = COOK_WORDS.filter(w => w !== 'cooked' && w !== method && new RegExp(`\\b${w}\\b`).test(text));
        if (['boiled', 'roasted', 'fried', 'grilled', 'braised', 'baked', 'poached', 'steamed'].includes(method) && !new RegExp(`\\b${method}\\b`).test(text) && other.length)
            out.push({ attribute: 'preparation', reason: `target preparation ${t.dims.preparation}; description says ${other.join('/')}` });
    }
    if (t.sweetening === 'unsweetened' && SWEETENED_RE.test(text) && !UNSWEETENED_RE.test(text))
        out.push({ attribute: 'sweetening', reason: 'target unsweetened; description says sweetened or syrup-packed' });
    if (t.sweetening === 'sweetened' && UNSWEETENED_RE.test(text) && !SWEETENED_RE.test(text))
        out.push({ attribute: 'sweetening', reason: 'target sweetened; description says unsweetened' });
    if (t.salt === 'unsalted' && SALTED_RE.test(text) && !UNSALTED_RE.test(text))
        out.push({ attribute: 'salt', reason: 'target without added salt; description says with salt' });
    if (t.salt === 'salted' && UNSALTED_RE.test(text) && !SALTED_RE.test(text))
        out.push({ attribute: 'salt', reason: 'target salted; description says without salt' });
    if (t.dims.drained === 'drained' || t.dims.drained === 'drained_rinsed') {
        if (UNDRAINED_RE.test(text))
            out.push({ attribute: 'drained', reason: 'target drained; description says undrained or solids and liquids' });
    }
    else if (t.dims.drained === 'undrained' && DRAINED_RE.test(text) && !UNDRAINED_RE.test(text))
        out.push({ attribute: 'drained', reason: 'target undrained; description says drained' });
    if (t.fortification === 'unfortified' && FORTIFIED_RE.test(text) && !UNFORTIFIED_RE.test(text))
        out.push({ attribute: 'fortification', reason: 'target unfortified; description says enriched or fortified' });
    if (t.fortification === 'fortified' && UNFORTIFIED_RE.test(text))
        out.push({ attribute: 'fortification', reason: 'target enriched or fortified; description says unenriched or unfortified' });
    const descJuice = mentionsJuiceProduct(text) || NECTAR_RE.test(text);
    if (t.juice && !descJuice && (classes.raw || classes.dried || classes.frozen || classes.canned))
        out.push({ attribute: 'productForm', reason: 'target is juice; description is the whole food' });
    if (!t.juice && !NECTAR_RE.test(lower(entry.name)) && descJuice)
        out.push({ attribute: 'productForm', reason: 'target is the whole food; description is a juice, nectar, drink, or concentrate' });
    const descPercents = percentFacts(text);
    for (const p of t.percents.filter(p => p.noun !== 'other')) {
        const stated = descPercents.filter(d => d.noun === p.noun);
        if (stated.length && !stated.some(d => d.value === p.value))
            out.push({ attribute: 'percent', reason: `target ${p.value}% ${p.noun}; description says ${stated.map(d => d.value + '% ' + d.noun).join(', ')}` });
    }
    if (!t.babyfood && BABYFOOD_RE.test(text))
        out.push({ attribute: 'productForm', reason: 'description is an infant food formulation' });
    if (t.skin === 'with-skin' && WITHOUT_SKIN_RE.test(text) && !WITH_SKIN_RE.test(text))
        out.push({ attribute: 'skin', reason: 'target with skin; description says without skin or peeled' });
    if (t.skin === 'without-skin' && WITH_SKIN_RE.test(text) && !WITHOUT_SKIN_RE.test(text))
        out.push({ attribute: 'skin', reason: 'target without skin; description says with skin' });
    return out;
}

// ---------------------------------------------------------------------------
// Precedents

export interface Precedent {
    targetId: string;
    decision: 'approved' | 'unresolved';
    source: string;
    note: string;
}
export interface UnresolvedRecord { id: string; source: string; note: string }

/**
 * Unresolved ids from the batch reports, checked in as data (the report tables
 * and prose lists are not a stable machine format). Sources:
 * docs/nutrition/population-batch-a1-import.md "Unresolved (11)",
 * docs/nutrition/population-batch-a2-import.md "Still unresolved (10)",
 * docs/nutrition/population-batch-a3-report.md "Unresolved".
 */
const A1 = 'docs/nutrition/population-batch-a1-import.md';
const A2 = 'docs/nutrition/population-batch-a2-import.md';
const A3 = 'docs/nutrition/population-batch-a3-report.md';
export const UNRESOLVED_PRECEDENTS: readonly UnresolvedRecord[] = Object.freeze([
    { id: 'apple-cider-nonalcoholic-ready-to-drink', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'ginger-beer-nonalcoholic-ready-to-drink', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'pear-juice-100-percent-ready-to-drink', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'mustard-dijon-as-sold', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'panko-breadcrumbs-as-sold', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'cacao-nibs-as-sold', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'miso-red-as-sold', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'miso-white-as-sold', source: A1, note: 'A1 unresolved: no reviewed source record' },
    { id: 'pomegranate-juice-100-percent-ready-to-drink', source: A1, note: 'A1 unresolved: Foundation candidate lacks core macros; 100% juice not verified' },
    { id: 'salsa-red-as-sold', source: A1, note: 'A1 unresolved: branded chunky composite; generic red formulation not established' },
    { id: 'chocolate-chips-semisweet-as-sold', source: A1, note: 'A1 unresolved: confection composition not validated for chips' },
    { id: 'tamari-regular-as-sold', source: A2, note: 'A2 unresolved: regular-sodium variant not established' },
    { id: 'greek-yogurt-plain-2-percent-fat-as-sold', source: A2, note: 'A2 unresolved: "lowfat" is a range, not 2%' },
    { id: 'greek-yogurt-plain-5-percent-fat-as-sold', source: A2, note: 'A2 unresolved: no source states 5% fat' },
    { id: 'goat-cheese-soft-chevre-as-sold', source: A2, note: 'A2 unresolved: soft type does not establish fresh chevre' },
    { id: 'tamari-reduced-sodium-as-sold', source: A2, note: 'A2 unresolved: variant not distinguished' },
    { id: 'vinegar-champagne-liquid-as-sold', source: A2, note: 'A2 unresolved: no source record' },
    { id: 'vinegar-rice-seasoned-liquid-as-sold', source: A2, note: 'A2 unresolved: no source record' },
    { id: 'vinegar-sherry-liquid-as-sold', source: A2, note: 'A2 unresolved: no source record' },
    { id: 'chicken-egg-scrambled-cooked-without-added-fat', source: A2, note: 'A2 unresolved: no-added-fat preparation not documented' },
    { id: 'chicken-egg-white-cooked-without-added-fat', source: A2, note: 'A2 unresolved: no cooked egg white record' },
    { id: 'banana-pureed-unsweetened', source: A3, note: 'A3 unresolved: only an infant-food puree exists' },
    { id: 'mango-dried-unsweetened', source: A3, note: 'A3 unresolved: dried mango exists only sweetened' },
    { id: 'mango-frozen-unsweetened', source: A3, note: 'A3 unresolved: no frozen mango record' },
    { id: 'mango-pureed-unsweetened', source: A3, note: 'A3 unresolved: no mango puree record' },
    { id: 'passion-fruit-pulp-pureed-unsweetened', source: A3, note: 'A3 unresolved: pureed pulp and variety not documented' },
    { id: 'pineapple-canned-in-heavy-syrup-drained', source: A3, note: 'A3 unresolved: no drained heavy-syrup record' },
]);

/** Trailing id segments that name a variant (salt, sugar, fat level, skin, enrichment), not the food. */
const VARIANT_SUFFIX = /-(?:regular|reduced-sodium|low-sodium|no-added-salt|with-salt|without-added-salt|unsalted|salted|sweetened|unsweetened|plain|nonfat|whole|low-fat|reduced-fat|fat-free|lactose-free|\d+(?:-\d+)?-percent(?:-fat)?|with-skin|without-skin|skinless|peeled|enriched|unenriched|fortified|not-fortified|unfortified|pasteurized|fresh)$/;
/**
 * Id with the trailing catalog-state segment, the manifest variant, and any
 * trailing variant qualifiers stripped: soy-sauce-regular-as-sold and
 * soy-sauce-reduced-sodium-as-sold share the stem soy-sauce.
 */
export function stemOf(entry: Pick<ManifestEntry, 'id' | 'state' | 'variant'>) {
    let id = entry.id;
    for (const suffix of [entry.variant, entry.state])
        if (suffix && id.endsWith('-' + suffix)) id = id.slice(0, -suffix.length - 1);
    for (let next = id.replace(VARIANT_SUFFIX, ''); next !== id && next; next = id.replace(VARIANT_SUFFIX, ''))
        id = next;
    return id;
}

function precedentsFor(entry: ManifestEntry, byId: Map<string, ManifestEntry>, matchTable: MatchEntry[], unresolved: readonly UnresolvedRecord[]): Precedent[] {
    const stem = stemOf(entry), name = lower(entry.name).trim();
    const related = (id: string) => {
        if (id === entry.id) return false;
        const other = byId.get(id);
        return other ? stemOf(other) === stem || lower(other.name).trim() === name : id === stem;
    };
    const out: Precedent[] = [];
    for (const m of [...matchTable].sort((a, b) => a.manifestId.localeCompare(b.manifestId)))
        if (related(m.manifestId))
            out.push({ targetId: m.manifestId, decision: 'approved', source: MATCH_TABLE_DOC, note: `reviewed ${m.dataType} ${m.release} fdcId ${m.fdcId}` });
    for (const u of [...unresolved].sort((a, b) => a.id.localeCompare(b.id)))
        if (related(u.id))
            out.push({ targetId: u.id, decision: 'unresolved', source: u.source, note: u.note });
    return out;
}

// ---------------------------------------------------------------------------
// Bundle

/** Name words that describe state or packaging, not food identity. */
const STATE_TOKENS = new Set([
    'raw', 'fresh', 'cooked', 'boiled', 'roasted', 'baked', 'fried', 'grilled', 'braised', 'steamed', 'poached', 'broiled', 'stewed',
    'canned', 'frozen', 'dried', 'dry', 'drained', 'undrained', 'rinsed', 'not', 'without', 'added', 'salt', 'salted', 'unsalted',
    'sugar', 'sweetened', 'unsweetened', 'ready', 'drink', 'eat', 'use', 'sold', 'liquid', 'plain', 'regular', 'whole', 'pureed',
    'packed', 'pack', 'water', 'heat', 'moist', 'oil', 'juice', 'syrup', 'heavy', 'light', 'fat', 'percent', 'unspecified',
]);
/**
 * matchSuggest's tokens for an entry, each with its alternative forms.
 * matchSuggest's prefix rule already matches s/es plurals ("pear" hits
 * "pears"), but not y -> ies ("cherry" vs "Cherries"), so a consonant + y token
 * also accepts its ies form. A token counts once however many forms hit.
 */
export function tokenGroups(entry: Pick<ManifestEntry, 'name' | 'aliases'>) {
    return suggestionTokens(entry).map(t => ({ token: t, forms: /[^aeiou]y$/.test(t) ? [t, t.slice(0, -1) + 'ies'] : [t], identity: !STATE_TOKENS.has(t) }));
}
/**
 * matchSuggest scoring per token group: the score is the number of entry
 * tokens (any form) that hit the description, using suggestCandidates itself
 * for each form. A record must hit at least one identity token, not only state
 * words such as "raw" (which alone would match hundreds of unrelated foods);
 * an entry with no identity token keeps every scoring record.
 */
export function scoreFoods(entry: Pick<ManifestEntry, 'name' | 'aliases'>, foods: Record<string, unknown>[]) {
    const groups = tokenGroups(entry);
    const anyIdentity = groups.some(g => g.identity);
    const hitsOf = (g: ReturnType<typeof tokenGroups>[number], records: Record<string, unknown>[]) =>
        new Set(g.forms.flatMap(form => suggestCandidates({ name: form }, records, records.length).map(s => String(s.fdcId))));
    const scores = new Map<string, { score: number; identity: boolean }>();
    for (const g of groups) {
        for (const id of hitsOf(g, foods)) {
            const row = scores.get(id) || { score: 0, identity: false };
            row.score++;
            row.identity ||= g.identity;
            scores.set(id, row);
        }
    }
    const kept = [...scores].filter(([, s]) => s.identity || !anyIdentity);
    // Tie-break signal: the description's lead segment (before the first comma,
    // where FDC names the food) is hit by an identity token.
    const keptIds = new Set(kept.map(([id]) => id));
    const leads = foods.filter(f => keptIds.has(String(f.fdcId))).map(f => ({ fdcId: f.fdcId, description: String(f.description || '').split(',')[0] }));
    const leadHits = new Set(groups.filter(g => g.identity || !anyIdentity).flatMap(g => [...hitsOf(g, leads)]));
    return kept.map(([fdcId, s]) => ({ fdcId, score: s.score, leadHit: leadHits.has(fdcId) }));
}
/** The description explicitly states the target's state class (raw, cooked, canned, frozen, dried). */
function supportsTargetState(entry: ManifestEntry, description: string) {
    const t = targetFacts(entry), text = lower(description);
    if (!t.stateClass) return false;
    return { raw: RAW_RE, cooked: COOK_RE, canned: CANNED_RE, frozen: FROZEN_RE, dried: DRIED_RE }[t.stateClass].test(text);
}

export interface Candidate {
    ref: string;
    fdcId: string;
    dataset: BundleDatasetId;
    release: string;
    description: string;
    coverage: Coverage;
    distinctions: string[];
    conflicts: Conflict[];
}
export interface BundleTarget {
    targetId: string;
    name: string;
    category: string;
    kind: string;
    state: string;
    variant: string | null;
    aliases: string[];
    notes: string | null;
    materialAttributes: MaterialAttribute[];
    candidates: Candidate[];
    precedents: Precedent[];
}
export interface SourceVersion { dataset: BundleDatasetId; release: string; file: string; sha256: string }
export interface GeminiBundle {
    schemaVersion: 1;
    bundleId: string;
    generatedAt: string;
    sourceVersions: SourceVersion[];
    manifestDigest: string;
    inputDigest: string;
    selection: { rule: string; count: number; excludedPublishedCount: number; excludedAssignedCount: number };
    targets: BundleTarget[];
}
export interface BuildBundleOptions {
    entries: ManifestEntry[];
    matchTable: MatchEntry[];
    datasets: BundleDataset[];
    count?: number;
    batchMax?: number;
    batches?: number;
    unresolved?: readonly UnresolvedRecord[];
    now?: Date;
}
export interface BuildBundleResult {
    bundle: GeminiBundle;
    eligibleCount: number;
    candidateTotals: Record<BundleDatasetId, number>;
    skippedRecords: Record<BundleDatasetId, number>;
}

export async function buildGeminiBundle({ entries, matchTable, datasets, count = DEFAULT_COUNT, batchMax = 25, batches = 3, unresolved = UNRESOLVED_PRECEDENTS, now = new Date() }: BuildBundleOptions): Promise<BuildBundleResult> {
    const ids = datasets.map(d => d.pin.id).sort();
    if (canonicalJson(ids) !== canonicalJson(['foundation', 'sr-legacy']))
        throw new Error('Bundle needs exactly the foundation and sr-legacy pins');
    const selection = selectBundleTargets(entries, matchTable, { count, batchMax, batches });
    const ordered = [...datasets].sort((a, b) => a.pin.id.localeCompare(b.pin.id));
    const sourceVersions: SourceVersion[] = ordered.map(d => ({ dataset: d.pin.id, release: d.pin.release, file: d.pin.fileName, sha256: String(d.pin.sha256) }));
    // Index each pinned release once, through the same audit path `suggest` uses.
    const indexed = [];
    for (const d of ordered) {
        const audit = await auditPinnedBulk(d.file, d.pin);
        indexed.push({ dataset: d, foods: audit.foods, raws: new Map(audit.foods.map(f => [String(f.fdcId), f])), skipped: audit.failures.length });
    }
    const coverageCache = new Map<string, Coverage>();
    const byId = new Map(entries.map(e => [e.id, e]));
    const candidateTotals: Record<BundleDatasetId, number> = { foundation: 0, 'sr-legacy': 0 };
    const targets: BundleTarget[] = [];
    for (const entry of selection.selected) {
        const scored = indexed.flatMap(({ dataset, foods, raws }) => scoreFoods(entry, foods).map(s => {
            const raw = raws.get(s.fdcId)!;
            return { ...s, dataset, raw, description: String(raw.description) };
        }));
        // matchSuggest score first. Ties: the lead segment names the food, then
        // fewer explicit conflicts, then the target state is stated, then fdcId,
        // then dataset. Only records scoring at least the sixth-best score can
        // reach the top six.
        const threshold = [...scored.map(s => s.score)].sort((a, b) => b - a)[MAX_CANDIDATES - 1] ?? 0;
        const pool = scored.filter(s => s.score >= threshold).map(s => ({ ...s, conflicts: findConflicts(entry, s.description), statesTarget: supportsTargetState(entry, s.description) }));
        pool.sort((a, b) => b.score - a.score || Number(b.leadHit) - Number(a.leadHit) || a.conflicts.length - b.conflicts.length
            || Number(b.statesTarget) - Number(a.statesTarget) || Number(a.fdcId) - Number(b.fdcId) || a.dataset.pin.id.localeCompare(b.dataset.pin.id));
        const candidates: Candidate[] = [];
        for (const c of pool.slice(0, MAX_CANDIDATES)) {
            const key = c.dataset.pin.id + ':' + c.fdcId;
            if (!coverageCache.has(key)) coverageCache.set(key, await coverageOf(c.raw, c.dataset.pin.release));
            candidates.push({
                ref: `cand:${entry.id}:${c.fdcId}`,
                fdcId: String(c.fdcId),
                dataset: c.dataset.pin.id,
                release: c.dataset.pin.release,
                description: String(c.raw.description),
                coverage: coverageCache.get(key)!,
                distinctions: extractDistinctions(String(c.raw.description)),
                conflicts: c.conflicts,
            });
            candidateTotals[c.dataset.pin.id]++;
        }
        targets.push({
            targetId: entry.id, name: entry.name, category: entry.category, kind: entry.kind, state: entry.state,
            variant: entry.variant ?? null, aliases: [...(entry.aliases || [])], notes: entry.notes ?? null,
            materialAttributes: materialAttributesOf(entry), candidates, precedents: precedentsFor(entry, byId, matchTable, unresolved),
        });
    }
    const manifestDigest = canonicalDigest(entries);
    const inputDigest = canonicalDigest({
        selectedTargetIds: targets.map(t => t.targetId),
        sourceVersions: sourceVersions.map(({ dataset, release, sha256 }) => ({ dataset, release, sha256 })),
        manifestDigest,
    });
    const generatedAt = now.toISOString();
    const bundle: GeminiBundle = {
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        bundleId: `gemini-bundle-${generatedAt.slice(0, 10)}-${inputDigest.slice(0, 12)}`,
        generatedAt,
        sourceVersions,
        manifestDigest,
        inputDigest,
        selection: { rule: SELECTION_RULE, count: targets.length, excludedPublishedCount: selection.excludedPublishedCount, excludedAssignedCount: selection.excludedAssignedCount },
        targets,
    };
    return { bundle, eligibleCount: selection.eligibleCount, candidateTotals, skippedRecords: { foundation: indexed[0].skipped, 'sr-legacy': indexed[1].skipped } };
}

/** Header placeholders in docs/nutrition/gemini-research-prompt.md. */
export function renderPrompt(template: string, bundle: Pick<GeminiBundle, 'bundleId' | 'inputDigest'>) {
    if (!template.includes('{{BUNDLE_ID}}') || !template.includes('{{INPUT_DIGEST}}'))
        throw new Error('Prompt template is missing its header placeholders');
    return template.replaceAll('{{BUNDLE_ID}}', bundle.bundleId).replaceAll('{{INPUT_DIGEST}}', bundle.inputDigest);
}
