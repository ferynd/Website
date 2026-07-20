# T23 — Trips and static travel content

Status: complete  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`  
Review date: 2026-07-15  
Change boundary: documentation only

## Scope

Reviewed the complete public Trips catalogue and both linked static travel experiences:

- `app/trips/page.tsx`
- `public/trips/JapanTrip.html`
- `public/trips/ChicagoTripItinerary/index.html`
- their in-page data, editing behavior, schedules, reservation displays, links, tabs, accessibility, responsive behavior, third-party dependencies, and publication lifecycle

The review focused on:

- public exposure of personal and reservation data;
- current versus archived presentation;
- reservation and schedule correctness;
- browser-local editing and persistence;
- unsafe HTML rendering;
- navigation, responsive behavior, and accessibility;
- stale external assumptions and third-party dependencies.

## Executive assessment

The Trips section currently behaves as a public archive of highly operational personal travel records rather than a safe travel-log showcase. The Japan itinerary is the dominant risk: it embeds private residence and workplace addresses, named travelers, exact hotel and flight dates, prepaid amounts, booking codes, reservation numbers, phone numbers, and a full email-confirmation log in a publicly routed static page. This revalidates the previously critical F-009 finding and expands its demonstrated exposure surface.

The Japan page also contains a browser-persistent same-origin script-injection path. Its reservation editor stores arbitrary user-entered strings in `localStorage`, then later interpolates those strings directly into `innerHTML`. An entered payload can therefore execute whenever the page is rendered again in that browser and can access other same-origin browser storage or page content.

The Chicago itinerary is lower risk but is an undated historical plan presented with “reserved,” “walk-in,” current hours, and availability-highlighting language. It is easy to mistake it for a current operational itinerary. Both pages need explicit lifecycle states and a safer distinction between public travel inspiration and private trip operations.

## Revalidated existing finding

### F-009 — Critical — Public exposure of private Japan travel and booking data

**Status:** Revalidated and broadened.

The public page exposes, among other data:

- an Osaka home address and Kyoto workplace address;
- traveler and reservation-holder names;
- exact travel dates, flight number, lodging sequence, check-in/out details, and meeting points;
- booking codes and reservation numbers;
- prepaid amounts and payment instructions;
- vendor and consultant telephone numbers;
- email subject lines and confirmation details.

Examples include the home/work addresses near the top of the page, the reservation index and email log, GetYourGuide code `GYGWZAZYHVLH`, MO-MO Paradise reservation `99Z6ZS`, and JTB reservation identifiers `006720000021261 / O1NT898019` with tour code `130SUETA005JG025S`.

**Required action:** Unpublish or access-control the page immediately, remove it from the catalogue, assess repository/history/cache exposure, and rotate or invalidate still-sensitive booking references where possible. A sanitized public retrospective should be generated from an allowlisted data model rather than by redacting the current operational file in place.

---

## New findings

### F-129 — High — Browser-persistent same-origin HTML/script injection through the Japan reservation editor

The page allows reservation names, addresses, contacts, details, schedule labels, and related fields to be edited and saved directly to `localStorage`. Those values are later inserted into HTML template strings and assigned through `innerHTML` without escaping or sanitization.

Affected rendering paths include:

- reservation-index rows;
- fixed-item cards;
- editor selection lists;
- schedule labels and related summaries.

A value such as an image element with an error handler can execute on the site origin after save and on later visits. Although the attacker normally needs access to that browser session, this remains a persistent injection sink and becomes more dangerous on a shared device or if another same-origin bug can seed storage.

**Recommendation:** Render user-controlled values with `textContent` or DOM text nodes. Where formatted content is truly required, use a strict allowlist sanitizer. Version and validate the stored schema before rendering, and clear or safely migrate existing stored values.

**Acceptance criteria:**

1. Every editor-controlled string is treated as text in all views.
2. Automated tests cover HTML tags, event-handler attributes, SVG payloads, malformed entities, and closing-tag breakout attempts.
3. Previously stored payloads cannot execute after upgrade.

### F-130 — High — Historical itineraries are presented as active operational plans without an archive state

The Chicago page advertises a July 4 weekend, labels activities as reserved, and publishes restaurant hours and option availability without a year in the visible title. The Japan trip occurred April 4–17, 2026, but the Trips catalogue still presents it simply as “Japan Trip.” Neither catalogue card carries a completed/archived date or a warning that operational details are historical.

This can lead users to rely on stale hours, ticket rules, reservation status, routes, or meeting instructions. It also keeps sensitive travel data prominent after the trip has ended.

**Recommendation:** Add explicit lifecycle metadata (`draft`, `upcoming`, `active`, `completed`, `archived`) and visible dates to every trip. Completed trips should default to a sanitized retrospective and must not retain live booking identifiers or “reserved” status language.

### F-131 — Medium — Japan edits are browser-local while the UI can imply authoritative itinerary updates

The editor reports “Saved in this browser,” but edits modify all rendered reservation, schedule, and day views, making the page appear updated as a coherent itinerary. They do not sync to the repository or other devices, have no export/import workflow, and can disappear when storage is cleared.

This creates a high likelihood of divergent plans between travelers or devices, especially because seeded data and browser overrides are merged silently on load.

**Recommendation:** Either remove editing from the public static page or make the local-only boundary unmistakable. Provide explicit export/import and last-saved metadata if local editing remains. For shared operational use, move the itinerary to an authenticated, revisioned data store.

### F-132 — Medium — Fuzzy reservation-to-booking matching can attach an override to the wrong itinerary item

The Japan enhancement layer matches reservations to bookings and schedule items using time equality, normalized substring matching, and token overlap, then accepts any score greater than zero. There is no ambiguity threshold, unique identity requirement, or user confirmation.

A reservation sharing only a time or one meaningful token can therefore become linked to the wrong booking or schedule block. Subsequent edits may update the displayed label, address, contact, and timing for the wrong day item while retaining aliases that make the mismatch difficult to notice.

**Recommendation:** Assign stable IDs in the source data and require exact identity matching. Treat heuristic matches as migration suggestions that require review, with collision and ambiguity reporting.

### F-133 — Medium — Chicago availability highlighting mishandles post-midnight times and embeds unversioned business hours

The option dataset encodes times such as `25:00` for 1:00 AM. The code intends to detect overnight spans with `parseFloat(end) < parseFloat(start)`, but `parseFloat('25:00')` is `25`, so the overnight branch does not run. `timeToRow('25:00')` then produces a grid row beyond the displayed 11 AM–midnight schedule, causing the highlight to extend outside or disappear from the intended grid.

All restaurant and attraction hours are also hardcoded without a checked-on date or source metadata. The page can therefore display stale availability with no indication of when it was verified.

**Recommendation:** Normalize times to minutes with explicit day offsets, clamp rendering to the visible range, and show overflow continuation. Store source URL and `verifiedAt` metadata for operational hours or remove them from archived pages.

### F-134 — Medium — Chicago tabs lack complete tab semantics and keyboard behavior

The Food & Drink and Activities controls are ordinary buttons that only toggle CSS classes. They do not expose `role="tab"`, `aria-selected`, `aria-controls`, tabpanel roles, roving focus, or arrow-key navigation.

**Recommendation:** Implement the WAI-ARIA tabs pattern or replace the interface with headings/disclosures if only two independently readable content groups are needed.

### F-135 — Medium — Trips catalogue exposes implementation notes instead of useful lifecycle metadata

The Japan card description says “Drop-in page path: /public/trips/JapanTrip.html,” which is an internal deployment note rather than user-facing travel context. The catalogue omits dates, status, intended audience, sensitivity, and whether a page is an active itinerary or retrospective.

**Recommendation:** Replace hardcoded cards with typed metadata containing title, destination, date range, lifecycle state, visibility, and summary. Never expose private/operational trips through the public catalogue.

### F-136 — Medium — Dense schedule tables rely on horizontal scrolling without an equivalent compact itinerary view

Both travel pages use wide fixed/minimum-width timelines. Japan’s weekly grid remains at least 1100px wide on small screens; Chicago’s combined schedule and options panel similarly requires substantial horizontal scrolling. Important labels and time relationships are visual and distributed across the grid, with no compact list equivalent tied to the same data.

**Recommendation:** Provide a mobile list view grouped by day and time, retain the grid only as an optional visualization, and ensure all status information represented by position or color is repeated in text.

---

## Strengths

- The Japan page uses native `<details>/<summary>` for most disclosure behavior.
- Schedule blocks added by JavaScript are keyboard-focusable and respond to Enter and Space.
- External links generally use a new-tab relationship that prevents opener access.
- The Japan page distinguishes fixed versus estimated schedule blocks in visible text.
- Both itineraries provide day-by-day narrative alternatives to their visual schedules, although those alternatives need clearer lifecycle labeling.

## Validation limitations

- This was a source-level review. Live browser testing, screen-reader testing, link-status checks, and responsive screenshots remain part of T26.
- Public cache/search-engine exposure and whether any booking identifiers remain valid were not tested.
- No attempt was made to execute an injection payload against the deployed site; the source path is direct and should be fixed without live exploitation.

## Recommended priority

1. Act on F-009 immediately: remove the Japan itinerary from public access and rotate still-sensitive references where feasible.
2. Fix F-129 before any editor-enabled version is republished.
3. Add lifecycle/archival controls from F-130 and catalogue metadata from F-135.
4. Replace heuristic reservation linking under F-132.
5. Address local-only state clarity, time parsing, accessibility, and responsive alternatives.

## T23 outcome

T23 is complete. The Trips section should not remain publicly discoverable in its current form. A safe replacement should separate:

- private, authenticated operational itineraries;
- sanitized public trip retrospectives;
- reusable destination guidance with dated source metadata.
