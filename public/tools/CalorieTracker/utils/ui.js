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

/**
 * Escapes HTML-special characters so user-controlled strings (e.g. food names)
 * can be safely interpolated into `innerHTML`. Food names are user input and
 * must never be rendered as raw HTML — doing so is an XSS vector. Prefer
 * `textContent`/DOM nodes where practical; use this for template-literal blocks
 * that remain string-based.
 * @param {*} value - The value to escape (coerced to string; null/undefined → '').
 * @returns {string} The escaped string.
 */
export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

import { NUTRIENT_MAX_BOUNDS } from '../constants.js';

let _undoTimer = null;
let _pendingCommit = null;

function flushPendingUndo() {
  if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
  if (_pendingCommit) { const fn = _pendingCommit; _pendingCommit = null; fn(); }
}

/**
 * Shows a 5-second undo toast. If the user clicks Undo, onUndo runs and the
 * pending action is cancelled. Otherwise onCommit fires after the delay.
 * If a previous undo toast is still pending, its onCommit runs immediately
 * before the new toast is shown.
 */
export function showUndoToast(text, onUndo, onCommit, duration = 5000) {
  const toast = document.getElementById('undo-toast');
  const label = document.getElementById('undo-toast-text');
  const btn   = document.getElementById('undo-toast-btn');
  if (!toast || !label || !btn) return;

  flushPendingUndo();

  _pendingCommit = onCommit;
  label.textContent = text;
  toast.classList.remove('hidden');

  const cleanup = () => {
    toast.classList.add('hidden');
    btn.removeEventListener('click', handleUndo);
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
  };

  const handleUndo = () => {
    _pendingCommit = null;
    cleanup();
    onUndo();
  };

  btn.replaceWith(btn.cloneNode(true));
  const freshBtn = document.getElementById('undo-toast-btn');
  freshBtn.addEventListener('click', handleUndo);

  _undoTimer = setTimeout(() => {
    const fn = _pendingCommit;
    _pendingCommit = null;
    cleanup();
    if (fn) fn();
  }, duration);
}

/**
 * Clamps a nutrient value to [0, max] and warns the user if the raw value
 * exceeded the bound. Returns the clamped number.
 * @param {string} nutrient - The canonical nutrient key (e.g. 'calories').
 * @param {number} raw - The raw parsed value.
 * @returns {number} The value clamped to [0, NUTRIENT_MAX_BOUNDS[nutrient]].
 */
export function clampNutrient(nutrient, raw) {
  if (Number.isNaN(raw)) return 0;
  const max = NUTRIENT_MAX_BOUNDS[nutrient];
  if (max != null && raw > max) {
    showMessage(`${formatNutrientName(nutrient)} clamped to ${max} (entered ${raw}).`, true);
    return max;
  }
  return Math.max(0, raw);
}
