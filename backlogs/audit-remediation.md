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

- [ ] **AR-00 Remove and invalidate the public Japan operational itinerary.** Findings F-009, F-128–F-136, F-150. Remove public access and sensitive shipped content; assess repository/cache/history exposure; rotate still-sensitive references; decide whether to rebuild a sanitized archive.
  - **Depends:** none. **Evidence:** T23, T25, T26.
  - **Accept:** sensitive page is not publicly retrievable; cache/history/rotation actions are recorded; any replacement uses an allowlisted safe dataset and passes mobile/accessibility/static-injection checks.

- [ ] **AR-01 Patch framework security and replace the deprecated Cloudflare path.** Findings F-003, F-004, F-005, F-008, F-147, F-152. Upgrade Next/RSC and migrate from `next-on-pages` to a supported deployment; pin Node/package manager; publish exact environment/build/rollback/smoke instructions.
  - **Depends:** none. **Evidence:** T02, T25, T26.
  - **Accept:** patched supported versions; clean production-equivalent build; discoverable production/staging URLs and deployed SHA; verified rollback/smoke runbook.

- [ ] **AR-02 Establish Firebase authorization and rules release controls.** Findings F-037, F-038, F-043, F-137–F-140, F-145, F-153. Replace hardcoded-email privilege with a verified immutable role signal; test every Firestore/Storage namespace with emulator personas; version and deploy rules with application releases.
  - **Depends:** AR-01 for final release automation; emulator work may start immediately. **Evidence:** T09, T24–T27.
  - **Accept:** email alone grants no admin access; role grant/revocation tests pass; full rules/storage matrix passes; app/rules releases and rollback are traceable.

- [ ] **AR-03 Enforce Conflict Tracker privacy, identity, and trend correctness.** Findings F-036, F-069–F-074. Reflections must be rules-unreadable before the intended reveal; invitation claim, side/author ownership, submission state, shared editing, resolution, and deletion must be actor-bound and transaction-safe; trend metrics must be correctly scoped and labeled rather than presenting one-conflict data as tracker-wide.
  - **Depends:** AR-02. **Evidence:** T14, T24.
  - **Accept:** emulator tests prove pre-reveal isolation and immutable authorship; drafts cannot unlock shared data; concurrent submit/resolve/delete behavior is deterministic; trend queries and labels distinguish conflict-specific from tracker-wide results; copy matches enforced behavior.

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
