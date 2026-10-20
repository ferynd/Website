Review and safely release the prepared Firebase repairs for `ferynd/Website`.

Repository/branch: `ferynd/Website`, `claude/website-backlog-review-9fzov8`; base `main`.
Target project: `jlb-calorietracker`.
Canonical deploy files: `firestore.rules` and `firebase.json` (Firestore only). `storage.rules` is deferred.

Fetch the latest source branch and preserve existing work. The Firebase repair commit is `e16cfad`; review is tracked in draft PR #160. Read `AGENTS.md`, `SECURITY.md`, `docs/firebase-release.md`, and AR-02/AR-03/AR-04 in `backlogs/audit-remediation.md`. Do not treat the branch or project as production-ready. Preserve the prepared privacy and functional repairs; avoid unrelated refactoring/upgrades. The source branch also contains earlier, unverified Cloudflare Workers changes; this request does not authorize deploying that migration.

Local repairs already include named reflection listeners with gated partner access, assigned-side reflection ownership, query-free batch deletion, atomic/retry-safe submission mirrors, Storage delete authorization independent of upload checks, legitimate Storage upload tests without skips, a trusted Admin SDK historical-mirror migration, and unique Trip Cost payer fallback. Recorded checks passed: root 1,402 tests; CalorieTracker 584 tests; rules/migration 62 tests with no skips; lint, type checking and Next.js production build. Re-run these checks on the exact fetched revision as needed to establish your own evidence:

- `npm ci`, then `npm test`, `npm run lint`, `npm run build`, `npm run test:rules`.
- `cd public/tools/CalorieTracker && npm ci && npm test`.
- Rules tests require Java 21 and use an isolated demo project, never production. The loopback-only proxy workaround is explained in the release runbook.

The prior environment had no callable Firebase connector and no trusted CLI/Google credentials. It did NOT inspect live rules/IAM, produce a production data inventory or backup, migrate production data, deploy rules, or verify production behavior. Do not report those steps as already done.

Use your authenticated Firebase connection to finish the outstanding work:

1. Verify the actual Firebase project, project number, Firestore database and Storage bucket. The client names `jlb-calorietracker.firebasestorage.app`; confirm it live. Retrieve current Firestore/Storage releases and every referenced ruleset source file, securely retain rollback copies/references, and compare them with the prepared canonical files. Reconcile legitimate live-only permissions and legacy data namespaces before overwriting anything. Check compatibility for all existing tools, including CalorieTracker's actual app ID.
2. (Deferred with Storage.) When Storage is provisioned, verify that `service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com` has `roles/firebaserules.firestoreServiceAgent` for cross-service Storage -> Firestore checks. Record the actual binding and any required minimal correction. Emulator tests do not establish live IAM readiness.
3. Historical mirrors self-heal in the client (own side only, exact `submittedAt`, through the normal rule path). The Admin migration (`scripts/firebase/migrateConflictMirrors.ts`) is **optional**. If someone chooses to run it, use trusted owner ADC, run a DRY-RUN first, keep a private backup, and get explicit approval of the plan digest before any production write. Never print reflection contents or credentials.
4. If the optional migration is run, STOP before production data writes and obtain my explicit approval of the concrete dry-run plan and SHA-256. The script's `--approve-plan-sha256` argument is a technical safeguard, not permission to approve on my behalf. After approval, use the documented maintenance/concurrency checks, apply only that plan, inspect the private audit, and re-run the dry run to verify zero remaining affected/blocked records. Report any partial progress precisely. Do not reset production data.
5. Release the corrected Conflict Tracker client first, through the backport PR to `main`, which Pages deploys. Verify that the Pages production deployment commit equals the merge commit. If client deployment cannot be verified, do not deploy the rules.
6. Only after local checks, the live-rule comparison and the verified client deployment, deploy ONLY:
   `npx firebase deploy --only firestore:rules --project jlb-calorietracker`
   Storage is deferred: no bucket exists (Spark), `firebase.json` maps Firestore only, and `storage.rules` is emulator-tested only. Historical mirrors self-heal in the client, so the Admin migration is optional.
   Do not deploy Hosting, Functions, Auth, indexes or unrelated resources. Do not use the invalid `storage:rules` selector.
7. Re-read the resulting active release/ruleset references, compare deployed sources with the approved files, and verify real authorized uploads/deletes plus unauthorized denial using approved test identities and non-sensitive fixtures. Verify self-only pre-submission reads, mutual reveal, historical genuine submissions and draft privacy. Remove only fixtures you created. Resume users only after successful checks.

Finish with exact changes, test/skipped counts, live configuration differences, migration counts and approval state, client deployment evidence, rules deployment command, project ID, both release/ruleset references, post-deployment verification and remaining blockers. Update the existing backlog accurately; do not mark initiatives complete before merge and production acceptance. If access or deployment prerequisites are missing, finish independent work and name the precise blocker without claiming success.
