# Requirements review — 2026-11-09

Planning record for James's nutrition direction of 2026-11-09, about 16:29 CT. This file does not enable writes, live food pulls, population, or paid APIs. The census section records aggregate counts only. It does not contain a backup, a user id, a document path, a food name, or a nutrient value.

Code was read on `main` at `497f941` (#196). PR #197 merged as `da04c70` and keeps private profile saves open as #69 Part B. A merge to `main` auto-deploys the Cloudflare Worker `jamesberto-website`. That is a site-code deploy. It is not a Firestore rules deploy, a write-flag change, or catalog population.

## Marks

| Mark | Meaning in this review |
| --- | --- |
| Implemented | The behavior is in repository code on `main`. |
| Tested | An automated test covers that claim. |
| Deployed | Production Firestore rules, write flags, or a confirmed live data operation. Not claimed from a code merge. |
| Populated | The curated catalog contains nutrition profiles. It does not. `public/shared/nutrition/catalog/nutrition-curated/manifest.json` has `profileCount: 0`. The research queue has 1,114 identities, all `queued`. |

Classes: **(1)** already satisfied, **(2)** needs code, **(3)** tracked but unfinished, **(4)** needs a new or updated backlog item.

## Approval recorded here

James approved only the read-only #60 Part B census and backup. The parent ran it. Agents must not query, export, or write production Firestore. Enabling `NUTRIENT_V2_WRITES_ENABLED`, rules deploys, live FDC, catalog import, and every other Part B gate stay unapproved.

## Production census

Read-only census and backup of project `jlb-calorietracker`, 2026-11-09 about 16:32 CT. The parent ran it. The 609-document backup stays private and off-repo. These are the aggregates:

| Aggregate | Count |
| --- | --- |
| Documents backed up | 609 |
| Users | 1 |
| Food documents | 191, all v1 |
| v2 food documents | 0 |
| Non-numeric legacy food documents | 0 |
| Food-document id collisions | 0 |
| Daily entries | 417 |
| Food elements inside daily entries | 3200 |
| Food-element collisions | 0 |
| Largest daily entry | 8257 bytes |
| Recipes | 1 |
| Confirmed recipe links | 0 |
| Recipe export refs | 0 |
| Timestamp fields reported | 2 |

The in-memory restore round-trip passed. Production food documents from this census are all v1. There are no v2-shaped food documents in that result.

The backup was read through the Firestore REST API with a CLI token because the box has no Application Default Credentials. That read does not keep the Firestore integer-versus-double distinction. Take a fresh Admin SDK backup before any real migration. This REST backup is not that migration copy.

`scripts/firebase/nutrientCensus.ts` still has three bugs, tracked as #80. The script requires Application Default Credentials. It creates the output directory after the existence check and before authentication, so a failed auth leaves the directory and `refuseUnsafeRun` refuses the retry. `isProcessEntry()` does not treat a `vite-node` launch as the script entry, so `main()` is skipped.

## (2) Two permanent flows, one registry

| Claim | Class | Evidence |
| --- | --- | --- |
| Saved foods, direct entry, quantity adjust, quick diary logging, and untouched history still exist | (1) | Legacy Today / Nutrients / staging / `public/tools/CalorieTracker/food/save.js` are still the food path. Import and Library are extra tabs in `public/tools/CalorieTracker/index.html`. |
| New flow is a separate tab | (2) and (4) | The tab exists and is labeled `Import`, not `Ingredient Import (Beta)`. Tracked as #78. |
| Library is its own tab | (1) for the shipped slice | `tab-library` is present. Add, edit, and save are not. Those remain #69 Part B. |
| One registry, profile store, and calculation module | (1) | `public/shared/nutrition/nutrientRegistry.js`, `ingredientStore.js`, and `calculate.js`. Recipe Standardizer imports the same registry. |
| Saving a meal does not auto-log it | (1) for both current paths | `saveWorkspace()` exports or refuses. It does not write a diary entry. Legacy `saveFoodItemToDatabase()` tells the user the food is ready to add; `staging/parser.js` adds to today's log only from a separate staged action. |
| Flat saved foods stay compatible | (1) while v2 writes are off | Food writes stay the 24-number v1 shape. A v1 writer refuses a document whose `nutrientSchemaVersion` is 2 or higher (`food/save.js`, `nutrition/nutrientRecord.js`). |
| Lossless conversion count of existing flat foods | (4) | Not measured. #77 may read a foods-only extract the parent keeps outside the checkout. The committed result is aggregate counts only. It must not query production, commit a document path, food name, id, or nutrient value, or rewrite foods. |

**Implemented / tested / deployed / populated:** coexistence and the no-auto-log save split are implemented and covered by `nutrition/importWorkspace.test.js` (`committed: false`) plus the existing food-save tests. Rules and write flags are not deployed. Nothing is populated.

## (3) Beta isolation

| Claim | Class | Evidence |
| --- | --- | --- |
| Import, match, research, fit, calculate, and review run with production writes off | (1) | `workspaceCapabilities().save` is true only when both write flags are true. Both are `false` in `capabilities.js`. Tests assert that. |
| Save testing uses an isolated Firebase test project | (3) | No test-project runbook or suite exists. #61 Part B still describes production smoke, which is a different approval. Phase 3 owns the isolated project. |
| No silent edits to existing foods or diary | (1) for the beta path | The workspace never calls the food or diary writers. |
| A global nutrient flag must not expose legacy flows to incompatible writes | (2) and (4) | `NUTRIENT_V2_WRITES_ENABLED` is one compile-time switch for food and day shape. Turning it on would change legacy saves. Do not flip it for the beta. Meal snapshots belong in the #64 Part B collection. Legacy food and diary documents stay v1. |
| Old clients and cached PWAs cannot overwrite or drop new fields | (1) for saved foods only; (2) for diary and the cache-name plan | Food save and saved-food CSV import refuse a document whose `nutrientSchemaVersion` is 2 or higher. `saveDailyEntry()` and `saveDailyEntrySnapshot()` replace the day with `setDoc` and do not read its schema, so a cached page can erase newer diary fields. That diary guard is unfinished #60 Part B work. Do not treat it as done. The repository cache is already `nutritrack-v5` while writes are off. This PR updates the #61 runbook so the write-enable PR must pick a new cache name after v5. #75 keeps the compatibility note. The 2026-11-09 census found 0 v2 food documents and 191 v1 food documents. Current repository code does not write v2 documents while the flag is false. |
| Clear failure, and the user can abandon to the old flow | (2) | `cancelWorkspace()` keeps `committed: false`. The Import screen does not yet say that failure leaves Today unchanged, and the tab is not labeled Beta. #78. |

**Implemented / tested:** write flags false, cancel does not commit, v1 refuses a newer food schema. **Deployed:** flags and rules are not deployed as enabled writers. **Populated:** no.

## (4A) Yield, water, fat, and retention

Class **(2)** and **(4)**. New item **#72**.

`fitWorkspace()` in `public/shared/nutrition/importWorkspace.js` does both things James rejected:

- It treats `meal.servingWeight.g`, or else `meal.yield.rawTotal.g`, as an exact sum of the lines that have no `parentLineId`. That set includes compound parents and excludes their children.
- When cooked weight is present and less than or equal to raw weight, it sets `yieldRetention` to `cooked / raw` on the temporary lines passed to `fitQuantities()`. It does not write that ratio back onto `resolution.lines`. `recalculateResolution()` therefore calculates from the original lines, and `workspace.calculation` can omit the ratio the solver just used.

`calculate.js` multiplies grams by `yieldRetention` before scaling per-100 g nutrients. If a line already has retention above 1, below 0, or non-finite, `gramsOf()` returns null and `calculateMeal()` skips that line. `fitWorkspace()` does not create that case. When cooked weight is greater than raw weight, it leaves retention unset, so calculation uses 1 and keeps the line at its full grams. Water gain is not modeled, and it does not drop the line. There is no separate water gain or loss, no fat absorbed or discarded, and no USDA retention factor. A single cooked/raw ratio, when the solver sees it, scales nutrients as if the missing weight were nutrient loss.

Tests that exist: `calculate.test.js` checks one nested `yieldRetention: 0.5`, and `fit.test.js` checks a 0.5 slope. There is no roasted-meat, boiled-pasta, baking, sauce, or mixed-dish regression. `fit.js` does not itself invent the universal ratio; `fitWorkspace()` does, and `calculate.js` applies whatever retention it is given.

**Implemented:** a single optional retention multiplier. **Tested:** only that multiplier. **Deployed / populated:** not a data change.

## (4B) Research response onto a saved revision

Class **(2)** and **(4)**. New item **#73**. The save itself stays #69 Part B.

`validateResearchResponse()` accepts unit, status, source ids, range, confidence, derivation, comparator, qualifier, and bounds. `research/packetProposal.js` can put those on a revision draft. `applyResearchResponse()` does not use that path. It copies only `value` and `status` onto the in-memory workspace line and does not write a revision (`importWorkspace.js`).

**Implemented:** validation and a draft proposal. **Tested:** the workspace apply test checks `source: 'packet'` and `committed: false` only. **Deployed / populated:** no.

## (4C) Official lookup

Class **(2)** and **(3)**. Updated item **#74**, still gated by **#62 Part B** for any live call.

| Claim | Status |
| --- | --- |
| Ladder order: curated/private, official, packet, manual or explicit incomplete | Implemented in `resolution.js` (`LADDER`). A packet is refused until an official attempt exists. |
| A lookup that was not performed must not show as `not_found` | Not satisfied. `lookupWorkspace()` records `outcome: 'not_found'` without contacting a database. `researchLibraryFields()` does the same before building a packet. The Import screen button **Record official miss** (`import-lookup`) calls `lookupWorkspace()` for every unresolved line. The **Import** button only calls `importWorkspaceInput()`. |
| Real deterministic lookup when live sources are enabled | Not implemented. Adapters exist for pinned local FDC fixtures. No live release is pinned. #62 Part B. |
| No re-research of resolved fields | Implemented for a library-resolved line (`matched_line`). Field-gap packets request `missingFields` only when those fields were computed. The Library button does not pass a chosen field list. |

**Implemented / tested:** the ladder and the "packet before official attempt" refusal. **Deployed:** no live source. **Populated:** no.

## (4D) #69 Part B private profiles

Class **(3)**. The item is already active and is updated with James's acceptance detail. It stays unstarted.

Shipped and archived as the search/review slice only: search, gap review, staged research text. `commitLibraryEdit()` returns `writes_disabled`. The Library tab has no add or edit control. `researchLibraryFields()` can accept `ref` and `missingFields`, but `ui/library.js` calls it with the name and owner only, so the packet is not pinned to the selected revision and field list.

Still required, behind the existing false write flag until #61 Part B is approved: add a private profile, edit by creating the next revision, label import and manual verified values, review and save a research result, choose specific missing fields, keep evidence and history, private overrides, curated records immutable.

**Implemented:** search, review, and a disabled commit. **Tested:** writes stay false. **Deployed / populated:** no.

## (4E) #64 Part B meal save

Class **(3)**. The item is already active and is updated. It stays unstarted.

No meal-version store is implemented. `saveWorkspace()` returns an export and `committed: false` even if the flags were on (`save_not_enabled`). There are no tests for meal transaction failure, retry, dedupe, concurrent edits, or an interrupted save. Re-portioning of a saved ingredient meal cannot exist until the meal is stored. Diary snapshots are not recalculated by the workspace because the workspace does not write them.

**Implemented / tested:** export-only refusal. **Deployed / populated:** no.

## (4F) Stale docs and compatibility

Class **(2)** and **(4)**. Item **#75**. This PR corrects the sentences that still say the current cache is `nutritrack-v4` or that calculation, fitting, Import, and Library have not shipped. It does not call those features deployed or populated.

Known stale claims before this PR:

- `docs/nutrition/workflow.md` said the service worker was `nutritrack-v4` and that #64 had not shipped. Part A calculation and #65 fitting are on `main`. Part B saving is not.
- `docs/nutrition/README.md` said the Import workspace, calculation, and fitting had not shipped.
- `public/tools/CalorieTracker/README.md` said the cache and Settings build were `nutritrack-v4` and that there was no Library UI.
- `docs/nutrition/ingredient-store-release.md` told the write-enable PR to bump the cache to `nutritrack-v5`. The repository is already at v5 with writes off. The write-enable PR must choose a new cache name.

Settings already renders `build ${cacheName}` from `capabilities.js`, so the live Settings string follows the constant. The docs did not.

**Implemented:** cache constant `nutritrack-v5`, tested by `sw.test.js`. **Deployed:** this review did not inspect the live worker. **Populated:** no.

## (5) Population

Class **(3)** and **(4)**. #62 Part B and #63 stay gated. New items **#76** (dry-run pilot) and **#77** (flat-food conversion report).

| Fact | Value |
| --- | --- |
| Queue | `docs/nutrition/ingredient-catalog.json`: 1,114 ids, 1,114 `queued`, 0 nutrient values |
| Priority 1 | 253 |
| Priority 2 / 3 | 767 / 94 |
| Curated profiles | 0 |
| Basis policy already written | per 100 g edible form; raw, cooked, drained, fortified, and branded stay distinct |
| Pipeline | #62 local adapters and packets. Live FDC is not pinned. |

A dry-run that uses pinned local fixtures and writes a report is safe. A live USDA or manufacturer pull is #62 Part B and is not approved. Importing the result into the curated catalog is #63 and is not approved. Subscription residual research stays the default; metered APIs stay at $0. The pilot report must include matches, coverage, uncertainty, unresolved fields, validation failures, and the production writes it would make. It must not perform those writes.

#77 estimates how many existing flat foods could convert without loss. It reads a foods-only extract supplied by the parent, kept outside the checkout. The committed result is aggregate counts only. It does not query production, does not commit a document path, food name, id, or nutrient value, and does not rewrite foods.

**Implemented:** the queue and the playbook. **Tested:** catalog JSON checks from #59. **Deployed:** no live source. **Populated:** no.

## (6) Nutrient conventions

Class **(1)** for the registry and calculator definitions. Copy-block placement of FODMAP and adjusted-carb summaries is **(2)** only if a later copy template still mixes them into the Calories-through-Choline block. The registry already separates them.

| Convention | Where |
| --- | --- |
| Historical 24 keys, including choline | `LEGACY_ORDER` in `nutrientRegistry.js` |
| Fat breakdown, omega-3 parts, individual sugar alcohols, allulose | `DETAIL_ORDER` |
| Standard fiber versus project weighted fiber | `fiber` / `fiberTotal` versus calculated `fiberWeightedLegacy`. `calculate.js` computes the weighted value. It is not a stored profile field. |
| Source carbs versus project adjusted carbs | `carbs` stays the source value. `adjustedCarbs()` subtracts fiber when the convention includes it, then allulose and the uncounted polyol fraction. Missing inputs stay unknown. |
| FODMAP | lactose, fructans, GOS, optional excess fructose, plus calculated milk equivalents and scoops |
| Status | `measured`, `label_reported`, `calculated`, `estimated_from_comparable`, `below_quantification_limit`, `unknown`, `not_applicable`, `legacy_unclassified`. Null is unknown, not zero. |

Recipe Standardizer imports the same registry. **Tested:** `calculate.test.js` covers weighted fiber, adjusted carbs, and unknown-not-zero. **Deployed:** not claimed. **Populated:** the curated catalog has no profiles. The 2026-11-09 census found 0 v2 food documents. Current repository code does not write v2 food documents while `NUTRIENT_V2_WRITES_ENABLED` is false.

## (7) Phases

Adopted as the backlog order. Phase 1 is the parent's job. This PR does not start phase 2.

1. **Census and backup.** The parent completed the read-only count on 2026-11-09. Aggregates are above. Writers stay off. The REST backup is not a migration copy. #80 tracks the script bugs. Agents do not run another production census.
2. **Technical corrections and branch work, production writes still off.** #72, #73, #74 lookup honesty, #75, #78, then #69 Part B and #64 Part B behind the existing false flags and emulator or fixture tests.
3. **Beta validation** (#79) in an isolated Firebase test project. Not production. #68 depends on its recorded result. #79 is an active blocked item so phase 3 cannot be skipped by taking the next unchecked production gate.
4. **Priority-1 dry-run pilot** (#76) on pinned local fixtures, plus #77 aggregate counts from a foods-only extract kept outside the checkout. The committed report has no document path, food name, id, or nutrient value.
5. **Controlled enablement**, one gate at a time, each with its own backup and rollback: #62 Part B, named #63 waves, #61 Part B, and only then a writer flag if legacy saves stay on v1. #60's global v2 food/day flag stays off unless a later approval shows legacy flows cannot see an incompatible write.
6. **#68 acceptance** after those gates and a #63 gap report.
7. **#71** stays deferred. Building the route still needs approval.

## Conflicts and dependencies

- **Global v2 flag versus beta isolation.** #60 Part B's writer step and requirement (3) disagree. Keep legacy food and diary writes on v1. Put beta nutrition on meal snapshots. Do not treat "census approved" as "writers approved."
- **Cache bump already spent.** v5 shipped in the repository before writes were enabled. The next writer PR needs a new cache name or cached v5 clients will keep the old writer.
- **Serving weight is not raw weight.** #72 has to land before #68 compares roasted, boiled, baked, or sauced meals with withheld totals. Otherwise the acceptance test would bless the wrong model.
- **`not_found` without a lookup** lets a packet claim an official miss. #74 has to land before a dry-run report counts official misses.
- **#69 Part B and #64 Part B** can be coded with flags false. They cannot be saved in production until #61 Part B (and, for diary detail, a v1-safe projection) is approved. #64 Part B depends on #61 Part B for rules. Affected meals inside #69 stay deferred to #64 Part B.
- **#76 depends on #72, #73, and #74 honesty** for a meaningful coverage report. It does not depend on production writes.
- **Worker auto-deploy.** Any later code PR that merges will update the public site. Flags must stay false in those PRs so the deploy cannot start writing.

## Safe next work

No production approval is required for:

1. **#72** — yield, water, fat, and retention model, with the five regression cases. Pure calculation.
2. **#73** — keep research evidence on the applied draft. Do not enable `commitLibraryEdit()`.
3. **#74** — stop recording `not_found` when no lookup ran. Leave the live adapter disabled.
4. **#75** — remaining compatibility notes. The false cache and "not shipped" sentences are corrected in this PR.
5. **#78** — rename the tab to Ingredient Import (Beta), and make failure and abandon copy say that Today is unchanged.
6. **#69 Part B and #64 Part B** — implement in branches with both write flags false and with emulator or fixture tests. Do not deploy rules or point tests at production.
7. **#76** — dry-run report from pinned local fixtures only.
8. **#77** — aggregate conversion counts from a foods-only extract the parent keeps outside the checkout. Do not query production or commit a path, name, id, or nutrient value.

Still blocked on a further approval: live FDC or manufacturer pulls, catalog import, rules deploy, flipping either write flag, production meal or profile saves, production smoke, and #71.
