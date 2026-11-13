# #63 energy-bound correction and held-import handoff

Date: 2026-11-13. Coordination: [review queue #215](https://github.com/ferynd/Website/issues/215).

## Scope and decision

Correct the per-100 g energy validation limit, without changing source numbers, nutrient identities, persisted schemas, existing profiles, or production write permissions. James authorized ChatGPT to implement bounded fixes and research decisions in the continuation request. The implementation still requires exact-head independent review and successful CI before merge. ChatGPT authored this change; author self-checks are not an independent review.

| Energy per 100 g | Result |
| --- | --- |
| Finite value from 0 through 900 kcal | `ok` |
| Above 900 through 910 kcal, inclusive | `review` |
| Above 910 kcal, negative, or non-finite | `reject` |

The 910 threshold is a small engineering validation margin. It is not a USDA standard, a nutrient estimate, or a claim that a food physically contains 910 kcal per 100 g. The review threshold stays at 900. The legacy per-unit ceiling stays at 10,000 kcal. All other nutrient bounds stay unchanged.

## Evidence and rationale

A universal 900 kcal rejection rule incorrectly treats the general 9 kcal/g fat factor as an exact upper bound for every composition record.

- [USDA FoodData Central FAQ](https://fdc.nal.usda.gov/faq/) explains that energy may use general Atwater factors or food-specific factors from USDA Agriculture Handbook 74.
- [FAO, Food energy: methods of analysis and conversion factors, chapter 3](https://www.fao.org/4/y5022e/y5022e04.htm), section 3.5.3 and Table 3.1, describes food-specific factors. Fat factors extend to 9.02 kcal/g. This supports the plausibility of 902 kcal per 100 g of pure fat.
- The repository's [H4 import report](population-batch-h4-import.md) records beef tallow, FDC 171400, with pinned SR Legacy energy row 1008 = 902 kcal/100 g and derivation NC. The [H5 report](population-batch-h5-import.md) records the same energy/derivation for lard, FDC 171401. Both imports correctly stopped at the previous hard bound.

Evidence limit: this correction independently checks the energy-factor rationale and code path. The two real USDA record values above are taken from the existing import reports. This session did not independently download and rehash the pinned USDA bulk files. Synthetic regression fixtures are explicitly labeled and do not replace raw-record verification.

Never change either source value from 902 to 900. Preserve calculated status and source derivation. Do not authorize other high-energy records merely because they now fit the numeric bound.

## Implementation

- `public/shared/nutrition/nutrientRegistry.js`: hard maximum 910 for kcal, explicit calorie `reviewAbove: 900`.
- `app/tools/recipe-standardizer/lib/nutritionIntake.ts`: derive the calorie intake maximum from the shared registry. Schema 1 now emits a review warning above 900; schema 2 already has this warning path. Neither parser clamps the value.
- The research validator already turns `review` into a warning. Approval already requires acknowledgement of every current warning and a matching content hash. The regression test exercises this with a synthetic 902 draft.
- No catalog record, match-table entry, conversion, writer flag, Firestore rule, API credential, or diary is changed by this PR.

Recipe intake warnings remain the existing user-facing review mechanism. Curated catalog approval has the stronger explicit warning-acknowledgement gate. A numeric value passing parsing is not a source-identity approval or an import authorization.

## Compatibility

Registry version 2, fingerprint keysets, nutrient schema versions, units, and serialized field shapes remain unchanged. This is a validation correction, not a storage migration. Existing source values and revision hashes are not regenerated.

The current tracker service worker uses network-first fetching for JavaScript and for the catalog manifest. A new path or cache namespace is not required for this bound-only change. An offline client with old code can still reject 902; that is a fail-closed compatibility limit, not a reason to weaken source validation. Refresh online before testing the later held-item import. Both production write flags remain false.

## Verification requirements

The branch adds boundary tests for 900, 900.000001, 901, 902, 910, 910.000001, and 911. Additional tests cover non-finite/negative inputs, unchanged legacy limits, both recipe intake schemas, exact 902 preservation, calculated status, unknown energy, synthetic profile construction, and explicit warning acknowledgement before approval.

`public/tools/CalorieTracker/nutrition/nutrientRegistry.test.js` belongs to `unit-calorie-tracker`. New `scripts/nutrition/energyBounds.test.ts` belongs to `unit-core` under `.github/ci/contract.json`.

Required execution: full tracker tests, root tests, lint/build, docs/contract checks, and the complete blocking CI suite at the final head. Record actual results in the PR and issue #215. Writing these tests is not a claim that they passed. The authoring environment could use the GitHub connector but could not fetch the repository/dependencies into its local runtime, so no local full-suite execution is claimed.

## Already resolved: shipped-catalog timeout

H12 already added a 30-second timeout to the single full shipped-catalog integrity test. Main `33a9300b4d2592cadae6f8584d12634eafc17fbf` retains it and pins 467 profiles. This change does not add a duplicate timeout fix, raise the global timeout, disable parallel tests, or remove an assertion.

## Muse next actions

1. Independently review the final energy-bound PR head, including both intake schemas, warning gates, test results, and absence of unrelated changes. Do not merge on author self-review alone. Use the expected-head SHA guard after every required check passes.
2. After merge, rerun only the two held approved identities in a separate append-only import batch: `beef-tallow-as-sold` / SR Legacy 171400 and `lard-as-sold` / SR Legacy 171401. Rehash the pinned release, recheck exact source title/release/identity and all five core fields, retain 902 and NC provenance, and acknowledge the actual high-energy warning with a source-specific reason.
3. Repeat deterministic staging, duplicate/idempotency checks, field replay, V4 catalog and append-only verification, and exact-head independent review. Expected count is 469 only if both pass and no other catalog changes intervene. This code PR does not itself import or approve those records.
4. Record the PR/review/merge milestones in issue #215 and append the actual milestone SHAs to the orchestrator Stage log. Keep the 25-item batch ladder unchanged for further population.
5. Continue the remaining identity-gap work separately. Completion of the 326 approved-pair lane is not completion of the entire catalog. The third-pass review also has 185 held, 21 rejected candidate pairings, and 184 unresolved targets. Reconcile these against current published identities before dispatching fresh candidate bundles. Do not reuse rejected pairings or the unverified Gemini donor sidecar.

No production writes, rules deployment, saved-food/diary migration, paid API operation, or automatic nutrient imputation is authorized here.
