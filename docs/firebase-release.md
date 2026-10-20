# Firebase rules release — jlb-calorietracker

Status: local repairs and emulator validation are complete; production release is blocked on live access, a reviewed historical-data plan, and a verified compatible client deployment. Nothing in this document establishes that production was changed.

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

## Live access and comparison — required before release

The current session had no callable Firebase connector tools, no CLI login, and no Application Default Credentials (ADC). `firebase projects:list` failed authentication, and the production migration dry run failed loading ADC. No production counts, backup, rules differences, IAM verification, release IDs or post-deploy results are available. Do not substitute an empty result for unavailable data.

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

1. Finish live rules/database/bucket/IAM comparison and the local checks. Identify the actual production client build and approved rollback artifacts.
2. Stage the compatible client and rules. Verify the client/rules pair in a non-production environment. The new submission transaction requires `getAfter` support; test against actual retrieved live rules as well, or keep the client inaccessible during the coordinated cutover. Do not expose it against incompatible intermediate rules.
3. Enter confirmed maintenance for old clients/writers. Produce the final dry run/backup, obtain explicit approval for that digest, apply, and verify it. Keep draft-only data private.
4. Deploy the compatible client to the separately verified existing application target; record deployed SHA/URL and ensure stale clients cannot continue writes. Keep users paused until rules and smoke checks finish. If client deployment cannot be verified, stop: do not deploy new Firestore rules.
5. Only when all gates pass, from the reviewed checkout with `firebase.json` mapped to the canonical sources:

   ```sh
   npx firebase deploy --only firestore:rules,storage --project jlb-calorietracker
   ```

   Do not use `storage:rules` (invalid selector). Do not deploy Hosting, Functions, indexes, Auth configuration, or unrelated resources. Do not run `firebase use` to make an implicit production default.
6. Re-read the active releases/rulesets, compare their source hashes to the approved files, and record both resulting references. With approved test identities and non-sensitive fixtures in production, verify own/partner pre-reveal privacy, legitimate mutual submission/reveal, historical submitted vs draft-only behavior, image upload, participant cleanup/delete and outsider denial. Clean up only the fixtures you created. Re-enable traffic only after these pass; record actual results, not just a successful deploy exit.

If cutover fails, keep maintenance in place and use the captured previous releases/client artifacts to plan a compatible rollback. Do not roll back privacy rules to broad readable drafts or overwrite historical data wholesale. Record remaining blockers in AR-02/AR-03/AR-04; these initiatives remain open until merge, production acceptance and their other recorded criteria are satisfied.
