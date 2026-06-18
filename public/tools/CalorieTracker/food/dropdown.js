/**
 * @file src/food/dropdown.js
 * @description Manages the interactive food search dropdown menu.
 */

import { CONFIG } from '../config.js';
import { state } from '../state/store.js';

/**
 * Sets up event listeners for the food search input field.
 */
export function setupFoodDropdown() {
  const foodInput = document.getElementById('food-item-input');
  const dropdownContainer = document.getElementById('food-dropdown');
  if (!foodInput || !dropdownContainer) return;

  // Listen for input to trigger a debounced search.
  foodInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimeout);
    const value = e.target.value.trim();
    state.searchTimeout = setTimeout(() => {
      if (value.length >= CONFIG.SEARCH_MIN_CHARS) {
        performFoodSearch(value);
      } else {
        hideFoodDropdown();
      }
    }, CONFIG.SEARCH_DEBOUNCE_MS);
  });

  // Handle keyboard navigation (ArrowUp, ArrowDown, Enter, Escape).
  foodInput.addEventListener('keydown', (e) => {
    if (!state.foodDropdownVisible) return;
    const items = dropdownContainer.querySelectorAll('.food-dropdown-item');
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        state.selectedDropdownIndex = Math.min(state.selectedDropdownIndex + 1, items.length - 1);
        updateDropdownHighlight(items);
        break;
      case 'ArrowUp':
        e.preventDefault();
        state.selectedDropdownIndex = Math.max(state.selectedDropdownIndex - 1, -1);
        updateDropdownHighlight(items);
        break;
      case 'Enter':
        e.preventDefault();
        if (state.selectedDropdownIndex >= 0 && items[state.selectedDropdownIndex]) {
          const foodName = items[state.selectedDropdownIndex].dataset.foodName;
          // selectFoodItem is exposed on the window object in wire.js
          window.selectFoodItem(foodName);
        }
        break;
      case 'Escape':
        hideFoodDropdown();
        break;
    }
  });

  // Hide the dropdown if the user clicks outside of it.
  document.addEventListener('click', (e) => {
    if (!dropdownContainer.contains(e.target) && e.target !== foodInput) {
      hideFoodDropdown();
    }
  });
}

/**
 * Filters and sorts saved food items based on the search term.
 * @param {string} searchTerm - The user's input.
 */
export function performFoodSearch(searchTerm) {
  const lowerSearchTerm = searchTerm.toLowerCase();
  const matches = Array.from(state.savedFoodItems.values())
    .filter(f => (f.name || '').toLowerCase().includes(lowerSearchTerm))
    .sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      // Prioritize exact matches and then matches that start with the search term.
      if (an === lowerSearchTerm && bn !== lowerSearchTerm) return -1;
      if (bn === lowerSearchTerm && an !== lowerSearchTerm) return 1;
      if (an.startsWith(lowerSearchTerm) && !bn.startsWith(lowerSearchTerm)) return -1;
      if (bn.startsWith(lowerSearchTerm) && !an.startsWith(lowerSearchTerm)) return 1;
      return an.localeCompare(bn);
    })
    .slice(0, CONFIG.MAX_DROPDOWN_ITEMS);

  if (matches.length > 0) {
    showFoodDropdown(matches);
  } else {
    hideFoodDropdown();
  }
}

/**
 * Renders and displays the food dropdown with matching items.
 * @param {object[]} matches - An array of food item objects to display.
 */
export function showFoodDropdown(matches) {
  const dropdownContainer = document.getElementById('food-dropdown');
  state.selectedDropdownIndex = -1;
  // Build with DOM nodes + textContent rather than innerHTML: food names are
  // user-controlled and would otherwise be an XSS vector (and break a quoted
  // inline onclick handler).
  dropdownContainer.replaceChildren();
  matches.forEach((f, idx) => {
    const name = f.name || '';

    const itemEl = document.createElement('div');
    itemEl.className = 'food-dropdown-item';
    itemEl.dataset.foodName = name;
    itemEl.dataset.index = String(idx);
    itemEl.addEventListener('click', () => window.selectFoodItem(name));

    const nameEl = document.createElement('div');
    nameEl.className = 'font-medium';
    nameEl.textContent = name;

    const macroEl = document.createElement('div');
    macroEl.className = 'text-xs text-gray-500';
    macroEl.textContent =
      `Cal: ${f.calories || 0} | P: ${f.protein || 0} / C: ${f.carbs || 0} / F: ${f.fat || 0}`;

    itemEl.append(nameEl, macroEl);
    dropdownContainer.appendChild(itemEl);
  });
  dropdownContainer.classList.remove('hidden');
  state.foodDropdownVisible = true;
}

/**
 * Updates the visual highlight on the dropdown items based on keyboard navigation.
 * @param {NodeListOf<Element>} items - The list of dropdown item elements.
 */
export function updateDropdownHighlight(items) {
  items.forEach((it, idx) => {
    it.classList.toggle('highlighted', idx === state.selectedDropdownIndex);
    if (idx === state.selectedDropdownIndex) {
      it.scrollIntoView({ block: 'nearest' });
    }
  });
}

/**
 * Hides the food dropdown menu and resets its state.
 */
export function hideFoodDropdown() {
  const dropdownContainer = document.getElementById('food-dropdown');
  if (!dropdownContainer) return;
  dropdownContainer.classList.add('hidden');
  state.foodDropdownVisible = false;
  state.selectedDropdownIndex = -1;
}
