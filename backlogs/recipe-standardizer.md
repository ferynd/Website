# Recipe Standardizer → Nutrition Tracker Rollout

Active feature backlog for the core nutrition integration. PR #153 is the current UI/workflow baseline: Recipe schema v2, named prep groups/results, structured timeline, workflow validation, and v1 compatibility are already merged.

Core P0–P5 remains a manual ChatGPT paste-back workflow; no site AI API calls. P6/P7 require explicit user approval.

## Parameters

- **Branch/PR:** one fresh branch and PR per phase from current `main`: `working/recipe-standardizer-p<N>` where possible.
- **Commit scope:** `recipe-standardizer`; phase IDs P0–P7; next new ID P8; never reuse IDs.
- **Archive:** `backlogs/recipe-standardizer-completed.md`.
- **Checks:** root `npm test`; component/page changes also `npm run lint` and `npm run build`. CalorieTracker code changes also require `cd public/tools/CalorieTracker && npm test`.
- **Manual verification:** use the same Firebase account in Recipe Standardizer and Nutrition Tracker; verify created/exported foods in the tracker UI.

## Current verified state

- Recipe data uses `schemaVersion: 2`; v1 loads through a non-mutating compatibility path.
- Workflow structure includes typed prep groups, named step results, timeline references, chronology/cycle validation, and a site-owned technique glossary.
- Each ingredient still carries the existing `nutritionLink` candidate shape (`linked|likely|unlinked`, food ID/name/confidence/review flag). Exact normalized names currently become `linked` automatically; P1 must replace inference-as-confirmation.
- Recipes remain one private Firestore document at `artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}`.
- Nutrition Tracker foods remain at `artifacts/default-app-id/users/{uid}/foodItems/{foodId}`. The accidental namespace is a migration concern tracked by AR-08/AR-16.

## Interop contracts

### Nutrition Tracker food documents

- Shape: `{ name, quantity, <24 canonical nutrient fields>, lastUpdated }`.
- Document ID is a normalized name slug; collisions can overwrite, so every create/export must check first and ask rather than silently replace.
- Nutrients are per one unit, but that unit has no physical basis.
- Do not add recipe metadata to food documents; the tracker rebuilds its fixed shape and drops extra fields.
- Daily log entries embed nutrient snapshots and do not reference food IDs.

### Grams-basis bridge

- Extend recipe-side `NutritionLink` with `gramsPerUnit: number | null`.
- Ingredient contribution = `ingredient.quantityG × storedNutrient / gramsPerUnit`.
- Recipe-created foods use a per-100g basis, so `gramsPerUnit = 100`.
- Existing foods require explicit user-entered gram basis. Unknown basis is excluded from nutrition math and surfaced.
- Nutrition references must eventually record source revision/lifecycle provenance; do not treat a stable ID as proof the food is unchanged.

## Active phases

### P0 — Rules deployment and production smoke test (user-assisted, non-blocking)

- [p] **Deploy current `firestore.rules` and verify the baseline flow.** No code unless deployment evidence reveals a defect.
  > blocked — requires user or deployment automation access; P1–P5 may proceed while this evidence remains pending.
  - Import a schema-v2 recipe, save, reload, and run food matching.
  - Record environment, deployed rules version/date, test account role, and outcome.
  - Keep this open until the user or automation confirms production/non-production deployment.
  - **Accept:** owner can complete the flow; another UID cannot read/write the recipe; deployment evidence is recorded.

### P1 — Confirmed links and grams basis

- [ ] **Add LinkEditor and revision-ready link state.**
  - Add `gramsPerUnit`, explicit inferred/confirmed/no-match/stale semantics, and additive parsing defaults.
  - Fetch full food records needed by later phases while retaining a lightweight matching type.
  - Badge opens a searchable picker with confirm, choose, unlink/no-match, and gram-basis controls.
  - Automatic matching remains a candidate until explicit confirmation.
  - Link edits use the existing update/save-as-new guard.
  - **Findings:** F-097, F-143.
  - **Accept:** confirmed link+basis survives save/reload; old recipes load; deleted/renamed targets surface for review; tests cover schema and link state.

### P2 — Paste-back nutrition intake and safe food creation

- [ ] **Generate one external-ChatGPT prompt, parse strict nutrition JSON, review, and create per-100g foods.** Depends: P1.
  - Prompt includes all 24 nutrient keys and canonical units; output schema is versioned JSON only.
  - Parser returns exact-path errors, finite numeric validation, and bounded values.
  - Review table supports accept/skip/reassign before writes.
  - Check slug collision before write; offer link-existing or rename, never silent overwrite.
  - Accepted rows create tracker foods with `quantity: 1`, auto-confirm the link, and set `gramsPerUnit: 100`.
  - **Accept:** N unlinked ingredients can become reviewed tracker foods and confirmed links; tracker search shows them; tests cover prompt, parser, bounds, matching, and collisions.

### P3 — Recipe nutrition calculation and display

- [ ] **Compute totals with honest coverage and source-state handling.** Depends: P1; P2 for full coverage.
  - Pure calculator returns totals, covered/total grams, and explicit uncomputable reasons.
  - Support total, per serving, per portion, and per 100g cooked; label estimated final-weight use and raw-ingredient assumptions.
  - Missing/deleted/renamed/revised foods never silently become zero or trusted.
  - Add Nutrition panel after Execution with coverage, compact macros, expandable full table, and live-scale support.
  - **Findings:** F-097, F-143.
  - **Accept:** complete and partial recipes are clearly distinguished; results scale correctly; stale targets require review; deterministic fixtures pass.

### P4 — Export a recipe as a Nutrition Tracker food

- [ ] **Export per portion or per 100g cooked with collision-safe update behavior.** Depends: P3.
  - Prefer per portion when portion data exists; otherwise require final weight for per-100g cooked.
  - Warn before exporting partial coverage.
  - Store export back-reference and nutrition snapshot hash on the recipe, never on the food document.
  - Re-export offers an explicit update path and stale indicator.
  - **Accept:** tracker logging multiplies the exported basis correctly; recipe changes show stale export; collision/update tests pass.

### P5 — Hardening, migrations, docs, and remaining touched-code findings

- [ ] **Complete rollout hardening before optional features.** Depends: P4.
  - Test all pre-v2/v2 saved shapes with the additive nutrition fields.
  - Add stale-write/revision conflict handling for multi-tab recipe updates or leave a separately approved AR-16 item with explicit residual risk.
  - Prevent baked scaling from persisting an unscalable equivalent as current without review/annotation.
  - Plan and document migration from `default-app-id` rather than making the accidental namespace permanent.
  - Persist ingredient checklist state in a versioned, per-recipe local store if still desired.
  - Update README, Architecture, Security, tool copy, and cross-tool contracts.
  - **Findings:** F-093, F-096, F-141; confirm F-097/F-143 closure.
  - **Accept:** migration fixtures, concurrent-save tests, baked-equivalent tests, docs, and end-to-end export smoke pass.

### P6 — Optional direct diary logging

- [ ] **Log a portion directly to a daily entry.** Depends: P4. Do not start without explicit approval.
  - This duplicates tracker-owned schema/write logic and carries whole-day concurrency risk; prefer a tracker-side import if practical.

### P7 — Optional in-site Gemini nutrition enrichment

- [ ] **Add an authenticated, rate-limited Gemini route as an alternate P2 input.** Depends: P2. Do not start without explicit approval.
  - Reuse the exact P2 parser/review/write path and update Security/API tests.

## Audit reconciliation

PR #153 resolved F-094 (prompt/parser contract) and F-095 (workflow graph validation). Do not recreate those fixes. The active rollout should close F-097/F-143 in P1/P3 and address or explicitly retain F-093/F-096/F-141 in P5/AR-16.
