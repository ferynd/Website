# T10: Testing Strategy, CI, Observability, and Release Confidence

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed:

- root and nested test commands, versions, and discovery behavior;
- test inventory by product and architectural layer;
- component, API-route, Firebase-rules, browser, accessibility, static-page, and end-to-end coverage;
- TypeScript/ESLint/build checks;
- GitHub Actions, commit statuses, dependency automation, and branch-gate evidence;
- Cloudflare/provider build validation and release smoke behavior;
- runtime error boundaries, structured logging, monitoring, alerting, and privacy-safe diagnostics;
- repository agent/testing policy and its enforceability.

No commands were executed in a local checkout during this task. Repository source, prior reported build evidence, and GitHub status/workflow metadata were used. Live checks remain part of T26.

## Existing strengths

- TypeScript is strict and no-emit.
- ESLint extends Next core-web-vitals and TypeScript rules.
- The repository has a committed lockfile and deterministic pinned Cloudflare tooling after the recent deployment repair.
- `AGENTS.md` gives change-sensitive test guidance and requires build/lint for React/config changes.
- Transcriber has broad pure-logic unit coverage across chunking, merging, speaker mapping, correction parsing/guards, settings, error sanitization, concurrency helpers, profiles, and Gemini parsing.
- Recipe Standardizer covers schema validation, scaling, shopping-list derivation, naming, nutrition matching, and step-text updates.
- Nutrition Tracker covers analysis, parser, state, target, exercise, banking, nutrient, staging, and HTML-escaping helpers.
- Show Tracker has tests for classification, scoring, season checks, review completeness, recommendation context, and selected concurrency logic.
- Date Night tests its weighting/decay/stacking/roller logic.
- Trip Planner has focused scheduling tests.
- The recent Cloudflare pin commit reports a successful clean install, type-check/lint, large unit suite, Next build, and Pages build.

The core weakness is that tests are concentrated in deterministic helpers, while security, authorization, browser interaction, deployment, and real persistence boundaries remain largely untested.

## Findings

### F-043: Firestore and Storage rules have no executable authorization test suite

- Status: validated
- Category: security testing / release confidence
- Priority: high
- Confidence: high
- Applies to: current `main`
- Evidence:
  - no `@firebase/rules-unit-testing` dependency or emulator test harness was found;
  - no Firestore/Storage rules tests were discovered;
  - `AGENTS.md` explicitly permits rules/auth/data-model changes to rely on manual Firebase validation when relevant tests are unavailable;
  - T09 found a critical Conflict Tracker privacy violation and multiple membership/ownership defects that a basic allow/deny matrix should have caught;
  - Storage rules are not connected to a versioned Firebase deployment configuration.
- User impact:
  - a syntactically valid rule change can expose private records or block production access without any automated warning;
  - UI tests cannot prove direct SDK/REST denial;
  - intended privacy wording can diverge from authoritative access behavior;
  - manual console validation is difficult to reproduce and easy to skip during urgent changes.
- Root cause: Firebase rules are treated as configuration/documentation rather than executable authorization code.
- Recommendation:
  - add Firebase Emulator Suite configuration and rules-unit tests;
  - define a role matrix for anonymous, ordinary user, invited user, participant, side A/B, owner, list admin, and site admin;
  - test every collection/path for read, query, create, update field transitions, delete, and malicious cross-record access;
  - include Storage size/type/path/ownership tests;
  - make the rules suite a required CI check.
- Acceptance criteria:
  - every rules block has positive and negative tests;
  - Conflict Tracker tests prove draft confidentiality and side ownership across all submission states;
  - Show invite tests prove self-enrollment requires a real invite and cannot rewrite peers;
  - Trip Cost tests enforce record-level modification policy;
  - deployed rules are generated/deployed from the tested files;
  - CI fails on any authorization regression.
- Backlog destination: immediate Firebase security testing candidate

### F-044: No authenticated integration or end-to-end suite exercises complete user workflows

- Status: validated
- Category: integration testing / product reliability
- Priority: high
- Confidence: high
- Applies to: current `main`
- Evidence:
  - no Playwright, Cypress, Testing Library, jsdom, or browser-test dependency/configuration was found;
  - no test imports or exercises App Router API handlers as HTTP boundaries;
  - no suite signs in through Firebase, creates collaborative records, opens a second user session, or verifies permission/realtime behavior;
  - no suite opens tool modals, uses keyboard navigation, uploads media, refreshes, retries, or validates persistence;
  - the test inventory has no dedicated Conflict Tracker, Trip Cost, CIFI, Social Security, static-game/trip, or authenticated workflow suite;
  - critical defects in T06–T09 exist at component, browser, auth, and persistence boundaries outside current pure-function coverage.
- User impact:
  - builds can pass while login, collaboration, modal access, AI endpoints, uploads, realtime listeners, or mobile workflows are broken;
  - client-only permission checks can appear correct while direct backend access is insecure;
  - regressions are detected manually after deployment rather than before merge.
- Root cause: tests were added around complex algorithms but not around complete user journeys and trust boundaries.
- Recommendation:
  - use Playwright with Firebase emulators and mock/stub AI providers;
  - maintain a small critical-path suite rather than attempting exhaustive UI automation;
  - test two-user collaboration explicitly;
  - add API contract tests around authentication, validation, provider failure, timeouts, and rate limits.
- Minimum critical paths:
  1. public catalogue navigation and static-page availability;
  2. auth sign-up/sign-in/sign-out/reload;
  3. Show list invite/join/add/rate/recommend with protected AI route;
  4. Conflict private draft, mutual submit, reveal, edit, and denial paths;
  5. Trip Planner event/image lifecycle and participant access;
  6. Date Night roll/review/photo/delete lifecycle;
  7. Trip Cost concurrent expense/payment behavior;
  8. Recipe import/edit/save/reload/delete;
  9. Transcriber mocked upload/fallback/resume/cancel/result workflow;
  10. Nutrition Tracker offline/reload/persistence smoke.
- Acceptance criteria:
  - critical-path browser tests run on every PR;
  - two isolated authenticated users prove collaboration and denial behavior;
  - provider calls are deterministic and never spend real quota in CI;
  - failures retain screenshots/traces with secrets and private content redacted;
  - flaky tests have documented ownership and are not silently retried into false success.
- Backlog destination: cross-site integration-test candidate

### F-045: Accessibility and responsive behavior have no automated browser guardrail

- Status: validated
- Category: accessibility testing / UI regression
- Priority: high
- Confidence: high
- Applies to: current `main`
- Evidence:
  - no axe, accessibility-tree, keyboard, screenshot, or viewport test tooling was found;
  - React component tests are absent, so ARIA state and label associations are not asserted;
  - static pages are not exercised by a browser test runner;
  - T06/T07 found deterministic failures involving hidden focus targets, modal focus escape, unlabeled controls, selected-state semantics, live progress, static click-only controls, and timeline alignment.
- User impact:
  - accessibility regressions can recur during ordinary styling/refactoring;
  - mobile overflow and coordinate defects are invisible to unit tests and TypeScript;
  - compliance depends entirely on ad hoc manual inspection.
- Root cause: accessibility and responsive design are treated as visual review concerns rather than testable behavior.
- Recommendation:
  - add axe scans to representative public/authenticated states;
  - add keyboard-only workflows for navigation and all shared dialogs;
  - add screenshot/coordinate tests for the Trip Planner timeline and major responsive headers;
  - test 320px, tablet, desktop, 200% text scaling, and reduced motion;
  - assert focus return, background inertness, names/roles/states, and live announcements.
- Acceptance criteria:
  - no critical/serious axe violations in selected routes/states;
  - closed navigation and modals cannot expose hidden focus targets;
  - screenshot tests catch timeline/grid misalignment and document-level overflow;
  - static disclosure/tab controls pass keyboard tests;
  - accessibility checks are required, not optional report artifacts.
- Backlog destination: shared accessibility QA candidate

### F-046: Static sites bypass most repository quality checks

- Status: validated
- Category: static-platform testing / release confidence
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surfaces:
  - games;
  - trips;
  - Social Security tools;
  - portions of Nutrition Tracker.
- Evidence:
  - TypeScript and Next build do not type-check or semantically validate standalone HTML/JavaScript under `public`;
  - ESLint configuration is oriented to the Next application and no static HTML validator is configured;
  - no link checker, HTML validator, dependency-load smoke, CSP validation, or static-page browser suite was found;
  - only Nutrition Tracker has meaningful static JavaScript unit coverage;
  - T05–T09 found missing utility CSS, inaccessible controls, mutable CDN dependencies, public PII, and no security headers on static surfaces.
- User impact:
  - static pages can ship broken scripts, missing styles, dead links, invalid semantics, or exposed information while all root checks pass;
  - third-party dependency failures are detected only at runtime;
  - static regressions are systematically underrepresented in release confidence.
- Root cause: `/public` is treated as passive assets even though it contains full applications and sensitive operational pages.
- Recommendation:
  - define maintained static entrypoints and run them through HTML/JS linting, link checking, browser smoke tests, accessibility scans, and external-dependency blocking tests;
  - validate every catalogue link resolves;
  - add a sensitive-content scan for trip artifacts and accidental credentials/booking references;
  - migrate critical shared dependencies into the normal package/build pipeline where practical.
- Acceptance criteria:
  - every listed static destination loads without console/page errors in CI;
  - HTML and internal links validate;
  - third-party-CDN-blocked tests verify graceful degradation;
  - sensitive-content scanning flags emails, reservation/confirmation patterns, private phone/address data in public trip files for review;
  - static routes receive the same security-header assertions as React routes.
- Backlog destination: static-platform QA candidate

### F-047: Production failures are not captured by structured observability or actionable alerts

- Status: validated repository gap; provider dashboards require runtime verification
- Category: observability / incident response
- Priority: high
- Confidence: high for source gap
- Applies to: current `main`
- Evidence:
  - no Sentry-equivalent client/server error collection, OpenTelemetry instrumentation, structured event logger, health endpoint, or Web Vitals reporting was found;
  - realtime listener failures are frequently console-only, hidden, or converted to empty state;
  - server API routes generally return errors to the caller but do not emit privacy-safe metrics by route/provider/stage/status;
  - there are no repository-defined alerts for AI quota/cost, repeated authentication failures, elevated 5xx rates, Firebase permission failures, upload cleanup failures, or Cloudflare deployment health;
  - Transcriber's detailed run debug report is local and user-initiated, useful for diagnosis but not fleet-wide observability.
- User impact:
  - silent data/listener failures can persist without the owner knowing;
  - API abuse or provider cost spikes may be discovered only through billing;
  - production regressions lack frequency, affected-route, release, and environment context;
  - debugging may require requesting screenshots or private user data.
- Root cause: privacy concerns and personal-project scale led to local diagnostics without a deliberately minimized production telemetry model.
- Recommendation:
  - define a privacy-safe event taxonomy containing operation, stage, status, duration bucket, release SHA, and coarse error category only;
  - never record transcript text, mood/notes, conflict content, recipe data, auth tokens, booking details, or raw provider bodies;
  - add alerts for route failure rate, quota/cost, auth denials, Firebase unavailable/permission errors, and deployment smoke failures;
  - add release identifiers to client/server diagnostics.
- Acceptance criteria:
  - the owner can identify which route/tool/stage is failing and since which release without accessing user content;
  - critical alerts have thresholds and delivery destinations;
  - telemetry payloads are documented and tested for forbidden fields;
  - client/server source maps and release SHA support actionable stack traces where appropriate;
  - users receive visible error/recovery state while the owner receives aggregate operational signals.
- Backlog destination: observability/privacy candidate

### F-048: The application lacks route-level error recovery and post-deploy health verification

- Status: validated
- Category: resilience / release engineering
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - no App Router `error.tsx`, `global-error.tsx`, or instrumentation entrypoint was discovered;
  - no repository health/readiness route exists;
  - no CI/CD workflow performs preview or post-deploy HTTP/browser smoke checks;
  - the latest `main` commit has no GitHub workflow runs or combined status checks;
  - deployment success is currently inferred from manually reported build commands and Cloudflare deployment behavior.
- User impact:
  - an uncaught route/component error can fall to generic framework behavior without tool-specific reset or support context;
  - a successful build/deploy can still publish broken auth, APIs, static assets, or runtime environment variables;
  - rollback decisions lack automated health evidence.
- Root cause: release verification ends at build completion rather than deployed behavior.
- Recommendation:
  - add global and route/tool error boundaries with privacy-safe reset/report behavior;
  - deploy preview builds for PRs and smoke them using the same browser suite;
  - after production deployment, verify catalogues, static assets, protected-route 401 behavior, authenticated status, and provider-key presence through safe probes;
  - document rollback and secret/config rollback procedures.
- Acceptance criteria:
  - uncaught tool errors render a recoverable boundary and release identifier;
  - preview and production smoke checks are automated and required;
  - environment/config omissions fail a controlled readiness check without revealing secret values;
  - failed post-deploy checks block promotion or initiate a documented rollback response;
  - deployment status is visible in GitHub checks.
- Backlog destination: release engineering candidate

### F-049: Test execution has no coverage contract and is fragmented across Vitest major versions

- Status: validated; expands F-007
- Category: test governance / maintainability
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - root `npm test` uses bare Vitest discovery under Vitest 2;
  - Nutrition Tracker separately pins Vitest 4 and explicitly runs overlapping files;
  - no root Vitest config defines includes/excludes, environment, setup, timeouts, coverage, or project boundaries;
  - no coverage provider or threshold is configured;
  - test-count growth is reported, but a count does not identify untested risk or duplicate execution;
  - tool ownership and minimum expected suites are not machine-enforced.
- User impact:
  - behavior can differ depending on which test command/version a contributor runs;
  - dependency upgrades can break one suite but not another;
  - large passing counts can create false confidence while entire tools/trust boundaries remain uncovered;
  - accidental test omission may not be noticed.
- Root cause: tests accumulated organically without a single workspace/project configuration and coverage map.
- Recommendation:
  - consolidate on one supported Vitest major or intentionally configure a workspace with isolated projects;
  - define explicit test inclusion/exclusion and environments;
  - track coverage for security-critical/pure modules without chasing an arbitrary site-wide percentage;
  - maintain a risk-to-suite matrix listing each tool and required unit/integration/E2E/rules checks.
- Acceptance criteria:
  - one root command deterministically runs each test exactly once;
  - local and CI versions/configuration match;
  - coverage reports identify critical untested modules and enforce targeted thresholds;
  - adding a new persisted/authenticated tool requires registering its test obligations;
  - test documentation reports suites and risk coverage, not only total count.
- Backlog destination: test-platform consolidation candidate

## Revalidated existing findings

### F-006: no automated required PR gate

T10 directly confirms:

- no GitHub Actions workflow or Dependabot configuration;
- no workflow runs for the latest `main` commit;
- no commit status checks;
- repository guidance is advisory and cannot prevent an unchecked merge.

Required checks should include install/runtime contract, lint, type/build, consolidated unit tests, Firebase rules tests, browser smoke/accessibility tests, dependency/security scanning, and Cloudflare preview build verification.

### F-007: two Vitest major versions

Expanded into F-049. Consolidation should happen before relying on coverage or test-count trends.

### F-003/F-004: framework and adapter risk

Dependency automation, vulnerability scanning, and preview deployment tests are necessary to prevent another prolonged insecure or broken build state.

## Recommended required-check pipeline

### Fast PR checks

1. lockfile/runtime validation on the supported Node version;
2. secret and sensitive-public-content scan;
3. ESLint plus explicit TypeScript check;
4. consolidated unit tests with targeted coverage;
5. Firestore and Storage emulator rules tests;
6. dependency vulnerability/license review appropriate for the repository.

### Build and browser checks

7. standard Next build;
8. Cloudflare/OpenNext target build after migration;
9. static HTML/link validation;
10. Playwright critical-path tests against Firebase emulators and mocked AI;
11. axe/keyboard/responsive checks;
12. preview deployment smoke tests.

### Release checks

13. production deployment health probes;
14. release SHA/observability verification;
15. post-deploy authenticated and protected-route smoke;
16. rollback readiness for failed checks.

## Manual validation that remains necessary

Automation should not replace:

- real assistive-technology testing;
- real mobile/Safari media behavior;
- representative long-audio memory/provider runs;
- human review of AI recommendation/transcription quality;
- sensitive-content/privacy review before publishing travel or relationship material;
- periodic Firebase/Cloudflare/provider console configuration review.

## Next task

`T11. CIFI Research Estimator`
