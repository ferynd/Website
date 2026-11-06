/**
 * Load a saved food into the staging inputs without going through Firebase.
 * Clears a previous paste-conflict block so the saved food can be used.
 */
import { state } from '../state/store.js';
import { allNutrients } from '../constants.js';
import { readFoodNutrients } from '../nutrition/nutrientRecord.js';
import { releaseStagingConflictBlock, renderNutrientDetail } from '../ui/nutrientDetail.js';

export function applySavedFoodToStaging(foodData, defaultQuantity = 1) {
  releaseStagingConflictBlock();
  const record = readFoodNutrients(foodData);
  state.stagedRecord = record;
  allNutrients.forEach((nutrient) => {
    const input = document.getElementById(`actual-${nutrient}`);
    if (!input) return;
    const value = record.values[nutrient];
    input.value = value == null ? '' : String(value);
  });
  renderNutrientDetail(document.getElementById('nutrient-detail-staging'), record);
  renderNutrientDetail(document.getElementById('nutrient-detail-food'), record);

  const quantity = foodData?.quantity ?? defaultQuantity;
  const quantityInput = document.getElementById('actual-quantity');
  if (quantityInput) quantityInput.value = quantity;
  const inlineQty = document.getElementById('food-inline-qty');
  if (inlineQty) inlineQty.value = quantity;
  return record;
}
