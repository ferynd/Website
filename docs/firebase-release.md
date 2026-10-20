# Firebase rules release — jlb-calorietracker

Status (2026-10-20, released): this is a Firestore-rules-only release, and it is **deployed**. PR #161 (the compatible Conflict Tracker client) merged as `4a24cea`, and Pages production deployment `b063b07d` served it. The rules were released as ruleset `47cb93f9-4008-4b73-a8f8-cc469f8b8ae4`; the current ruleset is `aa808b96-d906-471f-8441-ee116413a8db`, which adds the conflict-create tightening (original rollback: `7c3d1850-1364-4b63-a283-711021545010`). Live checks passed 56/56, using throwaway accounts and fixtures that were removed afterwards. A follow-up tightening of the conflict-create rule (clean initial resolution/reflection/shared state, from the Codex review) is deployed (ruleset `aa808b96`, re-verified live 59/59). Storage is **deferred** until a bucket exists on the Blaze plan. Historical submission mirrors heal **in-app**, so the Admin migration is optional. No production data was modified, apart from the self-removed fixtures. One side effect: the Cloud Storage for Firebase API was enabled; see the live inspection notes.

## Sources and verified local behavior

- Repository: `ferynd/Website`; source branch: `claude/website-backlog-review-9fzov8`; base: `main`.
- Canonical deploy files: `firestore.rules` and `firebase.json`, which now maps **Firestore only**. `storage.rules` is kept, and is still emulator-tested through `firebase.rules-test.json`, but it is **deferred**: it is not wired into the deploy config and must not be deployed until Storage is provisioned. See the Storage notes below.
- The client configuration names project `jlb-calorietracker` and bucket `jlb-calorietracker.firebasestorage.app`. These are repository identifiers, not live discovery results. Firestore rules assume the `(default)` database. `.firebaserc` deliberately selects a demo project for local testing; every production command must explicitly select the real project.
- Conflict listeners request named documents: self immediately; partner only after two committed, server-confirmed timestamp mirrors. Missing/invalid mirrors never reveal a partner. Listener errors clear unavailable content and surface an error; cleanup cancels all subscriptions. Deletion batches the two known reflection IDs and parent without querying.
- Creation and updates enforce assigned-side identity, matching `id`/`person`/`conflictId`/`authorUid`, and immutable non-null submission timestamps. Verified admin retains read/delete authority, including private drafts, but cannot write a reflection as an unassigned author. Admin authority remains verified-email based; this work does not close the separate custom-claim migration.
- Submission and mirror commit atomically using `getAfter` rules validation. Retrying preserves the original timestamp. Missing historical mirrors default safely to null in rule evaluations.
- Storage image validation applies to creation/replacement; deletion requires membership/admin authorization without examining `request.resource`. Both upload paths and the actual `listAll`/`getMetadata`/`deleteObject` cleanup sequence have positive and negative emulator coverage.
- Historical self-heal: older submissions have no parent mirror. When a member's own reflection is submitted but their side's mirror is missing or null, the client writes that mirror once per subscription, using exactly the reflection's `submittedAt`, plus `hasReflectionX` and `updatedAt`. It uses the ordinary rule path (null to the exact value, checked by `validConflictSubmission`). It writes only the caller's own side. It is idempotent: once the mirror is set, nothing more is written. A rejected write is not retried, and errors log only the error code, never content. A conflict reveals after **both** members have opened it once. Until then, drafts and partner reflections stay private.
- Delete fallback: under the currently deployed rules, a non-admin cannot delete reflections, even ones that don't exist. If the atomic batch delete is denied and neither reflection exists, the client deletes the conflict document directly, which is the old behavior. Under the new rules, the batch succeeds.
- No un-submit: once a reflection has `submittedAt`, the client hides "Save draft", and `saveReflectionDraft` refuses inside a transaction (`SubmittedReflectionError`). The AR-03 rules also deny `submittedAt` going back to null. The live rules do not, which is why the client guard matters before rules ship.
- Delete enumerates reflections: the client lists every reflection the caller can see, plus the canonical IDs, and deletes them all with the parent in one batch. The live rules allow listing, but only admins may delete reflections, so a non-admin delete of a conflict with reflections is denied as a whole and nothing is orphaned. The AR-03 rules deny creating any non-canonical ID. **Residual:** a *legacy* stray ID, created under the old rules, can't be listed by Person A before the reveal, so it would survive Person A's delete. An admin delete (admins can list) or the optional migration dry run (which flags "unexpected reflection document IDs") finds these.
- Both Trip Cost expense paths default a blank payer only when exactly one participant matches the caller's UID.

## Local checks

From the repository root, use its Node/npm pins, `npm ci`, and Java 21 for the emulators. In cloud environments where the default config directory is not writable, prefix commands with `XDG_CONFIG_HOME=/workspace/.config`; use `FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators` for retained emulator artifacts. These paths contain tooling state, never production data.

```sh
npm test
npm run lint
npm run build
npm run test:rules
cd public/tools/CalorieTracker && npm test
```

Validated locally (phase 2): root 62 files / 1,407 tests; CalorieTracker 9 files / 584 tests; rules/migration 6 files / 90 tests (including `conflict-client-compat`, which runs the corrected client against both the live ruleset fixture and the new rules); lint, TypeScript and production Next.js build passed. No tests were skipped. Counts describe these suites separately; root also discovers CalorieTracker tests.

The former Storage success-test skips reproduced as failures. Two independent harness defects were identified: test project IDs differed from the CLI project used by cross-service lookups, and firebase-tools 15.24's unconditional proxy dispatcher ignored `NO_PROXY` for localhost. The suites now share explicit `demo-website-rules-test`, run serially to prevent clearing each other's data, and load `scripts/emulator-proxy.cjs`. That preload routes only HTTP requests to configured loopback emulator ports directly. All external requests retain their proxy/TLS behavior. No production IAM role is simulated or verified by these local passes.

## Live inspection — 2026-10-20 (read-only, CLI login `arkkahdarkkahd@gmail.com`)

- Project `jlb-calorietracker`, number `994744135946`, billing **disabled** (Spark).
- Firestore: exactly one database, `(default)`, FIRESTORE_NATIVE, `nam5`. PITR disabled; version retention 1 h.
- Rules releases: only `cloud.firestore` → ruleset `7c3d1850-1364-4b63-a283-711021545010` (released 2026-05-07 21:53:57 UTC). Its single file `firestore.rules` is byte-identical (except the final newline) to `origin/main` at `074c307`. Current `main` adds only an explicit `recipe-standardizer` block that the deployed legacy `{appId}` wildcard already covers. There are no live-only grants to reconcile. The branch's narrowing to `default-app-id` keeps `recipe-standardizer` via its explicit block. Originals are kept privately for rollback, outside the repo.
- Storage: **no bucket exists** (`jlb-calorietracker.firebasestorage.app` and `.appspot.com` return 404; the project bucket list is empty), and there is **no Storage rules release**. Date Night and Trip Planner image uploads therefore cannot work in production today, and `storage.rules` is emulator-verified only. A new default bucket requires the Blaze plan. A `firebase deploy --dry-run --only firestore:rules,storage` during the review **enabled the `firebasestorage.googleapis.com` API** as a CLI side effect. It is free, created no bucket, and changed no rules. Then it stopped with "Firebase Storage has not been set up".
- IAM: no `service-994744135946@gcp-sa-firebasestorage.iam.gserviceaccount.com` agent exists yet, because Storage is not provisioned. Once a bucket exists, grant it `roles/firebaserules.firestoreServiceAgent` before relying on the Storage rules' `firestore.get()` checks. The other bindings are default service agents plus the single owner.
- Admin account: Auth record has `emailVerified: true` (password provider), so the new `email_verified` requirement keeps admin access.
- The Firestore rules on this branch compile against production (`firebase deploy --dry-run --only firestore:rules`). The live release stayed unchanged afterward.
- Live client: Pages project `weekendtrip`, production deployment `9cc93135` built from `main` `bddd054`. It does **not** contain this branch's Conflict Tracker client.

### Compatibility of these rules with the live (`main`) client

The emulator suites `tests/rules/conflict-tracker-release.rules.test.ts` and `tests/rules/conflict-client-compat.rules.test.ts` cover this. The second suite runs against a verbatim fixture of the live ruleset (`tests/rules/fixtures/firestore.live-7c3d1850.rules`, test-only) and against the new rules. Legacy conflict creation without mirror fields still works (fixed). However, the `main` client listens to and deletes through the `reflections` **collection**. The new rules deny that before reveal, and that restriction is the privacy fix itself. The `main` client also never writes the submission mirrors. **Deploying these Firestore rules while `main`'s client is live breaks Conflict Tracker reflections, deletion and the shared section.** The corrected client *is* compatible with the currently deployed rules, so it must ship first. This branch cannot build on Pages (OpenNext/Workers), so ship it as a minimal backport PR to `main`: the seven `app/tools/conflict-tracker` files, which typecheck on `main`. While the old rules are live, deleting a conflict that has no reflections still works for Person A, through the fallback. A non-admin deleting a conflict that **has** reflections stays denied until the new rules ship. That is identical to the old client, because the old rules allow only admins to delete reflections. So this is not a regression.

## Live access procedure (for re-verification)

Use an authenticated Firebase connector or trusted CLI/Google ADC. Never paste tokens or service-account JSON into chat, source files, or logs. Firebase CLI login alone does not necessarily provide the Admin SDK's ADC; verify both required operations independently.

1. Discover the project number, actual Firestore database(s), and actual Storage bucket(s). Confirm the app uses the default database and the discovered bucket. Query only the needed metadata and migration records.
2. List Firebase Rules releases; follow the active Firestore and each Storage release's `rulesetName`, and retrieve **all files** of each ruleset. Securely save originals and release/ruleset references for rollback. Compare with repository sources, resolve live-only permissions, and preserve unrelated legitimate access. Do not overwrite live permissions blindly or preserve a broad grant that defeats the privacy fix.
3. Check the real CalorieTracker namespace (`default-app-id` or any historically supplied app ID) and all existing tools against live rules/data. The branch narrows the old CalorieTracker wildcard; an unexpected live namespace requires explicit reconciliation before release.
4. Inspect project IAM for `service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com`. Storage's Firestore lookups need `roles/firebaserules.firestoreServiceAgent` on the project. Record the actual binding. Inspect before changing it; emulator passes do not prove production IAM. The CLI can prompt to grant this role; a noninteractive deploy skips this check, so don't rely on deploy output to establish it.

Read-only APIs, if the connected tool exposes them: Firebase project metadata; Firestore `projects/.../databases`; Firebase Storage `projects/.../buckets`; Firebase Rules `projects/.../releases` then each referenced ruleset; Cloud Resource Manager `getIamPolicy`. Retain service account/project metadata without exposing auth values.

## Optional: Admin mirror migration (not required for this release)

The in-app self-heal above replaces this migration for the release, so no Admin ADC or production data plan is needed. The scripts stay in the repository for an optional bulk backfill, for example to reveal conflicts that one partner never reopens. Running them still requires owner ADC and explicit approval of a dry-run plan digest, as described below. The earlier concern about mixed-case emails on unclaimed invites is dropped: James confirmed there are no pending invites.

The Admin SDK migration is `scripts/firebase/migrateConflictMirrors.ts`, with tested logic in `scripts/firebase/conflictMigration.ts`. It scans tracker/conflict records, including missing ancestors with surviving subcollections. For each conflict, it validates side/author/document identity and submission types. Each absent mirror becomes null or the exact original stored timestamp for that side; this also handles only one submitted side. It never changes reflection contents, timestamps, shared text, flags, or unrelated parent fields. Existing conflicting mirrors, invalid identities/timestamps, unexpected reflection IDs and missing parents are quarantined. Any inconsistency blocks a production apply until resolved and re-planned.

Choose a new private directory **outside the checkout**, on protected persistent storage. The script creates it with mode 0700; plan, backup and audit files use mode 0600. Preserve this directory securely across the release; do not attach it to a PR or upload it to chat. Backup encoding retains timestamp seconds/nanoseconds and typed document values. It includes complete affected parent documents, tracker identity and both reflections, so it contains private information. Store an encrypted retained copy if the execution machine is ephemeral.

Run first in read-only mode with trusted ADC:

```sh
npx --no-install vite-node scripts/firebase/migrateConflictMirrors.ts -- \
  --dry-run --project jlb-calorietracker \
  --out /workspace/firebase-release-private/conflict-mirrors-release-1
```

This writes `backup.json` before `plan.json`, and prints only aggregate counts, inconsistency count, checksums, and the fields intended for change. Inspect the protected plan for exact paths/writes and report affected/unchanged/blocked counts without reflection contents. No production writes occur during this command. Do not reuse an existing output directory.

**Ask for explicit approval of that concrete production plan and its SHA-256 before applying.** Approval of the original repair request does not authorize historical-data changes. If writers remain active after the dry run, regenerate the plan/backup during maintenance and obtain approval for the new digest. Pause all old clients/writers before the final plan and keep them paused through verification; recording a maintenance flag does not pause them automatically.

Only after approval and verified maintenance:

```sh
npx --no-install vite-node scripts/firebase/migrateConflictMirrors.ts -- \
  --apply --project jlb-calorietracker \
  --out /workspace/firebase-release-private/conflict-mirrors-release-1 \
  --maintenance-confirmed --approve-plan-sha256 APPROVED_PLAN_SHA256
```

Replace the digest placeholder with the approved dry-run digest. The script validates the project, plan and backup checksum, then checks tracker/parent/reflection versions in each transaction before writing only the planned mirror fields. Concurrent edits stop the run. A private JSONL audit records per-conflict outcomes; a partial run is reported, not rolled back blindly. Repeats are no-ops when the planned values already match genuine submissions. Run a fresh dry run afterward: affected and blocked counts must both be zero, and verify previously submitted vs draft-only access separately. Never print the private backup to establish success. No automatic production restore is supplied; restore only reviewed affected fields with version checks, using the retained backup and explicit approval.

## Compatible release order and exact deployment

The Cloudflare Workers hosting cutover is a separate track; see README "Deployment". It doesn't change the Firebase steps below.

1. Done 2026-10-20: live rules/database/bucket/IAM comparison and local checks (see above).
2. Done 2026-10-20 (`4a24cea`, Pages `b063b07d`): merge the client backport PR to `main` (Conflict Tracker client only, including the self-heal and the delete fallback). Wait for the Pages production deployment of `weekendtrip`. Verify that its source commit equals the merge commit, and that `/tools/conflict-tracker` serves the new bundle. Smoke-test it against the **current** rules. Members' first visits will start healing their own historical mirrors, and that is safe under both rule sets.
3. Done 2026-10-20 (ruleset `47cb93f9`): deploy **Firestore rules only**. Re-run this same command for any later rules change, such as the conflict-create tightening in #160:

   ```sh
   npx firebase deploy --only firestore:rules --project jlb-calorietracker
   ```

   `firebase.json` no longer maps Storage, so this deploys nothing else. Do not deploy Hosting, Functions, indexes, Auth configuration, or unrelated resources. Do not run `firebase use`. Leave the Cloud Storage for Firebase API enabled. Stale tabs still running the old client lose reflection loading and deletion until they reload.
4. Done 2026-10-20 (56/56 live checks; historical-shape emulator check 15/15; fixtures and test accounts deleted): verify. List the releases and confirm `cloud.firestore` points to a new ruleset whose source equals `firestore.rules`. Record that ruleset; the rollback reference is `7c3d1850-1364-4b63-a283-711021545010`. Then test in production with two dedicated test accounts and a test tracker containing only non-sensitive fixture text:
   - each side can read only its own draft;
   - a partner can't read a draft or a one-sided submission;
   - mutual submission reveals both, and the shared section unlocks only then;
   - Person A deletes, and Person B and an outsider are denied;
   - an outsider can't read anything;
   - a historical conflict reveals only after both members have opened it.

   Delete only the fixtures you created.
5. Deferred, as a separate future release: Storage. It needs Blaze billing, a default bucket, the Storage service agent with `roles/firebaserules.firestoreServiceAgent`, and then `storage` re-added to `firebase.json` and deployed on its own.

If cutover fails, keep maintenance in place and use the captured previous releases/client artifacts to plan a compatible rollback. Do not roll back privacy rules to broad readable drafts or overwrite historical data wholesale. Record remaining blockers in AR-02/AR-03/AR-04; these initiatives remain open until merge, production acceptance and their other recorded criteria are satisfied.
