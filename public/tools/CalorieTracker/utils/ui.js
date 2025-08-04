/**
 * @file src/utils/ui.js
 * @description Utility functions for common UI tasks like logging, showing messages, and handling errors.
 */

import { CONFIG } from '../config.js';
import { state } from '../state/store.js';

/**
 * Logs a message to the console if debug mode is enabled.
 * @param {string} ctx - The context of the log message (e.g., 'firebase-auth').
 * @param {string} msg - The message to log.
 * @param {*} [data=null] - Optional data to include in the log.
 */
export const debugLog = (ctx, msg, data = null) => {
  if (CONFIG.DEBUG_MODE) {
    console.log(`[NUTRITION-TRACKER][${ctx}]`, msg, data || '');
  }
};

/**
 * Displays a toast-style message at the bottom-right of the screen.
 * @param {string} text - The message text to display.
 * @param {boolean} [isError=false] - If true, the message will have a red background.
 * @param {number} [duration=5000] - The duration in milliseconds to show the message.
 */
export const showMessage = (text, isError = false, duration = 5000) => {
  const { messageText, messageBox } = state.dom;
  if (messageText && messageBox) {
    messageText.textContent = text;
    messageBox.classList.remove('hidden', 'bg-green-500', 'bg-red-500');
    messageBox.classList.add(isError ? 'bg-red-500' : 'bg-green-500');
    setTimeout(() => messageBox.classList.add('hidden'), duration);
  }
};

/**
 * Standardized error handler. Logs the full error and shows a user-friendly message.
 * @param {string} ctx - The context where the error occurred.
 * @param {Error} err - The error object.
 * @param {string} [userMsg='An error occurred'] - The message to show to the user.
 * @returns {null} Always returns null.
 */
export const handleError = (ctx, err, userMsg = 'An error occurred') => {
  console.error(`[NUTRITION-TRACKER][ERROR][${ctx}]`, err);
  showMessage(userMsg, true);
  return null;
};

/**
 * Formats a camelCase nutrient key into a human-readable string.
 * e.g., 'vitaminB12' becomes 'Vitamin B12'.
 * @param {string} name - The camelCase nutrient name.
 * @returns {string} The formatted name.
 */
export const formatNutrientName = (name) =>
  name.replace(/([A-Z])/g, ' $1').trim()
    .replace(/^vitamin/i, 'Vitamin ')
    .replace(/^omega/i, 'Omega-');
