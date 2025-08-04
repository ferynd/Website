/**
 * @file src/ui/modals.js
 * @description Manages the behavior of various modal dialogs in the application.
 */

import { state } from '../state/store.js';

/**
 * Shows a generic confirmation modal. Can also function as a prompt for text input.
 * @param {string} message - The message to display in the modal.
 * @param {function} onConfirm - The callback function to execute on confirmation. It receives the input value if it's a prompt.
 * @param {function|null} [onCancel=null] - An optional callback for cancellation.
 * @param {boolean} [isPrompt=false] - If true, an input field is shown.
 * @param {string} [defaultValue=''] - The default value for the prompt input.
 */
export function showConfirmationModal(message, onConfirm, onCancel = null, isPrompt = false, defaultValue = '') {
  const {
    confirmationModal,
    confirmationMessage,
    confirmActionButton,
    cancelActionButton,
    promptInput,
    promptInputContainer
  } = state.dom;

  if (!confirmationModal) return;

  confirmationMessage.textContent = message;
  promptInput.value = defaultValue;

  // Show or hide the text input field based on whether it's a prompt.
  if (isPrompt) {
    promptInputContainer.classList.remove('hidden');
    promptInput.focus();
  } else {
    promptInputContainer.classList.add('hidden');
  }

  confirmationModal.classList.remove('hidden');

  // Define event handlers and clean them up after use to prevent memory leaks.
  const handleConfirmClick = () => {
    const value = isPrompt ? promptInput.value.trim() : null;
    onConfirm(value);
    closeModal();
  };

  const handleCancelClick = () => {
    if (onCancel) onCancel();
    closeModal();
  };

  const closeModal = () => {
    confirmationModal.classList.add('hidden');
    confirmActionButton.removeEventListener('click', handleConfirmClick);
    cancelActionButton.removeEventListener('click', handleCancelClick);
  };

  // Attach event listeners.
  confirmActionButton.addEventListener('click', handleConfirmClick);
  cancelActionButton.addEventListener('click', handleCancelClick);
}

// --- Functions exposed to global scope for inline HTML `onclick` handlers ---

/**
 * Closes the "Blank Food Name" modal and resets its state.
 */
export function closeBlankFoodNameModal() {
  const modal = document.getElementById('blank-food-name-modal');
  if (!modal) return;
  modal.classList.add('hidden');

  // Reset the input and visibility of internal components.
  const input = document.getElementById('blank-food-name-input');
  input.value = '';
  document.getElementById('blank-food-name-prompt').classList.remove('hidden');
  document.getElementById('blank-food-name-input-container').classList.add('hidden');
}

/**
 * Closes the "Duplicate Food" comparison dialog.
 */
export function closeDuplicateDialog() {
  const modal = document.getElementById('duplicate-food-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}
