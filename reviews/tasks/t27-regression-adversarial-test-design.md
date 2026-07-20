# T27 — Regression and adversarial test design

Status: complete  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Review date: 2026-07-15  
Change boundary: documentation only

## Objective

Convert the investigation’s findings into an executable test strategy that prevents recurrence, prioritizes destructive/silent failures, and separates pure logic, rules-emulator, browser, API, concurrency, and deployment checks.

This task designs tests; it does not modify application code or backlogs.

## Test architecture

### Layer 1 — Pure deterministic unit tests

Use Vitest for calculations, parsers, schema migrations, time conversion, matching, and state transitions. Tests must avoid Firebase/browser dependencies where possible.

Required suites:

- CIFI current-rate anchoring, declining logarithmic curves, zero/negative/invalid histories, and monotonic payout dates.
- Transcriber silence removal, timestamp remapping, overlap stitching, speaker mapping, suppression, fallback-cache fingerprints, and correction failure preservation.
- Show scoring/recommendation eligibility, incomplete reviews, watcher filters, and model-response parsing.
- Conflict status/reveal state machine and immutable author identity.
- Trip Planner recurrence expansion across DST/timezones and local-date serialization.
- Trip Cost conservation, manual splits, spend caps, settlements, participant deletion, and payment attribution.
- Recipe equivalent scaling, bake validation, import strictness, dependency graphs, source-revision checks, and export calculations.
- Nutrition date keys, food identity, quantity precision, age calculation, target generation, CSV escaping, and estimate removal.
- Social Security reduction/credit tables, earnings tests, tax model boundaries, monthly timing, and break-even invariants.

### Layer 2 — Firestore and Storage emulator tests

Every namespace must be tested against the repository rules as deployed, not mocked authorization helpers.

Test personas:

- unauthenticated;
- ordinary verified user;
- unverified user;
- owner;
- participant/member;
- invited-email user before and after UID claim;
- removed participant;
- anonymous user;
- administrator custom-role user;
- user with the administrator email but no administrator role;
- attacker with unrelated UID/email.

Core assertions:

- no user can infer/read another user’s documents by path guessing or collection query;
- email-only membership cannot override a conflicting claimed identity;
- role removal takes effect after token refresh;
- author/creator/payer fields cannot be forged or changed by another participant;
- hidden reflections cannot be read directly before mutual reveal;
- ordinary users cannot mutate participant/admin arrays except through the intended trusted flow;
- audit/changelog records are append-only, actor-bound, and admin-readable as intended;
- cross-tool IDs cannot be linked unless both targets exist and the actor has required rights;
- Storage paths enforce the same membership lifecycle as Firestore;
- legacy wildcards cannot authorize new namespaces accidentally.

### Layer 3 — API contract and abuse tests

For every Edge/API route, test:

- missing, malformed, expired, wrong-audience, wrong-project, unverified, and unauthorized Firebase tokens;
- method and content-type enforcement;
- body/file limits at, below, and above boundaries;
- model/provider allowlists;
- malformed upstream JSON and non-JSON errors;
- timeout, cancellation, retry, duplicate request, and partial provider failure;
- error redaction for API keys, tokens, request URLs, transcript snippets, and PII;
- bounded concurrency and rate limiting;
- no sensitive response caching;
- provider-file deletion success/failure and surfaced retention warning.

Show Tracker AI routes require explicit unauthenticated, replay, oversized-prompt, injection-text, and burst tests.

Transcriber requires exact preservation tests showing that a failed cleanup chunk returns its original segments, resume caches are run/file/settings scoped, and fallback providers never reuse incompatible results.

### Layer 4 — Browser component and accessibility tests

Use Playwright or equivalent with desktop and narrow-mobile projects.

Baseline for every catalogue/static page:

- route exists and returns expected content;
- back navigation works;
- keyboard-only traversal reaches every control;
- visible focus is present;
- disclosures and tabs expose correct roles/state;
- screen-reader names are stable;
- JavaScript-disabled content remains readable where progressive enhancement is expected;
- reduced-motion removes non-essential movement;
- horizontal content has an equivalent compact representation or accessible navigation;
- no automatic media without persistent pause/mute/volume controls;
- no console errors or mixed-content requests;
- external assets have pinned versions and failure fallback.

Static safety cases:

- insert HTML/script-like strings into every editable field and confirm they render as text;
- reload and confirm localStorage values remain inert;
- test very long disclosure content for clipping;
- block `IntersectionObserver`, CDN scripts, fonts, and storage APIs;
- test post-midnight schedule ranges;
- archive dates are visibly historical and do not imply active reservations.

### Layer 5 — Multi-tab/device concurrency tests

Run with two isolated browser contexts and controlled Firestore latency.

Required scenarios:

- edit the same Nutrition day from two devices;
- delayed quantity save while changing selected date;
- edit the same Recipe/Trip Cost/Trip Planner record concurrently;
- participant removal while the removed user has an open session;
- invitation acceptance at the same time as revocation or email change;
- payment/expense deletion while another client edits it;
- planner-cost link deletion/replacement;
- rename/delete a Calorie food while a Recipe holds a confirmed reference;
- submit both Conflict reflections simultaneously, then test retry/offline replay;
- resolve/unresolve from both users concurrently.

Assertions must verify no silent overwrite, conserved totals, explicit conflicts, stable ownership, and recoverable user messaging.

### Layer 6 — Time, locale, and boundary tests

Use fake clocks plus browser timezone projects:

- America/Chicago, UTC, Asia/Tokyo, and a DST-transition zone;
- just before/after local midnight;
- leap day and year boundaries;
- browser date-only parsing versus explicit local dates;
- trip events spanning DST and destination changes;
- Social Security claiming birthdays/month boundaries;
- Nutrition age/profile updates on birthday;
- delayed autosaves crossing midnight;
- 24:00/25:00 static schedule encodings.

### Layer 7 — Deployment and production smoke tests

A deployment must publish its commit SHA and environment metadata. Post-deploy automation should validate:

- production/staging hostname resolves;
- expected commit is displayed in a protected diagnostic endpoint or response header;
- all catalogue routes and static targets return 200;
- API routes reject unauthenticated probes correctly;
- Firebase project/environment matches the intended deployment;
- security rules and indexes were deployed from the same release;
- no source maps or environment secrets are publicly exposed;
- cache invalidation removes withdrawn sensitive pages;
- rollback procedure restores the prior release and rules together.

## Finding-to-test priority groups

### P0 — Release-blocking

- F-003/F-004 framework/deployment path.
- F-009 public itinerary data removal/cache verification.
- F-036/F-069/F-071/F-072 Conflict authorization/privacy/reveal.
- F-037/F-038/F-043/F-137/F-139 Firebase authorization/deployment/admin role.
- F-087 Trip Cost conservation under spend caps.
- F-129 persistent same-origin injection.

### P1 — Silent data corruption or materially wrong output

- F-050/F-052 CIFI projections.
- F-056/F-058/F-061 transcript preservation/speaker authority.
- F-075/F-076 timezone/recurrence.
- F-088–F-090 Trip Cost ownership/lifecycle/attribution.
- F-093 recipe bake equivalence.
- F-098/F-099/F-101/F-104 Nutrition cross-date, identity, historical values, concurrency.
- F-107–F-109/F-113–F-116 Social Security rules/math/model foundations.

### P2 — Integration and lifecycle

- anonymous upgrade and account merge;
- invitation/revocation;
- planner-cost reciprocal linking;
- recipe-food revisions/deletion;
- schema migration and legacy namespace dual-read;
- archive/active content lifecycle.

### P3 — Accessibility, resilience, and documentation

- games/static disclosures, audio, reduced motion, no-JS visibility;
- mobile schedule alternatives;
- route manifest and back links;
- documentation reference validation;
- external dependency failures.

## Required CI jobs

1. `unit-core` — root Vitest suites.
2. `unit-calorie-tracker` — static tracker tests.
3. `rules-emulator` — Firestore and Storage persona matrix.
4. `api-contract` — route authentication, validation, limits, redaction.
5. `browser-public` — public routes, static safety, accessibility, mobile/no-JS/reduced-motion.
6. `browser-auth` — disposable Firebase project multi-role workflows.
7. `concurrency` — two-context destructive-update scenarios.
8. `docs-manifest` — route existence, document links, catalogue generation, sensitive-pattern checks.
9. `build-cloudflare` — exact production adapter/build command.
10. `deploy-smoke` — environment/commit/rules/routes/cache verification.

P0 jobs must block merge and deployment. P1 tests must block releases once implemented. Flaky tests may be quarantined only with an owner, issue, and expiry date; they cannot silently become non-blocking.

## Test data and privacy rules

- Never use real relationship transcripts, trip reservations, addresses, nutrition history, or API keys in fixtures.
- Generate deterministic synthetic identities and records.
- Keep provider integration recordings short, consented, and non-sensitive.
- Redact artifacts/screenshots automatically.
- Destroy temporary Firebase projects or fixture namespaces after runs.
- Test secret redaction using fake key-shaped strings, never live credentials.

## Exit criteria for T28 readiness

The final prioritization package should classify each finding as:

- covered by an existing passing test;
- test designed but not implemented;
- requires manual/environment validation;
- accepted risk with explicit owner and review date.

No Critical or High finding should be marked resolved without a regression test or a documented reason why automated verification is impossible.

## T27 outcome

T27 is complete. The repository needs a layered test program centered on rules-emulator authorization, destructive concurrency, source-to-deployment traceability, and browser adversarial cases. The design above is sufficiently specific to convert into backlog items during T28 without re-investigating the underlying failure modes.