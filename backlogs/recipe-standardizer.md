# Recipe Standardizer → Nutrition Tracker Rollout

Active feature backlog for the core nutrition integration. PR #153 is the current UI/workflow baseline: Recipe schema v2, named prep groups/results, structured timeline, workflow validation, and v1 compatibility are already merged.

Core P0–P5 remains a manual ChatGPT paste-back workflow; no site AI API calls. P6/P7 require explicit user approval.

## Parameters

- **Branch/PR:** one fresh branch and PR per phase from current `main`: `working/recipe-standardizer-p<N>` where possible.
- **Commit scope:** `recipe-standardizer`; phase IDs P0–P8; next new ID P9; never reuse IDs.
- **Archive:** `backlogs/recipe-standardizer-completed.md`.
- **Checks:** root `npm test`; component/page changes also `npm run lint` and `npm run build`. CalorieTracker code changes also require `cd public/tools/CalorieTracker && npm test`.
- **Manual verification:** use the same Firebase account in Recipe Standardizer and Nutrition Tracker; verify created/exported foods in the tracker UI.

## Current verified state

- Recipe data uses `schemaVersion: 2`; v1 loads through a non-mutating compatibility path.
- Workflow structure includes typed prep groups, named step results, timeline references, chronology/cycle validation, and a site-owned technique glossary.
- Each ingredient carries a `nutritionLink` with status `unlinked|candidate|confirmed|no-match` (legacy `linked|likely` read as `candidate`), plus `gramsPerUnit` and a target revision fingerprint for confirmed links. Automatic name matches are only candidates; confirmation is explicit via the LinkEditor, and stale (deleted/renamed/revised) targets are derived on load (P1, PR #163).
- P2 (PR #164) adds a paste-back nutrition prompt, strict per-100g parser, review table, and create-only tracker food transaction; accepted rows auto-confirm links with `gramsPerUnit: 100`.
- P3 (PR #167) adds a pure nutrition calculator (`lib/nutritionCalc.ts`) with covered/total grams and explicit not-counted reasons, display formatting (`lib/nutritionFormat.ts`), and a Nutrition panel after Execution (total, per serving, per portion, per 100g cooked) with live scaling.
- Recipes remain one private Firestore document at `artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}`.
- Nutrition Tracker foods remain at `artifacts/default-app-id/users/{uid}/foodItems/{foodId}`. The accidental namespace is a migration concern tracked by AR-08/AR-16. Migration plan: ARCHITECTURE → Nutrition Tracker namespace migration (F-141).

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
- P4 (PR #168) exports a recipe as one tracker food per portion or per 100 g cooked (single transaction, create-only or verified own-target update) with a `recipe.nutritionExports` back-reference + snapshot hash and stale/edited/deleted indicators.
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

### P6 — Optional direct diary logging

- [ ] **Log a portion directly to a daily entry.** Depends: P4. Do not start without explicit approval.
  - This duplicates tracker-owned schema/write logic and carries whole-day concurrency risk; prefer a tracker-side import if practical.

### P7 — Optional in-site Gemini nutrition enrichment

- [ ] **Add an authenticated, rate-limited Gemini route as an alternate P2 input.** Depends: P2. Do not start without explicit approval.
  - Reuse the exact P2 parser/review/write path and update Security/API tests.

### P8 — Persist ingredient checklist ticks (optional UX)

- [p] **Persist Shopping/Grocery checklist ticks per recipe in one versioned localStorage object.** Depends: P5.
  > pushed — saved-recipe checklist hydration/persistence with stale-key pruning, 50-recipe LRU cap, safe storage wrappers, deletion cleanup, and device-local docs; checks: npm test (2441), npx tsc --noEmit, npm run lint, npm run build pass; commit: f2dab71; PR: #178
  - Add `lib/checklistStore.ts`, key `recipe-standardizer:checklist`, value `{ version: 1, recipes: Record<recipeId, { keys: string[]; updatedAtMs: number }> }`.
  - Pure `parseChecklistStore(raw: unknown)` returns an empty store for invalid values, drops non-string keys, and caps at `MAX_RECIPES = 50` by LRU on `updatedAtMs`.
  - SSR-safe `readChecklist(recipeId)` and `saveChecklist(recipeId, keys)` guard `typeof window` and catch storage failures.
  - Only saved recipes persist; unsaved imports keep ephemeral ticks; deleting a recipe removes its local entry best-effort.
  - Keys use the normalized shopping-list key; prune stale keys after mount against current shopping keys.
  - **Accept:** parser, LRU, storage round-trip/failure/removal, and stale-key helper tests pass; Shopping and Grocery modes share hydrated ticks; docs state local-only, per-device, not synced.

## Audit reconciliation

PR #153 resolved F-094 (prompt/parser contract) and F-095 (workflow graph validation). Do not recreate those fixes. P5 addresses F-093 with bake review and persisted annotations, and F-096 client-side with revision transactions (rules-level enforcement remains an AR-16 residual). F-141's migration plan is documented in ARCHITECTURE; execution remains under AR-08. F-097/F-143 are confirmed closed by P1/P3: automatic/legacy links stay candidates until explicit gram-basis confirmation; target revision/fingerprint is revalidated on load, stale targets are excluded from calculations, and transactions re-verify source targets. Source-namespace provenance follows F-141 M1; actor provenance is inapplicable to single-owner recipes.

P5 manual verification remains for the user in two signed-in tabs: update/update and overwrite/repeated conflict, update/delete and save-as-new, export versus stale editor and stale export, legacy revision 0 → 1, bake review/save/reload/edit confirmation in all views, owned-only primary export disabled with row re-export available, tracker export/edited/deleted target smoke, per-recipe checklist reset, and offline update failure. No production writes or browser smoke were performed by the implementer.
