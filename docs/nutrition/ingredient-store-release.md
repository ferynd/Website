# Ingredient store release (#61)

Part A implements code, tests, and emulator-only rules validation. **Rules not deployed; INGREDIENT_STORE_WRITES_ENABLED=false; NUTRIENT_V2_WRITES_ENABLED unchanged (false); no production data touched.** The census script is built and logic-tested but has not been run. The curated catalog is empty (`nutrition-curated`, `profileCount: 0`). No #60 Part B, #62, or #63 action is included. Firestore storage for research jobs or meal records is outside this release and would need its own later rules release (#62 follow-on, #64 Part B).

Source rules use the explicit `{collectionName}/{subpath=**}` form, not recursive path indexing. Emulator acceptance covers atomic create/hash agreement, curated override creation without a private identity, head +1, metadata retirement, immutable revisions/conversions, ownership, catalog denial, and legacy regression cases.

Prerequisites/residual risk: production index behavior is unverified by the emulator. Pre-#61 recipe tabs can drop ingredient refs, so deploy readers before enabling writers. Cache clearing at sign-out deliberately loses pending drafts. F-141 M4 must include all four new collections. #60 Part B controls only food/day document shape and is a separate release; it is not a prerequisite for #61 Part A.

## Part B: Production enablement (**Requires James's explicit approval**; not started)

Preconditions:
- Part A is merged.
- The production web deployment serves the readers: the deployed build of the merge SHA contains `parseNutritionLink` with `ingredientRef`. The repository cache is already `nutritrack-v5` with writes off. Confirm the live worker's cache name before B5; do not assume a merge was a rules or data deploy.
- Readers are live before writers.

**B1. Read-only inspection** (Firebase CLI login, or trusted ADC; never paste tokens):
- List Rules releases. Retrieve every file of the active `cloud.firestore` ruleset and save it privately outside the repo as the rollback reference. Record the ruleset name.
- Diff that ruleset against `git show 326a748:firestore.rules`. Any live-only grant must be reconciled before deploying.
- Run the census, which is **Admin SDK + ADC**:
  `npx --no-install vite-node scripts/firebase/ingredientStoreCensus.ts -- --project jlb-calorietracker --out <private dir outside checkout>`.
  Expect 0 documents in the four collection groups. A nonzero count blocks the deploy until reviewed, because existing data under those names would become write-restricted.
- Backup: no Firestore data is rewritten, so a data export is not required. A managed export would need Blaze anyway, and the project is on Spark. The rollback artifact is the saved ruleset.
- Estimates of affected data stay "unknown until this dry-run". No production counts are assumed.

**B2. Dry-run compile:** `npx firebase deploy --dry-run --only firestore:rules --project jlb-calorietracker`. Record the output. The live release must be unchanged afterwards.

**B3. Deploy rules (approval 1):** `npx firebase deploy --only firestore:rules --project jlb-calorietracker`.
- Do not deploy Hosting, Functions, Storage, indexes, or Auth.
- Do not run `firebase use`.

**B4. Verify:**
- The releases point to a new ruleset whose source equals `firestore.rules` at the merge SHA. Record it.
- Live smoke with two throwaway accounts (approval 2):
  - Tracker legacy flows still work: save food, log a day, targets, goals, profile, weights.
  - Recipe flows still work: load, save, export.
  - Ingredient paths: owner create of identity, variant, and r1; head +1; revision update denied; cross-user read denied; curated path write denied; the private search query works without a composite index.
  - Remove the fixtures afterwards with Admin SDK cleanup under ADC, because the rules deny client deletes.

**B5. Enable writes (approval 3):**
- A separate small PR sets `INGREDIENT_STORE_WRITES_ENABLED = true` and bumps `NUTRITRACK_CACHE_NAME` and the service worker to a new name after `nutritrack-v5`. v5 is already the repository cache while writes are off, so reusing v5 would leave cached clients on the old writer.
- Merge it, verify the deployed bundle SHA, and confirm the Settings line reads `ingredient store v1 (writes on)`.

**Live data copy/backfill: none.**
- No `foodItems`, `dailyEntries`, recipe docs, or diary snapshots are rewritten or copied.
- Legacy foods enter the library only through explicit per-user actions later (#69).
- A bulk "promote all saved foods" migration would be a new backlog item with its own dry-run, backup, and approval.

**Rollback:**
- Rules: redeploy the saved previous ruleset with `firestore:rules`, using the same command and the saved file. Private ingredient documents remain owner-only, but immutability is unenforced while rolled back.
- Writes: a PR sets the flag back to false. Readers keep reading.
- No data deletion is part of the rollback.

**Approval sentences James must say yes to (separately):**
1. "I approve deploying the #61 Firestore rules from `firestore.rules` at commit `<merge-sha>` to `jlb-calorietracker` with `npx firebase deploy --only firestore:rules --project jlb-calorietracker`, after the read-only inspection, census (0 docs), and dry-run compile passed."
2. "I approve creating fixture ingredient records under two throwaway test accounts in `jlb-calorietracker` for live verification, and removing them afterwards with the Admin SDK cleanup."
3. "I approve merging and deploying the PR at commit `<sha>` that sets `INGREDIENT_STORE_WRITES_ENABLED = true`, enabling owner-private ingredient identity/variant/revision/conversion writes in production (`NUTRIENT_V2_WRITES_ENABLED` stays false)."

---


The census reports only aggregate counts by collection and path prefix, with private local output outside the checkout. It has no remote write operation and refuses write/apply/delete modes. Do not execute it as an implementation check.
