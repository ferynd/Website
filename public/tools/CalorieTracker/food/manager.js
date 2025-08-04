/**
 * @file src/food/manager.js
 * @description Handles the food management UI and logic, including the food manager modal,
 * editing, and deleting saved food items.
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
 * Deletes a food item from the saved foods database and removes it from the current day's log if present.
 * @param {string} foodId - The ID of the food item to delete.
 */
export async function deleteFoodItemFromManager(foodId) {
  const food = state.savedFoodItems.get(foodId);
  if (!food) return;

  showConfirmationModal(`Delete "${food.name}" from saved foods? This action is permanent and will also remove any instances of this food from today's log.`, async () => {
    try {
      const dateStr = state.dom.dateInput.value;
      const todayEntry = state.dailyEntries.get(dateStr) || { date: dateStr };
      let removedCount = 0;
      let needsSave = false;

      // Filter out the deleted food from today's log and subtract its nutrients.
      state.dailyFoodItems = state.dailyFoodItems.filter(item => {
        if (item.name === food.name) {
          allNutrients.forEach(n => {
            const currentTotal = parseFloat(todayEntry[n]) || 0;
            const itemValue = parseFloat(item[n]) || 0;
            todayEntry[n] = Math.max(0, currentTotal - itemValue);
          });
          removedCount++;
          needsSave = true;
          return false; // Remove from the array
        }
        return true; // Keep in the array
      });

      // Save the updated daily entry if any items were removed.
      if (needsSave) {
        await saveDailyEntry(dateStr, todayEntry);
      }

      // Delete the item from the main food database.
      await deleteFoodItem(foodId);

      showMessage(`Deleted "${food.name}" from saved foods${removedCount > 0 ? ` and subtracted ${removedCount} servings from today's totals` : ''}.`);

      // Refresh the food manager modal and the main UI.
      openFoodManager();
      updateDashboard();
      updateChart();
      updateFoodItemsList();
    } catch (e) {
      handleError('delete-food-manager', e, 'Failed to delete food item.');
    }
  });
}

/**
 * Closes the food manager modal.
 */
export function closeFoodManager() {
  document.getElementById('food-manager-modal').classList.add('hidden');
}
