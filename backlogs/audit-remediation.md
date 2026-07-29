# Audit Remediation — Active Backlog

Compact execution queue derived from the 2026 full-site investigation. Detailed evidence remains in `reviews/tasks/`; load only reports linked by the selected initiative.

## Parameters

- **Branch/PR:** one focused branch/PR per initiative from current `main`: `working/audit-<id>-<slug>` where possible.
- **Commit scope:** affected subsystem; IDs AR-00 onward; next new ID **AR-18**; never reuse IDs.
- **Archive:** `backlogs/audit-remediation-completed.md`.
- **Checks:** initiative acceptance tests plus the smallest relevant commands from `AGENTS.md`. Critical/high work requires regression coverage or an explicit automation limitation.

## Dispatch

For “continue implementing fixes,” “continue audit remediation,” or “continue Wave N”:

1. Reconcile this backlog against `main`.
2. Resume `[p] needs follow-up` first.
3. Otherwise select the first unblocked `[ ]` initiative in wave order.
4. Use one initiative per PR unless adjacent work shares the same files, tests, and release boundary.
5. Read only the linked evidence for that initiative.

## WAVE 0 — Immediate containment and release blockers

- [p] **AR-00 Remove and invalidate the public Japan operational itinerary.** Findings F-009, F-128–F-136, F-150. Remove public access and sensitive shipped content; assess repository/cache/history exposure; rotate still-sensitive references; decide whether to rebuild a sanitized archive.
  - **Depends:** none. **Evidence:** T23, T25, T26.
  - **Accept:** sensitive page is not publicly retrievable; cache/history/rotation actions are recorded; any replacement uses an allowlisted safe dataset and passes mobile/accessibility/static-injection checks.
  > needs follow-up — `public/trips/JapanTrip.html` deleted and delisted from the Trips catalogue and homepage (no code path serves it going forward); checks: lint, build, `npm test` all pass. Not closable yet: (1) content is still recoverable from git history — closing requires a maintainer-authorized history rewrite (`git filter-repo` + coordinated force-push + re-clone) that this session will not perform unilaterally; (2) cache/search-engine exposure can't be assessed without a known production URL/deployed SHA (blocked, same gap as F-152/T26); (3) rotating the still-live booking/vendor references (JTB, GetYourGuide, MO-MO Paradise, phone numbers) requires contacting those vendors, outside code scope; (4) no sanitized public replacement was built — deferred decision, not required by Accept criteria unless a replacement ships. Decision needed from the user on 1–3 before this item can reach `[x]`.

- [p] **AR-01 Patch framework security and replace the deprecated Cloudflare path.** Findings F-003, F-004, F-005, F-008, F-147, F-152. Upgrade Next/RSC and migrate from `next-on-pages` to a supported deployment; pin Node/package manager; publish exact environment/build/rollback/smoke instructions.
  - **Depends:** none. **Evidence:** T02, T25, T26.
  - **Accept:** patched supported versions; clean production-equivalent build; discoverable production/staging URLs and deployed SHA; verified rollback/smoke runbook.
  > needs follow-up — Next.js upgraded 15.4.3 → 15.5.22 (the actively-patched backport line; closes every disclosed CVE, including several high-severity SSRF/middleware-bypass/DoS ones the audit's originally-cited 15.4.11 target does not — that line has no further patches). Migrated off deprecated `@cloudflare/next-on-pages` to `@opennextjs/cloudflare` (F-004): added `wrangler.jsonc`/`open-next.config.ts`, removed `export const runtime = 'edge'` from all 12 API routes (required by the adapter; verified `verifyFirebaseAuth.ts`'s Web Crypto usage has no edge-only dependency), replaced the `pages:build` script with `cf:build`/`cf:preview`/`cf:deploy`. Added `engines`/`packageManager`/`.nvmrc` pinning Node 22 (F-005). Rewrote README's Deployment section into an exact runbook: build/deploy commands, required secrets, rollback, post-deploy smoke check (F-008, F-147). Checks: lint, `next build`, `opennextjs-cloudflare build`, full `npm test` (1974 tests) all pass; locally booted the built Worker with `wrangler dev` and confirmed `/`, `/trips` (200), the removed Japan page (404, confirming AR-00 survives the new build path), and an API route all serve correctly.
  > Not closable yet: (1) `wrangler.jsonc`'s Worker name/service binding are placeholders — never confirmed against a real Cloudflare account (no credentials available in this session); (2) no actual `wrangler deploy` was run, so "verified rollback/smoke runbook" and "discoverable production/staging URLs" (F-152) remain unverified against production — same operability gap T26 already flagged; (3) Worker secrets (`GEMINI_API_KEY`, `GPT_API_KEY`, TMDB creds) need to be set on the new Worker via `wrangler secret put` before first deploy. Needs a maintainer with Cloudflare dashboard access to run the first `cf:deploy`, confirm the project name, set secrets, and record the resulting URL/SHA here.

- [p] **AR-02 Establish Firebase authorization and rules release controls.** Findings F-037, F-038, F-043, F-137–F-140, F-145, F-153. Replace hardcoded-email privilege with a verified immutable role signal; test every Firestore/Storage namespace with emulator personas; version and deploy rules with application releases.
  - **Depends:** AR-01 for final release automation; emulator work may start immediately. **Evidence:** T09, T24–T27.
  - **Accept:** email alone grants no admin access; role grant/revocation tests pass; full rules/storage matrix passes; app/rules releases and rollback are traceable.
  > needs follow-up — Scoped to shared cross-tool authorization infrastructure; deep per-tool field-transition rules (Conflict Tracker reveal timing, Trip Cost conservation) are left to AR-03/AR-04, which now build on this harness rather than duplicating it. Delivered: (1) F-043 — new `@firebase/rules-unit-testing` + Firebase emulator harness (`tests/rules/`, `npm run test:rules`, `firebase.json`), runnable fully locally with no real Firebase project; (2) F-137/F-041 (partial) — `isAdmin()` in both rules files now requires `email_verified == true`, using a null-safe `.get()` accessor (a real bug this harness caught: Storage Rules throws on a genuinely-absent token claim instead of returning false, unlike Firestore Rules — see storage.rules comment); full custom-claim/allowlisted-UID migration is NOT done (needs Admin SDK/server credentials this session doesn't have — the admin email itself is still the root credential); (3) F-138 — legacy CalorieTracker wildcard pinned from `{appId}` to the literal `default-app-id` namespace so a future per-user tool isn't implicitly writable; (4) F-038 — new canonical `storage.rules` (replaces `storage.date-night.rules`, which had no Trip Planner coverage at all) with participant scoping plus a server-side 8 MB/image-type ceiling, wired into `firebase.json` alongside `firestore.rules`; (5) F-145 (partial) — SECURITY.md's Trip Planner/Date Night upload bullets now describe the actual server-side enforcement instead of implying client compression is the boundary. Checks: `npm run lint`, `npm run build`, `npm test` (1974 tests), and `npm run test:rules` (19 passed, 2 documented `it.skip`) all pass.
  > Not closable yet: (1) two Storage rules tests (Date Night/Trip Planner participant-upload success path) are skipped — this sandbox's local emulator throws a "Null value error" on the Storage→Firestore cross-service `firestore.get()` call even though the referenced document exists; the identical idiom was already live in the pre-existing `storage.date-night.rules`, so this is believed to be a sandbox-specific limitation, not a rules defect, but it has NOT been verified green anywhere. Re-run `npm run test:rules` in an unrestricted environment before trusting this path. (2) Admin authority is still email-based (email_verified-gated only); a real fix needs a Firebase custom claim or allowlisted-UID role document set via the Admin SDK, which needs Cloudflare/Firebase-adjacent server credentials outside this session's access — F-137/F-041 are only partially closed. (3) No `firebase deploy --only firestore:rules,storage:rules` has been run — the emulator-verified rules files are not yet the live deployed rules; F-153's "no documented safe manual-test environment" gap is now closed by the harness, but deployment itself still needs the user's Firebase CLI login. (4) F-140 (canonical cross-tool identity contract) is intentionally left to AR-08, which owns it and depends on AR-02.

- [p] **AR-03 Enforce Conflict Tracker privacy, identity, and trend correctness.** Findings F-036, F-069–F-074. Reflections must be rules-unreadable before the intended reveal; invitation claim, side/author ownership, submission state, shared editing, resolution, and deletion must be actor-bound and transaction-safe; trend metrics must be correctly scoped and labeled rather than presenting one-conflict data as tracker-wide.
  - **Depends:** AR-02. **Evidence:** T14, T24.
  - **Accept:** emulator tests prove pre-reveal isolation and immutable authorship; drafts cannot unlock shared data; concurrent submit/resolve/delete behavior is deterministic; trend queries and labels distinguish conflict-specific from tracker-wide results; copy matches enforced behavior.
  > needs follow-up — F-036 (critical) closed: reflection read rules now deny a partner's document entirely until both sides have genuinely submitted, verified via a new `personASubmittedAt`/`personBSubmittedAt` mirror on the conflict doc that rules only allow to be set to the exact value already committed on that side's own reflection (can't be forged). F-069 closed: SharedSection and the status badges now gate on that same signal instead of the draft-only `hasReflectionA/B` flags (which the existing UI wrongly treated as a submission signal) — also fixed a latent bug this introduced (partner's "submitted" badge could never show under the old reflection-content-based check, since that content is exactly what's hidden pre-reveal). F-037 closed for this tool: every conflict/tracker/reflection field now has an explicit field-diff-scoped write rule (creator/Person A for content and shared section, each side for their own resolved flag, one-time Person-B claim) — replacing the prior "any member can rewrite everything" rules. F-071 closed except email_verified (see below). F-072 closed: resolution flags are per-side and `status` is rules-validated against them. F-073 addressed conservatively: a reflection can no longer be un-submitted back to a hidden draft, without redesigning the existing (intentional, UI-documented) re-edit-and-resubmit flow. F-074 closed: conflict/reflection deletion is Person A/admin only (rules-enforced) and `deleteConflict` now uses a Firestore batch instead of sequential deletes. SECURITY.md gained a Conflict Tracker section documenting what's actually enforced (F-145). New dedicated `tests/rules/conflict-tracker.rules.test.ts` (14 tests, all passing) covers pre-reveal isolation, authorship tampering, field-scoped updates, the claim transition, and deletion authority. Checks: lint, build, `npm test` (1974), `npm run test:rules` (33 passed, 2 pre-existing skips unrelated to this tool) all pass.
  > Not closable yet: (1) F-071's `email_verified` requirement for the Person B claim was deliberately *not* added — this app has no email-verification UI for ordinary users (only Transcriber's admin flow calls `sendEmailVerification`), so requiring it would lock out real Conflict Tracker users; needs a verification-email UI addition before this can close. (2) F-070 (trend dashboard scoping/labeling) was not addressed — deferred, no code changed for it. (3) None of this has been deployed (`firebase deploy --only firestore:rules`) or verified against a real Firebase project/existing production data — the rules were only exercised against the local emulator with synthetic seed data. Given F-036 changes what data is currently readable, deploying this needs verification against real Conflict Tracker documents (in particular, confirm `personASubmittedAt`/`personBSubmittedAt` get backfilled — see follow-up note below — before deploy, or existing already-submitted-but-unmirrored conflicts will incorrectly stay locked).
  > **Migration note for deploy:** existing conflict documents created before this change won't have `personASubmittedAt`/`personBSubmittedAt` set, even if both reflections were already genuinely submitted — the shared section and cross-partner reflection read would incorrectly stay locked for that historical data until a one-time backfill (for each conflict, if both reflections have `submittedAt != null`, copy those values into the parent conflict doc) is run. No backfill script was written in this session.

- [ ] **AR-04 Correct Trip Cost conservation, ownership, and participant lifecycle.** Findings F-031, F-087–F-092 and related concurrency/integration findings. Reject infeasible caps; require balances to conserve spend and net to zero; enforce payer/creator ownership; prevent participant deletion from stranding references; honor Planner deep links.
  - **Depends:** AR-02 for authorization tests. **Evidence:** T17, T24.
  - **Accept:** property tests conserve every cent; settlements include only true debtors/creditors; references survive or block participant removal; two-client and rules tests pass.

- [ ] **AR-05 Contain and rebuild misleading Social Security outputs.** Findings F-107–F-120. Immediately label/disable disputed planning results, then rebuild on authoritative versioned rules with monthly timing and explicit scope.
  - **Depends:** none. **Evidence:** T20, T21.
  - **Accept:** no stale/incomplete model is represented as dependable planning guidance; source year and assumptions are visible; golden tests cover claiming ages, earnings test, ARF, tax, timing, spouse/survivor scope, and balance boundaries.

## WAVE 1 — Delivery and regression infrastructure

- [ ] **AR-06 Add staged, release-blocking CI.** Findings F-006, F-007, F-044–F-049, F-151; test design T27. Add pinned-runtime clean install, canonical unit projects, rules emulator, API contract, public/auth browser, concurrency, docs/manifest, production build, and deploy smoke jobs in staged order.
  - **Depends:** AR-01/AR-02 for deployment/rules jobs.
  - **Accept:** P0 checks block merge/deploy; test ownership is explicit; flaky quarantine requires owner/issue/expiry; artifacts are privacy-safe.

- [ ] **AR-07 Create a typed product manifest and static safety checks.** Findings F-010–F-017, F-135, F-149, F-151. One manifest should drive catalogues and validate route, lifecycle, sensitivity, implementation type, owner, back link, external dependency, and archive status.
  - **Depends:** AR-00 lifecycle decision.
  - **Accept:** catalogues derive from one source; invalid/private/missing routes fail CI; docs inventory and sensitive/static-sink checks run automatically.

## WAVE 2 — Shared identity, data integrity, and lifecycle

- [ ] **AR-08 Define canonical identity, namespace, and foreign-reference contracts.** Findings F-138, F-140–F-144. Normalize UID/email/account state, version schemas/references, migrate accidental namespaces, and validate target existence, authorization, lifecycle, and reciprocal linkage.
  - **Depends:** AR-02.
  - **Accept:** account/identity transitions and migrations are tested; foreign links cannot be syntactically valid but semantically unauthorized/stale; schema owners/versions are documented.

- [ ] **AR-09 Replace destructive whole-document collaboration writes.** Findings include F-034, F-066, F-079, F-080–F-085, F-088–F-090, F-096, F-098, F-104. Use transactions, actor-addressable records/maps, version preconditions, and idempotent operation IDs.
  - **Depends:** AR-06 concurrency harness.
  - **Accept:** two-client tests show no silent loss or duplicate operation; partial success is visible/recoverable; generic forms cannot overwrite member-owned fields.

- [ ] **AR-10 Build shared Storage staging, ownership, retention, and cleanup.** Findings F-039, F-078, F-086 and related Planner/Date Night upload risks. Stage uploads, finalize after owning-record commit, delete replaced/deleted assets, and reconcile orphans.
  - **Depends:** AR-02, AR-08.
  - **Accept:** cancel/failure/replacement/deletion tests leave no unauthorized or orphaned objects; cleanup is idempotent, observable, and membership-aware.

## WAVE 3 — AI/API integrity and Transcriber preservation

- [ ] **AR-11 Harden paid AI/media APIs and bound recommendation context.** Findings F-030, F-035, F-040, F-067, F-068 and applicable route findings. Require auth/authorization, strict schemas, request/model/field/token limits, quotas/rate limits, timeout/cancellation, redacted errors, untrusted-data boundaries, and server-authoritative inputs.
  - **Depends:** AR-02, AR-06.
  - **Accept:** unauthenticated/oversized/burst/injection requests fail before provider spend; Show recommendation cost is bounded; client-supplied records cannot bypass list authority; privacy-minimized contract tests pass.

- [ ] **AR-12 Complete remaining Transcriber fidelity, memory, cancellation, and recovery work.** Findings F-030, F-056, F-059–F-061, F-064. Make silence deletion and suppression preservation-safe/reviewable, remove personalized default context, bound decoded-memory/chunk materialization, add cancellation, and protect undownloaded/tab-local work.
  - **Depends:** AR-06 for browser/API/evaluation harness expansion. **Evidence:** T12, T12A.
  - **Accept:** quiet/repeated-phrase corpus has no unacceptable omissions; default context is neutral; peak memory is measured/bounded; cancellation cleans provider files and retains safe progress; unload/recovery behavior is accurate and tested.
  - **Do not reimplement:** PR #152 closed F-057, F-058, F-062, and F-063.

## WAVE 4 — Tool correctness

- [ ] **AR-13 Correct Trip Planner timezone, recurrence, and planner-local state.** Findings F-075–F-079 and related scheduling/storage risks. Use one zoned-time contract for create/edit/drag/display/recurrence and preserve occurrence-relative dates.
  - **Depends:** AR-06 time/browser tests.
  - **Accept:** different browser zones produce the same intended instant; series edits preserve distinct occurrences; DST/cross-midnight/planner-switch/concurrency tests pass.

- [ ] **AR-14 Protect Nutrition Tracker date, identity, historical values, and concurrent logs.** Findings F-098–F-106. Bind delayed saves to captured date/user, use collision-safe food identity/rename, support guest upgrade, preserve exact historical exercise, add revision-safe daily writes, and correct precision/timezone/CSV handling.
  - **Depends:** AR-06; AR-08 where identity migration applies.
  - **Accept:** multi-tab/date-boundary/upgrade/rename tests show no silent loss or cross-date write; exports are spreadsheet-safe.

- [ ] **AR-15 Correct CIFI projection anchoring and declining-curve solving.** Findings F-050, F-052 and supporting estimator findings.
  - **Depends:** none.
  - **Accept:** current observed rate anchors projections; declining/log/zero/negative/outlier fixtures behave mathematically and surface uncertainty.

- [ ] **AR-16 Close remaining Recipe integration/correctness findings during the feature rollout.** Findings F-093, F-096, F-097, F-141, F-143. Coordinate with `backlogs/recipe-standardizer.md`; do not create competing PRs.
  - **Depends:** selected Recipe phases and AR-08 namespace plan.
  - **Accept:** P1/P3 close link/provenance issues; P5 fixes or explicitly retains bake/concurrency/namespace risk with tests. PR #153 already closed F-094/F-095.

## WAVE 5 — Accessibility, resilience, and documentation

- [ ] **AR-17 Complete public/static accessibility, resilience, and documentation cleanup.** Findings F-121–F-127, F-130–F-136, F-146–F-151 and earlier cross-site UI findings. Add controllable media, semantic disclosures/tabs, reduced-motion/no-JS behavior, compact schedule alternatives, pinned/fallback dependencies, concise runbooks, and accurate security claims.
  - **Depends:** AR-00, AR-01, AR-07.
  - **Accept:** public browser matrix passes keyboard/mobile/no-JS/reduced-motion; README/runbooks are concise/current; Security distinguishes enforced controls from conventions/limitations.

## Operating rules

- Queue order is authoritative when the user is vague about fixes.
- A requested feature can precede later waves; include only its direct blockers/touched-code findings.
- Wave 0 containment may override feature work while an active exposure or materially misleading output remains live.
- Archive an initiative only after merge, acceptance verification, required deployment, and regression coverage.
