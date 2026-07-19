/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Minimal-but-complete valid V1 recipe JSON used across test files.
 * Deliberately kept at schemaVersion 1 with no workflow fields — it doubles
 * as the saved-recipe compatibility fixture.
 */
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

/* ------------------------------------------------------------ */
/* V2 regression fixture — compact Thai tea parfait tart         */
/* ------------------------------------------------------------ */

const ing = (
  id: string,
  displayName: string,
  quantityG: number | null,
  primarySectionId: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  displayName,
  quantityG,
  equivalent: '',
  prepNote: '',
  sectionIds: [primarySectionId],
  primarySectionId,
  groceryCategory: 'Pantry',
  optional: false,
  substitutionNotes: '',
  conversionNotes: '',
  ...extra,
});

/**
 * Compact v2 fixture modeled on the Thai tea parfait tart regression case:
 * a mixer-bowl crust group, just-in-time white chocolate, during-wait tea
 * base staging, refrigerated dairy whipped late, a named-result chain
 * (crust mixture → sealed crust → filled tart), lemon mascarpone scheduled
 * during the thaw, and a timeline with an overnight freeze, an overlapped
 * mascarpone entry, and a room-temperature thaw alternative.
 */
export const validV2RecipeJson = () => ({
  schemaVersion: 2,
  name: 'Thai Tea Parfait Tart',
  source: { type: 'website', url: 'https://example.com/thai-tea-tart', notes: '' },
  servings: { baselineServings: 10, portionCount: 10, portionSizeG: null },
  yield: { estimatedFinalWeightG: 1400, yieldNotes: '' },
  sections: [
    { id: 'sec-crust', name: 'Almond Crunch Crust', type: 'execution', purpose: 'Press and seal the crust', order: 1, dependsOn: [], notes: '' },
    { id: 'sec-filling', name: 'Thai Tea Filling', type: 'execution', purpose: 'Make and set the parfait filling', order: 2, dependsOn: ['sec-crust'], notes: '' },
    { id: 'sec-mascarpone', name: 'Lemon Mascarpone', type: 'execution', purpose: 'Curd, then mascarpone cream', order: 3, dependsOn: ['sec-filling'], notes: '' },
    { id: 'sec-serve', name: 'Finish & Serve', type: 'execution', purpose: 'Pipe and serve', order: 4, dependsOn: ['sec-mascarpone'], notes: '' },
  ],
  ingredients: [
    ing('ing-almonds', 'roasted almonds', 85, 'sec-crust'),
    ing('ing-almond-butter', 'almond butter', 60, 'sec-crust'),
    ing('ing-cornflakes', 'cornflakes', 45, 'sec-crust'),
    ing('ing-conf-sugar', 'confectioners sugar', 50, 'sec-crust'),
    ing('ing-crust-salt', 'fine sea salt', 2, 'sec-crust'),
    ing('ing-crust-tea', 'Thai tea leaves', 6, 'sec-crust'),
    ing('ing-citric', 'citric acid', 1, 'sec-crust', { optional: true }),
    ing('ing-white-choc', 'white chocolate', 55, 'sec-crust'),
    ing('ing-infusion-tea', 'Thai tea leaves for infusion', 12, 'sec-filling'),
    ing('ing-condensed', 'sweetened condensed milk', 200, 'sec-filling'),
    ing('ing-dulce', 'dulce de leche', 120, 'sec-filling'),
    ing('ing-tamarind', 'tamarind concentrate', 15, 'sec-filling'),
    ing('ing-filling-salt', 'fine sea salt for filling', 2, 'sec-filling'),
    ing('ing-cream', 'heavy cream', 240, 'sec-filling', { groceryCategory: 'Dairy' }),
    ing('ing-sour-cream', 'sour cream', 120, 'sec-filling', { groceryCategory: 'Dairy' }),
    ing('ing-gelatin-filling', 'powdered gelatin', 7, 'sec-filling'),
    ing('ing-lemon-juice', 'lemon juice', 80, 'sec-mascarpone', { groceryCategory: 'Produce' }),
    ing('ing-butter', 'unsalted butter', 85, 'sec-mascarpone', { groceryCategory: 'Dairy' }),
    ing('ing-mascarpone', 'mascarpone', 225, 'sec-mascarpone', { groceryCategory: 'Dairy' }),
    ing('ing-gelatin-curd', 'powdered gelatin for curd', 3, 'sec-mascarpone'),
  ],
  prepGroups: [
    {
      id: 'g-crust',
      name: 'crust ingredients in mixer bowl',
      ingredientIds: ['ing-almonds', 'ing-almond-butter', 'ing-cornflakes', 'ing-conf-sugar', 'ing-crust-salt', 'ing-crust-tea', 'ing-citric'],
      destination: 'mixer bowl',
      instruction: 'Measure everything into the mixer bowl.',
      timing: { when: 'start', note: '' },
      firstUseStepId: 'step-mix',
      holdNote: '',
      details: '',
      techniqueIds: [],
    },
    {
      id: 'g-white-choc',
      name: 'melted white chocolate',
      ingredientIds: ['ing-white-choc'],
      destination: '',
      instruction: 'Melt gently until smooth.',
      timing: { when: 'just-in-time', beforeStepId: 'step-brush', note: '' },
      firstUseStepId: 'step-brush',
      holdNote: 'Melt just before brushing.',
      details: '',
      techniqueIds: ['water-bath'],
    },
    {
      id: 'g-infusion',
      name: 'strained tea infusion',
      ingredientIds: ['ing-infusion-tea'],
      destination: '',
      instruction: 'Steep the tea, then strain.',
      timing: { when: 'during-wait', waitEntryId: 'tl-freeze-crust', note: '' },
      firstUseStepId: 'step-mix-base',
      holdNote: '',
      details: '',
      techniqueIds: [],
    },
    {
      id: 'g-tea-base',
      name: 'tea base staples',
      ingredientIds: ['ing-condensed', 'ing-dulce', 'ing-tamarind', 'ing-filling-salt'],
      destination: 'medium bowl',
      instruction: 'Stage together.',
      timing: { when: 'during-wait', waitEntryId: 'tl-freeze-crust', note: '' },
      firstUseStepId: 'step-mix-base',
      holdNote: '',
      details: '',
      techniqueIds: [],
    },
    {
      id: 'g-gelatin-filling',
      name: 'bloomed gelatin',
      ingredientIds: ['ing-gelatin-filling'],
      destination: '',
      instruction: 'Bloom per package directions.',
      timing: { when: 'just-in-time', beforeStepId: 'step-mix-base', note: '' },
      firstUseStepId: 'step-mix-base',
      holdNote: '',
      details: '',
      techniqueIds: ['bloom-powdered-gelatin'],
    },
    {
      id: 'g-whipped-dairy',
      name: 'whipped dairy',
      ingredientIds: ['ing-cream', 'ing-sour-cream'],
      destination: '',
      instruction: 'Whip to medium-soft peaks.',
      timing: { when: 'just-in-time', beforeStepId: 'step-fold', note: '' },
      firstUseStepId: 'step-fold',
      holdNote: 'Keep refrigerated until the tea base is almost ready.',
      details: '',
      techniqueIds: ['medium-soft-peaks'],
    },
    {
      id: 'g-gelatin-curd',
      name: 'bloomed gelatin for curd',
      ingredientIds: ['ing-gelatin-curd'],
      destination: '',
      instruction: 'Bloom per package directions.',
      timing: { when: 'just-in-time', beforeStepId: 'step-cook-curd', note: '' },
      firstUseStepId: 'step-cook-curd',
      holdNote: '',
      details: '',
      techniqueIds: ['bloom-powdered-gelatin'],
    },
    {
      id: 'g-mascarpone-cold',
      name: 'cold mascarpone and butter',
      ingredientIds: ['ing-butter', 'ing-mascarpone'],
      destination: '',
      instruction: 'Keep cold until needed.',
      timing: { when: 'during-wait', waitEntryId: 'tl-thaw', note: '' },
      firstUseStepId: 'step-combine-mascarpone',
      holdNote: 'Keep refrigerated.',
      details: '',
      techniqueIds: [],
    },
  ],
  prepSteps: [],
  activeSteps: [
    {
      id: 'step-mix', sectionId: 'sec-crust',
      text: 'Mix the crust ingredients in the mixer bowl until the cereal breaks down.',
      ingredientRefs: ['ing-almonds', 'ing-almond-butter', 'ing-cornflakes', 'ing-conf-sugar', 'ing-crust-salt', 'ing-crust-tea', 'ing-citric'],
      timing: '3–4 min', temperature: '', visualCue: 'coarse, cohesive crumble', dependencyNote: '', order: 1,
      usesPrepGroupIds: ['g-crust'], usesResultIds: [], result: { id: 'res-crust-mixture', name: 'crust mixture' }, techniqueIds: [],
    },
    {
      id: 'step-press', sectionId: 'sec-crust',
      text: 'Press the crust mixture into the tart pan.',
      ingredientRefs: [], timing: '', temperature: '', visualCue: 'even layer', dependencyNote: '', order: 2,
      usesPrepGroupIds: [], usesResultIds: ['res-crust-mixture'], result: { id: 'res-pressed-crust', name: 'pressed crust' }, techniqueIds: [],
    },
    {
      id: 'step-brush', sectionId: 'sec-crust',
      text: 'Brush the pressed crust with the melted white chocolate.',
      ingredientRefs: ['ing-white-choc'], timing: '', temperature: '', visualCue: '', dependencyNote: '', order: 3,
      usesPrepGroupIds: ['g-white-choc'], usesResultIds: ['res-pressed-crust'], result: { id: 'res-sealed-crust', name: 'sealed crust' }, techniqueIds: [],
    },
    {
      id: 'step-freeze-crust', sectionId: 'sec-crust',
      text: 'Freeze the sealed crust until set.',
      ingredientRefs: [], timing: '30+ min', temperature: '', visualCue: 'firm to the touch', dependencyNote: '', order: 4,
      usesPrepGroupIds: [], usesResultIds: ['res-sealed-crust'], result: null, techniqueIds: [],
    },
    {
      id: 'step-mix-base', sectionId: 'sec-filling',
      text: 'Whisk the strained tea infusion and bloomed gelatin into the tea base staples.',
      ingredientRefs: ['ing-infusion-tea', 'ing-condensed', 'ing-dulce', 'ing-tamarind', 'ing-filling-salt', 'ing-gelatin-filling'],
      timing: '', temperature: '', visualCue: 'smooth', dependencyNote: '', order: 5,
      usesPrepGroupIds: ['g-infusion', 'g-tea-base', 'g-gelatin-filling'], usesResultIds: [], result: { id: 'res-tea-base', name: 'tea base' }, techniqueIds: [],
    },
    {
      id: 'step-chill-base', sectionId: 'sec-filling',
      text: 'Chill the tea base until thick but pourable.',
      ingredientRefs: [], timing: '45–60 min', temperature: '', visualCue: 'thick but pourable', dependencyNote: '', order: 6,
      usesPrepGroupIds: [], usesResultIds: ['res-tea-base'], result: { id: 'res-chilled-base', name: 'chilled tea base' }, techniqueIds: [],
    },
    {
      id: 'step-fold', sectionId: 'sec-filling',
      text: 'Fold the whipped dairy into the chilled tea base.',
      ingredientRefs: ['ing-cream', 'ing-sour-cream'], timing: '', temperature: '', visualCue: 'no streaks', dependencyNote: 'do not overmix', order: 7,
      usesPrepGroupIds: ['g-whipped-dairy'], usesResultIds: ['res-chilled-base'], result: { id: 'res-filling', name: 'tea filling' }, techniqueIds: ['fold'],
    },
    {
      id: 'step-fill', sectionId: 'sec-filling',
      text: 'Fill the sealed crust with the tea filling and freeze overnight.',
      ingredientRefs: [], timing: 'overnight', temperature: '', visualCue: '', dependencyNote: '', order: 8,
      usesPrepGroupIds: [], usesResultIds: ['res-sealed-crust', 'res-filling'], result: null, techniqueIds: [],
    },
    {
      id: 'step-cook-curd', sectionId: 'sec-mascarpone',
      text: 'Cook the lemon curd, then stir in the bloomed gelatin for curd.',
      ingredientRefs: ['ing-lemon-juice', 'ing-gelatin-curd'], timing: '', temperature: 'low heat', visualCue: 'coats a spoon', dependencyNote: '', order: 9,
      usesPrepGroupIds: ['g-gelatin-curd'], usesResultIds: [], result: { id: 'res-curd', name: 'lemon curd' }, techniqueIds: [],
    },
    {
      id: 'step-chill-curd', sectionId: 'sec-mascarpone',
      text: 'Chill the lemon curd fully.',
      ingredientRefs: [], timing: '1–2 hours', temperature: '', visualCue: '', dependencyNote: 'wait until fully set', order: 10,
      usesPrepGroupIds: [], usesResultIds: ['res-curd'], result: { id: 'res-chilled-curd', name: 'chilled curd' }, techniqueIds: [],
    },
    {
      id: 'step-combine-mascarpone', sectionId: 'sec-mascarpone',
      text: 'Beat the cold mascarpone and butter, then combine with the chilled curd.',
      ingredientRefs: ['ing-butter', 'ing-mascarpone'], timing: '', temperature: '', visualCue: 'smooth and pipeable', dependencyNote: '', order: 11,
      usesPrepGroupIds: ['g-mascarpone-cold'], usesResultIds: ['res-chilled-curd'], result: { id: 'res-mascarpone-cream', name: 'lemon mascarpone cream' }, techniqueIds: [],
    },
    {
      id: 'step-pipe', sectionId: 'sec-serve',
      text: 'Pipe the lemon mascarpone cream onto the thawed tart.',
      ingredientRefs: [], timing: 'within a few hours of serving', temperature: '', visualCue: '', dependencyNote: '', order: 12,
      usesPrepGroupIds: [], usesResultIds: ['res-mascarpone-cream'], result: null, techniqueIds: [],
    },
  ],
  timeline: [
    { id: 'tl-crust', kind: 'execution', phaseLabel: 'Day before', references: [{ kind: 'section', id: 'sec-crust' }], titleOverride: '', activeTime: '25 min', passiveTime: '', duringEntryId: '', alternatives: [], order: 1 },
    { id: 'tl-freeze-crust', kind: 'wait', phaseLabel: 'Day before', references: [{ kind: 'step', id: 'step-freeze-crust' }], titleOverride: 'Crust sets in the freezer', activeTime: '', passiveTime: '30+ min', duringEntryId: '', alternatives: [], order: 2 },
    { id: 'tl-filling', kind: 'execution', phaseLabel: 'Day before', references: [{ kind: 'section', id: 'sec-filling' }], titleOverride: '', activeTime: '30 min', passiveTime: '', duringEntryId: '', alternatives: [], order: 3 },
    { id: 'tl-freeze-tart', kind: 'wait', phaseLabel: 'Overnight', references: [{ kind: 'step', id: 'step-fill' }], titleOverride: 'Tart freezes', activeTime: '', passiveTime: 'overnight', duringEntryId: '', alternatives: [], order: 4 },
    {
      id: 'tl-thaw', kind: 'wait', phaseLabel: 'Serving day', references: [], titleOverride: 'Thaw in the refrigerator',
      activeTime: '', passiveTime: '4–5 hours', duringEntryId: '',
      alternatives: [{ label: 'Room-temperature thaw', activeTime: '', passiveTime: 'about 1 hour', note: 'Faster but watch it closely.' }],
      order: 5,
    },
    { id: 'tl-mascarpone', kind: 'execution', phaseLabel: 'While the tart thaws', references: [{ kind: 'section', id: 'sec-mascarpone' }], titleOverride: '', activeTime: '30 min', passiveTime: '1–2 hours chilling', duringEntryId: 'tl-thaw', alternatives: [], order: 6 },
    { id: 'tl-serve', kind: 'serve', phaseLabel: 'Just before serving', references: [{ kind: 'step', id: 'step-pipe' }], titleOverride: '', activeTime: '10 min', passiveTime: '', duringEntryId: '', alternatives: [], order: 7 },
  ],
  techniqueOverrides: [],
  notes: [],
});
