# Recipe Standardizer — Nutrition Rollout Backlog

Single source of truth for the Recipe Standardizer → Nutrition Tracker (CalorieTracker)
integration rollout. The v1 tool (PR #149, merged) imports ChatGPT-converted recipes,
scales gram-first, and *records* name-match links to CalorieTracker food items. This
rollout makes those links useful end-to-end: nutrition data enters via the conversion
prompt, ingredients can be pushed into the tracker, recipes compute their own nutrition,
and whole recipes become loggable food items.

## Parameters (for `backlogs/protocol.md`)

- **Working branch:** `working/recipe-standardizer-backlog`
- **Commit scope:** `recipe-standardizer`; item ids `R<N>` (next new id: **R7**; never reuse ids)
- **Archive:** `backlogs/recipe-standardizer-completed.md`
- **Tests:**
  - Pure lib / schema / logic changes: `npm test` from repo root (vitest; covers
    `app/tools/recipe-standardizer/__tests__/`). Add or update tests for every new pure
    function, validator change, or regression fix.
  - Component / page changes: also `npm run lint` and `npm run build`.
  - Never touches `public/tools/CalorieTracker/` code, so its suite is not required —
    unless an item explicitly changes tracker code (none currently do).

## Session protocol

Follow `backlogs/protocol.md` with the parameters above.

## Context facts (verified against the codebase — do not re-derive)

Read `ARCHITECTURE.md` § "Recipe Standardizer" for tool behavior. Key integration facts:

- **Recipe storage:** one doc per recipe at
  `artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}` shaped
  `{ name, recipe, createdAt, updatedAt }` (`lib/db.ts`). Loads re-run the strict
  validator (`lib/schema.ts` — pure, never throws, exact-path errors + non-fatal warnings).
- **Tracker food storage:** `artifacts/default-app-id/users/{uid}/foodItems/{foodId}`.
  Doc shape (see `public/tools/CalorieTracker/food/save.js`):
  `{ name, quantity, <nutrient keys>, lastUpdated: <ISO string> }` — flat fields, no
  nesting. Doc id = `name.toLowerCase().replace(/[^a-z0-9]/g, '_')`.
- **Tracker semantics:** nutrient field values are **per 1 unit of `quantity`**; a log
  entry adds `quantity × value` per nutrient (`food/manager.js`). `quantity` is a
  unitless multiplier — the unit convention lives in the food's name.
- **Nutrient keys:** `allNutrients` in `public/tools/CalorieTracker/constants.js` —
  `calories, protein, carbs, fat, fiber, potassium, magnesium, sodium, calcium, choline,
  vitaminB12, folate, vitaminC, vitaminB6, vitaminA, vitaminD, vitaminE, vitaminK,
  selenium, iodine, phosphorus, iron, zinc, omega3`. Units follow the tracker's
  `DEFAULT_BASELINE_TARGETS` conventions (standard US RDA units: kcal; g for
  protein/carbs/fat/fiber/omega3; mg for potassium, magnesium, sodium, calcium, choline,
  vitaminC, vitaminB6, vitaminE, iron, zinc, phosphorus; mcg for vitaminB12, folate,
  vitaminA, vitaminD, vitaminK, selenium, iodine).
- **Firestore rules:** the legacy wildcard `match /artifacts/{appId}/users/{userId}/{document=**}`
  in `firestore.rules` already lets a signed-in user read/write **their own** foodItems
  from any tool — no rules change needed for cross-tool writes, but `SECURITY.md` must
  document each new write surface.
- **Link model:** each ingredient carries `nutritionLink`
  (`linked | likely | unlinked`, `lib/types.ts`). Matching (`lib/nutritionMatch.ts`):
  exact normalized name → `linked`; token score ≥ 0.6 → `likely` + `needsUserReview`;
  else `unlinked`. Re-matching (`applyNutritionMatches`) preserves only `linked` entries.
- **No AI calls on the site:** nutrition data can only enter via the copyable ChatGPT
  conversion prompt (`lib/prompt.ts`) + strict-JSON paste (`lib/schema.ts`), or manual
  entry in the UI.
- **Food list access:** `RecipeContext.loadFoodItems()` → `fetchFoodItems(uid)` in
  `lib/db.ts` already reads the tracker's foodItems (id + name only today).

## Invariants

Preserve these unless the user explicitly asks to change them:

- Grams (`quantityG`) stay the source of truth for quantities; `equivalent` is
  display-only text.
- Import stays strict-JSON with exact-path errors; the site never calls an AI API.
- Any change to an already-saved recipe routes through `SaveChoiceModal`
  (update / save-as-new / cancel) — no silent overwrites. The same "no silent
  overwrite" rule applies to writes into the tracker's `foodItems` (duplicate check +
  confirm, mirroring `food/save.js`'s duplicate dialog behavior).
- Nutrition matching/linking/data **never blocks** importing or saving a recipe —
  missing data degrades to warnings and coverage notes.
- Any recipe shape change bumps `RECIPE_SCHEMA_VERSION` and must still load existing
  v1 Firestore docs and v1 pasted JSON (normalize with defaults + non-fatal warning;
  never reject).
- Shopping/grocery views stay derived from ingredients at render time; no stored
  shopping list.

---

## Active items

Rollout goal: a user converts a recipe in ChatGPT (prompt now includes per-100 g
nutrition), imports it, reviews/creates ingredient links, sees the recipe's computed
nutrition, and can log either single ingredients or the whole recipe in the
Nutrition Tracker. R1 → R2/R3 → R4/R5 is the dependency spine; R6 is the final
real-data gate.

### HIGH

- [ ] **R1 Schema v2: per-ingredient nutrition data.** Add optional
  `nutritionPer100g: Partial<Record<NutrientKey, number>> | null` to `RecipeIngredient`
  (values per 100 g of the ingredient; `NutrientKey` = the 24 tracker keys listed in
  Context facts, exported from a new shared constant in `lib/types.ts`). Bump
  `RECIPE_SCHEMA_VERSION` to 2. Validator: v1 docs/JSON normalize to
  `nutritionPer100g: null` (no error, no warning); reject non-numeric or negative
  values with exact-path errors; unknown keys → non-fatal warning and dropped. Update
  the ChatGPT prompt (`lib/prompt.ts`) to request best-estimate per-100 g values —
  calories/protein/carbs/fat expected, micros optional, `null` when unknown — and
  document the units. Show per-100 g data read-only in `IngredientEditModal` with
  manual edit support.
  Accept: v1 fixture still parses clean; v2 fixture round-trips; prompt text names the
  exact keys and units; tests cover normalization, rejection, and unknown-key warning.
  Files: `lib/types.ts`, `lib/schema.ts`, `lib/prompt.ts`,
  `components/IngredientEditModal.tsx`, `__tests__/schema.test.ts`, `__tests__/fixtures.ts`.

- [ ] **R2 Ingredient → tracker food item export.** Depends: R1. New pure
  `lib/foodItemExport.ts`: `buildFoodItemDoc(ingredient)` → `{ id, data }` where
  `data = { name: '<Ingredient name> (100g)', quantity: 1, ...nutritionPer100g mapped
  onto flat tracker keys (absent keys → 0), lastUpdated: ISO }` and id is derived from
  the full name per the tracker's id rule. Convention (document in ARCHITECTURE.md):
  exported ingredient foods are per-100 g, so tracker `quantity` 1.5 = 150 g. New
  `createFoodItem(uid, id, data)` in `lib/db.ts` (setDoc). UI: "Add to Nutrition
  Tracker" action on `unlinked`/`likely` ingredients (IngredientEditModal and/or
  IngredientsView badge), enabled only when `nutritionPer100g` has at least `calories`;
  confirm modal previews name + values; duplicate guard — if the id or a
  case-insensitive name match exists in the fetched food list, require an explicit
  overwrite-or-rename choice, never silent. On success, re-run matching so the link
  flips to `linked` with the new `foodItemId`. Update `SECURITY.md`: recipe tool now
  writes to the CalorieTracker foodItems path (own-uid only, existing wildcard rule).
  Accept: builder unit-tested (id derivation, key mapping, zero-fill, name suffix);
  export → link flip verified manually; duplicate path can't clobber without confirm.
  Files: `lib/foodItemExport.ts` (new), `lib/db.ts`, `RecipeContext.tsx`,
  `components/IngredientEditModal.tsx`, `components/IngredientsView.tsx`,
  `__tests__/foodItemExport.test.ts` (new), `SECURITY.md`, `ARCHITECTURE.md`.

- [ ] **R3 Recipe nutrition computation + Overview display.** Depends: R1. New pure
  `lib/nutrition.ts`: `computeRecipeNutrition(recipe)` sums
  `quantityG × nutritionPer100g / 100` per ingredient into totals per nutrient key, and
  returns `{ totals, perServing, perPortion, coverage }` — perServing from
  `servings.currentServings ?? baselineServings`, perPortion from
  `servings.portionCount` (else from total weight ÷ `portionSizeG`), and
  `coverage = { includedCount, excluded: [{id, displayName, reason}] }` listing every
  ingredient skipped for missing grams or missing nutrition data (never silently
  pretend complete). Compute from the **scaled working copy** the UI renders, not the
  baseline. UI: "Nutrition" block in the Overview accordion — macro line
  (kcal / P / C / F) prominent, expandable micros table, coverage warning listing
  excluded ingredients. Update the ARCHITECTURE.md line that says computing recipe
  nutrition "is a documented follow-up, not in v1".
  Accept: math unit-tested incl. null grams, null nutrition, zero servings/portions
  (no division blowups), scaling factor applied; coverage list exact.
  Files: `lib/nutrition.ts` (new), `components/RecipeWorkspace.tsx` (Overview),
  `__tests__/nutrition.test.ts` (new), `ARCHITECTURE.md`.

### MEDIUM

- [ ] **R4 Batch link-review panel.** Depends: R2. One place to clear all
  `needsUserReview` flags: a "Review links" surface in the Ingredients panel (workflow
  mode) listing every `likely`/`unlinked` ingredient with per-row actions —
  **accept** suggested match (→ `linked`, review flag off), **choose** from a
  searchable list of fetched foods, **create** in tracker (reuse R2 flow), or
  **dismiss** (stays `unlinked`, review flag off so it stops nagging). Pure
  state-transition helpers for each action. Edits mark the recipe dirty and route
  through the normal save flow — no new persistence path.
  Accept: transitions unit-tested; review badge count reaches zero after a full pass;
  dismissed items survive re-match (extend `applyNutritionMatches` to also preserve
  dismissed links — note: today it only preserves `linked`).
  Files: `lib/nutritionMatch.ts`, `components/IngredientsView.tsx` (or new
  `components/LinkReviewPanel.tsx`), `__tests__/nutritionMatch.test.ts`.

- [ ] **R5 Recipe → tracker food item export ("log this recipe").** Depends: R2, R3.
  Button in Overview/Scaling area: writes ONE foodItems doc for the whole recipe —
  name = recipe name, nutrient values = R3's `perPortion` (fallback `perServing`;
  if neither is derivable, disable with an explanatory tooltip), `quantity: 1` = one
  portion. Same confirm + duplicate guard as R2. If coverage is incomplete, the confirm
  modal must show the excluded-ingredient list and require explicit "export partial"
  acknowledgement. Document the per-portion convention in ARCHITECTURE.md.
  Accept: builder path unit-tested (portion fallback chain, partial-coverage flag);
  exported doc loggable in the tracker.
  Files: `lib/foodItemExport.ts`, `components/RecipeWorkspace.tsx` and/or
  `components/ScalingPanel.tsx`, `__tests__/foodItemExport.test.ts`, `ARCHITECTURE.md`.

### ROLLOUT GATE (work last)

- [ ] **R6 Real-recipe rollout QA.** Depends: R1–R5 merged. The user converts their real
  recipe collection in ChatGPT with the updated prompt and imports each recipe. Agent's
  role per session: take the user's reported friction (validation errors, prompt
  misses, bad matches, unit mistakes), fix `lib/prompt.ts` / `lib/schema.ts` /
  matcher thresholds accordingly, and keep a one-line running friction note on this
  item. Do not start R6 work unless the user supplies recipes or reports friction.
  Accept (user-confirmed): their collection imports cleanly with nutrition data, links
  reviewed to zero flags, and at least one recipe logged in the tracker end-to-end.

### LOW / NICE-TO-HAVE

_(empty — slot future ideas here, e.g. gramsPerUnit on links to compute nutrition from
already-saved tracker foods that predate R1 data)_
