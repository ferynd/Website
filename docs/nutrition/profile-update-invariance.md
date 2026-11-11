# V6: profile updates do not change saved meals or diary entries

Rollout decision V6 (James, 2026-11-10): prove with tests that updating an ingredient profile never silently changes a saved recipe or a historical diary snapshot. V6 runs beside catalog batch scaling and does not gate it.

Suite: [profileUpdateInvariance.test.js](../../public/tools/CalorieTracker/nutrition/profileUpdateInvariance.test.js), added to the CalorieTracker `npm test` list. Tests and docs only; no production code changed. Both write flags stay false, and the suite does not mock them. The shipped catalog and [source-match-table.json](source-match-table.json) are unchanged.

## Result

No invariance violation was found. A profile update is a new revision. A saved meal record, its recalculation, a diary entry built from it, a re-portion of that entry, a freshness check, and a logged diary day all keep revision 1's values after revision 2 exists. Totals change only through the explicit `rebuildMealRecord`. That function returns a new, unsaved record pinned to revision 2 and leaves the original record, the entry, and the day as they were. Editing a saved record in place to look like revision 2 fails `verifyMealRecord`.

## Model

All values are synthetic. Ingredient A (raw, 200 g) and ingredient B (cooked, 300 g) form a 2-serving meal. The meal goes through the real Import workspace steps: import, match against pinned revision-1 profiles, calculate, fit, review, then `buildMealSnapshot`. The test adds the unhashed store fields (`namespace`, `version`, `versionId`) that `mealStore.saveMealVersion` would add, then builds a 1-serving diary entry and plans adding it to an empty day.

Then the update: `buildRevisionDraft` drafts revision 2 of ingredient A with revision 1 as `base` and different values (150 to 210 kcal per 100 g, plus changed protein, carbohydrate, and fat). Revision 2 has the same variant, a new revision number and revision id, a new content hash, and a `supersedes` pointer to revision 1. A fixture test confirms that the meal's totals really come from revision 1 and that revision 2 would give different totals, so a silent switch would be visible.

## Cases

| # | Requirement | Test (`describe` › `it`) |
| --- | --- | --- |
| 1 | Saved meal record byte-identical; content hash still verifies | `case 1: the saved meal record is byte-identical and its content hash still verifies after revision 2 exists` |
| 2 | `recalculateMealRecord` returns revision-1 totals | `case 2: recalculateMealRecord still returns the revision-1 totals (pinned data only, never the new head)` |
| 3 | Diary entry keeps frozen totals and snapshot; `readDiaryItem` returns originals | `case 3: the diary entry keeps its frozen totals and snapshot, and readDiaryItem returns the original values` |
| 4 | `reportionDiaryMealEntry` scales frozen totals | `case 4: reportionDiaryMealEntry scales the frozen totals, not the revision-2 values` |
| 5 | Freshness check reports new data and does not mutate the entry | `case 5: checkMealEntryFreshness against the revision-2 head reports new data and does not mutate the entry` |
| 6 | Drafting revision 2 does not mutate revision 1 | `case 6: drafting and validating revision 2 does not mutate the revision-1 document` |
| 7 | Only the explicit rebuild changes totals: new record, pinned to revision 2, original unchanged | `case 7: only rebuildMealRecord changes totals, as a NEW record pinned to revision 2; the original is unchanged` |
| 8 | Logged day not altered; day-hash guard carries the frozen entry | `case 8: a diary day holding the frozen entry is not altered by the update, and the day-hash guard still matches` |
| 9 | In-place edit to look like revision 2 is rejected | `case 9: a saved record edited in place to look like revision 2 fails verifyMealRecord` |

Two fixture tests sit beside the nine cases. One checks that revision 2 is a genuinely different revision of the same variant. The other checks that both real write flags are false. All tests are under `V6 fixture sanity` and `V6 profile update does not change saved meals or diary entries`.

## Adjustments to the brief

The code differs from the brief's wording in a few places. The suite follows the code.

- `checkMealEntryFreshness(entry, heads)` takes a map from variant id to a head number or a head document (`headRevision`), not a revision document. Case 5 passes a head document built from revision 2 and also a numeric head.
- `planDiaryMealAdd(dayDoc, entry, expectedDayHash)` guards against a day that changed since it was read, for example in another tab. It is not specific to profiles. Case 8 shows that the day hash read before the update still matches afterwards, that a further add succeeds and carries the frozen entry, and that a day changed in place (as a silent recalculation would change it) is refused with `stale_day`.
- `buildDiaryMealEntry` needs a saved record. The suite adds the store fields directly rather than going through the flag-gated meal store. Those fields are outside the content hash (`MEAL_STORE_FIELDS`).
- `rebuildMealRecord` returns an unsaved record, so `buildDiaryMealEntry` refuses it (`meal_not_saved`) until it is saved. Case 7 asserts that and then shows that a new entry from the rebuilt record, once stamped as version 2, has revision-2 totals while the old entry keeps revision-1 totals.
- `readDiaryItem` never reads a library. It passes the entry through with its parsed ref. Case 3 asserts identity (`read.item === entry`) and that every v1 value is unchanged.

## Guards, not regressions

Every test passes on the pre-V6 code at base `5a618bf`, because V6 adds no production change. These tests are guards. To check that they would catch a real violation, each of the following production edits was applied temporarily, the suite was run, and the file was restored (git confirmed clean afterwards):

| Temporary violation | Tests failed |
| --- | --- |
| `rebuildMealRecord` writes the new ref into the input record | 2 of 11 (cases 7, 9) |
| `buildRevisionDraft` mutates its `base` revision | 1 of 11 (case 6) |
| `verifyMealRecord` skips the content-hash check | 1 of 11 (case 9) |
| `checkMealEntryFreshness` writes into the entry when behind | 1 of 11 (case 5) |
| `reportionDiaryMealEntry` reads values other than the frozen snapshot | 1 of 11 (case 4) |
| Recalculation ignores the pinned per-100 g inputs | 11 of 11 (the meal snapshot itself is refused as `calculation_stale`) |

## Coverage gaps

- **Flag-gated stores.** `ingredientStore.saveRevision` and `mealStore.saveMealVersion` are not exercised here. The existing store test (flags mocked, fake port) shows that a profile update writes a new revision document and moves the variant head. It does not assert that the revision-1 document stays byte-identical in the store. The live-store path is covered by the #79 beta validation, not here.
- **UI paths.** The Import workspace and Library UI are not exercised: the freshness notice display, the "recalculate" action, and the flow that saves a rebuilt record and logs a new entry. Only the pure functions they call are tested.
- **Legacy diary writer.** `services/firebase.js` and diary persistence are not used. The suite tests the day document that `planDiaryMealAdd` returns, not a stored day.
- **Content hash is not a signature.** `verifyMealRecord` detects an in-place edit. A writer that re-stamps both the content hash and the idempotency key from edited content would produce a record that verifies. Detecting that relies on the meal store being append-only (`supersedes`, version history) and on Firestore rules, which are outside this suite. Case 9 shows that re-stamping only the content hash is caught (`idempotencyKey`).
- **Nested meals.** A saved meal used as a line of another meal is not covered for profile updates. Its pin is a meal version, and freshness reports it the same way, but no V6 case updates a nested meal.

## Counts

Run on 2026-11-11 at base `5a618bf`, with the suite added:

- Targeted: `profileUpdateInvariance.test.js` 11 passed (11).
- CalorieTracker `npm test`: 49 files, 1202 tests passed (1191 before, plus 11 new).
- Root `npm test`: 115 files, 2156 tests passed.
- `npm run ci:docs`: PASS. `npm run ci:contract`: PASS.

## Rule going forward

A profile update lands as a new revision. It never edits an earlier revision document. Saved meal records pin a revision and its content hash and calculate only from their own pinned inputs. Diary entries hold a frozen snapshot and are re-portioned from it. A newer head produces only the notice "New data available…". A saved meal or a diary entry changes only through the explicit actions: `rebuildMealRecord` makes a new record, which is reviewed and saved as a new version, and a new diary entry is made from that version. Any change that would let recalculation, re-portioning, reading, or a freshness check resolve a live head must fail this suite.
