import { canonicalJson, sha256Hex } from '../contentHash.js';
import { normalizeSourceResult } from './sourceResult.js';

export function getFdaRoundingInterval(key, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (key === 'calories') {
    if (value <= 50) return 5;
    return 10;
  }
  if (['fat', 'fatSaturated', 'fatTrans'].includes(key)) {
    if (value < 5) return 0.5;
    return 1;
  }
  if (key === 'sodium') {
    if (value <= 140) return 5;
    return 10;
  }
  if (key === 'cholesterol') {
    return 5;
  }
  if (['carbs', 'fiber', 'fiberTotal', 'sugarsTotal', 'sugarsAdded', 'protein'].includes(key)) {
    if (value < 1) return 0.5;
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
          sourceId: context.manualRecord.recordId || 'manual-entry',
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

      const nutrients = [];
      for (const [key, item] of Object.entries(raw.nutrients || {})) {
        if (item === null || item === undefined) continue;

        let amount = null;
        let status = 'measured';
        let comparatorRef = undefined;
        let derivation = undefined;
        let upperBound = undefined;

        if (typeof item === 'number') {
          amount = item;
        } else if (typeof item === 'object') {
          amount = item.value ?? null;
          status = item.status || 'measured';
          comparatorRef = item.comparatorRef;
          derivation = item.derivation;
          upperBound = item.upperBound;

          if (status === 'estimated_from_comparable' && !comparatorRef && !derivation) {
            throw new Error(
              `Manual estimate for ${key} requires a comparatorRef or derivation`
            );
          }
        }

        nutrients.push({
          key,
          amount,
          status,
          comparatorRef,
          derivation,
          upperBound,
        });
      }

      const checksum = 'sha256:' + (await sha256Hex(canonicalJson(raw)));
      const sourceRecord = {
        type: 'manual',
        datasetId: raw.datasetId || 'manual-input',
        recordId: String(raw.recordId || 'manual-entry'),
        title: raw.title || 'Manual Entry',
        version: raw.version || '1',
        publishedAt: raw.publishedAt,
        accessedAt: raw.accessedAt || new Date().toISOString().slice(0, 10),
        originalBasis: 'per_100g_edible',
        permittedUse: raw.permittedUse || 'permitted_review',
        checksum,
      };

      return {
        type: 'manual',
        recordId: sourceRecord.recordId,
        sourceRecord,
        nutrients,
        portions: raw.portions || [],
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
          sourceId: context.labelRecord.recordId || 'label-entry',
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
        if (val === null || val === undefined) continue;

        let numVal = typeof val === 'number' ? val : Number(val.value);
        if (!Number.isFinite(numVal)) continue;

        const interval = getFdaRoundingInterval(key, numVal);
        nutrients.push({
          key,
          amount: numVal,
          status: 'label_reported',
          roundingInterval: interval,
        });
      }

      const checksum = 'sha256:' + (await sha256Hex(canonicalJson(raw)));
      const sourceRecord = {
        type: 'label',
        datasetId: raw.brand || 'Nutrition Facts Label',
        recordId: String(raw.recordId || 'label-1'),
        title: raw.title || raw.productName || 'Nutrition Facts Label',
        version: raw.version || '1',
        publishedAt: raw.publishedAt,
        accessedAt: raw.accessedAt || new Date().toISOString().slice(0, 10),
        originalBasis: raw.servingSize
          ? `per_serving_${raw.servingSize}${raw.servingSizeUnit || 'g'}`
          : 'per_100g_edible',
        permittedUse: raw.permittedUse || 'Fair use / factual nutrition data',
        checksum,
      };

      return {
        type: 'label',
        recordId: sourceRecord.recordId,
        sourceRecord,
        nutrients,
        portions: raw.portions || [],
        servingSize: raw.servingSize !== undefined ? Number(raw.servingSize) : null,
        servingSizeUnit: raw.servingSizeUnit || null,
        checksum,
      };
    },
  };
}
