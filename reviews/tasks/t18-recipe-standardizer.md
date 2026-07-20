# T18: Recipe Standardizer Deep Dive

Completed: 2026-07-14  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete current merged implementation, including:

- Firebase authentication and per-user recipe persistence;
- strict JSON import, normalization, warnings, schema-version behavior, and saved-recipe reload validation;
- the copyable ChatGPT conversion prompt and its contract with the parser;
- workflow sections, ingredient references, prep/active steps, dependencies, and display ordering;
- ingredient editing, step-text rename review, consolidated shopping/pantry and grocery-category views;
- multiplier, serving, final-weight, and portion scaling, including equivalent-text scaling and baked scaling;
- Nutrition Tracker food-item discovery and name-based link matching;
- recipe library loading, deletion, unsaved-change handling, update versus save-as-new behavior, and multi-tab concurrency;
- Firestore authorization, testing, responsive behavior, accessibility, and failure recovery.

## Current workflow trace

1. A Firebase-authenticated user enters a private per-user recipe workspace.
2. The user copies a conversion prompt into ChatGPT with a source recipe, then pastes strict JSON back into the site.
3. The parser validates known fields and cross-references, normalizes optional fields, sorts sections and steps by numeric order, and returns errors or warnings.
4. An accepted import becomes an unsaved working recipe and starts a best-effort name match against the user’s Nutrition Tracker saved foods.
5. Ingredients appear in workflow, consolidated shopping/pantry, and grocery-category views; ingredient names and quantities can be edited.
6. Prep and cooking instructions are grouped by section and render live ingredient-reference quantities.
7. Scaling is normally render-only. The user may explicitly bake the selected scale into the recipe, making scaled values the new baseline.
8. New recipes save directly. Changes to an already-saved recipe require choosing update existing, save as new, or cancel.
9. Saved recipes are stored as one Firestore document and are revalidated through the import parser on reload.

## Strong design decisions

- The tool avoids a paid or public AI route. Recipe conversion is an explicit external ChatGPT paste-back workflow.
- Strict JSON parsing returns actionable path-specific errors instead of allowing malformed data into the workspace.
- Sections, ingredients, and steps use stable IDs with cross-reference validation.
- A pasted shopping list is intentionally ignored; shopping views are always derived from current ingredients.
- Grams are treated consistently as the primary scaling quantity.
- Unparseable free-text equivalent ranges are not partially scaled or corrupted during render-time scaling.
- Live scaling does not mutate the baseline recipe until the user explicitly chooses to bake it in.
- A measured actual finished weight is preferred over an estimate for weight-based scaling.
- Ingredient renames preserve structured references and trigger a review flow for free-prose step text.
- Saved-recipe edits route through an explicit update/save-as-new decision rather than silently overwriting.
- Recipes are stored atomically as a single private per-user document and revalidated on load.
- The pure parser, scaling, shopping, matching, naming, and step-update helpers have meaningful Vitest coverage.

## Findings

### F-093: Baked scaling can save contradictory equivalent quantities without a warning

- Status: validated
- Category: scaling correctness / data integrity
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: bake-scale workflow, ingredient displays, copied JSON, and saved recipes
- Evidence:
  - render-time scaling returns `null` when an equivalent cannot be parsed and the UI labels the unchanged equivalent as being “at 1×”;
  - `applyScaleToRecipe` permanently scales grams but retains the original equivalent whenever `scaleEquivalentText` returns `null`;
  - after baking, the active scale resets to 1×, so the display no longer marks the retained equivalent as unscaled;
  - the contradictory values are then copied to JSON or persisted as the new baseline.
- Example: an ingredient with `50 g` and equivalent `a generous handful`, baked at 3×, becomes `150 g` and `a generous handful` with no caveat.
- User impact:
  - the primary gram value and secondary equivalent can describe different batch sizes while both look authoritative;
  - a saved or shared recipe may instruct the cook to use materially too little of an ingredient;
  - the inconsistency survives reload because it is now part of the baseline document.
- Root cause: the runtime-only `equivalentUnscaled` warning is not represented in the persisted ingredient model, and baked scaling treats an unscalable equivalent as safe to retain unchanged.
- Recommendation:
  1. When baking, either clear an unscalable equivalent, require user review, or persist an explicit stale/unscaled annotation.
  2. Show a pre-bake review listing every equivalent that cannot be transformed.
  3. Do not allow the new baseline to present an old-batch equivalent as current without an explicit warning.
  4. Add round-trip tests covering bake, save, reload, and display for unparseable equivalents.
- Acceptance criteria:
  - every retained equivalent after a baked scale is either correctly scaled or visibly marked as not applicable to the new baseline;
  - saved/reloaded recipes preserve that status;
  - the user can review and correct affected ingredients before persistence;
  - tests cover prose quantities, ranges, count-based quantities, and blank equivalents.
- Backlog destination: urgent Recipe Standardizer scaling-correctness candidate

### F-094: The import prompt permits schema extensions that the parser silently discards

- Status: validated
- Category: import contract / data preservation
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: ChatGPT conversion prompt, JSON import, saved-recipe reload, and copied JSON
- Evidence:
  - the conversion prompt says “Add fields if necessary”;
  - `parseRecipeJson` reconstructs a new `Recipe` using only known v1 fields and ignores all unknown fields;
  - a non-v1 `schemaVersion` produces only a warning and is imported as v1 anyway;
  - loading a saved recipe sends its data through the same parser, so unsupported fields are also stripped from legacy or future documents when subsequently saved;
  - even `recipeId`, which appears in the provided JSON shape, is not part of the parsed `Recipe` model.
- User impact:
  - ChatGPT may preserve source-specific details in additional fields that disappear without notice;
  - future schema versions can be downgraded into v1 with silent loss of information;
  - copied JSON can differ materially from what the user pasted even when import reports success.
- Root cause: the prompt describes an extensible shape while the importer implements a closed, lossy normalization contract and treats version incompatibility as nonfatal.
- Recommendation:
  1. Remove the instruction to add arbitrary fields unless the model and parser preserve extensions deliberately.
  2. Reject unsupported major schema versions or run explicit migrations.
  3. Warn with exact paths for unknown fields that will be dropped.
  4. Add round-trip tests asserting either preservation or explicit rejection of extension data.
- Acceptance criteria:
  - the prompt and parser describe the same extensibility rules;
  - unsupported versions cannot be silently coerced;
  - users are told before import when data will be discarded;
  - importing, copying, saving, and reloading a supported recipe is lossless for every documented field.
- Backlog destination: Recipe Standardizer schema-governance candidate

### F-095: Workflow dependencies are accepted but not validated or enforced as a graph

- Status: validated
- Category: workflow correctness
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `sections[].dependsOn`, workflow overview, prep/cook ordering, and prompt contract
- Evidence:
  - the parser verifies only that each dependency ID exists;
  - self-dependencies and multi-section cycles are accepted;
  - displayed section order is determined only by numeric `order`;
  - no topological validation or ordering uses `dependsOn`;
  - duplicate or contradictory order values are also accepted.
- User impact:
  - a recipe can claim mutually impossible prerequisites;
  - a dependent section can appear before the section it requires;
  - the workflow-first representation can be internally contradictory while passing strict validation.
- Root cause: dependency metadata is treated as decorative text rather than an executable invariant of the workflow model.
- Recommendation: validate the section graph for self-references and cycles, warn or reject dependencies that contradict display order, and either topologically order sections or clearly define `order` as authoritative and validate it against dependencies.
- Acceptance criteria:
  - cyclic and self dependencies are rejected with exact paths;
  - every accepted dependency can be completed before its dependent section in the rendered workflow;
  - deterministic tests cover chains, branches, duplicate order values, missing dependencies, self-cycles, and multi-node cycles.
- Backlog destination: Recipe Standardizer workflow-integrity candidate

### F-096: Recipe updates are last-write-wins across tabs with no revision conflict detection

- Status: validated source risk; overwrite reproduction requires multi-tab runtime validation
- Category: data integrity / concurrency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: saved recipe update and delete workflows
- Evidence:
  - a recipe is loaded once into local `baseline` and `draft` state;
  - `updateRecipe` replaces the entire nested recipe object using `setDoc(..., { merge: true })`;
  - no expected `updatedAt`, revision number, transaction, or precondition is checked;
  - the live library listener updates metadata but does not refresh or flag an already-open draft;
  - another tab can update or delete the same recipe while the first tab continues editing its stale copy.
- User impact:
  - the later save can silently overwrite another tab’s edits;
  - an open deleted recipe can be recreated as a new copy or saved under changed assumptions;
  - the explicit update/save-as-new modal protects user intent within one tab but not against remote changes.
- Root cause: optimistic local editing has no document revision contract.
- Recommendation: persist a revision or authoritative `updatedAt`, compare it before update, and present reload/overwrite/save-as-new choices on conflict. Consider Firestore transaction or update precondition support.
- Acceptance criteria:
  - two tabs editing the same baseline cannot silently overwrite one another;
  - deletion or remote update is surfaced to the open editor;
  - conflict handling preserves both versions or requires an explicit overwrite decision;
  - multi-tab tests cover update/update and update/delete races.
- Backlog destination: Recipe Standardizer persistence-integrity candidate

### F-097: “Linked” nutrition matches are auto-confirmed by name and never revalidated

- Status: validated; current direct nutrition impact is deferred because v1 does not calculate nutrition
- Category: cross-tool identity / future nutrition correctness
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: Nutrition Tracker matching badges and persisted `nutritionLink`
- Evidence:
  - exact normalized-name equality automatically creates status `linked`, confidence 1, and `needsUserReview: false`;
  - exact names can represent different products, preparations, brands, or nutrition bases;
  - `applyNutritionMatches` preserves all existing `linked` entries without checking whether the food item still exists or still has the same name;
  - the UI labels the result simply as “linked”;
  - the current rollout backlog identifies unit-basis ambiguity and link confirmation as prerequisites for nutrition calculations.
- User impact:
  - the saved link can look user-confirmed even though it was inferred automatically;
  - deleted, renamed, or repurposed food documents leave stale references;
  - future nutrition calculations could inherit an apparently authoritative but incorrect food mapping unless link management is completed first.
- Root cause: exact text equality is being used as both candidate matching and confirmation semantics.
- Recommendation: treat all automatic matches as candidates until explicitly confirmed, store and validate the required grams-per-unit basis, re-check linked document existence/name before computation, and distinguish inferred, confirmed, stale, and intentionally-unlinked states.
- Acceptance criteria:
  - automatic matching never implies user confirmation;
  - confirmed links record a physical quantity basis before nutrition math is allowed;
  - deleted or renamed food items are surfaced for review;
  - tests cover same-name different-basis foods and stale links.
- Backlog destination: existing Recipe Standardizer nutrition-integration P1/P3 work

## Revalidated cross-cutting findings

- F-019/F-021: long modals and the sticky jump bar still require narrow-viewport validation.
- F-023/F-026: modals do not implement complete focus management and most asynchronous status text is not announced.
- F-032: recipe-list listener errors are surfaced, but individual load/save failures and optional nutrition-match failures still depend on local status text or are intentionally swallowed.
- F-043/F-044: private recipe rules and authenticated save/load workflows lack emulator and end-to-end coverage.
- F-047: no production error telemetry captures import, persistence, or cross-tool matching failures.

## Test assessment

Existing pure tests cover:

- valid and invalid strict JSON parsing;
- duplicate IDs and broken cross-references;
- unknown section-type normalization;
- sorting and shopping-list rejection;
- scale-factor derivation and quantity rounding;
- common equivalent parsing, Unicode fractions, and deliberate refusal to scale ranges;
- baked gram/weight scaling;
- shopping consolidation and grouping;
- nutrition name similarity and link classification;
- ingredient rename step-text review;
- save-as-new naming behavior.

Missing high-value coverage includes:

- baked unparseable-equivalent save/reload behavior;
- unknown-field and unsupported-version round trips;
- dependency cycles, self-dependencies, and order contradictions;
- multi-tab update conflicts and remote deletion;
- Firestore owner-only rule tests;
- authenticated import-save-reload end-to-end coverage;
- automatic-link confirmation semantics and stale linked-food documents;
- mobile sticky navigation and modal keyboard/focus behavior.

## Runtime validation required later

T26 should verify:

1. importing, editing, scaling, baking, saving, and reloading a representative complex recipe;
2. the contradictory-equivalent scenario from F-093;
3. two-tab update and delete conflicts;
4. a future/unknown schema field and unsupported schema version;
5. keyboard and screen-reader behavior for import errors and all modals;
6. narrow mobile behavior with the sticky jump bar and long ingredient/step content;
7. real Firestore privacy and nutrition-food access under owner and non-owner accounts.

## Outcome

Recipe Standardizer has a strong pure-data foundation, clear workflow structure, meaningful unit tests, and unusually careful handling of strict imports and non-destructive live scaling. Its most immediate correctness gap is that baked scaling can turn a visibly qualified unscaled equivalent into an apparently current but contradictory saved measurement. Schema-extension promises, dependency semantics, stale-write detection, and nutrition-link confirmation also need hardening before the tool becomes a dependable long-term recipe and nutrition system.