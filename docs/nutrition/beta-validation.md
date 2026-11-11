# V5 / #79: beta validation runbook and record

Rollout decision V5 (James, 2026-11-10): validate the full ingredient creation and update flow in the isolated test environment. This file is the #79 runbook and the V5 record. It covers the verified state of the beta project, the setup it still needs, the live validation script, and the results so far.

The isolated project is `jlb-calorietracker-beta` (display name CalorieTracker Beta). James confirmed it under his #79 confirmation rule on 2026-11-10. Production (`jlb-calorietracker`) is never part of this runbook. The V5 prerequisite save path is merged (PR #218, `267942f`).

**Status: the live run has NOT YET RUN. It is blocked on four console setup steps in the beta project.** Until then, the local evidence is the chained flow test ([betaFlowValidation.test.js](../../public/tools/CalorieTracker/nutrition/betaFlowValidation.test.js)). See [Results](#results).

## Rules for every beta session

- The shipped write flags stay false. `INGREDIENT_STORE_WRITES_ENABLED` and `NUTRIENT_V2_WRITES_ENABLED` in [capabilities.js](../../public/shared/nutrition/capabilities.js) are never changed by this work. Beta enablement happens only inside a local, uncommitted beta build during the live run (step L2), never by flipping the shipped capabilities.
- Production is never contacted. Every Firebase CLI command names `--project jlb-calorietracker-beta` explicitly. Do not run `firebase use`. Do not run any command with `--project jlb-calorietracker`.
- No deploys of Hosting, Functions, Storage, indexes, or Auth. The only rules deploy is the beta-only step L1, and only inside a supervised live run.
- Synthetic data only. Test ingredient names, values, and meals are invented. None of James's food names, values, or diary entries go into the beta project, this file, or the repository.
- The beta web app config stays outside the checkout. Firebase web keys are public identifiers, but committing the beta config would point shipped code at beta.

## Access prerequisite: restore the Firebase CLI credential

The CLI login for this environment is kept as a backup file, not in the default home. Restore it into a throwaway home for each session:

1. Create `/tmp/fbhome/.config/configstore/` (the firebase-tools configstore location under that home).
2. Copy `~/.firebase-cli/configstore-backup.json` to `/tmp/fbhome/.config/configstore/firebase-tools.json` with mode `0600`.
3. Run every CLI command with `HOME=/tmp/fbhome`, for example `HOME=/tmp/fbhome npx firebase projects:list`.
4. Never print, paste, or commit the file or its tokens. Remove `/tmp/fbhome` at the end of the session.

## Verified beta state

Verified by the orchestrator on 2026-11-11 at about 01:50 CT, with the credential restored as above. Every command was read-only.

| Check | Command | Evidence |
| --- | --- | --- |
| Both projects are visible | `firebase projects:list` | Lists `jlb-calorietracker` (production, project number 994744135946) and CalorieTracker Beta `jlb-calorietracker-beta` (project number 94545123847). |
| Firestore database | `firebase firestore:databases:list --project jlb-calorietracker-beta` | Fails with HTTP 403: "Cloud Firestore API has not been used in project jlb-calorietracker-beta before or it is disabled." There is no Firestore database in beta yet. |
| Registered apps | `firebase apps:list --project jlb-calorietracker-beta` | "No apps found." |

Conclusion: a live beta run cannot be completed until four console-side setup steps happen in beta: enable the Cloud Firestore API, create the (default) Firestore database, register a web app, and create a test auth user. CLI POST-type operations are blocked in this sandbox by the egress proxy (HTTP 411, the same failure that blocked `firebase projects:addfirebase`), so these are Firebase Console steps for James or a supervised browser session. No CLI project mutation was attempted, the production project was not touched, and no rules were deployed anywhere.

## Remaining beta setup (console, beta only, in order)

Do each step with **CalorieTracker Beta (`jlb-calorietracker-beta`)** selected in the console project picker. Check the project id on the page before each click. Do not use the CLI for these steps: POST requests from this sandbox fail with HTTP 411 at the egress proxy.

1. **Enable the Cloud Firestore API.** Google Cloud Console → APIs & Services → Library → search "Cloud Firestore API" → Enable (direct path: `console.cloud.google.com/apis/library/firestore.googleapis.com?project=jlb-calorietracker-beta`). Creating the database in step 2 may also enable it; record which happened.
2. **Create the (default) Firestore database.** Firebase Console → CalorieTracker Beta → Build → Firestore Database → Create database. Keep the database id `(default)`. Choose a location (it cannot be changed later) and start in **production mode**, so everything is denied until the beta rules from step L1 are in place. Do not choose test mode.
3. **Register a web app.** Firebase Console → Project settings (gear) → General → Your apps → Add app → Web. Use a nickname such as `calorietracker-beta-web` and do not set up Hosting. Save the config object to a private file outside the checkout. It is used only in step L2.
4. **Create a test auth user.** Firebase Console → Build → Authentication → Get started → Sign-in method → enable Email/Password. Then Users → Add user with a synthetic address (not James's account) and a generated password kept privately. A second synthetic user is optional; it makes the cross-user part of flow 6 checkable live.

Afterwards, re-run the read-only checks: `firestore:databases:list --project jlb-calorietracker-beta` should list `(default)`, and `apps:list --project jlb-calorietracker-beta` should list the web app. Record both in [Results](#results).

## Live validation script

Run only after the four setup steps are recorded, in one supervised session. Start a log with the date, the operator, the repository `main` SHA, the beta project id, the ruleset name (step L1), and the flag values used in the local build (step L2).

### Preparation

- **L1. Beta rules (beta only).** Deploy the repository `firestore.rules` at the recorded `main` SHA to beta only: `HOME=/tmp/fbhome npx firebase deploy --only firestore:rules --project jlb-calorietracker-beta`. This is a POST and may hit the same HTTP 411 block. If it does, paste `firestore.rules` into Firebase Console → Firestore Database → Rules for CalorieTracker Beta and publish it there. Record the ruleset name and the source SHA. Never deploy to `jlb-calorietracker`.
- **L2. Local beta build (never committed).** Make a throwaway worktree of the recorded `main` SHA outside the repository. In that copy only: replace `public/tools/CalorieTracker/firebaseConfig.js` with the beta web app config from setup step 3, and set `INGREDIENT_STORE_WRITES_ENABLED = true`. Leave `NUTRIENT_V2_WRITES_ENABLED = false` (release phase 5: legacy food and diary writes stay v1 in the beta; see gap G2 for what this blocks). Serve that copy on `localhost` (authorized by default in Firebase Auth) and sign in as the test user. Before starting, confirm the page's Firebase project id is `jlb-calorietracker-beta` (Settings line or the network panel). Never commit, push, or deploy the throwaway copy.
- **L3. Baseline.** Before any flow, note in the log that the test user has no diary entries and no saved foods, and record the Settings line for the ingredient store.

### Flows

Evidence for each flow: a screenshot or text of the visible UI result, plus the Firestore Console document path(s) and the fields named below. Record values from the synthetic fixture only.

| # | Flow | Steps | Expected outcome | Evidence to record |
| --- | --- | --- | --- | --- |
| 1 | Research a missing ingredient | Ingredient Import (Beta): import a one-line synthetic list for an ingredient not in the catalog or library. Match (line is `missing`), Skip official lookup (not enabled), copy the research packet, paste back a synthetic response that sets a few macros as measured with one versioned source and leaves at least one micronutrient unknown with a reason. | The line resolves from the packet. Unknown fields stay unknown, not zero. Nothing is written to Firestore. The diary is unchanged. | Packet request id; applied fields and the unknown field with its reason; Firestore shows no new documents. |
| 2 | Add a new private profile | Save the researched result to the library ("Save to my library"). | Revision 1 is created under the test user. | Paths `artifacts/default-app-id/users/<uid>/ingredientIdentities/<id>`, `ingredientVariants/<variantId>` (`headRevision: 1`), `ingredientRevisions/<variantId>~r1`; per-field provenance and source with version and dates; the unknown field is `null` with `status: unknown`. |
| 3 | Fill a missing micronutrient | Library: open the profile, research only the missing micronutrient (pinned packet), paste back a synthetic measured value, save. | Revision 2 is created; it supersedes revision 1. | `ingredientRevisions/<variantId>~r2` with `supersedes` pointing at r1; the head shows `headRevision: 2`; the filled field has its own source. |
| 4 | Update preserving unchanged fields | Compare r1 and r2 in the Firestore Console. | Every field other than the filled one has the same value, quality, and provenance in r2 as in r1. r1 is unchanged. | Field-by-field comparison of the two documents (copy the JSON of both). |
| 5 | Concurrent revisions | Open the same profile in two tabs at the same revision. Save a synthetic label edit in tab A, then a different edit in tab B. | Tab A saves the next revision. Tab B shows a revision conflict, keeps its draft, and writes nothing. | The visible conflict message; head revision after both saves; no extra revision document; the retained pending save in the browser (IndexedDB) for tab B. |
| 6 | Private override precedence | Library: pick a curated profile, save a private override with one synthetic label value. If a second test user exists, sign in as that user and view the same curated profile. | The test user sees the private override instead of the curated record. The curated record is unchanged. The second user sees the curated record. | Override path `ingredientVariants/ov-…` with `overrides` set and `basedOn` the curated ref; the Library view for both users. |
| 7a | Library save path | Covered by flows 2, 3, 5, and 6 (each save goes through `commitLibraryEdit`). | Each save is committed or visibly refused; none writes a diary day. | The saved refs; the test user still has no `dailyEntries` documents. |
| 7b | Import Workspace save path | Import a two-line synthetic meal that uses the revision-2 profile and the override, review it, and press save. | Committed save with `logged: false` and never a diary write. **Blocked live: see gaps G1 and G2.** Until they are resolved the button returns the export copy, `committed: false`. | Record the visible result and that no `mealRecords`, `mealRecordVersions`, or `dailyEntries` document was written. |

After the flows: confirm that `dailyEntries` and `foodItems` for the test user are still empty (abandoning the beta leaves the diary unchanged until an explicit diary add), and that no legacy food or diary document has a v2 shape.

### Cleanup

- Delete every test document under `artifacts/default-app-id/users/<test uid>/` in the beta Firestore Console (the rules deny client deletes of ingredient documents; the console is not bound by the rules). Alternatively, delete the beta database itself if no further beta run is planned.
- Delete the test user(s) in Authentication → Users.
- Delete the throwaway worktree from step L2 and the private beta config file if it is no longer needed.
- Remove `/tmp/fbhome`.
- In the repository checkout, confirm `git status` is clean and both flags in `capabilities.js` are still `false`.
- Record the cleanup in the log.

## Local evidence: chained flow validation

[betaFlowValidation.test.js](../../public/tools/CalorieTracker/nutrition/betaFlowValidation.test.js) chains the seven flows in one narrative against one in-memory fake port (`fakePort` from [ingredientFixtures.js](../../public/tools/CalorieTracker/nutrition/ingredientFixtures.js)). It is in the CalorieTracker `npm test` list and the `unit-calorie-tracker` CI stage. Tests only: no production code changed. Both write flags are mocked on inside that file only; its last test reads the real `capabilities.js` and asserts both are false.

| Step | Test | What it proves |
| --- | --- | --- |
| 1 | `flow 1` | A missing line goes import → match (`missing`) → lookup (`not_performed`; a packet is refused before it) → packet (0 model calls) → synthetic response applied. Unknown iron stays `null` with its reason. Nothing is written. |
| 2 | `flow 2 + 7a` | `commitLibraryEdit` with `create` saves the research result as private revision 1: per-field provenance keyed to the request's source, the source version and `permittedUse: review_required`, iron `unknown` with `gap:` reason. |
| 3, 4 | `flows 3 + 4` | Pinned research for `iron` only, saved as revision 2. `supersedes` points at revision 1. For every other field, value, quality, and per-field provenance are byte-identical to revision 1, and every revision-1 source is kept byte-identical. The stored revision-1 document is byte-identical. |
| 5 | `flow 5` | An edit staged from revision 1 before the fill was saved now returns `revision_conflict`, `retained: true`. The draft is in the pending-save outbox with `baseRevision: 1`. The store is byte-identical before and after; the head stays at 2. |
| 6, 7a | `flows 6 + 7a` | A private override saved through `commitLibraryEdit` is what `resolveEffectiveProfile` returns for the owner; copied curated fields keep the curated provenance; the curated record is unchanged. A store for another user on the same port still resolves the curated record. |
| 7b | `flow 7b` | The Import workspace matches revision 2 and the override through `store.resolveRef`, calculates (totals checked against the profile values), and `saveWorkspace(workspace, { store: mealStore })` returns `committed: true`, `logged: false`. The saved meal record pins both refs. Exactly one meal head and one meal version are written; no ingredient document changes; every document in the port is in an ingredient or meal collection under the owner (no `dailyEntries`, no `foodItems`). |
| flags | last test | The real `capabilities.js` keeps both flags false. With the local mock off, `commitLibraryEdit` returns `writes_disabled`. |

The tests are guards: they pass on `main` with no production change. To check that they can fail, two production edits were applied temporarily and then restored with `git checkout` (git confirmed clean): removing the stale-base check in `ingredientStore.saveRevision` failed flow 5 and the chain after it; skipping the override lookup in `resolveEffectiveProfile` failed flow 6 and the chain after it (3 of 7 tests failed).

## Gaps

These are documented instead of worked around. None is fixed here, because this work is tests and docs only.

- **G1. The Import workspace UI has no meal store.** [ui/importWorkspace.js](../../public/tools/CalorieTracker/ui/importWorkspace.js) calls `saveWorkspace(current)` without a store, and no tracker service creates a Firestore-backed `createMealStore` (only the ingredient store is wired, in [services/ingredientStore.js](../../public/tools/CalorieTracker/services/ingredientStore.js)). Even with save on, the live button would return `store_unavailable` with the export copy. Live evidence for flow 7b needs a separate reviewed change that wires a meal store into the UI.
- **G2. The Import workspace save gate needs the global v2 flag.** `workspaceCapabilities().save` is `INGREDIENT_STORE_WRITES_ENABLED && NUTRIENT_V2_WRITES_ENABLED`. Release phase 5 says not to flip `NUTRIENT_V2_WRITES_ENABLED` for the beta, so legacy food and diary writes stay v1. A beta run that follows that rule cannot reach the committed Import Workspace save. Resolving this needs a decision: either decouple the meal-save gate from the global v2 flag in a reviewed change, or explicitly approve v2 on in the local beta build with no legacy food or diary saves during the run.
- **G3. Meal record rules are generic.** `mealRecords` and `mealRecordVersions` fall under the generic owner read/write rule in `firestore.rules`. There is no append-only or immutability validation and no rules test for them, unlike the four ingredient collections. Meal-version immutability currently rests on the client store, not on rules.
- **G4. The fake port is not Firestore.** The chained test uses the optimistic in-memory port and fake caches. Real transaction behavior, the IndexedDB profile cache and outbox, the curated catalog shards, and index behavior are only exercised by the live run (and, for rules, by the emulator suite).
- **G5. Cross-user denial is not live-checked by the local test.** Flow 6's "owner only" part is shown with a second store on the same port. Rules-level cross-user denial is covered by the emulator rules tests, not by this suite and not yet live.
- **G6. Research responses are hand-built.** The local test pastes synthetic `nutrition.researchResponse` objects. No assistant round trip is exercised.

## Results

| Date | Run | Result |
| --- | --- | --- |
| 2026-11-11 | Beta state check (orchestrator, read-only CLI) | See [Verified beta state](#verified-beta-state): Firestore API not enabled, no database, no apps. |
| 2026-11-11 | Live run | **NOT YET RUN.** Blocked on the four console setup steps. Flow 7b is also blocked live by gaps G1 and G2. |
| 2026-11-11 | Chained flow validation (local) | `betaFlowValidation.test.js` 7 passed (7). CalorieTracker `npm test`: 50 files, 1209 tests passed. Both shipped write flags false. |
