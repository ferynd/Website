import { extractStateWords } from './fdcFood.js';
import { getNutrient, NUTRIENT_STATUSES } from '../nutrientRegistry.js';
import { canonicalJson, sha256Hex } from '../contentHash.js';
// Hash the canonical input before adding access dates or other runtime defaults.
// Canonical JSON normalizes object-key order while retaining all supplied evidence.
async function inlineRecordId(type, raw) {
    return String(raw.recordId || `${type}-sha256:${await sha256Hex(canonicalJson(raw))}`);
}
export function getFdaRoundingInterval(key, value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return undefined;
    if (key === 'calories') {
        if (value <= 50)
            return 5;
        return 10;
    }
    if (['fat', 'fatSaturated', 'fatTrans'].includes(key)) {
        if (value < 5)
            return 0.5;
        return 1;
    }
    if (key === 'sodium') {
        if (value <= 140)
            return 5;
        return 10;
    }
    if (key === 'cholesterol') {
        return 5;
    }
    if (['carbs', 'fiber', 'fiberTotal', 'sugarsTotal', 'sugarsAdded', 'protein'].includes(key)) {
        if (value < 1)
            return 0.5;
        return 1;
    }
    return value === 0 ? 1 : undefined;
}
export function createManualAdapter() {
    return {
        id: 'manual',
        scope: ['curated', 'private'],
        runsIn: ['browser', 'cli'],
        requiresSecret: false,
        async release() {
            return 'manual-v1';
        },
        async match(target, context = {}) {
            if (context.manualRecord) {
                return {
                    sourceAdapter: 'manual',
                    sourceId: await inlineRecordId('manual', context.manualRecord),
                    matchConfidence: 1.0,
                    matchType: 'exact',
                };
            }
            return null;
        },
        async fetch(recordId, context = {}) {
            if (context.manualRecord) {
                return context.manualRecord;
            }
            throw new Error(`Manual record not found in context for id: ${recordId}`);
        },
        async toSourceResult(raw, context = {}) {
            if (!raw || typeof raw !== 'object') {
                throw new TypeError('Invalid manual record: expected object');
            }
            if (!raw.source || typeof raw.source !== 'object')
                throw new TypeError('Source record required');
            const nutrients = [];
            for (const [key, item] of Object.entries(raw.nutrients || {})) {
                if (item === null || item === undefined)
                    continue;
                let amount = null;
                let status = 'measured';
                let comparatorRef = undefined;
                let derivation = undefined;
                let upperBound = undefined;
                if (typeof item === 'number') {
                    throw new TypeError('Manual observation requires explicit status and unit');
                }
                else if (typeof item === 'object') {
                    amount = item.value ?? null;
                    status = item.status;
                    comparatorRef = item.comparatorRef;
                    derivation = item.transferReason ? (item.derivation || 'comparable') + ': ' + item.transferReason : item.derivation;
                    upperBound = item.upperBound;
                    if (status === 'estimated_from_comparable' && (!comparatorRef || !item.transferReason || !item.range)) {
                        throw new Error(`Manual estimate for ${key} requires a comparatorRef, transferReason and range`);
                    }
                }
                if (!NUTRIENT_STATUSES.includes(status) || (amount !== null && (!Number.isFinite(amount) || amount < 0)))
                    throw new TypeError('Invalid manual observation: ' + key);
                nutrients.push({
                    key,
                    unit: item.unit || getNutrient(key)?.unit,
                    range: item.range,
                    amount,
                    status,
                    comparatorRef,
                    derivation,
                    upperBound,
                });
            }
            const checksum = 'sha256:' + (await sha256Hex(canonicalJson(raw)));
            const sourceRecord = {
                ...raw.source,
                type: raw.source.type || 'manual',
                datasetId: raw.datasetId || 'manual-input',
                recordId: await inlineRecordId('manual', raw),
                title: raw.title || raw.source.title || 'Manual Entry',
                version: raw.version || raw.source?.version || '1',
                publishedAt: raw.publishedAt,
                accessedAt: raw.accessedAt || raw.source?.accessedAt || new Date().toISOString().slice(0, 10),
                originalBasis: 'per_100g_edible',
                permittedUse: raw.permittedUse || raw.source.permittedUse || 'permitted_review',
                checksum,
            };
            for (const k of Object.keys(sourceRecord))
                if (sourceRecord[k] === undefined)
                    delete sourceRecord[k];
            return {
                type: 'manual',
                recordId: sourceRecord.recordId,
                sourceRecord,
                nutrients,
                portions: raw.portions || [],
                extractedStateWords: extractStateWords([raw.state, raw.description, raw.title].filter(Boolean).join(' ')),
                checksum,
            };
        },
    };
}
export function createLabelAdapter() {
    return {
        id: 'label',
        scope: ['curated', 'private'],
        runsIn: ['browser', 'cli'],
        requiresSecret: false,
        async release() {
            return 'label-v1';
        },
        async match(target, context = {}) {
            if (context.labelRecord) {
                return {
                    sourceAdapter: 'label',
                    sourceId: await inlineRecordId('label', context.labelRecord),
                    matchConfidence: 1.0,
                    matchType: 'exact',
                };
            }
            return null;
        },
        async fetch(recordId, context = {}) {
            if (context.labelRecord) {
                return context.labelRecord;
            }
            throw new Error(`Label record not found in context for id: ${recordId}`);
        },
        async toSourceResult(raw, context = {}) {
            if (!raw || typeof raw !== 'object') {
                throw new TypeError('Invalid label record: expected object');
            }
            // Check curated photo restrictions
            if (context.scope === 'curated' && raw.photos?.length) {
                throw new Error('Photos cannot enter curated data');
            }
            const nutrients = [];
            for (const [key, val] of Object.entries(raw.nutrients || {})) {
                if (val === null || val === undefined)
                    continue;
                const numVal = typeof val === 'number' ? val : val.value;
                if (!Number.isFinite(numVal) || numVal < 0)
                    throw new TypeError('Invalid label number: ' + key);
                const interval = getFdaRoundingInterval(key, numVal);
                nutrients.push({
                    key,
                    amount: numVal,
                    unit: val.unit || getNutrient(key)?.unit,
                    status: 'label_reported',
                    roundingInterval: interval,
                });
            }
            const per100g = raw.originalBasis === 'per_100g_edible';
            if (!per100g && raw.servingSize == null)
                throw new TypeError('Label requires an explicit serving basis: positive gram servingSize and servingSizeUnit, or originalBasis per_100g_edible');
            if (!per100g && (!Number.isFinite(raw.servingSize) || raw.servingSize <= 0))
                throw new TypeError('Label servingSize must be a positive number');
            const originalBasis = per100g ? 'per_100g_edible' : `per_serving_${raw.servingSize}${raw.servingSizeUnit || ''}`;
            const checksum = 'sha256:' + (await sha256Hex(canonicalJson(raw)));
            const sourceRecord = {
                type: 'label',
                datasetId: raw.brand || 'Nutrition Facts Label',
                recordId: await inlineRecordId('label', raw),
                title: raw.title || raw.productName || 'Nutrition Facts Label',
                version: raw.version || raw.source?.version || '1',
                publishedAt: raw.publishedAt,
                accessedAt: raw.accessedAt || raw.source?.accessedAt || new Date().toISOString().slice(0, 10),
                originalBasis,
                permittedUse: raw.permittedUse || 'Fair use / factual nutrition data',
                checksum,
            };
            for (const k of Object.keys(sourceRecord))
                if (sourceRecord[k] === undefined)
                    delete sourceRecord[k];
            return {
                type: 'label',
                originalBasis,
                recordId: sourceRecord.recordId,
                sourceRecord,
                nutrients,
                portions: raw.portions || [],
                extractedStateWords: extractStateWords([raw.state, raw.description, raw.title].filter(Boolean).join(' ')),
                servingSize: raw.servingSize !== undefined ? raw.servingSize : null,
                servingSizeUnit: raw.servingSizeUnit || null,
                checksum,
            };
        },
    };
}
