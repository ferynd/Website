/**
 * @file state/schema.js
 * @description Pure schema normalization and save-preparation functions.
 *
 * RULES FOR THIS MODULE:
 *   - No Firebase imports (no CDN URLs, no db/auth references).
 *   - No DOM access.
 *   - No state mutations.
 *   - Only imports from ../constants.js.
 *
 * Every function is a pure transform: it takes plain data, returns plain data.
 * Nothing here writes to Firestore or changes global state — those are the
 * callers' responsibilities.
 */

import {
  SCHEMA_VERSIONS,
  DEFAULT_USER_PROFILE,
  DEFAULT_GOAL_SETTINGS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// Internal defaults
// ---------------------------------------------------------------------------

/**
 * Default shape for an estimateMeta object.
 * When an existing estimateMeta is partially formed, it is merged with this
 * so every field is always present.
 */
const DEFAULT_ESTIMATE_META = {
  method: null,
  modelVersion: null,
  confidence: null,
  sourceDataWindow: null,
  createdAt: null,
  updatedAt: null,
  locked: false,
  previousEstimate: null,
};

// ---------------------------------------------------------------------------
// normalizeEntry
// ---------------------------------------------------------------------------

/**
 * Normalize a raw daily entry to the current v2 in-memory schema.
 *
 * Guarantees:
 *   - All legacy fields (calories, protein, carbs, fat, trainingBump, foodItems,
 *     and any custom fields) are preserved unchanged.
 *   - schemaVersion is set to SCHEMA_VERSIONS.ENTRY in memory, reflecting the
 *     upgraded shape.  The original stored value (if < current) is kept as
 *     _storedSchemaVersion for diagnostics; prepareEntryForSave() strips it
 *     before writing to Firestore.
 *   - Missing v2 fields are filled with safe defaults (nulls and empty arrays).
 *   - If estimateMeta is already an object, it is merged with DEFAULT_ESTIMATE_META
 *     so every sub-field is present.
 *   - Safe to call multiple times (idempotent).
 *
 * Schema history:
 *   v0 / absent — original shape: macros + trainingBump + foodItems only
 *   v1           — intermediate; schemaVersion was never written to Firestore
 *   v2 (current) — adds entryType, exerciseSessions, dayActivityLevel,
 *                  vacationDayType, estimateMeta, manualLock,
 *                  calorieAdjustmentItems
 *
 * @param {object} entry - Raw entry from Firestore (or any schema version).
 * @returns {object} Entry with all v2 fields present.
 */
export function normalizeEntry(entry) {
  if (!entry) return entry;
  const out = { ...entry };

  // Capture original stored version if it is older than the current schema,
  // so callers can distinguish "this was stored as v0" without inspecting an
  // in-memory schemaVersion of 2.
  const storedVersion = out.schemaVersion;
  if (
    out._storedSchemaVersion === undefined &&
    storedVersion !== undefined &&
    storedVersion < SCHEMA_VERSIONS.ENTRY
  ) {
    out._storedSchemaVersion = storedVersion;
  }
  // In-memory version always reflects the current upgraded shape.
  out.schemaVersion = SCHEMA_VERSIONS.ENTRY;

  // Legacy entries were manually logged.
  if (out.entryType === undefined) out.entryType = 'logged';

  // Array fields — always arrays, never undefined/null.
  if (!Array.isArray(out.foodItems)) out.foodItems = [];
  if (!Array.isArray(out.exerciseSessions)) out.exerciseSessions = [];
  if (!Array.isArray(out.calorieAdjustmentItems)) out.calorieAdjustmentItems = [];

  // Nullable scalars.
  if (out.dayActivityLevel === undefined) out.dayActivityLevel = null;
  if (out.vacationDayType === undefined) out.vacationDayType = null;

  // Boolean.
  if (out.manualLock === undefined) out.manualLock = false;

  // estimateMeta:
  //   - absent → null (non-estimate entries have no meta)
  //   - null   → null (explicit null kept as-is)
  //   - object → merged with DEFAULT_ESTIMATE_META so every sub-field exists
  if (out.estimateMeta === undefined) {
    out.estimateMeta = null;
  } else if (out.estimateMeta !== null && typeof out.estimateMeta === 'object') {
    out.estimateMeta = { ...DEFAULT_ESTIMATE_META, ...out.estimateMeta };
  }

  return out;
}

// ---------------------------------------------------------------------------
// normalizeUserProfile / normalizeGoalSettings
// ---------------------------------------------------------------------------

/**
 * Normalize a raw userProfile document, filling every missing field with its
 * default value.  Safe to call on an empty object (first-time user).
 * @param {object} raw - Raw Firestore document or {}.
 * @returns {object} Profile with all DEFAULT_USER_PROFILE fields present.
 */
export function normalizeUserProfile(raw) {
  return { ...DEFAULT_USER_PROFILE, ...(raw || {}) };
}

/**
 * Normalize a raw goalSettings document, filling every missing field with its
 * default value.
 *
 * manualTargetOverrides is key-merged (not replaced) so that no existing
 * per-nutrient override is silently dropped.
 *
 * @param {object} raw - Raw Firestore document or {}.
 * @returns {object} Goal settings with all DEFAULT_GOAL_SETTINGS fields present.
 */
export function normalizeGoalSettings(raw) {
  const base = { ...DEFAULT_GOAL_SETTINGS };
  if (!raw || Object.keys(raw).length === 0) return base;
  return {
    ...base,
    ...raw,
    manualTargetOverrides: {
      ...base.manualTargetOverrides,
      ...(raw.manualTargetOverrides || {}),
    },
  };
}

// ---------------------------------------------------------------------------
// prepareEntryForSave
// ---------------------------------------------------------------------------

/**
 * Prepare a daily entry for writing to Firestore.
 *
 * - Runs normalizeEntry() to ensure all v2 fields are present.
 * - Forces schemaVersion to SCHEMA_VERSIONS.ENTRY on the saved document.
 * - Strips _storedSchemaVersion (diagnostic-only, must not be persisted).
 * - Does NOT mutate the incoming object.
 *
 * @param {object} entry     - Entry to prepare (any schema version).
 * @param {object} [opts={}] - Optional field overrides applied before normalization.
 *                             e.g. { entryType: 'estimate' }
 * @returns {object} A new, save-ready entry with all v2 fields.
 */
export function prepareEntryForSave(entry, opts = {}) {
  const merged = { ...entry, ...opts };
  const normalized = normalizeEntry(merged);
  // Strip diagnostic-only field — never persist it to Firestore.
  const { _storedSchemaVersion, ...toSave } = normalized;
  return toSave;
}

// ---------------------------------------------------------------------------
// prepareProfileForSave
// ---------------------------------------------------------------------------

/**
 * Prepare a user profile object for writing to Firestore.
 *
 * Merges in order: defaults → current state → incoming data, so the caller's
 * explicit values always win without wiping fields they didn't include.
 * Forces schemaVersion to SCHEMA_VERSIONS.PROFILE.
 *
 * @param {object} incoming  - Partial or full profile from a save form / API call.
 * @param {object} [current] - state.userProfile (already normalized).  Pass {} for new users.
 * @returns {object} Save-ready profile with every field present.
 */
export function prepareProfileForSave(incoming, current = {}) {
  return {
    ...DEFAULT_USER_PROFILE,
    ...current,
    ...incoming,
    schemaVersion: SCHEMA_VERSIONS.PROFILE,
  };
}

// ---------------------------------------------------------------------------
// prepareGoalSettingsForSave
// ---------------------------------------------------------------------------

/**
 * Prepare a goal settings object for writing to Firestore.
 *
 * Merges manualTargetOverrides carefully (three-way merge: defaults → current
 * state → incoming) so no existing per-nutrient key is ever dropped.
 * Forces schemaVersion to SCHEMA_VERSIONS.GOAL.
 *
 * @param {object} incoming    - Partial or full goal settings from a save form / API call.
 * @param {object} [current]   - state.goalSettings (already normalized).  Pass {} for new users.
 * @param {object} [opts]      - Options: { replaceOverrides: boolean }
 *   replaceOverrides: when true, uses incoming.manualTargetOverrides directly (no merge),
 *   allowing callers to clear previously-saved override keys. Default: false (safe merge).
 * @returns {object} Save-ready goal settings with every field present.
 */
export function prepareGoalSettingsForSave(incoming, current = {}, opts = {}) {
  const result = {
    ...DEFAULT_GOAL_SETTINGS,
    ...current,
    ...incoming,
    manualTargetOverrides: opts.replaceOverrides
      ? (incoming.manualTargetOverrides ?? {})
      : {
          ...(DEFAULT_GOAL_SETTINGS.manualTargetOverrides),
          ...(current.manualTargetOverrides || {}),
          ...(incoming.manualTargetOverrides || {}),
        },
    schemaVersion: SCHEMA_VERSIONS.GOAL,
  };
  return result;
}
