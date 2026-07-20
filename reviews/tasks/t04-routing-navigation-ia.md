# T04: Routing, Navigation, Discovery, and Information Architecture

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed:

- root layout and metadata;
- home-page calls to action and featured content;
- global desktop/mobile navigation;
- Games, Tools, Trips, and Style Guide routes;
- all catalogued React and static destinations;
- Show Tracker internal navigation;
- Trip Cost authentication/list/detail navigation;
- static-site return links;
- route loading and 404 provisions;
- access requirement communication;
- public discoverability of trip content.

Live HTTP responses and external links were not exercised in this task. Internal destination validity was checked against repository files and App Router routes.

## Route integrity

No broken first-party destination was found in the primary catalogues:

- all four global navigation destinations exist;
- all eleven Tool catalogue links resolve to an implemented React route or static entry file;
- both Game catalogue links resolve to static entry files;
- both Trip catalogue links resolve to static entry files;
- all four Show Tracker bottom-navigation routes exist;
- the home-page featured Japan route exists.

This does not validate external links embedded in static content, Cloudflare redirects, case-sensitive behavior on every deployment target, or runtime access after authentication.

## Global navigation architecture

`components/Nav.tsx` provides:

- brand link to `/`;
- Games, Tools, Trips, and Style Guide links;
- desktop and collapsible mobile presentations;
- active styling based on `pathname === href`.

The root layout does not render navigation. Each page must opt in by importing `Nav`. This has caused several linked destinations to omit the site shell entirely.

### Active state

The exact-path comparison marks `Tools` active only at `/tools`, not at any `/tools/*` destination. The same pattern would fail for any future nested Games or Trips route using the shared shell.

Consequences:

- a visitor in CIFI, Transcriber, Show Tracker, Conflict Tracker, Trip Planner, Date Night, or Recipe Standardizer sees no selected primary section;
- Show Tracker's own bottom nav identifies its local tab, but the global `Tools` hierarchy remains visually unselected;
- the global navigation does not communicate the visitor's location within the site structure.

## Missing or inconsistent return navigation

### Next.js pages without the shared shell

- `/style-guide`
  - linked directly from primary global navigation;
  - does not render `Nav` or another return link.
- `/tools/trip-cost`
  - authentication, trip list, and trip detail states do not render `Nav` or a parent-site return link;
  - internal Back actions only return from a selected trip to the Trip Cost list.

### Static pages without a site return link

- `/games/Emeril_A_World_Divided/index.html`
- `/trips/JapanTrip.html`

### Static pages with return links

- Noir Detective, Chicago itinerary, and Nutrition Tracker return to the hub.
- Both Social Security tools return to `/tools`.

The static pages therefore use three different patterns: return to hub, return to parent catalogue, or no return navigation.

## Public Japan itinerary exposure

The home page features `/trips/JapanTrip.html`, and the Trips catalogue also links it. The static file contains a substantial amount of personally identifying and operational information, including:

- residential and work addresses;
- traveller/guest names;
- hotel locations and phone information;
- reservation identifiers and booking details;
- detailed dated movements;
- an email/confirmation log;
- emergency/contact wording.

The page has no application authentication, no `robots` directive in its head, and no repository `public/robots.txt`. A Cloudflare Access policy or other provider-level protection could exist, but no such protection is represented in the repository and the home page deliberately advertises the route.

The itinerary dates are in the past, which reduces immediate movement-tracking risk, but persistent home/work addresses and identifying booking/contact data remain sensitive.

## Route metadata and browser wayfinding

Root metadata is globally:

- title: `James Berto • Projects & Games`
- description: `Projects, games, and experiments.`

Only the Show Tracker has a route-specific Next.js layout metadata declaration. The other Next.js catalogues and tools inherit the generic title and description.

Effects:

- tabs and history entries are difficult to distinguish when several tools are open;
- bookmarks do not identify the tool;
- shared links receive generic site-level title/description information;
- private/admin tools are not distinguishable at browser-chrome level.

Static pages generally have distinct `<title>` elements, although the Social Security calculator title still contains the implementation suffix `— Fixed`.

## Tool catalogue information architecture

The Tools page is a single flat list of eleven destinations. It accurately describes core functions, but it does not consistently communicate access or persistence mode.

Observed modes include:

- public static tools;
- local/device-only tool;
- optional-account static tool;
- sign-in-required Firebase tools;
- shared/group tools;
- admin-only tool.

Only Transcriber is explicitly labelled `Private tool`. Conflict Tracker uses privacy-oriented descriptive copy, but the remaining sign-in/shared tools do not disclose the account requirement until after navigation.

A visitor cannot determine from the catalogue:

- whether sign-in is required;
- whether data is local, private per user, or shared with a group;
- whether the destination is owner/admin-only;
- whether the tool is an active utility, experiment, guide, or static archive.

The list remains usable at its current size, but access/status metadata would materially improve expectation setting.

## Home and primary navigation observations

- Home provides direct access to Games, Tools, and Trips, then separately features Japan.
- Games receives the primary filled CTA treatment despite Tools containing most active functionality. This may be intentional and is not recorded as a defect.
- Style Guide is a primary visitor navigation item even though its content is a developer-facing component/token demonstration. Whether it belongs in public primary navigation is a product-positioning decision, not a verified defect.
- F-001 remains valid: Japan's card copy is developer placeholder text rather than visitor-facing content.

## Loading and not-found provisions

- The App Router has a global full-screen loading bar.
- No custom `app/not-found.tsx` exists, so invalid App Router destinations use the framework default.
- Static-file misses may use Cloudflare's default 404 behavior.

A branded recovery page with Home, Tools, Games, and Trips options would improve navigation, but the current default behavior is an enhancement opportunity rather than a functional defect.

## Findings

### F-009: Publicly linked Japan itinerary exposes sensitive personal and booking information

- Status: validated
- Category: privacy / security
- Priority: high
- Confidence: high
- Applies to: current `main`, subject to unverified provider-level access controls
- Surface: home page, Trips catalogue, `public/trips/JapanTrip.html`
- Evidence:
  - the route is linked from both public React pages;
  - the static document contains residential/work addresses, names, contact information, reservation references, dated movements, and an email-confirmation log;
  - the route has no application authentication or page-level `noindex` directive;
  - no repository `robots.txt` exists.
- User impact: visitors, crawlers, or anyone receiving the URL may access information that could enable unwanted contact, address discovery, account/booking social engineering, or broader personal profiling.
- Root cause: a detailed operational itinerary was published as a static public asset and promoted as featured site content without a redaction/access-control boundary.
- Immediate recommendation:
  1. Remove the home and Trips links while intent is confirmed.
  2. If the content is private, move it behind authenticated authorization or a provider access policy and remove sensitive static source from the public build/history where practical.
  3. If it is intended to be shareable, generate a redacted public version excluding addresses, contact details, reservation identifiers, email-log content, and unnecessary names.
  4. Add `noindex` only as defense in depth; it is not access control.
  5. Review whether any exposed reservation/contact information still needs rotation or notification.
- Acceptance criteria:
  - public anonymous requests cannot retrieve unapproved sensitive fields;
  - the home/catalogue do not advertise a private route;
  - an approved redaction checklist exists for future shared itineraries;
  - provider-level access behavior is documented and tested.
- Backlog destination: urgent privacy decision/fix before normal backlog sequencing

### F-010: Primary navigation does not identify nested section routes

- Status: validated
- Category: UX / information architecture
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `components/Nav.tsx` and all nested Next.js routes
- Evidence: active state uses `pathname === link.href`; every tool route begins `/tools/` and therefore leaves `Tools` inactive.
- User impact: users lose a persistent indication of where they are in the site hierarchy, especially when moving among several tools.
- Root cause: active-state logic treats only exact catalogue paths as part of each section.
- Recommendation: mark a section active for its exact route and descendant routes, while handling `/` separately.
- Acceptance criteria:
  - `/tools` and every `/tools/*` route mark Tools active;
  - equivalent descendant behavior exists for Games and Trips where applicable;
  - active state is exposed visually and with `aria-current="page"` or an appropriate current-location value;
  - tests cover exact and nested paths.
- Backlog destination: shared navigation backlog candidate

### F-011: Several first-party destinations are navigation dead ends

- Status: validated
- Category: UX / information architecture
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: Style Guide, Trip Cost, Emeril, Japan itinerary, static shell conventions
- Evidence:
  - Style Guide and Trip Cost do not render `Nav` or a parent return link;
  - Emeril and Japan contain no site return navigation;
  - other static pages use inconsistent Hub versus Tools return targets.
- User impact: direct-link visitors and users who do not rely on browser Back cannot reliably return to the site or understand the destination's parent section.
- Root cause: the root layout does not own the site shell, and static pages do not share a required navigation fragment/pattern.
- Recommendation:
  - add a shared Next.js site-shell layout with explicit opt-out for true full-screen applications;
  - ensure opt-out tools retain a clear parent-site return action;
  - standardize static-page navigation with Home plus parent-catalogue links.
- Acceptance criteria:
  - every first-party destination has an obvious keyboard-accessible route to its parent or Home;
  - Style Guide and Trip Cost no longer strand direct visitors;
  - static pages use a documented consistent pattern;
  - no route renders duplicate navigation.
- Backlog destination: shared navigation backlog candidate

### F-012: Most Next.js routes inherit generic browser and sharing metadata

- Status: validated
- Category: UX / documentation / discoverability
- Priority: low
- Confidence: high
- Applies to: current `main`
- Surface: App Router metadata
- Evidence:
  - root metadata is generic;
  - repository search finds route metadata declarations only in the root and Show Tracker layouts;
  - most route pages are client components and cannot directly export metadata.
- User impact: tabs, history, bookmarks, and shared links are difficult to distinguish and may misrepresent tool content.
- Root cause: route-specific server layouts or metadata wrappers were not added as client-heavy tools expanded.
- Recommendation: add concise route metadata at catalogue and tool layout boundaries, with a title template such as `%s • James Berto`.
- Acceptance criteria:
  - each top-level catalogue and tool has a distinct title and description;
  - metadata does not disclose private user content;
  - static titles remove implementation notes such as `— Fixed`;
  - browser-tab verification is included in route smoke tests.
- Backlog destination: navigation/metadata backlog candidate

### F-013: Tool catalogue does not communicate access and data-sharing expectations

- Status: validated
- Category: UX / information architecture
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `/tools`
- Evidence:
  - seven React tools use Firebase authentication/state, including one admin-only tool;
  - the flat catalogue generally describes function but not sign-in, ownership, sharing, or local-only mode;
  - only Transcriber is explicitly labelled private/admin-oriented before entry.
- User impact: users encounter unexpected login gates and cannot tell whether entered data remains local, is private to their account, or is shared with collaborators.
- Root cause: catalogue cards model only name, description, href, and icon.
- Recommendation: add compact metadata badges or secondary text for access (`Public`, `Sign-in`, `Admin only`), persistence (`Local`, `Account`, `Shared group`), and maturity where useful.
- Acceptance criteria:
  - every tool communicates access requirement before navigation;
  - collaborative tools identify that data is shared with the relevant group;
  - local-only tools identify device-local persistence;
  - labels are derived from a central catalogue structure to prevent prose drift.
- Backlog destination: tools catalogue/IA backlog candidate

## Items deferred to later tasks

- hidden mobile-menu focusability and `aria-current`: T07 accessibility;
- loading-screen announcements and reduced motion: T07;
- external-link validity and static-page runtime behavior: T22/T23/T26;
- Japan privacy controls, static hosting exposure, and repository history: T09;
- shared-shell visual implementation: T05;
- responsive behavior of navigation and dense catalogues: T06.

## Next task

`T05. Shared component architecture and design system`
