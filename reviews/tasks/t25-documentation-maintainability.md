# T25 — Documentation and maintainability audit

Status: complete  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Review date: 2026-07-15  
Change boundary: documentation only

## Scope

Reviewed the repository’s developer and operator guidance, source-of-truth hierarchy, setup and deployment instructions, route/tool inventories, backlog workflow, and maintainability of the largest static surfaces.

Primary sources:

- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `BACKLOG.md`
- `backlogs/protocol.md`
- `package.json`
- representative implementation files including `app/layout.tsx`, `app/tools/trip-cost/TripContext.tsx`, `firestore.rules`, and `public/trips/JapanTrip.html`

## Executive assessment

The repository has a strong agent/backlog workflow: `AGENTS.md` provides a clear loading order, the backlog protocol defines merge-based completion, and contribution rules explicitly require documentation updates. The weakness is that the most visible documentation does not follow that hierarchy in practice.

`README.md` has expanded into a long mixture of project overview, implementation notes, historical narrative, speculative descriptions, security claims, deployment instructions, and AI-agent guidance. Much of that content duplicates `AGENTS.md`, `ARCHITECTURE.md`, `SECURITY.md`, and the live catalogue arrays. Several duplicated claims have already drifted from the code.

The static Japan itinerary is the largest maintainability hotspot: data, rendering, editing, persistence, matching, and multiple generations of enhancement scripts are appended into one HTML file. Its structure makes review and safe modification unusually difficult and contributed directly to the security and data-linking defects identified in T23.

## Revalidated existing findings

- **F-004:** the deprecated Cloudflare adapter constrains deployment maintenance.
- **F-009/F-129:** the Japan itinerary combines sensitive embedded content with unsafe rendering.
- **F-036/F-069/F-071/F-072:** Conflict Tracker privacy and identity guarantees are weaker than the README describes.
- **F-037/F-038/F-043/F-139:** rules deployment and shared-project authorization require a tested, controlled process.
- **F-142/F-144:** cross-tool links and schemas lack enforceable integrity/version contracts.

T25 does not duplicate those defects; it records documentation and maintainability causes below.

---

## New findings

### F-145 — High — Documentation promises security and integration guarantees that are not enforced

The project-facing documentation presents several properties as settled guarantees:

- Conflict Tracker reflections are described as private until both people submit.
- Trip Planner’s `costTrackerId` is described as a 1:1 link whose participant mutations remain synchronized.
- Trip Cost permissions are described as secure owner/participant boundaries.

Prior source reviews found that the current rules and models do not fully enforce those guarantees. Security-sensitive behavior must not be documented as guaranteed when it depends on client convention, mutable email membership, or unvalidated foreign IDs.

**Impact:** users may disclose sensitive relationship data under a false privacy assumption; developers may build new integrations on boundaries that do not exist; reviewers may treat documentation as evidence of controls rather than verifying rules.

**Recommendation:** document security properties only from tested rules/server invariants. Add an explicit status vocabulary: `enforced`, `client convention`, `planned`, or `known limitation`. Link each enforced claim to a rule/test identifier.

**Acceptance criteria:**

1. README and SECURITY claims match current rules and live behavior.
2. Privacy and authorization statements distinguish enforced controls from intended UX.
3. Every material security guarantee has emulator or integration-test coverage.

### F-146 — Medium — The Trip Cost README is internally contradictory and describes an obsolete data model

Within the same section, the README says ordinary users can create trips, then says only the administrator can create trips. The current Firestore rule permits trip creation only to the administrator.

The README also describes participants, expenses, and payments as subcollections with specific per-subcollection listeners and atomic/batched writes. Current `TripContext.tsx` reads and rewrites `participants`, `expenses`, and `payments` as arrays on the trip document. This is a materially different concurrency, authorization, and scaling model.

**Recommendation:** replace the historical implementation narrative with a concise current model generated or verified from types, collection builders, and rules. Move history to a changelog or archive.

### F-147 — Medium — Deployment instructions do not match the repository’s executable Cloudflare build path

`package.json` defines separate `build` and `pages:build` scripts, with `pages:build` invoking the pinned `next-on-pages` adapter. The README instead tells operators to use a generic Next.js preset or `npm run build` and choose `.vercel/output` or `.next` heuristically.

The guide does not provide one authoritative production command, output directory, required Cloudflare settings, required secrets, or a deployment verification checklist.

**Recommendation:** create a short production runbook tied directly to package scripts and checked-in configuration. State exact build command, output, runtime compatibility flags, secrets, Firebase rules/storage deployment order, and post-deploy smoke checks.

### F-148 — Medium — README is a speculative implementation dump rather than a stable entrypoint

The README contains phrases such as “likely,” “appears,” “might,” and “if present” while describing current tools. It also repeats AI-agent rules, architecture, security, setup, deployment, content-authoring, and tool-level implementation details already owned by other documents.

This makes the most visible document both difficult to review and easy to leave stale. A README should tell a contributor what the project is, how to run it, where authoritative details live, and how to validate a change—not narrate uncertain internals.

**Recommendation:** reduce README to a concise overview and verified quick start. Move detailed tool architecture to tool-local docs or `ARCHITECTURE.md`; keep agent workflow only in `AGENTS.md`; keep security properties only in `SECURITY.md` and rules/tests.

### F-149 — Medium — Route and product inventories are manually duplicated and already inconsistent

The catalogue exists independently in:

- hardcoded arrays in `app/games/page.tsx`, `app/tools/page.tsx`, and `app/trips/page.tsx`;
- README tool/game/trip sections;
- `ARCHITECTURE.md` route lists;
- home-page copy and backlog references.

Drift is visible now: `ARCHITECTURE.md` lists only the Chicago trip under `/public/trips`, while the actual Trips catalogue also publishes the Japan itinerary. README similarly describes the current Trips section primarily around Chicago.

**Recommendation:** define one typed project manifest used to render catalogue pages and generate a documentation inventory. Include lifecycle (`active`, `archived`, `private`), implementation type, sensitivity, owner, route, and validation command.

### F-150 — Medium — JapanTrip.html is an append-only multi-generation application with no maintainable source boundary

The Japan itinerary is a single large HTML document containing embedded operational data, styles, editor UI, localStorage persistence, fuzzy matching, and multiple versions of rendering functions. Earlier functions render days and schedules; later scripts redefine or wrap those functions and render the page again.

This structure makes it difficult to determine which implementation is authoritative, safely escape all data, test matching, or remove sensitive fields. The T23 persistent-injection and fuzzy-linking defects are predictable outcomes of this architecture.

**Recommendation:** do not continue patching the generated HTML. Extract typed data, pure matching/validation functions, escaped rendering, and persistence into modules with tests—or retire the operational page and rebuild only a sanitized archive.

### F-151 — Medium — Documentation and static-content invariants are policy-only, not automatically validated

Contributor and agent guides require back links, current docs, correct catalogue entries, safe static content, and manual page checks. There is no repository check that verifies:

- every catalogue route exists;
- every public static page has a return path;
- docs reference existing paths and current catalogue entries;
- public pages do not contain known-sensitive patterns;
- external scripts are pinned;
- archived trips are not presented as active;
- large static pages avoid unsafe user-data `innerHTML` sinks.

**Recommendation:** add a lightweight repository validation script and CI job. It should parse the project manifest/public tree, verify route targets and back links, scan documentation references, and run focused static safety checks. Treat it as a guardrail, not a substitute for security review.

---

## Strengths

- `AGENTS.md` is a clear canonical workflow entrypoint with useful context-loading rules.
- `backlogs/protocol.md` has disciplined merge-based status reconciliation and commit traceability.
- `CONTRIBUTING.md` explicitly requires documentation updates in the same PR.
- `SECURITY.md` correctly identifies `firestore.rules` as the authoritative rules source.
- Complex Transcriber architecture is documented with unusually good module and data-retention detail.
- Modern React tools generally colocate pure logic and tests better than the legacy/static pages.

## Recommended sequence

1. Correct false security/integration guarantees under F-145 immediately.
2. Replace Trip Cost’s obsolete README section under F-146.
3. Publish one exact deployment runbook under F-147.
4. Introduce a typed project manifest and generated catalogue/docs inventory under F-149.
5. Reduce README and clarify document ownership under F-148.
6. Retire or modularize the Japan static application under F-150.
7. Add documentation/static-content validation under F-151.

## T25 outcome

T25 is complete. The repository has good workflow discipline but weak documentation authority. Documentation should be treated as untrusted until security claims, Trip Cost architecture, deployment instructions, and route inventories are reconciled with code and backed by automated checks.