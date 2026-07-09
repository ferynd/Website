# Recipe Standardizer — Nutrition Integration Rollout Backlog

Single source of truth for the Recipe Standardizer → CalorieTracker nutrition rollout.
This is the plan of record supplied by the user on 2026-07-09; it supersedes the earlier
R1–R6 draft (no R-item was ever started — ignore R-ids in old discussion).

The v1 tool (PR #149, merged; `app/tools/recipe-standardizer/`, live at
`/tools/recipe-standardizer`) imports ChatGPT-converted recipes as strict JSON, displays
them workflow-first, scales, and saves per-user to Firestore. Each ingredient carries a
`nutritionLink` stub (`linked | likely | unlinked`, food-item id + confidence) that
name-matches the CalorieTracker's saved foods — but the link is recorded, not used. This
rollout adds: confirming/managing links (P1), gathering nutrition for unlinked
ingredients via ChatGPT paste-back (P2), computing full recipe nutrition (P3), exporting
a finished recipe as a normal tracker food (P4), docs/hardening (P5), and two optional
late phases (P6 diary logging, P7 in-site Gemini).

**Constraint carried forward:** no AI API calls from the website in the core flow (P0–P5).
The user runs prompts in ChatGPT manually and pastes strict JSON back — same pattern as
recipe import. (The repo has Gemini Edge-route infra — `app/lib/aiConfig.ts`,
`app/lib/aiModels.ts`, used by Show Tracker — which only optional P7 may reuse.)

## Parameters (for `backlogs/protocol.md`)

- **Branch strategy (overrides the protocol's single long-lived branch; everything else
  in the protocol applies unchanged):** one branch and one PR **per phase**, started
  from fresh `origin/main` after the previous phase merges:
  `working/recipe-standardizer-p<N>`. Web/remote sessions may be pinned to a `claude/*`
  branch — fine, per protocol.
- **Commit scope:** `recipe-standardizer`; item ids `P<N>` = phases 0–7 (next new id:
  **P8**; never reuse ids). Work phases strictly in order; P6/P7 are optional — do not
  start them unless the user explicitly asks.
- **Archive:** `backlogs/recipe-standardizer-completed.md`
- **Tests:** `npm test` from repo root (Vitest — new pure libs get `__tests__/` coverage
  like the existing 6 suites); component/page changes also `npm run lint` and
  `npm run build`. Optional deploy-parity check: `npx --yes @cloudflare/next-on-pages@1`
  (delete `.vercel/` afterward — it pollutes local vitest discovery). CalorieTracker
  code is only touched in the possible P6 alternative — if so, also run
  `cd public/tools/CalorieTracker && npm test`.

## Session protocol

Follow `backlogs/protocol.md` with the parameters above.

## Interop contracts (read first — everything bridges through these)

### CalorieTracker food items (`artifacts/default-app-id/users/{uid}/foodItems/{foodId}`)

Verified against source (file:line refs in `public/tools/CalorieTracker/`):

- Doc shape (`food/save.js:67`): `{ name, quantity, ...24 nutrient keys, lastUpdated }`.
  No schemaVersion, no id field inside the doc.
- Doc ID is a name slug (`food/save.js:65`):
  `name.toLowerCase().replace(/[^a-z0-9]/g, '_')`. `setDoc` overwrites on collision —
  collisions must be handled deliberately (getDoc-check first, then ask).
- Nutrients are stored **per 1 quantity-unit, unit-agnostic**. `quantity` is a bare
  numeric multiplier (default 1) with no physical basis — no grams/serving distinction
  exists anywhere in the tracker. Logged amount = `quantity × storedNutrient`.
- 24 canonical nutrient keys (`constants.js:50–77`), units implied by convention, values
  assumed already canonical: `calories` (kcal); `protein, carbs, fat, fiber, omega3`
  (g); `potassium, magnesium, sodium, calcium, choline, vitaminC, vitaminB6, vitaminE,
  iron, zinc, phosphorus` (mg); `vitaminB12, folate, vitaminA, vitaminD, vitaminK,
  selenium, iodine` (mcg).
- Bounds: `NUTRIENT_MAX_BOUNDS` (`constants.js:135–143`), flat `{key: max}` map used to
  clamp inputs.
- ⚠️ **Do NOT add custom fields to foodItems docs.** CalorieTracker's save flow rebuilds
  the whole doc (`setDoc`, no merge) from its fixed shape — any extra field is silently
  dropped on the next edit/resave in the tracker. All recipe-side metadata (grams basis,
  link info, export back-reference) lives on the **recipe** documents.
- Daily entries (`dailyEntries/{YYYY-MM-DD}`, schemaVersion 2, `state/schema.js:71–125`)
  embed copies of per-unit nutrients plus quantity; they never reference foodItem ids.

### The grams-basis bridge (core design decision)

Recipe ingredients are gram-based; tracker foods have no defined physical basis. Bridge
it **on the recipe side**:

- Extend `NutritionLink` (`lib/types.ts`) with `gramsPerUnit: number | null` = "grams of
  this ingredient per 1 quantity-unit of the linked food". Per-gram nutrition =
  `storedNutrient / gramsPerUnit`; an ingredient's contribution =
  `ingredient.quantityG × storedNutrient / gramsPerUnit`.
- Foods created BY the recipe tool are always **per-100 g** (`quantity: 1` = 100 g
  edible portion), so `gramsPerUnit` auto-fills to 100.
- Pre-existing tracker foods: the user supplies `gramsPerUnit` once at link-confirmation
  time ("1 unit of 'Butter' = how many grams?"). A link without `gramsPerUnit` stays
  usable for everything except nutrition math and counts as "not computable" in coverage.

## Current state (what a fresh session inherits)

- Tool code: `app/tools/recipe-standardizer/` — `lib/` (pure: `schema.ts`, `scaling.ts`,
  `shoppingList.ts`, `nutritionMatch.ts`, `stepTextUpdate.ts`, `naming.ts`,
  `display.ts`, `prompt.ts`; Firebase: `firebase.ts`, `db.ts`), `components/`,
  `RecipeContext.tsx`, `__tests__/` (6 files, 60 tests).
- `lib/db.ts` already has `fetchFoodItems(uid)` returning `{id, name}[]` from the
  tracker's collection (`CALORIE_TRACKER_APP_ID = 'default-app-id'`).
- `lib/nutritionMatch.ts`: exact normalized name ⇒ `linked` (confidence 1, no review);
  token similarity ≥ 0.6 (capped 0.95) ⇒ `likely` + review flag; else `unlinked`.
  `applyNutritionMatches` never downgrades a confirmed `linked`.
- Recipes saved as `{name, recipe, createdAt, updatedAt}` at
  `artifacts/recipe-standardizer/users/{uid}/recipes/{id}`; loads re-run the strict
  import validator, so **any schema extension must be additive with defaults** (see
  `parseRecipeJson`'s `readNutritionLink`).
- Firestore rules: explicit owner-only block for the recipe path is in
  `firestore.rules`; the legacy wildcard `artifacts/{appId}/users/{userId}/**`
  (owner-only) already authorizes recipe-tool reads/writes of foodItems. No rules
  changes needed for any phase except possibly P6/P7.
- Conventions (`AGENTS.md`): TypeScript + Tailwind tokens, lucide-react, pure libs with
  Vitest under `__tests__/`, Conventional Commits, update ARCHITECTURE/SECURITY/README
  when fundamentals change.

## Risk register / bridging notes

- **Unit ambiguity is the #1 correctness risk.** Everything hangs on the per-100 g
  convention for created foods and explicit `gramsPerUnit` for pre-existing ones. Never
  infer a basis silently; "unknown basis" ⇒ excluded from math + surfaced.
- **Slug collisions overwrite** in the tracker's own save flow — the recipe tool must
  always getDoc-check before setDoc and ask.
- **Never write extra fields to foodItems docs** (tracker resaves drop them). All
  metadata lives on recipe docs.
- **Linked-food drift:** tracker-side edits change nutrition under a link silently —
  acceptable (that's how the tracker works), but show `matchedName` vs current name
  mismatch as a soft "re-review" hint (cheap check during the P3 fetch).
- **Raw-vs-cooked:** computed nutrition is raw-ingredient-based; per-100 g-cooked
  requires final weight. Label accordingly; encourage filling `actualFinalWeightG`
  (field already exists in Overview).
- **Firestore rules deploys are manual** — any phase touching rules (only P6/P7 might)
  must call this out in its PR.
- Carried-over v1 invariants still apply: strict-JSON import with exact-path errors;
  saved-recipe edits route through `SaveChoiceModal` (no silent overwrites); nutrition
  linking never blocks importing or saving; shopping/grocery views stay derived from
  ingredients.

## Verification (every phase)

- `npm test`, `npm run lint`, `npm run build`; optional
  `npx --yes @cloudflare/next-on-pages@1` parity check (delete `.vercel/` afterward).
- End-to-end against the Cloudflare Pages branch preview (each PR gets one): exercise
  the phase's acceptance line with a real recipe import. Live-Firebase steps are
  user-verified — list the manual steps in the PR body.
- Cross-tool check for P2/P4/P6: open `/tools/CalorieTracker/index.html` as the same
  user and confirm the created/exported food (and logged entry, P6) appears and
  computes correctly in the tracker's own UI.

---

## Active items (work strictly in order; P6/P7 only on explicit user request)

### P0 — Post-merge housekeeping (do first, ~10 min, user-assisted)

- [ ] **P0 Deploy rules + production smoke test.** Deploy `firestore.rules` to Firebase
  (manual, Firebase console/CLI — the repo file is source of truth but doesn't
  auto-deploy; the tool currently works only via the legacy wildcard rule). Smoke-test
  production: import a recipe, save, reload, run nutrition match. Agent's role: remind
  the user, provide the exact steps, and record confirmation here; no code. Do not
  block P1 coding on this, but flag it in every PR until confirmed.

### P1 — Link management UI (confirm / pick / unlink + grams basis)

- [ ] **P1 LinkEditor + `gramsPerUnit`.** Goal: the user can resolve every
  `likely`/`unlinked` badge into a confirmed link or an explicit no-match, and record
  `gramsPerUnit`.
  - `lib/types.ts`: add `gramsPerUnit: number | null` to `NutritionLink`; update
    `UNLINKED_NUTRITION`.
  - `lib/schema.ts` → `readNutritionLink`: accept the new field (number > 0 or null) —
    additive; old saved recipes parse with null.
  - `lib/db.ts`: extend the food fetch to also return each food's `quantity` and
    nutrient values (full doc read, same collection) — needed by P3–P5. Keep
    `FoodItemRef` for matching; add `FoodItemFull`.
  - New component `LinkEditor` (modal or inline expansion in Ingredients → Recipe
    Workflow mode, launched from the nutrition badge): shows current status; **Confirm**
    (`likely` → `linked`), **Pick from list** (searchable dropdown over fetched foods,
    reuse `nameSimilarity` for sort), **Unlink / mark as no-match**, and a
    grams-per-unit input (prefill 100 when the food was recipe-created; required before
    "computable"). Confirming sets `status: 'linked'`, `needsUserReview: false`.
  - Link edits mark the draft dirty → existing update/save-as-new/cancel flow already
    guards persistence (no new save logic).
  - Tests: schema round-trip of `gramsPerUnit`; pure `lib/linking.ts` helper if
    non-trivial logic emerges (e.g. `isComputableLink` predicate).
  - Accept: every badge is clickable; a confirmed link with grams basis survives
    save/reload; old recipes still load.

### P2 — Ingredient nutrition intake via external AI (paste-back)

- [ ] **P2 Nutrition prompt + import + food creation.** Depends: P1. Goal:
  batch-generate a ChatGPT prompt for all unlinked ingredients, paste strict JSON back,
  create real tracker foods (per-100 g), auto-link.
  - `lib/nutritionPrompt.ts` (pure): `buildNutritionPrompt(ingredients: {name, prepNote}[])`
    — instructs ChatGPT to return strict JSON only:
    `{ "schemaVersion": 1, "foods": [{ "ingredientName": "", "per100g": { <all 24 canonical keys, numbers> }, "confidence": "high|medium|low", "notes": "" }] }`,
    values per 100 g edible portion, canonical units listed explicitly (embed the
    kcal/g/mg/mcg unit table per key), estimate-and-flag when uncertain, no commentary.
    Include the ingredient list verbatim.
  - `lib/nutritionImport.ts` (pure, mirrors `schema.ts` style): `parseNutritionJson(raw)`
    → exact-path errors; clamp each value to a local copy of the tracker's
    `NUTRIENT_MAX_BOUNDS`. Duplicate the 24-key bounds + canonical-keys list into
    `lib/trackerNutrients.ts` with a pointer comment to
    `public/tools/CalorieTracker/constants.js` — the static tool is a separate JS
    package, don't import across.
  - `lib/db.ts`: `createFoodItem(uid, name, per100g)` — writes
    `{ name, quantity: 1, ...nutrients, lastUpdated: new Date().toISOString() }` with
    the slug doc id. **Collision handling:** getDoc first; if the slug exists, do not
    overwrite — offer "link to existing food instead" or "rename and create".
  - New component `NutritionIntakePanel` (entry points: the unlinked summary in
    Ingredients mode, and P3's coverage warning): step 1 copy prompt (unlinked
    ingredient names auto-included), step 2 paste JSON, step 3 review table (name →
    matched ingredient, calories sanity column, confidence) with per-row accept/skip,
    then create foods + auto-link (`status: 'linked'`, `gramsPerUnit: 100`,
    `matchConfidence: 1`). Rows whose `ingredientName` matches no current unlinked
    ingredient: show and let the user assign or skip (don't hard-fail the batch).
  - Tests: prompt content (units table present, names embedded), parser
    errors/clamping, slug collision logic (pure part).
  - Accept: recipe with N unlinked ingredients → one prompt → one paste → N new tracker
    foods visible in CalorieTracker's own search, ingredients linked with grams basis,
    recipe saved with links.

### P3 — Recipe nutrition computation & display

- [ ] **P3 `lib/nutrition.ts` + Nutrition panel.** Depends: P1 (P2 for full coverage).
  Goal: show what the recipe actually contains, honestly scoped to link coverage.
  - `computeRecipeNutrition(recipe, foods: Map<foodItemId, FoodItemFull>, factor)` →
    `{ totals: Record<nutrientKey, number>, coveredGrams, totalGrams, uncomputable:
    {ingredientId, reason: 'unlinked'|'no-grams-basis'|'no-weight'|'food-missing'}[] }`.
    Contribution = `quantityG × factor × nutrient / gramsPerUnit`. Optional ingredients
    included by default with a toggle.
  - Derivations: per serving (`baselineServings`), per portion
    (`portionCount`/`portionSizeG`), per 100 g cooked
    (÷ `actualFinalWeightG ?? estimatedFinalWeightG`, labeled "estimated" when using
    the estimate — note in UI that nutrition is computed from raw ingredient weights;
    water loss is why per-100 g-cooked needs the final weight).
  - New **Nutrition** accordion panel in `RecipeWorkspace` (nav becomes Overview /
    Ingredients / Prep / Cook / Nutrition / Scaling / JSON): coverage banner ("87% of
    ingredient grams linked — 2 ingredients missing", CTA → P2 panel / P1 editor),
    compact macro row + expandable full 24-nutrient table, per-total/serving/portion/
    100 g toggle. Respects the live scale factor.
  - Stale-food handling: if a linked `foodItemId` no longer exists, surface it in
    `uncomputable` and flag the badge for re-review (don't crash, don't silently zero).
    Cheap drift hint: show `matchedName` vs current food name mismatch as "re-review".
  - Fetch foods once per recipe session via `RecipeContext` (reuse P1's `FoodItemFull`
    fetch); recompute pure-side on draft/factor changes.
  - Tests: contribution math incl. `gramsPerUnit` division, coverage accounting, per-X
    derivations, missing-food and no-basis paths.
  - Accept: fully-linked recipe shows plausible totals that scale with the working-copy
    factor; partially-linked recipe clearly shows coverage and never presents partial
    totals as complete.

### P4 — "Linking off": export recipe as a tracker food

- [ ] **P4 Recipe export.** Depends: P3. Goal: one click turns the finished recipe into
  a normal CalorieTracker food so portions are logged inside the tracker.
  - Export button in the Nutrition panel (enabled when coverage = 100% of weighed,
    non-optional grams — otherwise confirm with an "exports partial nutrition" warning).
  - Basis: per portion when portion data exists (nutrients = totals / portionCount,
    food name `"{Recipe Name} (1 portion)"`), else per 100 g cooked (needs final
    weight; name `"{Recipe Name} (100 g)"`). `quantity: 1`. Same slug + collision
    handling as P2 (re-export of the same recipe → offer overwrite — the natural
    "update the food after editing the recipe" path).
  - Store a back-reference **on the recipe doc** (never on the food doc):
    `export: { foodItemId, basis, exportedAt, nutritionSnapshotHash }` → UI shows
    "exported / recipe changed since export — re-export?".
  - `lib/schema.ts`: accept the optional `export` block additively.
  - Tests: per-portion vs per-100 g basis math, snapshot-hash staleness detection.
  - Accept: exported recipe appears in CalorieTracker's food search; logging
    `quantity: 2` there yields 2 portions' nutrients; editing the recipe shows the
    stale-export indicator; re-export updates the same food doc.

### P5 — Docs, polish, and hardening pass (small; before optional phases)

- [ ] **P5 Docs + migration sanity + UX debt.** Depends: P4.
  - Update `ARCHITECTURE.md` (Recipe Standardizer section: link management, nutrition
    pipeline, export contract, the do-not-add-fields-to-foodItems rule), `SECURITY.md`
    (recipe tool now writes foodItems — same-user only), `README.md`, and the
    tools-page card description.
  - Migration sanity: load every pre-existing saved recipe shape in tests (fixture
    without `gramsPerUnit`/`export`).
  - UX debt: persist Ingredients-mode checkbox ticks per recipe (localStorage, keyed by
    recipe id — follow `app/tools/transcriber/lib/settings.ts` versioned-object
    pattern); confirm P1's pick-list closed the old "likely match review" gap.

### P6 — OPTIONAL: direct diary logging from the recipe tool

- [ ] **P6 "Log a portion to today."** Do NOT build unless the user explicitly asks
  (deliberately last: duplicates tracker-owned logic). Writes
  `dailyEntries/{YYYY-MM-DD}` exactly per v2 schema (`state/schema.js:71–125`): append
  `{id: crypto.randomUUID(), name, quantity, timestamp, ...perUnitNutrients}` to
  `foodItems[]`, add `quantity × nutrient` into top-level totals, set
  `schemaVersion: 2`, preserve all other fields (read-modify-write of the whole doc).
  Risks: schema drift with the tracker, concurrent same-day edits. Recommendation:
  only build if logging inside the tracker (P4 flow) proves annoying in practice;
  prefer a small CalorieTracker-side "import from recipe" instead if drift worries
  grow (that alternative touches tracker code → run its test suite).

### P7 — OPTIONAL: in-site Gemini enrichment

- [ ] **P7 Edge route for nutrition enrichment.** Do NOT build unless the user
  explicitly asks (relaxes the no-AI-calls stance — ship only if the manual round trip
  proves tedious). One Edge route (`app/api/recipe-nutrition/route.ts`) reusing
  `app/lib/aiConfig.ts` + `AVAILABLE_GEMINI_MODELS`, returning the exact same JSON
  contract as P2's paste-back so it's just a second entry point into
  `parseNutritionJson` → review table → create foods. Gate the button on key
  availability (mirror Show Tracker's pattern). Update `SECURITY.md` (new API
  surface); the route must not be admin-gated but should require Firebase auth if any
  server secret is spent per call (follow `app/lib/verifyFirebaseAuth.ts` precedent).
