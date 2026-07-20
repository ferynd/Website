# T09: Security and Privacy Architecture

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed source-level security and privacy behavior across:

- public and authenticated API routes;
- server-secret boundaries and upstream error handling;
- Firebase authentication and administrator identification;
- Firestore rules, membership invariants, record ownership, and audit writes;
- Firebase Storage rules, upload validation, download URL handling, and deletion/retention;
- Conflict Tracker draft confidentiality;
- Show Tracker AI data transmission and minimization;
- public/static content exposure;
- security headers, CSP, third-party scripts, and client-side HTML rendering;
- repository secret hygiene and security documentation.

Actual deployed Cloudflare/Firebase configuration, active Firebase rules, provider-side retention settings, billing alerts, API quotas, and historical secret exposure require T26 environment validation.

## Positive controls

- Server API keys are read only from Edge runtime environment variables; Firebase client configuration is correctly treated as public configuration rather than a secret.
- `.env*` and private PEM files are excluded by `.gitignore`.
- Transcriber routes consistently authenticate before processing audio or transcript content.
- Transcriber authentication independently verifies Firebase ID-token signatures, issuer, audience, timestamps, email identity, and `email_verified` on every protected API request.
- Transcriber validates model IDs against fixed allowlists and revalidates upload size server-side.
- Transcriber sends the Gemini key in a request header rather than a query string for Files API operations and sanitizes provider errors before returning them.
- Transcriber does not persist run audio or transcript text in Firestore/Storage; speaker clips remain device-local except during an authenticated run.
- Recipe Standardizer and legacy user-scoped paths restrict Firestore records to the authenticated UID.
- Firestore has no broad public wildcard rule; unmatched paths are denied by default.
- Calorie Tracker includes a shared HTML-escaping helper and uses `textContent` for common message rendering.
- Uploaded images are decoded and re-encoded through a canvas before normal UI uploads, reducing accidental EXIF retention and preventing the standard client path from directly storing arbitrary original bytes.

These protections are meaningful, but several authorization boundaries are substantially weaker than the UI and documentation imply.

## Findings

### F-035: Show Tracker AI endpoints are publicly callable with paid server credentials

- Status: validated
- Category: security / abuse prevention / cost control
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surfaces:
  - `POST /api/classify`
  - `POST /api/recommend`
- Evidence:
  - both routes read server-side TMDB/Gemini credentials and perform paid or quota-limited upstream work;
  - neither route authenticates a Firebase user or verifies list membership;
  - neither route has rate limiting, per-user quotas, request signing, origin enforcement, or abuse throttling;
  - `/api/recommend` accepts caller-supplied moods, profiles, and an arbitrarily sized candidate array and sends the generated prompt to Gemini;
  - `/api/classify` accepts arbitrary title text and can invoke both TMDB and Gemini fallback logic;
  - Transcriber routes already demonstrate the repository's available server-side Firebase token verification pattern, but that pattern is not applied here.
- User impact:
  - anyone who discovers the public endpoint can consume the site's provider quota or billing;
  - an attacker can automate large or repeated requests without needing a site account;
  - resource exhaustion can make legitimate Show Tracker recommendations unavailable;
  - public callers receive upstream failure details that should not be exposed more broadly than necessary.
- Root cause: authentication is enforced only in the Show Tracker UI/Firestore layer, while the server routes trust that only the first-party client will call them.
- Recommendation:
  1. Require a valid Firebase ID token on both routes.
  2. Verify the caller belongs to the referenced Show Tracker list; do not trust a client-provided candidate set as proof of membership.
  3. Add bounded input schemas and maximum title, mood, profile, note, candidate, and prompt sizes.
  4. Add per-user and deployment-level quotas/rate limits, plus provider billing alerts.
  5. Return normalized client-safe errors and keep detailed provider errors server-side.
- Acceptance criteria:
  - unauthenticated and invalid-token calls return 401 without contacting TMDB/Gemini;
  - authenticated non-members cannot use another list's recommendation data;
  - request bodies exceeding documented limits return 400/413 before provider work;
  - repeated calls trigger a deterministic quota response;
  - provider call counts and rejected abuse attempts are observable without logging private prompt content;
  - security tests cover direct curl-style calls, forged bodies, oversized candidate arrays, and burst traffic.
- Backlog destination: urgent Show Tracker/API security candidate

### F-036: Conflict Tracker drafts are neither private nor owner-protected before mutual submission

- Status: validated
- Category: critical privacy / authorization defect
- Priority: critical
- Confidence: high
- Applies to: current `main`
- Surfaces:
  - `artifacts/conflict-tracker/trackers/{trackerId}/conflicts/{conflictId}/reflections/{personA|personB}`
  - Conflict Tracker reflection subscription and UI privacy promise
- Evidence:
  - the UI states: “Write privately. Only shared after your partner also submits” and “Reflections are hidden until both sides submit. Each person sees only their own draft”;
  - the context subscribes to the entire reflections collection for the active conflict and stores every reflection returned in client state;
  - Firestore rules allow any tracker member to read every reflection document, regardless of side or submission state;
  - therefore a partner's draft is already delivered to the other member's browser before both submit, even though rendering code hides it;
  - the update rule checks only that the *new* document's `authorUid` equals the caller, so a member can update the other side's fixed reflection document and change `authorUid` to themselves;
  - tracker members can also update the parent conflict fields that mirror submission/status state.
- User impact:
  - deeply sensitive conflict reflections, emotional states, needs, interpretations, and ownership statements can be inspected before the author chooses to submit;
  - a partner can overwrite or corrupt the other person's draft;
  - the UI gives a materially false confidentiality guarantee;
  - early access can change the relationship interaction the feature is specifically designed to protect;
  - this is a direct privacy breach between authenticated users, not merely a theoretical unauthenticated attack.
- Root cause: confidentiality and side ownership are implemented only in React rendering/guard helpers rather than in the authoritative Firestore data model and rules.
- Immediate recommendation:
  - stop representing unsubmitted private drafts in a collection readable by both members;
  - until fixed, remove or clearly retract the privacy claim and avoid using the tool for private draft content.
- Durable architecture options:
  1. Store each draft under a UID-owned private path and copy/reveal a submitted immutable snapshot into a shared path only after both submissions.
  2. Use separate side-specific documents with rules that permit owner-only read/write until submitted, then conditionally permit partner read when both immutable submission markers exist.
  3. Move the mutual-reveal transition to a trusted server/Cloud Function transaction if Firestore rules cannot safely express the state transition.
- Acceptance criteria:
  - before mutual submission, Person A cannot read any Person B draft field and vice versa through SDK, REST, console, cached query, or direct document access;
  - a user can create/update only their assigned side's draft and cannot change ownership/system fields;
  - submitted snapshots cannot be reverted to private draft state by a peer;
  - mutual reveal is atomic and cannot expose one side early during concurrent submissions;
  - emulator tests prove both read and write denial for every pre-/post-submission state;
  - migration protects or deletes existing drafts before the corrected privacy wording is restored.
- Backlog destination: immediate Conflict Tracker security incident candidate

### F-037: Firestore rules do not preserve membership and actor-specific ownership invariants

- Status: validated
- Category: authorization / data integrity
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative defects:
  - Show Tracker list self-enrollment;
  - Conflict Tracker tracker/membership mutation;
  - Trip Cost peer financial-record mutation;
  - unscoped audit-log creation;
  - Show record cross-list mutation.
- Evidence:
  - Show Tracker's “self-add via invite” rule does not verify that a matching pending invite exists;
  - that rule limits affected top-level keys but does not prove the caller only appended their own UID/member record, allowing replacement of membership arrays when a list ID is known;
  - any Conflict Tracker member, including an email-invited member, can update every tracker field with no changed-key restrictions, including member lists, side UIDs/names, invitation emails, and creator-related metadata;
  - any Conflict Tracker member can update/delete any conflict, while the UI intends some edit/delete actions to be Person A/admin only;
  - Trip Cost participant updates may replace entire participants, participantIds, expenses, and payments arrays, so rules do not enforce `createdBy`, payer, or record-specific modification boundaries;
  - Show members may update a show based on its current list membership but are not prevented from changing `listId`, ownership, or other system fields;
  - Trip Planner and Trip Cost audit subcollections allow any signed-in user to append an entry to any known planner/trip path as long as `actorUid` equals their UID, without proving participant access.
- User impact:
  - users can grant access beyond the intended invitation flow or remove legitimate members;
  - peers can alter or delete another person's financial, conflict, or ownership records through a custom Firebase client even when the React UI hides those controls;
  - audit logs can be polluted with misleading entries;
  - collaborative data cannot be treated as attributable or tamper-resistant.
- Root cause: rules authorize broad document updates based on current membership but do not validate field-level transitions, immutable fields, invited identity, or record ownership.
- Recommendation:
  - define immutable/system fields and allowed transition schemas for every collection;
  - require an actual invite document for self-enrollment and consume it atomically through a trusted function or tightly constrained transaction;
  - store collaborative records as per-record documents rather than editable arrays;
  - enforce side/creator/payer ownership in rules using existing and requested resource data;
  - require participant/admin membership for audit writes and validate allowed audit fields/types;
  - prohibit `listId`, owner IDs, creator IDs, membership arrays, and role fields from ordinary member updates.
- Acceptance criteria:
  - a non-invited user cannot join a Show list even with its ID;
  - an invited user can add only their own exact membership record and cannot remove/change another member;
  - Conflict Tracker members cannot alter role assignment, membership, creator fields, or peer-only fields outside an explicit workflow;
  - Trip Cost users cannot update/delete another user's record unless the product explicitly grants that permission;
  - show records cannot be moved to an unauthorized list;
  - only valid participants/admins can append schema-valid audit records;
  - comprehensive Firestore emulator tests cover every allow/deny path and malicious field diff.
- Backlog destination: urgent cross-tool Firestore rules candidate

### F-038: Firebase Storage authorization is not reproducible from the repository and does not constrain uploaded content

- Status: validated repository gap; deployed rules require runtime verification
- Category: security / storage / deployment governance
- Priority: high
- Confidence: high for repository gap, unknown for deployed exposure
- Applies to: current `main`
- Evidence:
  - the repository has no `firebase.json` tying Firestore/Storage rule files to deployment;
  - the only discovered Storage rules file is named `storage.date-night.rules` rather than a canonical shared `storage.rules`;
  - no Trip Planner Storage rule source is present despite Trip Planner writing to the same Firebase bucket under `artifacts/trip-planner/uploads/{plannerId}/...`;
  - no workflow/script in the inspected repository deploys or tests Storage rules;
  - Date Night's rule allows any participant/admin to read and write every object under the Date Night upload prefix;
  - it does not validate file size, MIME type, extension, object ownership, roll association, or immutable metadata;
  - client-side image compression is bypassable by any authenticated custom client and cannot serve as the security boundary.
- User impact:
  - the repository cannot prove what rules protect production uploads;
  - manual console rules can drift from documented assumptions without code review;
  - participants may be able to upload arbitrary or oversized content, overwrite/delete peer uploads, or consume storage quota;
  - Trip Planner upload confidentiality may be open, broken, or manually configured, but none of those states is auditable here.
- Root cause: Storage security was added as an isolated file/documentation note instead of a single versioned, deployed, tested ruleset covering every prefix.
- Recommendation:
  - create one canonical Storage rules file and Firebase deployment configuration;
  - explicitly scope Trip Planner access by planner membership and Date Night access by participant/roll ownership;
  - enforce maximum encoded size and permitted output MIME types;
  - prevent arbitrary overwrite/delete of objects not owned by the caller unless an explicit shared-management rule exists;
  - add emulator rules tests and CI deployment-diff checks.
- Acceptance criteria:
  - production rule source and deployed hash/version are traceable to a reviewed commit;
  - unauthorized users cannot list/read/write/delete either tool's objects;
  - participants cannot upload non-approved content types or files above limits;
  - ownership and shared-delete behavior are explicitly tested;
  - default/unmatched Storage paths are denied;
  - T26 confirms deployed Firebase rules match repository rules.
- Backlog destination: urgent Firebase Storage governance candidate

### F-039: Deleting application records does not delete associated uploaded images

- Status: validated
- Category: privacy / retention / storage cost
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surfaces:
  - Date Night roll photos;
  - Trip Planner event and idea images.
- Evidence:
  - Date Night `deleteRoll` deletes only the Firestore roll document and never deletes objects listed in `photos`;
  - Trip Planner event/idea deletion removes Firestore documents but does not inspect or delete referenced image objects;
  - Trip Planner's only object-deletion logic is inside `compressOldImages`, which is not called elsewhere in the repository and deletes by age rather than record ownership;
  - both tools persist `getDownloadURL` results in Firestore records rather than storing only a protected object path;
  - SECURITY.md states only general data-minimization guidance and defines no implemented image-retention schedule or account/trip deletion workflow.
- User impact:
  - users can believe a photo was deleted when only its database reference disappeared;
  - sensitive trip/date photos remain in the bucket indefinitely and continue consuming quota;
  - removed participants may retain previously copied download URLs;
  - orphaned objects become difficult to discover because the referencing document is gone.
- Root cause: uploads and records are managed as separate best-effort operations without an authoritative attachment lifecycle.
- Recommendation:
  - store canonical object paths plus attachment metadata, not only download URLs;
  - delete attachments transactionally or through an idempotent cleanup job when their parent is deleted;
  - define retention periods for abandoned uploads, completed trips, deleted rolls, and removed accounts;
  - rotate/revoke access tokens or delete objects when membership is removed where confidentiality requires it;
  - add an orphan scanner and dry-run cleanup report before production deletion.
- Acceptance criteria:
  - deleting a roll/event/idea removes all exclusively owned objects or records a visible retryable cleanup state;
  - shared/deduplicated objects use reference counting or an equivalent safe ownership model;
  - removed members cannot retrieve protected images through the application or previously issued access mechanism after the defined revocation period;
  - orphan scanning identifies existing unreferenced objects;
  - retention behavior is documented in-product and in SECURITY.md;
  - failure-injection tests prove cleanup is resumable and idempotent.
- Backlog destination: Date Night/Trip Planner privacy and storage candidate

### F-040: Show recommendations send more personal data to Gemini than the UI discloses or requires

- Status: validated
- Category: privacy / data minimization / transparency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: Show Tracker mood recommendation workflow
- Evidence:
  - the client sends viewer display names, freeform shared/per-person mood text, candidate records, and generated preference profiles to `/api/recommend`;
  - the prompt includes each present viewer's rating history, freeform notes, rewatch/brain-power values, and current mood;
  - candidate formatting additionally sends notes belonging to absent viewers, labelled with a display name when known or raw UID otherwise;
  - the in-product explanation says recommendations “read” notes/ratings but does not clearly state that these fields are transmitted to Google's Gemini service;
  - SECURITY.md identifies Gemini as the provider but does not enumerate the personal fields, purpose, retention assumptions, or absent-viewer behavior.
- User impact:
  - a person who is not participating in the current recommendation can have their private notes sent to a third-party model;
  - users may enter emotionally descriptive mood text without understanding the external destination;
  - data processing exceeds the minimum needed for present-viewer recommendation when absent notes are included.
- Root cause: prompt quality was optimized using all available context without a formal data-minimization and consent boundary.
- Recommendation:
  - exclude absent-viewer notes and identifiers by default;
  - send only fields materially required for the selected recommendation mode;
  - show a concise pre-submit disclosure naming the provider and exact data categories;
  - provide a local-only/no-notes mode and per-member consent controls;
  - document provider retention assumptions and avoid stable UIDs in prompts.
- Acceptance criteria:
  - absent members' notes/identifiers are never transmitted without explicit consent;
  - network tests assert the minimized request schema;
  - UI disclosure appears before the first AI request and is accessible;
  - users can inspect which data categories will be sent;
  - SECURITY.md documents provider, purpose, fields, retention assumptions, and deletion limitations;
  - prompt-quality tests confirm minimization does not materially regress recommendations.
- Backlog destination: Show Tracker privacy candidate

### F-041: Site-wide administrator authority is bound to a public email string rather than a stable verified role

- Status: validated
- Category: identity / authorization architecture
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - Firestore and Storage rules define administrator status solely as `request.auth.token.email == 'arkkahdarkkahd@gmail.com'`;
  - those rules do not require `email_verified == true`;
  - client tools duplicate the same email comparison for privileged UI behavior;
  - Transcriber server APIs are stronger because they also require verified email, but the broader Firebase data plane does not share that guarantee;
  - the email address is necessarily public in this public repository and should not be treated as a secret identifier.
- User impact:
  - administrator identity depends on mutable email-account lifecycle rather than a controlled role assignment;
  - if the email identity were ever removed/recreated, misconfigured, or represented by an unverified token, broad Firestore/Storage authority could be granted unexpectedly;
  - changing the administrator requires coordinated code/rules deployment across multiple duplicated checks;
  - there is no auditable grant/revoke history.
- Root cause: an early single-owner shortcut became the common authorization primitive.
- Recommendation:
  - use a stable UID and/or Firebase custom admin claim set through an authenticated administrative process;
  - require verified identity for privileged actions;
  - centralize client role interpretation but treat server/rules claims as authoritative;
  - document emergency revocation and account-recovery procedures.
- Acceptance criteria:
  - email alone cannot grant administrator privileges;
  - unverified accounts are denied privileged reads/writes;
  - admin grants/revocations are auditable and do not require application redeployment;
  - rules tests cover changed email, deleted/recreated identity, missing claim, forged client flags, and revoked claim refresh;
  - Transcriber and Firebase data paths use one documented role model or explicitly justified separate models.
- Backlog destination: identity architecture candidate

### F-042: The repository defines no explicit browser security-header policy

- Status: validated repository gap; deployed headers require runtime verification
- Category: web security / defense in depth
- Priority: medium
- Confidence: high for source gap
- Applies to: current `main`
- Evidence:
  - `next.config.ts` contains no response-header configuration;
  - no repository policy was found for Content-Security-Policy, frame restrictions, MIME sniffing, referrer behavior, or browser permissions;
  - no Cloudflare Pages `_headers` source was found;
  - static pages use inline scripts/styles, mutable third-party scripts, and multiple `innerHTML` rendering paths;
  - SECURITY.md recommends pinned dependencies and escaping but does not define enforceable browser headers.
- User impact:
  - the site lacks repository-controlled defense in depth against script injection, clickjacking, accidental MIME execution, and unnecessary browser capabilities;
  - static-page supply-chain compromise has a larger blast radius;
  - deployed settings can drift silently in the Cloudflare dashboard.
- Root cause: security policy is documented as coding guidance rather than versioned deployment configuration.
- Recommendation:
  - define a staged CSP based on an inventory of required scripts/styles/connect endpoints;
  - add frame, content-type, referrer, and permissions headers through a repository-controlled Cloudflare/Next configuration;
  - reduce inline script/style dependence and self-host critical dependencies before enforcing strict CSP;
  - initially deploy CSP reporting mode, then enforce after violation review.
- Acceptance criteria:
  - T26 records the headers actually served by React and static routes;
  - required policy is version-controlled and deployed automatically;
  - no maintained route can be framed unless explicitly required;
  - CSP blocks unapproved script origins and inline execution after migration;
  - automated tests assert critical headers for representative routes;
  - security policy changes receive normal code review.
- Backlog destination: shared web-platform security candidate

## Revalidated existing findings

### F-003: vulnerable Next.js dependency

Remains the most immediate framework-level security issue. T09 did not find compensating infrastructure controls in the repository that justify delaying the patched upgrade.

### F-009: public Japan itinerary exposure

T09 strengthens the remediation requirement:

- the itinerary is not only linked from the site; it exists in a public GitHub repository and includes addresses, phone numbers, reservation numbers, traveler names, dates, and operational instructions;
- simply removing a catalogue link does not remove repository/current-file/history exposure;
- affected booking references and access assumptions should be treated as disclosed and rotated where feasible;
- remediation should redact the current file, remove public deployment, assess Git-history cleanup, and confirm cached/search-index copies.

### F-033: third-party CDN dependence

Also represents supply-chain exposure. Resolve through exact self-hosted dependencies and the CSP/header work in F-042.

## Additional observations

- The Transcriber security boundary is materially stronger than the Show Tracker AI boundary and should be used as the pattern for protected server routes.
- Firestore rules are too consequential to remain untested; this becomes a primary T10 finding.
- Client-side authorization helpers improve UX but cannot compensate for permissive Firestore/Storage rules.
- Download URLs, invite/list IDs, document IDs, and obscurity must not be treated as authorization controls.
- The repository's SECURITY.md is unusually detailed for a personal project, but several statements describe intended behavior that the rules do not actually enforce.

## Immediate containment order

1. Disable or stop using Conflict Tracker private drafts until F-036 is fixed.
2. Patch F-003 and redeploy.
3. Redact/unpublish the Japan itinerary and rotate exposed booking references where possible.
4. Add authentication and quotas to `/api/classify` and `/api/recommend`.
5. Tighten/deploy/test Firestore and Storage rules before expanding shared use.
6. Avoid relying on deletion of Date Night/Trip Planner records to remove uploaded photos until attachment cleanup exists.

## Runtime validation required

- compare deployed Firestore and Storage rules with repository source;
- test direct SDK/REST reads and writes under anonymous, ordinary user, invited user, participant, owner, list-admin, and site-admin identities;
- inspect Cloudflare response headers and route access controls;
- confirm AI provider quotas, billing alerts, logging, and data-retention settings;
- enumerate existing orphaned Storage objects and active download links;
- verify whether exposed itinerary data has been indexed or cached externally;
- inspect Firebase Auth account recovery, email verification, and admin identity state.

## Next task

`T10. Testing strategy, CI, observability, and release confidence`
