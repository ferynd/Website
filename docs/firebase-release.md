# Firebase rules release — jlb-calorietracker

Status (2026-10-20 review): live Firestore/IAM/Storage were inspected read-only and the review defects below were fixed and emulator-tested. Production release remains blocked on (1) deploying the corrected Conflict Tracker client to the live Pages site, (2) Admin ADC for the migration dry run plus explicit approval of its digest, and (3) Storage not being provisioned. No production data, rules, or client were changed by this work (one side effect: see Storage API note).

## Sources and verified local behavior

- Repository: `ferynd/Website`; source branch: `claude/website-backlog-review-9fzov8`; base: `main`.
- Canonical files: `firestore.rules`, `storage.rules`, `firebase.json`.
- The client configuration names project `jlb-calorietracker` and bucket `jlb-calorietracker.firebasestorage.app`. These are repository identifiers, not live discovery results. Firestore rules assume the `(default)` database. `.firebaserc` deliberately selects a demo project for local testing; every production command must explicitly select the real project.
- Conflict listeners request named documents: self immediately; partner only after two committed, server-confirmed timestamp mirrors. Missing/invalid mirrors never reveal a partner. Listener errors clear unavailable content and surface an error; cleanup cancels all subscriptions. Deletion batches the two known reflection IDs and parent without querying.
- Creation and updates enforce assigned-side identity, matching `id`/`person`/`conflictId`/`authorUid`, and immutable non-null submission timestamps. Verified admin retains read/delete authority, including private drafts, but cannot write a reflection as an unassigned author. Admin authority remains verified-email based; this work does not close the separate custom-claim migration.
- Submission and mirror commit atomically using `getAfter` rules validation. Retrying preserves the original timestamp. Missing historical mirrors default safely to null in rule evaluations.
- Storage image validation applies to creation/replacement; deletion requires membership/admin authorization without examining `request.resource`. Both upload paths and the actual `listAll`/`getMetadata`/`deleteObject` cleanup sequence have positive and negative emulator coverage.
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

Validated locally: root 61 files / 1,402 tests; CalorieTracker 9 files / 584 tests; rules/migration 4 files / 62 tests; lint, TypeScript and production Next.js build passed. No tests were skipped. Counts describe these suites separately; root also discovers CalorieTracker tests.

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

The emulator suite `tests/rules/conflict-tracker-release.rules.test.ts` covers this. Legacy conflict creation without mirror fields still works (fixed). However, the `main` client listens to and deletes through the `reflections` **collection**. The new rules deny that before reveal, and that restriction is the privacy fix itself. The `main` client also never writes the submission mirrors. **Deploying these Firestore rules while `main`'s client is live breaks Conflict Tracker reflections, deletion and the shared section.** The corrected client *is* compatible with the currently deployed rules, so it must ship first. This branch cannot build on Pages (OpenNext/Workers), so ship it as a minimal backport PR to `main`: the seven `app/tools/conflict-tracker` files, which typecheck on `main`. One known transient regression applies while the old rules are still live. Person A deleting a conflict now uses one batch that always deletes both reflection IDs. Old rules permit reflection deletes for admin only, so non-admin deletion fails until the new rules ship. Under the old rules, deleting a conflict that had reflections already failed.

## Live access procedure (for re-verification)

Use an authenticated Firebase connector or trusted CLI/Google ADC. Never paste tokens or service-account JSON into chat, source files, or logs. Firebase CLI login alone does not necessarily provide the Admin SDK's ADC; verify both required operations independently.

1. Discover the project number, actual Firestore database(s), and actual Storage bucket(s). Confirm the app uses the default database and the discovered bucket. Query only the needed metadata and migration records.
2. List Firebase Rules releases; follow the active Firestore and each Storage release's `rulesetName`, and retrieve **all files** of each ruleset. Securely save originals and release/ruleset references for rollback. Compare with repository sources, resolve live-only permissions, and preserve unrelated legitimate access. Do not overwrite live permissions blindly or preserve a broad grant that defeats the privacy fix.
3. Check the real CalorieTracker namespace (`default-app-id` or any historically supplied app ID) and all existing tools against live rules/data. The branch narrows the old CalorieTracker wildcard; an unexpected live namespace requires explicit reconciliation before release.
4. Inspect project IAM for `service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com`. Storage's Firestore lookups need `roles/firebaserules.firestoreServiceAgent` on the project. Record the actual binding. Inspect before changing it; emulator passes do not prove production IAM. The CLI can prompt to grant this role; a noninteractive deploy skips this check, so don't rely on deploy output to establish it.

Read-only APIs, if the connected tool exposes them: Firebase project metadata; Firestore `projects/.../databases`; Firebase Storage `projects/.../buckets`; Firebase Rules `projects/.../releases` then each referenced ruleset; Cloud Resource Manager `getIamPolicy`. Retain service account/project metadata without exposing auth values.

## Historical mirrors: dry run, backup, approval, apply

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

This branch also contains an unverified Cloudflare Workers migration from earlier work. `wrangler.jsonc`'s Worker identity is not production evidence. Do not run `cf:deploy`, deploy a new Worker, or assume the corrected client is live as part of this Firebase handoff. Coordinate the client release separately on the verified hosting target.

1. Done 2026-10-20: live rules/database/bucket/IAM comparison and local checks (see above).
2. Open and merge a backport PR to `main` with the corrected Conflict Tracker client. Let Pages deploy it, then record the deployment ID and commit, and smoke-test it against the **current** rules. Under the current rules it works, with two exceptions: historical conflicts don't reveal the partner until migration, and non-admin delete fails as noted above.
3. Ask users to reload, so stale tabs stop writing unmirrored submissions. Run the migration **dry run** with Admin ADC (`gcloud auth application-default login`, as the project owner). Back it up privately and get explicit approval of the plan's SHA-256. Apply only that digest, then re-run the dry run: affected and blocked must both be 0. If anything drifted, re-plan and re-approve.
4. Deploy **Firestore rules only** while Storage is unprovisioned:

   ```sh
   npx firebase deploy --only firestore:rules --project jlb-calorietracker
   ```

   `--only firestore:rules,storage` fails while no bucket exists. Deploy `storage` later, as its own step: after Storage is provisioned (Blaze), the Storage service agent exists, and `roles/firebaserules.firestoreServiceAgent` is granted. Do not use `storage:rules` (invalid selector). Do not deploy Hosting, Functions, indexes, Auth configuration, or unrelated resources. Do not run `firebase use` to make an implicit production default.
5. Re-read the active releases and rulesets. Compare their sources to the approved files and record the new ruleset name, keeping `7c3d1850-…` as the rollback reference. Test in production with approved test identities and non-sensitive fixtures: own/partner pre-reveal privacy, mutual submission and reveal, historical submitted vs draft-only, and outsider denial. Test image upload and delete only once Storage exists. Clean up only the fixtures you created.

If cutover fails, keep maintenance in place and use the captured previous releases/client artifacts to plan a compatible rollback. Do not roll back privacy rules to broad readable drafts or overwrite historical data wholesale. Record remaining blockers in AR-02/AR-03/AR-04; these initiatives remain open until merge, production acceptance and their other recorded criteria are satisfied.
