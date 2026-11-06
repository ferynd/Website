/**
 * @file food/save.js
 * @description Food saving workflow. The staging area is preserved after a save so the
 * user can immediately add the food to today's log without re-entering values.
 */

import { state, parseQty } from '../state/store.js';
import { showMessage, handleError, formatNutrientName, escapeHtml, flashSaveConfirmation, transactionFailureMessage } from '../utils/ui.js';
import { showConfirmationModal, closeDuplicateDialog } from '../ui/modals.js';
import { db } from '../services/firebase.js';
import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { appId } from '../config.js';
import { getStagedRecord, rememberStagedFoodName } from '../staging/parser.js';
import { selectFoodItem } from './manager.js';
import { resolveNutrientWriteVersion } from '../../../shared/nutrition/capabilities.js';
import { LEGACY_V1_KEYS, getNutrient } from '../../../shared/nutrition/nutrientRegistry.js';
import { NewerSchemaError, NutrientBoundsError, assessFoodSave, commitSavedFoodWrite, readFoodNutrients, targetsFromStagedRecord, v1StorageNotice } from '../nutrition/nutrientRecord.js';

const SAVE_CONFIG = {
  SUCCESS_MESSAGE_DURATION: 3000,
  DEBUG_SAVE_OPERATIONS: false,
};

/**
 * Main entry point: save the current staging area as a food item.
 */
export async function saveFoodItemToDatabase() {
  const foodNameInput = document.getElementById('food-item-input');
  let foodName = foodNameInput.value.trim();
  const record = getStagedRecord();
  if (record.conflicts.length) {
    showMessage('Resolve conflicting nutrient values before saving.', true);
    return;
  }

  if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
    console.log('🍽️ [FOOD-SAVE] Starting save process:', { foodName, record });
  }

  if (!foodName) {
    handleBlankName(record);
    return;
  }

  const existingFood = Array.from(state.savedFoodItems.values()).find(f => f.name.toLowerCase() === foodName.toLowerCase());
  if (existingFood) {
    const assessment = assessFoodSave(existingFood, record, resolveNutrientWriteVersion());
    if (assessment.newerSchema) {
      showMessage('This food was saved by a newer version — reload.', true);
      return;
    }
    if (!assessment.identical) {
      showDuplicateDialog(existingFood, record, foodName);
      return;
    }
    showMessage(`Food item "${foodName}" already exists with identical values. Ready to add to today's log!`, false, SAVE_CONFIG.SUCCESS_MESSAGE_DURATION);
    return;
  }

  await processSaveFoodItem(foodName, record);
}

/**
 * Persist a new food item to Firestore and update local state.
 * The staging area is intentionally not cleared so the user can add to today's log immediately.
 */
async function processSaveFoodItem(foodName, record) {
  if (!state.userId) return showMessage('Cannot save food item. Not authenticated.', true);

  try {
    const foodId = foodName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const quantity = parseQty(document.getElementById('actual-quantity')?.value);
    const lastUpdated = new Date().toISOString();
    const ref = doc(db, `artifacts/${appId}/users/${state.userId}/foodItems`, foodId);
    // The in-memory list can be stale or miss a colliding slug. Read that id
    // inside the transaction and refuse a v1 overwrite of a v2 document.
    const built = await runTransaction(db, (transaction) => commitSavedFoodWrite(transaction, ref, record, {
      writeVersion: resolveNutrientWriteVersion(),
      name: foodName,
      quantity,
      lastUpdated,
    }));
    const foodData = built.doc;
    state.savedFoodItems.set(foodId, foodData);

    if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
      console.log('✅ [FOOD-SAVE] Successfully saved:', { foodId, foodData });
    }

    const notice = resolveNutrientWriteVersion() === 1 ? v1StorageNotice(built) : '';
    const message = notice
      ? `✅ "${foodName}" saved to database! ${notice}`
      : `✅ "${foodName}" saved to database! Ready to add to today's log.`;
    showMessage(message, false, SAVE_CONFIG.SUCCESS_MESSAGE_DURATION);
    flashSaveConfirmation(document.getElementById('save-food-item-btn'));
    rememberStagedFoodName(foodName);

  } catch (e) {
    if (e instanceof NewerSchemaError || e?.name === 'NewerSchemaError') {
      showMessage('This food was saved by a newer version — reload.', true);
      return;
    }
    if (e instanceof NutrientBoundsError || e?.name === 'NutrientBoundsError') {
      const label = getNutrient(e.key)?.label || 'A nutrient';
      showMessage(`${label} is outside the registry bounds and was not saved.`, true);
      return;
    }
    handleError('save-food-item', e, transactionFailureMessage(e, 'Failed to save food item'));
    
    if (SAVE_CONFIG.DEBUG_SAVE_OPERATIONS) {
      console.error('❌ [FOOD-SAVE] Save failed:', e);
    }
  }
}

/**
 * Prompt the user for a name when the food item input is blank.
 */
function handleBlankName(record) {
  const modal = state.dom.blankFoodNameModal;
  modal.classList.remove('hidden');
  document.getElementById('blank-food-name-input').value = '';
  document.getElementById('blank-food-name-prompt').classList.remove('hidden');
  document.getElementById('blank-food-name-input-container').classList.add('hidden');

  // Event Listeners for the Blank Name Modal
  document.getElementById('confirm-blank-name-btn').onclick = async () => {
    modal.classList.add('hidden');
    await processSaveFoodItem('(blank)', record);
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
      await processSaveFoodItem(newName, record);
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
 * Show a diff dialog when the staged values differ from an existing saved food.
 */
function showDuplicateDialog(existingFood, record, foodName) {
  const modal = state.dom.duplicateFoodModal;
  const container = document.getElementById('duplicate-comparison');
  const diffs = [];
  const existing = readFoodNutrients(existingFood);
  const version = resolveNutrientWriteVersion();
  const keys = version === 2 ? Object.keys(record.values) : LEGACY_V1_KEYS;
  const projected = version === 2 ? null : targetsFromStagedRecord(record);

  keys.forEach(n => {
    const existingValue = version === 2 ? (existing.values[n] ?? null) : (typeof existing.values[n] === 'number' ? existing.values[n] : 0);
    const stagedValue = version === 2 ? (record.values[n] ?? null) : projected[n];
    if (existingValue !== stagedValue) {
      const existingNumber = typeof existingValue === 'number' ? existingValue : 0;
      const stagedNumber = typeof stagedValue === 'number' ? stagedValue : 0;
      diffs.push({
        nutrient: getNutrient(n)?.label || formatNutrientName(n),
        existing: existingNumber,
        new: stagedNumber,
        delta: stagedNumber - existingNumber,
      });
    }
  });

  container.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">Food item "${escapeHtml(foodName)}" already exists with different values:</h3>
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
    await processSaveFoodItem(foodName, record);
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