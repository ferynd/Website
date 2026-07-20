# T24 — Cross-tool identity, data-model, and integration audit

Status: complete  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Review date: 2026-07-15  
Change boundary: documentation only

## Scope

This task reviewed the architecture connecting the site’s authenticated and stateful tools rather than re-reviewing each tool independently. It covered:

- shared Firebase project and authentication configuration;
- Firestore namespace and rules architecture;
- administrator identity and authorization;
- anonymous versus authenticated account continuity;
- participant/member/person identifiers across tools;
- email invitation identity;
- Trip Planner ↔ Trip Cost references;
- Recipe Standardizer ↔ Calorie Tracker references;
- schema versioning, provenance, and referential integrity;
- browser-local state that appears integrated but is not shared.

Primary sources included `firestore.rules`, shared Firebase configuration, tool database adapters, and integration-specific model code.

## Executive assessment

The site has made a useful move toward a shared `artifacts/{tool}` namespace, but it does not yet have a shared identity or integration model. Each tool independently defines “person,” “participant,” “member,” “owner,” and “admin” using different combinations of UID arrays, email arrays, display-name maps, participant objects, and hardcoded site-owner exceptions.

All authenticated tools share one Firebase project and one rules deployment. That simplifies setup, but it also turns authorization mistakes and schema drift into cross-tool risks. The administrator role is granted by comparing a token email to a hardcoded address rather than by a verified custom claim. The same email is also exported to client code. Meanwhile, integrations mostly store foreign document IDs without validating the target’s ownership, membership, existence, version, or lifecycle.

The most important remediation is to introduce a small shared identity/integration layer: verified custom roles, normalized identity profiles, typed/versioned foreign references, explicit ownership checks, and migration-safe namespace contracts.

## Revalidated existing findings

- **F-037/F-038/F-043:** Firestore/Storage authorization and deployment require tightening, versioning, and emulator validation.
- **F-069/F-071/F-072:** Conflict Tracker email/UID membership and reveal boundaries remain unsafe.
- **F-088/F-089/F-090:** Trip Cost participant lifecycle, ownership, and attribution remain inconsistent.
- **F-097:** Recipe nutrition links are retained without revalidation.
- **F-100:** Calorie Tracker anonymous identities lack a safe upgrade/login path.
- **F-104:** Whole-document state remains vulnerable to concurrent overwrite.

T24 does not duplicate those findings; it records the architectural causes and cross-tool consequences below.

---

## New findings

### F-137 — High — Site-wide administrator authority is granted by a hardcoded email claim

`isAdmin()` in Firestore rules checks only whether `request.auth.token.email` equals a hardcoded address. The same address is exported from the client Firebase configuration and reused by multiple tools.

The rule does not require a dedicated custom claim, an immutable administrator UID, or `email_verified == true`. Email becomes both a public identifier and the root authorization credential for broad access across Trip Cost, Trip Planner, Date Night, Conflict Tracker, Show Tracker, and other shared-project data.

Consequences include:

- a single account/email-control failure grants broad cross-tool access;
- role changes require source/rules deployment rather than controlled administration;
- development and production environments cannot cleanly assign different administrators;
- security review cannot distinguish ordinary identity from privileged authorization.

**Recommendation:** Replace email-based administration with Firebase custom claims or an allowlisted UID role document administered only by trusted server-side tooling. Require verified identities, log role changes, and remove the administrator email from client-facing constants.

**Acceptance criteria:**

1. Firestore rules authorize administrators through a dedicated immutable role signal.
2. Email values are never sufficient for site-wide privilege.
3. Rules-emulator tests cover forged/unverified email claims, changed emails, removed roles, and ordinary users.

### F-138 — Medium — The legacy wildcard weakens namespace and schema isolation for current and future tools

The rule:

`match /artifacts/{appId}/users/{userId}/{document=**}`

allows any signed-in user to read and write any nested path under their own UID for any `appId`. Explicit Recipe Standardizer rules are therefore redundant, and future per-user tools placed beneath this shape may become writable before their intended validation rules are designed.

Although callers cannot use this wildcard to write another user’s UID, it prevents tool-specific field validation, immutable ownership fields, size controls, and lifecycle constraints. It also makes it harder to reason about which explicit block actually protects a path.

**Recommendation:** Replace the wildcard with explicit rules for the Calorie Tracker legacy namespace and each supported per-user tool. Add field allowlists and schema-version checks where feasible.

### F-139 — High — One Firebase project and one rules deployment create a site-wide authorization blast radius

Trip Cost explicitly states that it uses the same Firebase project as Calorie Tracker, and the shared rules file governs numerous unrelated tools and sensitive datasets. A permissive helper, wildcard, deployment mistake, or rule-order misunderstanding can therefore expose multiple applications at once.

This is particularly significant because the project includes nutrition history, relationship conflicts/reflections, trip finances, date history/photos, watch-list preferences, recipes, and itinerary data.

**Recommendation:** At minimum, split rules into tested modules generated into one deployment, require emulator integration tests for every namespace, and block deployment unless the complete suite passes. Consider separate Firebase projects for the most sensitive domains, especially Conflict Tracker, to reduce breach impact and simplify least privilege.

### F-140 — Medium — Cross-tool person identity is fragmented and has no canonical profile

The tools independently use fields such as:

- `participantIds`, `participantUids`, and `memberUids`;
- `memberEmails` and pending-invite email documents;
- participant objects with tool-specific IDs;
- `memberDisplayNames` keyed by UID;
- creator, payer, author, owner, and administrator identifiers.

There is no shared profile document, normalized email helper, identity status, merge history, or stable person-reference type. The same person can therefore appear as an email-only invite, an anonymous UID, an authenticated UID, and several display names across tools without a supported reconciliation path.

**Recommendation:** Define a shared `UserIdentity`/`PersonRef` contract with canonical UID, normalized verified email, display-name provenance, account type, and migration/merge metadata. Tool records should store immutable UID references plus optional snapshots for historical display.

### F-141 — Medium — The Calorie Tracker integration depends on an implicit `default-app-id` fallback

Recipe Standardizer reads saved foods from `artifacts/default-app-id/users/{uid}/foodItems`. That namespace is not a deliberate product identifier; it exists because the static Calorie Tracker does not set `window.__app_id` and falls back to the string `default-app-id`.

This makes an accidental runtime fallback part of the permanent integration contract. Correcting the Calorie Tracker configuration or introducing environments could silently disconnect all Recipe Standardizer food matches.

**Recommendation:** Adopt an explicit versioned namespace such as `calorie-tracker`, migrate existing documents, and support a temporary dual-read migration. Record the source namespace/version in nutrition references.

### F-142 — Medium — Trip Planner ↔ Trip Cost linking lacks referential and membership integrity

Trip Planner stores a `costTrackerId`, and its owner can change that field. The rules protect each underlying tool independently, but they do not verify that:

- the referenced Trip Cost document exists;
- the planner owner may administer the target tracker;
- planner and tracker participant sets correspond;
- the linked tracker has not been deleted or replaced;
- the link was intentionally accepted by both sides.

An invalid or unrelated ID can therefore be saved as an apparently valid integration. Users may see a link they cannot open, or the planner may imply financial coverage for a different participant group.

**Recommendation:** Create links through a trusted server transaction that validates both documents and records reciprocal typed references, actor UID, creation time, schema version, and participant compatibility. Surface broken/stale links explicitly.

### F-143 — Medium — Recipe nutrition references lack source revision and lifecycle provenance

A Recipe Standardizer ingredient stores a Calorie Tracker food item ID, matched name, confidence, and review flag. Confirmed links are preserved without checking whether the target food still exists, was renamed, had its nutrients changed, or was replaced after a slug collision.

This is a foreign-key relationship without revision, snapshot, or deletion semantics. Future nutrition calculations could silently use a materially different food than the one the user originally confirmed.

**Recommendation:** Store source tool, namespace, food ID, source revision/update timestamp, confirmed nutrient snapshot, and confirmation actor/time. Revalidate on load and before calculation; require review when the source changes or disappears.

### F-144 — Medium — Cross-tool schemas and foreign references are not centrally versioned

Tools use independent document shapes and ad hoc references, but there is no shared integration schema registry, migration contract, or compatibility check. IDs such as `costTrackerId` and `foodItemId` are plain strings with no tool, environment, type, or version discriminator.

This increases the chance that refactors, imports, test data, or environment changes create syntactically valid but semantically wrong references.

**Recommendation:** Define typed foreign references containing at least `{ project, tool, entityType, id, schemaVersion }`, validate them at boundaries, and document migration/deprecation policy. Add integration tests that use production-shaped documents across tool versions.

---

## Architectural strengths

- Most modern tools use Firebase UID rather than display name as the primary authorization identifier.
- Firestore data is broadly separated beneath tool-specific `artifacts/{tool}` namespaces.
- Several rules distinguish owners/admins from ordinary participants.
- Show Tracker’s per-UID display-name map is more enforceable than mutable array objects because Firestore can constrain changed map keys.
- Recipe Standardizer uses stable food document IDs in addition to names, providing a foundation for a stronger revisioned reference.
- Trip Planner prevents ordinary participants from changing `costTrackerId`; the remaining issue is validating the owner-created link.

## Validation limitations

- This was a source/rules review; it did not execute the Firebase emulator or inspect live project claims/documents.
- Actual deployed rules may differ from the repository version, which is itself an existing deployment-risk finding.
- Account linking, anonymous upgrade, invite acceptance, and foreign-link failure states remain candidates for live T26 validation.

## Recommended implementation sequence

1. Replace email-based site administration under F-137.
2. Establish mandatory full-project rules-emulator coverage and reduce the shared-project blast radius under F-139.
3. Remove the broad wildcard under F-138.
4. Define canonical identity and typed foreign-reference contracts under F-140/F-144.
5. Migrate the implicit Calorie Tracker namespace under F-141.
6. Add transactional, reciprocal Trip Planner/Trip Cost linking under F-142.
7. Add revisioned nutrition reference validation under F-143.

## T24 outcome

T24 is complete. The site has shared authentication infrastructure but not yet a trustworthy shared identity or integration layer. Cross-tool features should not expand until roles, person references, namespace contracts, and foreign-link validation are formalized and covered by emulator tests.
