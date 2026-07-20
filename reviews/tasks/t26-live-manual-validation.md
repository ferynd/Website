# T26 — Live and manual validation

Status: complete with documented access limitations  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Review date: 2026-07-15  
Change boundary: documentation only

## Objective

T26 was intended to validate the highest-risk findings against the deployed application and authenticated workflows rather than relying only on source inspection.

## Environment discovery result

A reproducible production target could not be resolved from the repository or public indexing:

- the GitHub repository metadata has no homepage/production URL;
- README and deployment guidance identify Cloudflare Pages but not the Pages project name, custom domain, or deployed hostname;
- no indexed deployment configuration exposes a production route;
- public web search for the repository title, owner, and likely `pages.dev` combinations returned no deployed application.

Authenticated Firebase validation would additionally require approved test accounts, participant identities, seeded non-production records, and permission to create or mutate sensitive data. None are documented in the repository.

T26 therefore distinguishes completed validation from blocked validation explicitly. No runtime behavior is claimed without evidence.

## Completed validation

### Repository/deployment state

- Confirmed `main` remained at `548d952daf9bb6bd4035d66bf8fcca234f8651f1` throughout the pass.
- Confirmed the repository is public and the audit branch remains documentation-only.
- Confirmed production deployment is described as Cloudflare Pages, but no executable production locator/runbook is available.
- Confirmed the expected Cloudflare production path is ambiguous because `package.json` exposes both `build` and `pages:build`, while README gives generic and conflicting deployment guidance.

### Public-surface source-equivalent checks

The following source-level behaviors are deterministic enough to validate without credentials:

- the Trips catalogue publicly links the Japan itinerary;
- the Japan document embeds the sensitive operational dataset directly in the shipped HTML;
- the Japan editor persists arbitrary entered strings to localStorage and later inserts them through HTML templates;
- the Chicago itinerary contains fixed historical dates/hours and JavaScript-only interaction;
- Noir audio controls and Emeril disclosure/progressive-enhancement defects are present in shipped markup/scripts;
- both Social Security tools expose their disputed calculations directly in client-side code.

These checks revalidate F-009, F-107–F-125, and F-129–F-136 at the source artifact level, but they are not substitutes for browser/device testing.

## Blocked live/manual matrix

| Area | Intended validation | Status | Required enablement |
|---|---|---:|---|
| Production home/catalogues | Routes, metadata, broken cards, 404s, back navigation | Blocked | Production hostname or Cloudflare preview URL |
| Static pages | Desktop/mobile layout, keyboard behavior, JS-disabled behavior, reduced motion | Blocked | Deployed URL or locally runnable checkout/browser |
| Japan itinerary | Confirm public exposure, cache state, persistent injection in isolated origin | Blocked | Deployed/preview URL and authorization to use a harmless payload |
| Firebase Auth | Sign-up/login, anonymous upgrade, email verification, role changes | Blocked | Approved test Firebase project/accounts |
| Firestore rules | Participant isolation, invitation claims, admin boundaries | Blocked | Emulator or non-production Firebase project with seeded roles |
| Conflict Tracker | Reflection privacy, reveal timing, invitation identity, resolution states | Blocked | Two controlled test users and disposable tracker |
| Trip Cost | Concurrent edits, participant lifecycle, payment ownership, spend caps | Blocked | At least two users and disposable trip |
| Trip Planner | Timezone/recurrence, planner-cost link integrity, concurrent edits | Blocked | Disposable planner/cost tracker and multi-user access |
| Nutrition Tracker | Guest upgrade, cross-date delayed writes, concurrent whole-day overwrite | Blocked | Disposable users/devices and controlled clock/date tests |
| Show Tracker APIs | Unauthenticated/rate-limit/model validation behavior | Blocked | Deployed API hostname and permission for bounded requests |
| Transcriber | Provider fallback, file cleanup, correction warnings, auth gate | Blocked | Admin test account, configured secrets, safe sample audio |

## New findings

### F-152 — Medium — The deployed application cannot be reproducibly located from the repository

The repository identifies Cloudflare Pages as the deployment platform but does not record a production hostname, Pages project name, custom domain, preview-link convention, or environment inventory. GitHub repository metadata also lacks a homepage URL.

This prevents contributors, reviewers, incident responders, and automated smoke tests from locating the deployed system from source control. It also makes it difficult to determine whether `main` is deployed, which environment contains a defect, or whether a security removal has propagated through caches.

**Recommendation:** Add a non-secret environment registry or deployment runbook containing production and staging hostnames, Cloudflare project identifier, branch/environment mapping, exact build command, deployment owner, and post-deploy verification links. Add the production URL to GitHub repository metadata.

### F-153 — Medium — Sensitive multi-user workflows have no documented safe manual-test environment

The repository does not document a Firebase emulator workflow, dedicated development project, disposable test identities, seeded fixtures, or cleanup procedure for relationship, nutrition, trip-finance, and invitation workflows.

As a result, manual validation either cannot be performed or risks touching production identities and sensitive records. This reinforces the existing absence of rules-emulator/integration coverage.

**Recommendation:** Establish a non-production Firebase environment and repeatable fixture loader. Provide test personas for admin, owner, participant, invited-email, anonymous, and unauthorized roles; isolate Storage; and document reset/cleanup commands.

## Required T26 follow-up evidence

The following evidence should be attached before calling the product runtime-validated:

1. Production and staging URLs plus deployed commit SHA.
2. Browser matrix results for desktop, narrow mobile, keyboard-only, reduced-motion, and JavaScript-disabled static pages.
3. Firebase emulator output covering every rule namespace and role.
4. Multi-tab/device concurrency recordings for whole-document tools.
5. Disposable end-to-end runs for invitation, account-upgrade, foreign-link, and delete/revoke workflows.
6. Network evidence that API routes reject unauthenticated/unauthorized calls and sanitize errors.
7. Cache/history verification after removing the Japan itinerary.

## T26 outcome

T26 is complete as an honest validation assessment, not as a claim that the production application was exercised. Source-equivalent checks revalidated the highest-risk public artifacts, while live and authenticated tests remain blocked by the absence of a discoverable deployment target and safe test environment. Those two operability gaps are recorded as F-152 and F-153.