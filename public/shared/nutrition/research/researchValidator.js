import { PROFILE_FIELDS as V2_KEYS } from './profileFields.js';
import { checkPer100g } from '../nutrientRegistry.js';
import { validateRevision, verifyRevisionHash } from '../ingredientProfile.js';
import { validateConversion } from '../ingredientConversion.js';
export const VALIDATOR_VERSION = 1;
const COOKED_STATE_WORDS = ['cooked', 'boiled', 'roasted', 'baked', 'fried', 'pan-fried', 'grilled', 'braised'];
/** Per-source lists win when present. Each list is judged alone so one cooked source cannot hide a raw one. */
function stateWordLists(proposal) {
    const bySource = proposal?.stateWordsBySource;
    if (bySource && typeof bySource === 'object' && !Array.isArray(bySource)) {
        const lists = Object.values(bySource).filter(Array.isArray);
        if (lists.length)
            return lists;
    }
    return [proposal?.extractedStateWords || []];
}
function stateConflictErrors(words, targetDims) {
    const errors = [];
    const extractedWords = new Set((words || []).map(w => String(w).toLowerCase()));
    const targetState = String(targetDims.state || '').toLowerCase();
    const isTargetRaw = targetState === 'raw' || targetState.includes('raw');
    const isTargetCooked = targetState === 'cooked' ||
        targetState.includes('cooked') ||
        targetState.includes('boiled') ||
        targetState.includes('roasted') ||
        targetState.includes('baked') ||
        targetState.includes('fried') ||
        targetState.includes('grilled') ||
        targetState.includes('braised');
    const sourceHasCooked = COOKED_STATE_WORDS.some(w => extractedWords.has(w));
    const sourceHasRaw = extractedWords.has('raw');
    if (isTargetRaw && sourceHasCooked)
        errors.push('Explicit conflict: target is raw but source is cooked/prepared');
    if (isTargetCooked && sourceHasRaw && !sourceHasCooked)
        errors.push('Explicit conflict: target is cooked but source is raw');
    if (targetDims.drained === 'drained' && extractedWords.has('undrained'))
        errors.push('Explicit conflict: target is drained but source is undrained');
    if (targetDims.drained === 'undrained' && extractedWords.has('drained'))
        errors.push('Explicit conflict: target is undrained but source is drained');
    if (targetDims.fortification === 'fortified' && extractedWords.has('unfortified'))
        errors.push('Explicit conflict: target is fortified but source is unfortified');
    if (targetDims.fortification === 'unfortified' && extractedWords.has('fortified'))
        errors.push('Explicit conflict: target is unfortified but source is fortified');
    if (targetDims.salt === 'unsalted' && extractedWords.has('salted'))
        errors.push('Explicit conflict: target is unsalted but source is salted');
    if (targetDims.salt === 'salted' && extractedWords.has('unsalted'))
        errors.push('Explicit conflict: target is salted but source is unsalted');
    return errors;
}
function needsCuratedClaimProvenance(entry) {
    return entry?.status === 'not_applicable' || entry?.status === 'below_quantification_limit' || entry?.upperBound != null;
}
export async function validateProposal(job, { base = null } = {}) {
    const errors = [];
    const warnings = [];
    let blockedReason = null;
    if (!job || typeof job !== 'object') {
        return { isValid: false, errors: ['Invalid job: expected object'], warnings: [] };
    }
    const draft = job.proposal?.revisionDraft;
    if (!draft) {
        errors.push('Job proposal is missing revisionDraft');
        return { isValid: false, errors, warnings };
    }
    if (job.proposal?.identityConflict)
        errors.push('Identity match conflict');
    // 1. Revision draft and hash validation
    const revisionErrors = validateRevision(draft);
    errors.push(...revisionErrors);
    const hashValid = await verifyRevisionHash(draft);
    if (!hashValid) {
        errors.push('Revision content hash verification failed');
    }
    // 2. Conversion validation
    for (const conv of job.proposal?.conversions || []) {
        const convErrors = validateConversion(conv);
        errors.push(...convErrors);
    }
    // 3. Status for all V2_KEYS
    const quality = draft.nutrientMeta?.quality || {};
    for (const key of V2_KEYS) {
        if (draft.nutrients[key] === null && ['measured', 'label_reported', 'calculated', 'estimated_from_comparable', 'source_reported', 'assumed_zero'].includes(quality[key]?.status))
            errors.push(`Field ${key} observational status requires non-null value`);
        if (quality[key]?.status === 'assumed_zero' && draft.nutrients[key] !== null && draft.nutrients[key] !== 0)
            errors.push(`Field ${key} assumed_zero status requires a zero value`);
        if (!quality[key]?.status) {
            errors.push(`Field ${key} has no status`);
        }
    }
    // Zero requires an attributable observation; null never becomes analytical zero.
    for (const key of V2_KEYS)
        if (draft.nutrients[key] === 0 && !draft.sources[draft.fieldProvenance[key]?.sourceKey])
            errors.push(`Zero without evidence: ${key}`);
    for (const key of V2_KEYS)
        if (quality[key]?.status === 'estimated_from_comparable') {
            const p = draft.fieldProvenance[key];
            if (!p?.comparatorRef || !p.derivation || !p.range)
                errors.push(`Estimate requires comparator, transfer reason/derivation and range: ${key}`);
        }
    // An upper bound or not-applicable claim is evidence. Curated output cannot
    // publish it without a source, and an assistant claim must name a verified one.
    if (job.scope === 'curated') {
        const assistantNutrients = job.proposal?.assistantResult?.nutrients;
        const verification = job.proposal?.sourceVerification;
        const assistantKeys = job.proposal?.assistantSourceKeys || {};
        const sourceIdFor = sourceKey => Object.entries(assistantKeys).find(([, key]) => key === sourceKey)?.[0];
        for (const key of V2_KEYS) {
            const entry = quality[key];
            if (!needsCuratedClaimProvenance(entry))
                continue;
            const sourceKey = draft.fieldProvenance?.[key]?.sourceKey;
            const sourced = Boolean(sourceKey && draft.sources?.[sourceKey]);
            if (!sourced)
                errors.push(`Curated field ${key} requires provenance for ${entry.status}`);
            if (assistantNutrients && Object.prototype.hasOwnProperty.call(assistantNutrients, key)) {
                const sourceId = sourced ? sourceIdFor(sourceKey) : undefined;
                if (!sourceId || verification?.[sourceId]?.status !== 'verified')
                    errors.push(`Curated field ${key} requires verified provenance`);
            }
        }
    }
    // 4. Per 100g scientific bounds check
    for (const key of V2_KEYS) {
        const val = draft.nutrients?.[key];
        if (val !== null && val !== undefined && typeof val === 'number') {
            const check = checkPer100g(key, val);
            if (check === 'reject') {
                errors.push(`Nutrient ${key} value ${val} rejected by checkPer100g bounds`);
            }
            else if (check === 'review') {
                warnings.push(`Nutrient ${key} value ${val} requires review (exceeds reviewAbove)`);
            }
        }
    }
    // 5. State conflicts (raw vs cooked, drained vs undrained, fortified vs plain).
    // Check each verified source on its own. A union would let a cooked source
    // hide a raw-only source on a cooked target, and the reverse.
    const targetDims = job.target?.dims || {};
    const targetState = String(targetDims.state || '').toLowerCase();
    const seenConflicts = new Set();
    for (const words of stateWordLists(job.proposal)) {
        for (const error of stateConflictErrors(words, targetDims)) {
            if (seenConflicts.has(error))
                continue;
            seenConflicts.add(error);
            errors.push(error);
        }
    }
    // 6. FDC adapter used on compound-reference entry
    if (job.target?.sourceStrategy === 'compound-reference') {
        const hasFdcSource = Object.values(draft.sources || {}).some(s => s.type === 'fdc');
        if (hasFdcSource) {
            errors.push('Conflict: FDC adapter used on a compound-reference entry');
        }
    }
    // 7. Concentration-needed state without manual formula
    if ((targetState.includes('concentration-needed') || job.target?.catalogState?.includes('concentration-needed'))) {
        const hasFormula = Boolean(job.proposal?.hasConcentrationFormula || draft.sources?.manual?.formula);
        if (!hasFormula) {
            errors.push('State requires concentration and formula: concentration-needed entry requires composition');
            blockedReason = {
                code: 'requires_composition',
                needs: 'Exact chemical concentration, formula, and food-grade carrier required',
            };
        }
    }
    // 8. Branded entry without label or manufacturer source
    if (job.target?.kind === 'branded') {
        const hasBrandSource = Object.values(draft.sources || {}).some(s => s.type === 'label' || s.type === 'manufacturer');
        if (!hasBrandSource) {
            errors.push('Branded entry requires a label or manufacturer source');
        }
    }
    // 9. Source metadata requirements
    for (const [sKey, src] of Object.entries(draft.sources || {})) {
        if (!src.version || typeof src.version !== 'string') {
            errors.push(`Source ${sKey} missing version`);
        }
        if (typeof src.accessedAt !== 'string' || !Number.isFinite(Date.parse(src.accessedAt)))
            errors.push(`Source ${sKey} invalid access date`);
        if (src.publishedAt !== undefined && (typeof src.publishedAt !== 'string' || !Number.isFinite(Date.parse(src.publishedAt))))
            errors.push(`Source ${sKey} invalid publication date`);
        if (!src.permittedUse || typeof src.permittedUse !== 'string') {
            errors.push(`Source ${sKey} missing permittedUse (license)`);
        }
        if (job.scope === 'curated' && src.permittedUse === 'review_required')
            errors.push(`Source ${sKey} has unresolved permittedUse (license)`);
        if (src.url && (() => {
            try {
                return new URL(src.url).protocol !== 'https:';
            }
            catch {
                return true;
            }
        })()) {
            errors.push(`Source ${sKey} URL must start with https://`);
        }
    }
    // 10. Curated scope carrying private material
    if (job.scope === 'curated') {
        for (const conv of job.proposal?.conversions || [])
            if (conv.source?.permittedUse === 'review_required')
                errors.push('Conversion source has unresolved permittedUse (license)');
        if (job.ownerUid || draft.ownerUid) {
            errors.push('Curated job cannot have ownerUid');
        }
        for (const [sKey, src] of Object.entries(draft.sources || {})) {
            if (/private|restricted|confidential/i.test(src.permittedUse || '')) {
                errors.push(`Curated job source ${sKey} cannot use non-public permittedUse`);
            }
            if (src.url && /blob:|data:|\/users\//i.test(src.url)) {
                errors.push(`Curated job source ${sKey} cannot reference private photo or user URLs`);
            }
        }
    }
    // Warnings
    if (targetState === 'unspecified') {
        warnings.push('Target food state is unspecified');
    }
    // Atwater macronutrient consistency
    const cal = draft.nutrients?.calories;
    const p = draft.nutrients?.protein;
    const c = draft.nutrients?.carbs;
    const f = draft.nutrients?.fat;
    const alc = draft.nutrients?.alcohol || 0;
    if (typeof cal === 'number' &&
        typeof p === 'number' &&
        typeof c === 'number' &&
        typeof f === 'number') {
        const atwater = 4 * p + 4 * c + 9 * f + 7 * alc;
        const diff = Math.abs(cal - atwater);
        const tol = Math.max(30, atwater * 0.25);
        if (diff > tol) {
            warnings.push(`Atwater energy inconsistency: reported ${cal} kcal differs from calculated ${Math.round(atwater)} kcal by >${Math.round(tol)}`);
        }
    }
    // Fat classes check
    if (typeof f === 'number' && f > 0) {
        const sumFatClasses = (draft.nutrients?.fatSaturated || 0) +
            (draft.nutrients?.fatTrans || 0) +
            (draft.nutrients?.fatMonounsaturated || 0) +
            (draft.nutrients?.fatPolyunsaturated || 0);
        if (sumFatClasses > f * 1.05) {
            warnings.push(`Fat classes sum (${Math.round(sumFatClasses * 100) / 100} g) exceeds total fat (${f} g) by >5%`);
        }
    }
    // Sugars + starch vs carbs
    if (typeof c === 'number' && c > 0) {
        const sumCarbs = (draft.nutrients?.sugarsTotal || 0) + (draft.nutrients?.starch || 0);
        if (sumCarbs > c * 1.05) {
            warnings.push(`Sugars + starch (${Math.round(sumCarbs * 100) / 100} g) exceeds total carbs (${c} g) by >5%`);
        }
    }
    // Fiber detail vs total
    const fibTotal = draft.nutrients?.fiberTotal;
    if (typeof fibTotal === 'number' && fibTotal > 0) {
        const sumFiber = (draft.nutrients?.fiberSoluble || 0) + (draft.nutrients?.fiberInsoluble || 0);
        if (sumFiber > fibTotal * 1.05) {
            warnings.push(`Soluble + insoluble fiber (${Math.round(sumFiber * 100) / 100} g) exceeds total fiber (${fibTotal} g) by >5%`);
        }
    }
    // Unit mix-up checks (e.g. mcg nutrients > 1000 in per 100g)
    for (const k of ['vitaminB12', 'selenium', 'iodine']) {
        const v = draft.nutrients?.[k];
        if (typeof v === 'number' && v > 5000) {
            warnings.push(`Likely unit mix-up: ${k} value is suspiciously high (${v} mcg)`);
        }
    }
    return {
        validatorVersion: VALIDATOR_VERSION,
        isValid: errors.length === 0,
        errors,
        warnings,
        blockedReason,
    };
}
