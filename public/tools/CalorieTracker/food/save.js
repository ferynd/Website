/**
 * @file src/food/save.js
 * @description FIXED: Food saving workflow that preserves staging area for immediate use
 */

import { state } from '../state/store.js';
import { allNutrients } from '../constants.js';
import { showMessage, handleError, formatNutrientName } from '../utils/ui.js';
import { showConfirmationModal, closeDuplicateDialog } from '../ui/modals.js';
import { db } from '../services/firebase.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { appId } from '../config.js';
import { getStagedValues } from '../staging/parser.js';
import { selectFoodItem } from './manager.js';

// Configuration at top of file
const SAVE_CONFIG = {
  PRESERVE_STAGING_AFTER_SAVE: true, // NEW: Don't clear staging after successful save
  SUCCESS_MESSAGE_DURATION: 3000, // Show success message for 3 seconds
  DEBUG_SAVE_OPERATIONS: true // Log save operations for debugging
};

/**
 * UPDATED: Main function to save food item with preserved staging workflow
 */
export async function saveFoodItemToDatabase() {
  const foodNameInput = document.getElementById('food-item-input');
  let foodName = foodNameInput.value.trim();
  const stagedValues = getStagedValues();

  if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
    console.log('🍽️ [FOOD-SAVE] Starting save process:', { foodName, stagedValues });
  }

  // Handle blank food name
  if (!foodName) {
    handleBlankName(stagedValues);
    return;
  }

  // Handle existing food item (check for duplicates)
  const existingFood = Array.from(state.savedFoodItems.values()).find(f => f.name.toLowerCase() === foodName.toLowerCase());
  if (existingFood) {
    const hasDifferences = allNutrients.some(n => parseFloat(existingFood[n] || 0) !== parseFloat(stagedValues[n] || 0));
    if (hasDifferences) {
      showDuplicateDialog(existingFood, stagedValues, foodName);
      return;
    }
    // UPDATED: Show message but don't clear staging
    showMessage(`Food item "${foodName}" already exists with identical values. Ready to add to today's log!`, false, SAVE_CONFIG.SUCCESS_MESSAGE_DURATION);
    return;
  }

  // Process new food item
  await processSaveFoodItem(foodName, stagedValues);
}

/**
 * UPDATED: Save food item and preserve staging area
 */
async function processSaveFoodItem(foodName, stagedValues) {
  if (!state.userId) return showMessage('Cannot save food item. Not authenticated.', true);

  try {
    // Generate a consistent ID from the food name
    const foodId = foodName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const quantity = parseFloat(document.getElementById('actual-quantity')?.value) || 0;
    const foodData = { name: foodName, quantity, ...stagedValues, lastUpdated: new Date().toISOString() };

    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/foodItems`, foodId), foodData);
    state.savedFoodItems.set(foodId, foodData); // Update local state

    if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
      console.log('✅ [FOOD-SAVE] Successfully saved:', { foodId, foodData });
    }

    // UPDATED: Show success message but DON'T clear staging
    showMessage(`✅ "${foodName}" saved to database! Ready to add to today's log.`, false, SAVE_CONFIG.SUCCESS_MESSAGE_DURATION);
    
    // REMOVED: clearStagingArea() call - staging area is preserved for immediate use
    
  } catch (e) {
    handleError('save-food-item', e, 'Failed to save food item');
    
    if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
      console.error('❌ [FOOD-SAVE] Save failed:', e);
    }
  }
}

/**
 * UPDATED: Handle blank name workflow with preserved staging
 */
function handleBlankName(stagedValues) {
  const modal = state.dom.blankFoodNameModal;
  modal.classList.remove('hidden');
  document.getElementById('blank-food-name-input').value = '';
  document.getElementById('blank-food-name-prompt').classList.remove('hidden');
  document.getElementById('blank-food-name-input-container').classList.add('hidden');

  // Event Listeners for the Blank Name Modal
  document.getElementById('confirm-blank-name-btn').onclick = async () => {
    modal.classList.add('hidden');
    await processSaveFoodItem('(blank)', stagedValues);
  };
  
  document.getElementById('enter-name-btn').onclick = () => {
    document.getElementById('blank-food-name-prompt').classList.add('hidden');
    document.getElementById('blank-food-name-input-container').classList.remove('hidden');
    document.getElementById('blank-food-name-input').focus();
  };
  
  document.getElementById('submit-new-food-name-btn').onclick = async () => {
    const newName = document.getElementById('blank-food-name-input').value.trim();
    if (newName) {
      modal.classList.add('hidden');
      await processSaveFoodItem(newName, stagedValues);
    } else {
      showMessage('Please enter a name or choose to save as (blank).', true);
    }
  };
  
  document.getElementById('cancel-blank-name-btn').onclick = () => {
    modal.classList.add('hidden');
    document.getElementById('food-item-input').value = '';
  };
}

/**
 * UPDATED: Duplicate dialog workflow with preserved staging
 */
function showDuplicateDialog(existingFood, newValues, foodName) {
  const modal = state.dom.duplicateFoodModal;
  const container = document.getElementById('duplicate-comparison');
  const diffs = [];
  
  allNutrients.forEach(n => {
    const e = parseFloat(existingFood[n] || 0);
    const nv = parseFloat(newValues[n] || 0);
    if (e !== nv) {
      diffs.push({ nutrient: formatNutrientName(n), existing: e, new: nv, delta: nv - e });
    }
  });

  container.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">Food item "${foodName}" already exists with different values:</h3>
    <div class="overflow-x-auto mb-6">
      <table class="min-w-full bg-white border border-gray-300">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-2 border-b text-left">Nutrient</th>
            <th class="px-4 py-2 border-b text-center">Saved</th>
            <th class="px-4 py-2 border-b text-center">Current</th>
            <th class="px-4 py-2 border-b text-center">Delta</th>
          </tr>
        </thead>
        <tbody>
          ${diffs.map(d => `
            <tr>
              <td class="px-4 py-2 border-b font-medium">${d.nutrient}</td>
              <td class="px-4 py-2 border-b text-center">${d.existing.toFixed(1)}</td>
              <td class="px-4 py-2 border-b text-center">${d.new.toFixed(1)}</td>
              <td class="px-4 py-2 border-b text-center ${d.delta >= 0 ? 'text-green-600' : 'text-red-600'}">${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex gap-3 justify-center flex-wrap">
      <button id="dup-use-saved" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Use Saved Version</button>
      <button id="dup-replace" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Replace Saved</button>
      <button id="dup-keep-both" class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">Keep Both (Rename)</button>
      <button onclick="closeDuplicateDialog()" class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700">Cancel</button>
    </div>`;
  
  modal.classList.remove('hidden');

  // Event Listeners for the Duplicate Dialog
  document.getElementById('dup-use-saved').onclick = () => {
    selectFoodItem(foodName); // Populate staging with the saved version
    closeDuplicateDialog();
    showMessage(`Loaded saved version of "${foodName}" into staging area.`, false, SAVE_CONFIG.SUCCESS_MESSAGE_DURATION);
  };
  
  document.getElementById('dup-replace').onclick = async () => {
    await processSaveFoodItem(foodName, newValues); // Overwrite the saved version
    closeDuplicateDialog();
  };
  
  document.getElementById('dup-keep-both').onclick = () => {
    const currentName = document.getElementById('food-item-input').value.trim();
    showConfirmationModal(`Enter a new name for the current version (currently "${currentName}"):`,
      async (newName) => {
        if (newName && newName.trim() && newName.trim().toLowerCase() !== currentName.toLowerCase()) {
          closeDuplicateDialog();
          // Update the food name input and re-trigger save
          document.getElementById('food-item-input').value = newName.trim();
          await saveFoodItemToDatabase();
        } else {
          showMessage('Please enter a unique name.', true);
        }
      },
      null, true, `${currentName} (v2)`
    );
  };
}