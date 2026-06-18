/**
 * @file src/food/manager.js
 * @description Food database management — select, edit, and delete saved food items without
 * touching prior daily entries.
 */

import { state } from '../state/store.js';
import { allNutrients } from '../constants.js';
import { showConfirmationModal } from '../ui/modals.js';
import { saveDailyEntry, deleteFoodItem } from '../services/firebase.js';
import { updateFoodItemsList, getCurrentDailyEntry } from '../services/data.js';
import { showMessage, handleError, escapeHtml, showUndoToast, flushPendingUndo } from '../utils/ui.js';
import { hideFoodDropdown } from './dropdown.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';

// Configuration
const MANAGER_CONFIG = {
  DEFAULT_QUANTITY: 1
};

/**
 * Populates the staging area input fields with data from a selected food item.
 * @param {object} foodData - The food item data object.
 */
export function populateStagingFromFood(foodData) {
  allNutrients.forEach(n => {
    const input = document.getElementById(`actual-${n}`);
    if (input && foodData[n] !== undefined) {
      input.value = foodData[n];
    }
  });

  const qInput = document.getElementById('actual-quantity');
  if (qInput) qInput.value = foodData.quantity ?? MANAGER_CONFIG.DEFAULT_QUANTITY;
}

/**
 * Selects a food item from the dropdown, populating the staging area.
 * This function is called from the dropdown's `onclick` handler.
 * @param {string} foodName - The name of the food to select.
 */
export function selectFoodItem(foodName) {
  const foodData = Array.from(state.savedFoodItems.values()).find(f => f.name === foodName);
  if (foodData) {
    document.getElementById('food-item-input').value = foodName;
    populateStagingFromFood(foodData);
    hideFoodDropdown();
  }
}

/**
 * Removes a food item from the daily log with a 5-second undo window.
 * @param {number} index - The index of the item in the `state.dailyFoodItems` array.
 */
export function removeFoodItem(index) {
  if (index < 0 || index >= state.dailyFoodItems.length) return;

  flushPendingUndo();

  const itemToRemove = state.dailyFoodItems[index];
  const dateStr = state.dom.dateInput.value;
  const todayEntry = getCurrentDailyEntry();

  const savedTotals = {};
  allNutrients.forEach(n => { savedTotals[n] = parseFloat(todayEntry[n]) || 0; });

  allNutrients.forEach(n => {
    const qty = parseFloat(itemToRemove.quantity ?? 0) || 0;
    const itemValue = qty * (parseFloat(itemToRemove[n]) || 0);
    todayEntry[n] = Math.max(0, (parseFloat(todayEntry[n]) || 0) - itemValue);
  });

  state.dailyFoodItems.splice(index, 1);
  todayEntry.foodItems = state.dailyFoodItems;

  updateDashboard();
  updateChart();
  updateFoodItemsList();

  showUndoToast(
    `Removed "${itemToRemove.name || '(blank)'}"`,
    () => {
      allNutrients.forEach(n => { todayEntry[n] = savedTotals[n]; });
      state.dailyFoodItems.splice(index, 0, itemToRemove);
      todayEntry.foodItems = state.dailyFoodItems;
      updateDashboard();
      updateChart();
      updateFoodItemsList();
      showMessage('Deletion undone.');
    },
    async () => {
      try {
        await saveDailyEntry(dateStr, todayEntry);
      } catch (e) {
        allNutrients.forEach(n => { todayEntry[n] = savedTotals[n]; });
        state.dailyFoodItems.splice(index, 0, itemToRemove);
        todayEntry.foodItems = state.dailyFoodItems;
        updateDashboard();
        updateChart();
        updateFoodItemsList();
        handleError('remove-food-item', e, 'Failed to remove food item.');
      }
    }
  );
}

/**
 * Opens the food manager modal and populates it with a list of saved food items.
 */
export function openFoodManager() {
  const modal = document.getElementById('food-manager-modal');
  const container = document.getElementById('food-manager-list');
  const list = Array.from(state.savedFoodItems.entries()).sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

  container.innerHTML = list.map(([id, f]) => `
    <div class="flex justify-between items-center p-3 border-b border-default">
      <div>
        <div class="font-medium">${escapeHtml(f.name)}</div>
        <div class="text-sm text-muted">Cal: ${f.calories || 0} | P: ${f.protein || 0} / C: ${f.carbs || 0} / F: ${f.fat || 0} | Qty: ${f.quantity ?? 0}</div>
      </div>
      <div class="flex gap-2">
        <button onclick="editFoodItem('${id}')" class="btn btn-primary text-sm">Edit</button>
        <button onclick="deleteFoodItemFromManager('${id}')" class="btn btn-danger icon-btn" aria-label="Delete" title="Delete">&times;</button>
      </div>
    </div>`).join('') || '<p class="text-muted text-center p-4">No saved food items.</p>';

  modal.classList.remove('hidden');
}

/**
 * Loads a saved food item's data into the staging area for editing.
 * @param {string} foodId - The ID of the food item to edit.
 */
export function editFoodItem(foodId) {
  const food = state.savedFoodItems.get(foodId);
  if (food) {
    document.getElementById('food-item-input').value = food.name;
    populateStagingFromFood(food);
    document.getElementById('food-manager-modal').classList.add('hidden');
    showMessage(`Loaded "${food.name}" for editing. Modify values and "Save Food Item" to update.`);
  }
}

/**
 * Deletes a food item from the saved foods database.
 * Daily entries that previously referenced this food are unaffected.
 * @param {string} foodId - The ID of the food item to delete.
 */
export async function deleteFoodItemFromManager(foodId) {
  const food = state.savedFoodItems.get(foodId);
  if (!food) return;

  showConfirmationModal(
    `Delete "${food.name}" from your saved foods database? This will only remove it from your food library and will NOT affect any previous daily logs.`,
    async () => {
      try {
        await deleteFoodItem(foodId);

        showMessage(`Deleted "${food.name}" from your saved foods database. Your historical daily logs are unchanged.`);

        // Refresh only the food manager modal
        openFoodManager();
        
      } catch (e) {
        handleError('delete-food-manager', e, 'Failed to delete food item from database.');
      }
    }
  );
}

/**
 * Closes the food manager modal.
 */
export function closeFoodManager() {
  document.getElementById('food-manager-modal').classList.add('hidden');
}