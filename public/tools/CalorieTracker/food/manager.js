/**
 * @file src/food/manager.js
 * @description FIXED: Food management that doesn't affect prior days when deleting saved foods
 */

import { state } from '../state/store.js';
import { allNutrients } from '../constants.js';
import { showConfirmationModal } from '../ui/modals.js';
import { saveDailyEntry, deleteFoodItem } from '../services/firebase.js';
import { updateFoodItemsList } from '../services/data.js';
import { showMessage, handleError } from '../utils/ui.js';
import { hideFoodDropdown } from './dropdown.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';

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
 * Removes a food item from the daily log for the current day.
 * @param {number} index - The index of the item in the `state.dailyFoodItems` array.
 */
export async function removeFoodItem(index) {
  if (index < 0 || index >= state.dailyFoodItems.length) return;

  const itemToRemove = state.dailyFoodItems[index];
  showConfirmationModal(`Remove "${itemToRemove.name || '(blank)'}"? This will subtract its nutrients from today's totals.`, async () => {
    try {
      const dateStr = state.dom.dateInput.value;
      const todayEntry = state.dailyEntries.get(dateStr) || { date: dateStr, foodItems: [] };

      // Subtract the nutrients of the removed item from the daily total.
      allNutrients.forEach(n => {
        const currentTotal = parseFloat(todayEntry[n]) || 0;
        const itemValue = parseFloat(itemToRemove[n]) || 0;
        todayEntry[n] = Math.max(0, currentTotal - itemValue);
      });

      // Remove the item from the local array and update the entry.
      state.dailyFoodItems.splice(index, 1);
      todayEntry.foodItems = state.dailyFoodItems;

      await saveDailyEntry(dateStr, todayEntry);
      showMessage(`Removed "${itemToRemove.name || '(blank)'}" and updated totals.`);

      // Refresh the UI to reflect the changes.
      updateDashboard();
      updateChart();
      updateFoodItemsList();
    } catch (e) {
      handleError('remove-food-item', e, 'Failed to remove food item.');
    }
  });
}

/**
 * Opens the food manager modal and populates it with a list of saved food items.
 */
export function openFoodManager() {
  const modal = document.getElementById('food-manager-modal');
  const container = document.getElementById('food-manager-list');
  const list = Array.from(state.savedFoodItems.entries()).sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

  container.innerHTML = list.map(([id, f]) => `
    <div class="flex justify-between items-center p-3 border-b border-gray-200">
      <div>
        <div class="font-medium">${f.name}</div>
        <div class="text-sm text-gray-500">Cal: ${f.calories || 0} | P: ${f.protein || 0} / C: ${f.carbs || 0} / F: ${f.fat || 0}</div>
      </div>
      <div class="flex gap-2">
        <button onclick="editFoodItem('${id}')" class="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Edit</button>
        <button onclick="deleteFoodItemFromManager('${id}')" class="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700">Delete</button>
      </div>
    </div>`).join('') || '<p class="text-gray-500 text-center p-4">No saved food items.</p>';

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
 * FIXED: Deletes a food item from the saved foods database ONLY.
 * This no longer affects any prior daily entries - only removes from the food database.
 * @param {string} foodId - The ID of the food item to delete.
 */
export async function deleteFoodItemFromManager(foodId) {
  const food = state.savedFoodItems.get(foodId);
  if (!food) return;

  showConfirmationModal(
    `Delete "${food.name}" from your saved foods database? This will only remove it from your food library and will NOT affect any previous daily logs.`, 
    async () => {
      try {
        // FIXED: Only delete from the food database - do not touch daily entries
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