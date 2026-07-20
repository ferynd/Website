# T06: Responsive and Interaction Design

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed source-level responsive and interaction behavior across:

- Home, Games, Tools, Trips, and the shared navigation;
- Show Tracker card/list modes and bottom/floating actions;
- Transcriber header, panels, and settings;
- Conflict Tracker toolbars, claim banner, forms, detail views, and tracker modal;
- Trip Planner toolbars, timeline, map/ideas layout, settings, changelog, and add/edit modal;
- Trip Cost authentication, trip list, trip detail, financial sections, and delete modal;
- Date Night page shell;
- Recipe Standardizer library, sticky jump controls, accordions, forms, and modals;
- static pages previously identified as relying on incomplete utility CSS.

No visual browser runner was available in this environment. Findings below distinguish deterministic layout defects from items requiring screenshot/device confirmation during T26.

## Positive responsive patterns

- Main catalogue pages use single-column mobile layouts and scale to multi-column grids.
- The shared navigation switches to a mobile menu and maintains 44-pixel trigger dimensions.
- Show Tracker is intentionally mobile-first, limits content width, offers card/list modes, horizontally scrolls action chips, and uses bottom-positioned primary actions.
- Show Tracker's main edit form behaves as a mobile bottom sheet and constrains itself to `92dvh` with internal scrolling.
- Transcriber settings constrain height and scroll internally.
- Recipe Standardizer uses accordions and responsive grids rather than forcing desktop tables into narrow viewports.
- Trip Planner's overall two-column workspace collapses to a single column before the `xl` breakpoint.
- Dense static itinerary tables generally opt into horizontal scrolling rather than compressing unreadably.

## Interaction architecture observations

### Mobile horizontal scrolling is sometimes intentional

The Trip Planner timeline deliberately uses a horizontal scroll container because each day column has a 288-pixel minimum width. This is a defensible representation for a calendar grid, provided:

- time labels stay aligned with event blocks;
- touch scrolling and drag gestures do not conflict;
- the current day can be reached without excessive traversal;
- users have a compact non-grid alternative where necessary.

The current implementation fails the first requirement and needs device validation for the second.

### Modal implementations are inconsistent

Some dialogs use viewport-relative maximum heights and internal scrolling, while others render a potentially long form inside a fixed centered overlay without any `max-height` or `overflow-y-auto` boundary.

This means responsive success depends on which tool-specific modal the user opens, rather than a shared dialog contract.

### Shared control density amplifies responsive pressure

T05 established that shared Button/Input/Select components use large vertical padding. T06 confirms the practical effect: headers and toolbars that would otherwise fit can wrap into unusually tall regions or overflow because each “small” button remains large.

## Findings

### F-018: Trip Planner timeline day headers are not aligned with the time axis

- Status: validated by deterministic layout source
- Category: functional UX defect / scheduling accuracy
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: `app/tools/trip-planner/components/PlannerTimeline.tsx`
- Evidence:
  - the left time-axis header is explicitly fixed to `height: 74`;
  - each day header has natural height and contains date/title plus four shared `Button size="sm"` actions;
  - each day column is only 288 pixels minimum width;
  - the action container permits wrapping;
  - shared small buttons use `py-4`, so the four actions necessarily occupy multiple tall rows in a 288-pixel column;
  - the event grid begins after the natural day-header height while the time grid begins after exactly 74 pixels.
- User impact:
  - event blocks are vertically offset from the clock labels;
  - a block visually adjacent to a time label can represent a different actual time;
  - scheduling edits can be made using a misleading coordinate system;
  - the mismatch becomes worse as buttons wrap or text expands.
- Root cause: the timeline assumes a uniform header height but only enforces it on the time-axis column.
- Recommendation:
  1. Separate day actions from the scroll-synchronized grid header, or use compact icon/menu actions.
  2. Give time and day headers one shared measured/fixed height.
  3. Keep the date/title region within that height and move secondary actions outside the coordinate grid.
  4. Add visual tests that compare horizontal grid lines across the time and day columns.
- Acceptance criteria:
  - the top of every day grid and the time-axis grid share the same Y coordinate;
  - a test event at 09:00 aligns with the 09:00 line at all supported widths;
  - header height remains identical with one day, many days, long titles, and localized text;
  - mobile/tablet/desktop screenshots demonstrate alignment;
  - action controls remain usable without changing the timeline origin.
- Validation: screenshot and coordinate sampling at 320, 768, and desktop widths; drag/move smoke tests.
- Backlog destination: urgent Trip Planner defect candidate

### F-019: Several long modals can exceed the mobile viewport without an internal scroll boundary

- Status: validated by source; exact clipping severity requires device confirmation
- Category: functional responsive defect
- Priority: high
- Confidence: high
- Applies to: current `main`
- Confirmed surfaces:
  - Trip Planner `AddItemModal`;
  - Conflict Tracker `TrackerModal`;
  - Trip Planner settings modal.
- Evidence:
  - each uses `fixed inset-0` with centered content;
  - their dialog containers omit a viewport-relative `max-height` and `overflow-y-auto` region;
  - AddItemModal can render tab controls, base fields, recurrence fields, time fields, travel/activity-specific fields, uploads, series controls, and action buttons;
  - TrackerModal renders explanatory copy and four large shared form fields;
  - the shared fields add substantial label/field vertical spacing.
- User impact:
  - on shorter phones, landscape orientation, browser zoom, or an open virtual keyboard, the top or bottom of a form can be outside the viewport;
  - Save, Delete, Cancel, or Close controls may become unreachable;
  - background document scrolling does not guarantee access to content inside a fixed overlay.
- Root cause: dialogs were implemented independently and do not share a required responsive shell.
- Recommendation: introduce a shared Dialog/Sheet primitive with:
  - `max-height` based on `dvh`;
  - internal scrollable content;
  - sticky header/footer where actions must remain reachable;
  - mobile bottom-sheet option;
  - safe-area padding;
  - body scroll lock and focus management, addressed with T07 requirements.
- Acceptance criteria:
  - every modal fits within 320x568 and landscape mobile viewports;
  - all fields and actions remain reachable at 200% zoom and with the virtual keyboard visible;
  - dialog headers and primary actions remain visible or predictably reachable;
  - no background scroll bleed occurs;
  - a shared primitive replaces duplicated overlay geometry for maintained React tools.
- Validation: responsive browser/device matrix and keyboard-open tests.
- Backlog destination: shared dialog/platform backlog candidate

### F-020: Several core tool headers and action bars do not collapse safely at narrow widths

- Status: validated by source; exact overflow thresholds require browser confirmation
- Category: responsive UX defect
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - Transcriber page header;
  - Trip Cost trip-list header;
  - Trip Cost trip-detail header;
  - Trip Planner primary action/account toolbar;
  - Conflict Tracker claim banner and account/trends toolbar.
- Evidence:
  - Transcriber places a large heading beside two large shared buttons in a non-wrapping flex row;
  - Trip Cost trip detail uses a three-part `justify-between` row for Back, trip name, and counts without wrapping or a mobile layout;
  - Trip List places title, display name/admin badge, and logout in a non-wrapping row;
  - Trip Planner allows the outer toolbar to wrap but keeps a large `ml-auto flex items-center` group containing multiple selects/buttons without its own wrap strategy;
  - Conflict Tracker uses multiple `ml-auto` action groups and a claim banner that keeps explanatory text beside a large button.
- User impact:
  - narrow screens, long trip/tracker names, account names, browser text scaling, or translated copy can cause horizontal overflow, clipped text, or compressed controls;
  - page hierarchy becomes difficult to scan when controls compete with titles;
  - primary actions may be pushed off-screen.
- Root cause: desktop flex-row composition is used without explicit mobile stacking, width constraints, truncation rules, or overflow behavior; oversized shared controls increase pressure.
- Recommendation:
  - define reusable responsive page-header and toolbar patterns;
  - stack title/metadata/actions on mobile;
  - make action groups wrap or horizontally scroll intentionally;
  - constrain/truncate identifiers while preserving full text through accessible disclosure;
  - use the revised compact control variants from F-016.
- Acceptance criteria:
  - no maintained React route creates document-level horizontal scrolling at 320 CSS pixels;
  - long realistic names and 200% text scaling do not hide actions;
  - title, status, and account actions have an intentional mobile order;
  - screenshot tests cover representative long-content states.
- Backlog destination: shared responsive shell backlog candidate

### F-021: Recipe Standardizer's sticky jump/action bar can consume excessive mobile viewport height and obscure jump targets

- Status: source-supported risk requiring visual confirmation
- Category: responsive interaction / usability
- Priority: medium
- Confidence: medium
- Applies to: current `main`
- Surface: `RecipeWorkspace.tsx`
- Evidence:
  - the sticky bar contains six section buttons plus unsaved state, Save, and Close;
  - the container allows wrapping and remains `sticky top-0`;
  - shared small buttons are vertically large;
  - `jumpTo` calls `scrollIntoView({ block: 'start' })` without compensating for the sticky bar height;
  - the number of wrapped rows changes with viewport width and dirty state.
- User impact: on mobile the sticky bar can occupy several rows, reducing the usable cooking viewport; jumped-to accordion headings may land underneath the bar.
- Root cause: desktop-style persistent navigation and actions share one wrapping sticky region with no scroll-margin contract.
- Recommendation:
  - use a horizontally scrollable single-row section navigator or compact menu on narrow screens;
  - separate Save/Close into a stable action area;
  - add `scroll-margin-top` based on the actual sticky shell height;
  - consider a cooking-mode navigator optimized for one-handed use.
- Acceptance criteria:
  - sticky controls occupy one predictable mobile row or a deliberately sized compact shell;
  - every jump target remains visible after navigation;
  - dirty/save state remains clear without increasing navigator height;
  - tests cover 320-pixel width with all labels and unsaved state.
- Validation: mobile screenshots and scripted jump testing.
- Backlog destination: Recipe Standardizer UX backlog candidate

## Existing findings revalidated

- F-014 remains high priority. Missing static utility definitions invalidate many intended responsive classes, so static mobile behavior cannot be trusted from markup alone.
- F-016 materially contributes to F-018 through F-021 by making supposedly small controls unusually tall.

## Risks and deferred validation

- Trip Planner event dragging uses pointer capture inside a horizontally scrollable timeline without an explicit `touch-action` contract. Device testing must confirm that touch scrolling and event movement do not conflict.
- Fixed overlays do not appear to lock background scrolling consistently. T07 will assess focus and keyboard implications; T26 should test scroll bleed.
- Virtual keyboard behavior, iOS safe areas, Android back behavior, and orientation changes require live/device validation.
- Static-page responsive rendering is deferred to T22/T23/T26 after F-014.

## Next task

`T07. Accessibility`
