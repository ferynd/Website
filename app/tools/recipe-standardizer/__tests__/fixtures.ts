/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/** Minimal-but-complete valid recipe JSON used across test files. */
export const validRecipeJson = () => ({
  schemaVersion: 1,
  recipeId: null,
  name: 'Chocolate Chip Cookies',
  source: { type: 'website', url: 'https://example.com/cookies', notes: '' },
  servings: { baselineServings: 24, currentServings: null, portionCount: 24, portionSizeG: 45 },
  yield: { estimatedFinalWeightG: 1080, actualFinalWeightG: null, yieldNotes: 'Estimated from ingredient weights.' },
  sections: [
    { id: 'sec-mixins', name: 'Prep Mix-Ins', type: 'prep', purpose: 'Chop and chill mix-ins', order: 1, dependsOn: [], equipment: ['cutting board'], notes: '' },
    { id: 'sec-dry', name: 'Prep Dry Bowl', type: 'prep', purpose: 'Combine dry ingredients', order: 2, dependsOn: [], equipment: ['medium bowl', 'whisk'], notes: '' },
    { id: 'sec-dough', name: 'Build Dough', type: 'execution', purpose: 'Combine everything', order: 3, dependsOn: ['sec-mixins', 'sec-dry'], equipment: ['stand mixer'], notes: '' },
  ],
  ingredients: [
    {
      id: 'ing-chocolate', displayName: 'dark chocolate', quantityG: 200, equivalent: '1 1/4 cups chopped',
      prepNote: 'roughly chopped', sectionIds: ['sec-mixins', 'sec-dough'], primarySectionId: 'sec-mixins',
      groceryCategory: 'Baking', optional: false, substitutionNotes: '', conversionNotes: '',
      nutritionLink: { status: 'unlinked', foodItemId: null, matchedName: null, matchConfidence: null, needsUserReview: true },
    },
    {
      id: 'ing-flour', displayName: 'all-purpose flour', quantityG: 300, equivalent: '2 1/2 cups',
      prepNote: '', sectionIds: ['sec-dry'], primarySectionId: 'sec-dry',
      groceryCategory: 'Baking', optional: false, substitutionNotes: '', conversionNotes: '',
      nutritionLink: { status: 'unlinked', foodItemId: null, matchedName: null, matchConfidence: null, needsUserReview: true },
    },
    {
      id: 'ing-butter', displayName: 'unsalted butter', quantityG: 225, equivalent: '2 sticks',
      prepNote: 'softened', sectionIds: ['sec-dough'], primarySectionId: 'sec-dough',
      groceryCategory: 'Dairy', optional: false, substitutionNotes: 'Browned butter works too.', conversionNotes: '',
      nutritionLink: { status: 'unlinked', foodItemId: null, matchedName: null, matchConfidence: null, needsUserReview: true },
    },
  ],
  prepSteps: [
    { id: 'prep-1', sectionId: 'sec-mixins', text: 'Chop the chocolate and chill it.', ingredientRefs: ['ing-chocolate'], equipment: [], timing: '10 min', temperature: '', visualCue: '', dependencyNote: 'Chill while preparing dough.', order: 1 },
    { id: 'prep-2', sectionId: 'sec-dry', text: 'Whisk flour into the dry bowl.', ingredientRefs: ['ing-flour'], equipment: ['whisk'], timing: '', temperature: '', visualCue: '', dependencyNote: '', order: 2 },
  ],
  activeSteps: [
    { id: 'act-1', sectionId: 'sec-dough', text: 'Cream butter, add dry mix, fold in chocolate.', ingredientRefs: ['ing-butter', 'ing-flour', 'ing-chocolate'], equipment: ['stand mixer'], timing: '5 min', temperature: '', visualCue: 'light and fluffy', dependencyNote: '', order: 1 },
  ],
  shoppingList: [],
  notes: ['Weights estimated for chocolate.'],
});
