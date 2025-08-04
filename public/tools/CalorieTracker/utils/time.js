/**
 * @file src/utils/time.js
 * @description Utility functions for date and time manipulation.
 */

import { CONFIG } from '../config.js';

/**
 * Formats a Date object into a 'YYYY-MM-DD' string.
 * @param {Date} date - The date to format.
 * @returns {string} The formatted date string.
 */
export const formatDate = (date) => date.toISOString().split('T')[0];

/**
 * Gets today's date as a 'YYYY-MM-DD' string in the specified timezone.
 * Falls back to the local timezone if the specified one is invalid.
 * @returns {string} Today's date string.
 */
export const getTodayInTimezone = () => {
  try {
    // 'en-CA' format is 'YYYY-MM-DD', which is ideal for date inputs.
    return new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.TIMEZONE });
  } catch {
    // Fallback for environments where the timezone might not be supported.
    return formatDate(new Date());
  }
};

/**
 * Calculates a date in the past by subtracting a number of days.
 * @param {Date} date - The starting date.
 * @param {number} days - The number of days to subtract.
 * @returns {Date} The new Date object representing the past date.
 */
export const getPastDate = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
};
