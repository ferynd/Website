# T28 — Final Review and Backlog Package

Status: complete  
Original audit baseline: `b261ba0d35deb7ed7c4d5bf590ff2895f87f6ac8`  
Final reconciled main: `89128768467dc8945ec4bd14f37602dcc0421c1f`

## Executive assessment

The repository has strong product ambition, modular tool boundaries, substantial deterministic test coverage, and several sophisticated subsystems. It is beyond a prototype, but many collaboration, authorization, deployment, and long-lived production assumptions still reflect a trusted/single-user environment.

The highest risks are concentrated rather than random:

1. public sensitive travel content and static injection;
2. framework/deployment lifecycle and missing release gates;
3. Firebase role/rules blast radius;
4. Conflict Tracker confidentiality/state boundaries and misleading trend scope;
5. Trip Cost financial conservation and actor attribution;
6. Social Security model accuracy and presentation;
7. destructive whole-document collaboration writes;
8. time-zone/recurrence correctness;
9. AI route authority, cost, and privacy boundaries;
10. limited safe runtime/manual-test infrastructure.

## Investigation completion

- T00–T27 reviewed repository foundations, shared UX/security/testing, every listed tool, static content, cross-tool integration, documentation, runtime-validation readiness, and regression design.
- T28 reconciled the findings against PR #152 (Transcriber quality pipeline) and PR #153 (Recipe workflow schema v2), removed duplicate/truncated audit artifacts, and converted the remaining work into implementation initiatives.
- Original register: **153 findings**.
- Closed by later merged work: **6** — F-057, F-058, F-062, F-063, F-094, F-095.
- Remaining open: **147** — 3 critical, 63 high, 77 medium, 4 low.

Finding counts describe audit observations, not 147 independent backlog tickets. The active remediation backlog intentionally groups common root causes into 18 initiatives.

## Execution model

### Feature track

Use a feature-specific backlog with ordered phases and a matching completed archive. A new feature request creates that hierarchy when none exists. Root `BACKLOG.md` is the routing/priority layer; it does not duplicate task detail.

User-assisted deployment checks may remain open in parallel when explicitly marked non-blocking. They stay visible for reminder and evidence capture but do not prevent selection of the next dependency-ready coding phase.

### Remediation track

Use `backlogs/audit-remediation.md`. Vague fix requests select the first actionable initiative by wave/dependency. The queue is organized around architectural outcomes, not finding-number order.

### Separation rule

Keep feature and remediation PRs separate. A feature PR may include a finding only when it directly blocks safe deployment or the feature necessarily touches the same code/invariant. Wave 0 containment may preempt feature work while an exposure or materially misleading output remains live.

### Completion rule

A backlog item is not complete when code is merely pushed. It becomes complete only after merge to `main`, acceptance/check/deployment verification, and movement into the matching archive. Current state is derived from `main`, PRs, and backlog status; no mutable `CURRENT_WORK.md` is used.

## Priority roadmap

### Wave 0 — containment/release blockers

- AR-00 remove/invalidate the public Japan operational itinerary;
- AR-01 patch Next/RSC and replace the deprecated Cloudflare adapter path;
- AR-02 establish verified Firebase roles, complete rules/storage tests, and controlled deployment;
- AR-03 enforce Conflict Tracker privacy, identity/state invariants, and correctly scoped/labeled trend metrics;
- AR-04 correct Trip Cost financial conservation/ownership/lifecycle;
- AR-05 contain and rebuild Social Security outputs.

### Wave 1 — delivery confidence

- AR-06 staged release-blocking CI;
- AR-07 typed product manifest and static safety checks.

### Wave 2 — shared data foundations

- AR-08 canonical identity, namespace, schema, and foreign references;
- AR-09 transaction/version/idempotency patterns for collaborative writes;
- AR-10 shared Storage staging/ownership/retention/cleanup.

### Wave 3 — AI/API and Transcriber

- AR-11 authenticate/validate/rate-limit paid routes and bound Show recommendation context;
- AR-12 finish Transcriber source preservation, neutral context, memory, cancellation, suppression, and local recovery.

### Wave 4 — tool correctness

- AR-13 Trip Planner timezone/recurrence/state;
- AR-14 Nutrition date/identity/history/concurrency;
- AR-15 CIFI projection correctness;
- AR-16 remaining Recipe integration/correctness findings coordinated with P1–P5.

### Wave 5 — accessibility/resilience/docs

- AR-17 public/static accessibility, progressive enhancement, mobile alternatives, dependency resilience, and authoritative documentation.

## Test strategy

No critical/high finding should close without a regression test or an explicit reason automation is infeasible. T27 defines layered coverage:

- pure deterministic calculations/parsers/state machines;
- Firestore and Storage emulator personas;
- API auth/abuse/limits/redaction;
- browser accessibility/mobile/no-JS/reduced-motion/static injection;
- two-context concurrency and offline/retry;
- timezone/midnight/DST boundaries;
- exact production build and post-deploy route/rules/cache smoke checks.

## Runtime-validation limitation

The audit could not independently exercise production/authenticated workflows because the repository did not expose production/staging URLs or a disposable Firebase test environment. Source-level findings remain valid, but T26’s blocked matrix must be completed before claiming full runtime verification.

## Process architecture

The final process uses layered, low-token instructions:

1. `AGENTS.md` — repository-wide rules;
2. `BACKLOG.md` — routing and priority;
3. `backlogs/AGENTS.md` — hierarchy creation/maintenance;
4. `backlogs/protocol.md` — reconcile/PR/archive mechanics;
5. one selected active backlog;
6. linked evidence/code only when required.

`AI_AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` point to this canonical hierarchy for cross-agent compatibility. Completed archives and audit reports are not startup context.

## Final disposition

The investigation is complete. Future work should proceed through feature phases or remediation initiatives, with targeted revalidation whenever `main` changes a reviewed subsystem. The first default feature coding item is Recipe Standardizer P1; P0 remains open in parallel as a user-assisted, non-blocking deployment check. The first default fix item is AR-00.
