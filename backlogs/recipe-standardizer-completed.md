# Recipe Standardizer — Completed Items Archive

Completed items are moved here from `backlogs/recipe-standardizer.md` by the reconcile
step in `backlogs/protocol.md` (only after their commits merge to `main`).

Pre-backlog context: the v1 tool itself shipped in PR #149 (merge `3dd5bd1`) before this
backlog existed — strict-JSON import, workflow sections, gram-first scaling, Ingredients
hub, per-user Firestore saves, and name-only nutrition links.

## Completed phases (P0–P7, in order)

### P1 — Confirmed links and grams basis

- [x] **Add LinkEditor and revision-ready link state.**
  > Resolved: candidate/confirmed/no-match link states with derived stale (missing/renamed/revised) detection, `gramsPerUnit` basis, full TrackerFood fetch, searchable LinkEditor using the existing save guard; findings F-097, F-143; checks: npm test, lint, tsc, build pass, Codex review clean; merged: 56aa175 (commit ae90b0f, PR #163); residual risk: legacy automatic links re-surface as candidates needing re-confirmation; namespace/source discriminator (F-144) deferred to P5.

### P2 — Paste-back nutrition intake and safe food creation

- [x] **Generate one external-ChatGPT prompt, parse strict nutrition JSON, review, and create per-100g foods.**
  > Resolved: versioned nutrition prompt (24 canonical nutrients), strict per-100g parser with exact-path errors and bounds, review table (create/skip/reassign/rename/link-existing), collision-checked create-only tracker food transaction with in-transaction guard reads, auto-confirmed 100 g links; checks: npm test (1491), test:rules (104), lint, tsc, build pass; Codex review 14 findings over 6 rounds all fixed, final round reviewed clean by Claude Opus + Grok; merged: e3ba33d (commit edf0700, PR #164); residual risk: P2 UI live since 2026-10-20 deploy e099df19, manual tracker-side verification of created foods not yet recorded by user.

### P3 — Recipe nutrition calculation and display

- [x] **Compute totals with honest coverage and source-state handling.**
  > Resolved: pure calculator (`lib/nutritionCalc.ts`) returning totals, covered/total grams, and explicit not-counted reasons (unlinked/candidate/no-match/stale/unknown basis never become zero); display formatting (`lib/nutritionFormat.ts`); Nutrition panel after Execution with coverage, compact macros, expandable full table, total/per serving/per portion/per 100g cooked bases, estimated-weight labels, live scaling; bake-scale portion fix; findings F-097, F-143; checks: npm test (1684), lint, tsc, build pass; Codex review 7 findings over 3 rounds + Claude Opus full-PR review (1 P2) all fixed, final round reviewed clean by Claude Opus; merged: 1fe6435 (commit bca3e18, PR #167); residual risk: deferred P3 nits (0.001x/1000x float-edge snapping, bound tests for other modes, overflow gap-note copy); manual signed-in smoke not yet recorded.

### P4 — Export a recipe as a Nutrition Tracker food

- [x] **Export per portion or per 100g cooked with collision-safe update behavior.**
  > Resolved: 1× export per portion (preferred) or per 100 g cooked (measured final weight required), basis chooser on first export, partial-coverage confirmation (incl. lower-bound/zero-filled nutrients), `recipe.nutritionExports` back-ref + nutrition snapshot hash on the recipe only, single transaction (create-only or verified own-target update with reviewed-target binding and overwrite confirmation), stale/edited/deleted indicators, docs; no rules change; checks: npm test (1833), lint, tsc, build pass; Claude Opus full-PR review (6 P2) + Codex review (3) + Claude targeted review (1 P2) all fixed, final round reviewed clean by Claude Opus; merged: 4b7f024 (commit 576e518, final head 5009f5f, PR #168); deployed 2026-10-21 13:50 CDT (version c3760465); residual risk: Codex P2 on 5009f5f (Export button enabled when only the already-exported basis is available, `NutritionExportCard.tsx:180`) deferred to P5; no component tests for modal UI fixes; manual signed-in smoke not yet recorded.
