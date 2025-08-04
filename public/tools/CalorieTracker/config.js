/**
 * @file src/config.js
 * @description Central configuration file for the application.
 * Contains constants that can be easily modified to change app behavior.
 */

// Main application configuration object
export const CONFIG = {
  // Timezone for date calculations to ensure consistency.
  TIMEZONE: 'America/Chicago',

  // Default nutrient to display in the chart on initial load.
  DEFAULT_CHART_NUTRIENT: 'calories',

  // Default timeframe for the chart (e.g., 'week', 'month').
  DEFAULT_CHART_TIMEFRAME: 'week',

  // Default minimum grams of fat for macro calculations if not set by the user.
  DEFAULT_FAT_MINIMUM: 50,

  // Array of hex color codes for the chart datasets.
  CHART_COLORS: ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'],

  // Number of previous days to look back for calculating rolling averages in the chart.
  CHART_AVERAGE_LOOKBACK: 3,

  // Minimum number of characters required to trigger the food search.
  SEARCH_MIN_CHARS: 1,

  // Debounce time in milliseconds for the food search to avoid excessive API calls.
  SEARCH_DEBOUNCE_MS: 300,

  // Maximum number of items to display in the food search dropdown.
  MAX_DROPDOWN_ITEMS: 10,

  // Flag to enable or disable console logging for debugging.
  DEBUG_MODE: true,

  // Duration for UI animations in milliseconds.
  ANIMATION_DURATION: 300,
};

// Unique application ID, retrieved from the global window scope if available (for Canvas environment).
// Falls back to a default ID if not found.
export const appId = typeof window !== 'undefined' && typeof window.__app_id !== 'undefined'
  ? window.__app_id
  : 'default-app-id';
