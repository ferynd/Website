/* --- CONFIGURATION: Firestore namespaces --- */
/** Firebase-free namespace contract; changing tracker identity requires the documented migration. */

/** Root collection shared by every Firestore-backed tool. */
export const ROOT_COLLECTION = 'artifacts';
/** Recipe Standardizer's private recipe namespace. */
export const RECIPE_APP_ID = 'recipe-standardizer';
/**
 * ACCIDENTAL runtime fallback: the static tracker never sets window.__app_id (F-141).
 * Do not change independently: ARCHITECTURE.md → Nutrition Tracker namespace migration (F-141)
 * defines dual-read migration. Changing this alone disconnects every link and export.
 * A parity test pins this to public/tools/CalorieTracker/config.js.
 */
export const CALORIE_TRACKER_APP_ID = 'default-app-id';
