# T07: Accessibility

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Source-level review covered:

- semantic landmarks and navigation state;
- keyboard reachability and visible focus behavior;
- mobile-menu disclosure behavior;
- modal/dialog semantics, focus entry, containment, Escape handling, and return focus;
- form labels, descriptions, errors, validation state, and grouped controls;
- toggle/selection state communication;
- icon-only controls;
- loading, progress, errors, and dynamic-result announcements;
- reduced-motion handling;
- representative static-page tabs, disclosures, charts, and click interactions.

Color contrast, browser accessibility-tree output, screen-reader announcements, zoom/reflow behavior, and automated axe/WAVE results require live validation during T26.

## Positive accessibility foundations

- The React shell generally uses semantic `main`, `header`, `nav`, `section`, button, and form elements.
- The shared Nav trigger has an accessible name and `aria-expanded`.
- Shared Input and Select generate stable IDs and connect their visible labels with `htmlFor`.
- The global React stylesheet includes a `prefers-reduced-motion` override.
- Many primary controls deliberately meet or exceed a 44-pixel target size.
- Show Tracker's view controls and primary floating action have explicit accessible names.
- Recipe Standardizer's primary accordions expose `aria-expanded` through their trigger components.
- Several Recipe Standardizer modals and Trip Cost's confirmation modal declare `role="dialog"` and `aria-modal="true"`.
- Trip Planner timeline events provide keyboard movement with Arrow Up/Down and Enter to edit.
- Nutrition Tracker includes a real tablist with `role="tab"`, `aria-selected`, `aria-controls`, and roving tabindex in its primary app bar.

These positive patterns are not applied consistently across the rest of the repository.

## Findings

### F-022: The collapsed mobile navigation leaves invisible links in the keyboard tab order

- Status: validated
- Category: accessibility / keyboard navigation
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: `components/Nav.tsx`
- Evidence:
  - the mobile navigation list is always rendered;
  - the closed state applies `max-h-0`, `opacity-0`, and `pointer-events-none` to its container;
  - those CSS properties do not remove descendant links from sequential keyboard focus;
  - no `hidden`, `inert`, conditional rendering, or descendant `tabIndex={-1}` is used;
  - primary links also do not expose `aria-current` for the active route.
- User impact:
  - keyboard users can Tab into controls they cannot see;
  - visible focus appears to disappear between the menu button and the next page control;
  - screen-reader users may encounter navigation choices that are described as collapsed;
  - current location is not announced.
- Root cause: visual disclosure state is implemented only with animation/pointer CSS, not interaction-tree state.
- Recommendation:
  - conditionally render the mobile list when open, or use `hidden`/`inert` while closed;
  - preserve an exit animation only if focusability is disabled immediately;
  - set `aria-controls` on the trigger;
  - set `aria-current="page"` or the appropriate current-location value on active links;
  - resolve descendant-route active state with F-010.
- Acceptance criteria:
  - closed-menu links are absent from the accessibility tree and Tab order;
  - opening moves no focus unexpectedly, and closing returns/retains focus on the trigger;
  - Escape closes the menu;
  - active exact and nested routes expose current state programmatically;
  - keyboard tests cover open, traverse, select, close, and viewport transition behavior.
- Backlog destination: urgent shared navigation accessibility candidate

### F-023: Most React modal overlays lack complete dialog semantics and focus management

- Status: validated
- Category: accessibility / interaction
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: tool-specific modal overlays across Shows, Transcriber, Conflict Tracker, Trip Planner, Date Night, and selected Recipe flows
- Evidence:
  - repository search finds many `fixed inset-0` overlays but only four components declaring both dialog role and modal state;
  - React Escape handling is found for Trip Cost's confirmation dialog, but not for most other overlays;
  - focus initialization is found only in limited implementations;
  - no shared focus-trap or focus-return primitive is present;
  - typical affected dialogs leave all background controls focusable and do not mark the page inert;
  - T06 separately established that several dialogs also lack viewport-constrained scrolling.
- User impact:
  - keyboard focus can move behind an open modal;
  - screen readers may not know a modal context opened or what its title is;
  - users can become lost between modal and background content;
  - Escape behavior and focus restoration vary unpredictably;
  - destructive or privacy-sensitive workflows become harder to operate safely.
- Root cause: modal geometry and behavior are reimplemented independently instead of using an accessible dialog primitive.
- Recommendation: introduce one shared Dialog/Sheet implementation that provides:
  - `role="dialog"` and `aria-modal="true"`;
  - labelled title and optional description;
  - sensible initial focus;
  - Tab/Shift+Tab containment;
  - Escape close where safe;
  - focus return to the invoking control;
  - inert/background scroll lock;
  - responsive height and internal scrolling from F-019.
- Acceptance criteria:
  - every maintained React modal uses the shared primitive or passes equivalent automated tests;
  - focus never escapes to background controls;
  - a screen reader announces dialog title and description on open;
  - Escape and close-button behavior are documented and consistent;
  - focus returns to the opener after close;
  - nested/confirmation dialogs behave predictably.
- Backlog destination: urgent shared dialog/accessibility platform candidate

### F-024: Many custom form and selection controls expose labels or selected state only visually

- Status: validated
- Category: accessibility / forms
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - Show Tracker ShowForm;
  - Conflict Tracker ConflictForm;
  - Show Tracker chips/view selection;
  - various Trip Planner, Date Night, and tool-local grouped button controls.
- Evidence:
  - ShowForm renders visible labels without `htmlFor`, while corresponding native fields omit IDs;
  - Show type and status are button grids with selected styling but no `aria-pressed`, radio-group semantics, or programmatic group label;
  - Conflict severity uses five buttons under a visual label without `fieldset`/`legend`, radiogroup, or selected-state attribute;
  - Conflict tags and reusable Show chips use active styling without `aria-pressed`;
  - card/list view buttons have names but do not expose which view is selected;
  - the primary navigation applies active styling without `aria-current`.
- User impact:
  - assistive technology may announce a field without its visible label;
  - selected filters, ratings, tags, modes, and views may be indistinguishable from unselected choices;
  - users cannot reliably determine current state before changing it.
- Root cause: custom button-based controls were styled as selectors without a shared accessible selection-control contract.
- Recommendation:
  - use native radios/checkboxes/selects where appropriate;
  - otherwise provide `aria-pressed`, `aria-selected`, or radiogroup/radio semantics matching the interaction;
  - use `fieldset`/`legend` for grouped choices;
  - associate every visible field label through `htmlFor`/ID or wrapping;
  - add accessible state tests to reusable Chip, view-toggle, rating, tag, and segmented-control components.
- Acceptance criteria:
  - every input is programmatically named;
  - every grouped selector has a programmatic group name;
  - current state is announced for every toggle, chip, view, and segmented choice;
  - keyboard behavior follows the selected semantic pattern;
  - automated accessibility tests cover representative tool forms.
- Backlog destination: cross-tool form/control accessibility candidate

### F-025: Shared Input and Select errors are not programmatically associated with their controls

- Status: validated
- Category: accessibility / validation
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: shared `Input.tsx` and `Select.tsx`, and all consumers passing `error`
- Evidence:
  - an error changes the visual border and renders a paragraph;
  - the field does not set `aria-invalid`;
  - the error paragraph has no stable ID;
  - the field does not reference the error with `aria-describedby` or `aria-errormessage`;
  - errors are not placed in a live region when introduced after submission.
- User impact: screen-reader users may know a submission failed but not which field failed or what correction is required.
- Root cause: visual error styling was added without extending the shared component's accessibility API.
- Recommendation:
  - generate an error ID from the field ID;
  - set `aria-invalid` and `aria-describedby`/`aria-errormessage` when errors exist;
  - merge caller-supplied description IDs safely;
  - focus the first invalid control after failed submission where appropriate.
- Acceptance criteria:
  - screen readers announce each field's error when focused;
  - multiple help/error descriptions compose correctly;
  - invalid state clears when the error clears;
  - unit tests assert generated IDs and ARIA relationships for Input and Select.
- Backlog destination: shared form primitive candidate

### F-026: Loading, progress, save, and calculator updates are rarely announced

- Status: validated
- Category: accessibility / asynchronous feedback
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - global App Router loading screen;
  - Show Tracker loading spinner;
  - Transcriber pipeline and upload progress;
  - Recipe Standardizer save/import/match status;
  - Social Security live calculator results;
  - multiple success/error paragraphs in collaborative tools.
- Evidence:
  - repository search finds no `role="status"` usage and very limited `aria-live` usage;
  - the global loading screen is a visual animated bar with no text/status semantics;
  - Transcriber progress updates visible step text and a width-only bar without a progressbar role or value attributes;
  - Recipe status updates render as ordinary paragraphs;
  - static calculators update text/HTML after every input without live-region semantics.
- User impact:
  - screen-reader users may not know that work started, advanced, completed, failed, or saved;
  - long-running transcription can appear idle;
  - changing a calculator input may produce no announced result;
  - users may repeat actions and create duplicate work.
- Root cause: async state is represented visually but there is no shared status/progress announcement pattern.
- Recommendation:
  - use polite status regions for normal progress/success and assertive alerts for blocking errors;
  - give determinate bars `role="progressbar"` with min/max/current values and accessible labels;
  - announce major pipeline-stage changes, not every rapidly changing timer tick;
  - focus error summaries only when necessary and avoid noisy duplicate announcements.
- Acceptance criteria:
  - global route loading has an accessible status message;
  - Transcriber announces stage changes and determinate progress meaningfully;
  - save/import/calculator changes are announced once with useful wording;
  - automated tests verify live-region and progressbar attributes;
  - screen-reader smoke tests confirm announcements are informative and not excessive.
- Backlog destination: shared async-feedback accessibility candidate

### F-027: Some icon-only controls have no dependable accessible name

- Status: validated
- Category: accessibility / controls
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - ShowForm close button;
  - Show Tracker sign-out icon button;
  - additional tool-local icon buttons requiring systematic review.
- Evidence:
  - ShowForm's close control contains only an X icon and has no `aria-label` or associated text;
  - the Show Tracker sign-out control relies on a `title` attribute rather than an explicit accessible name;
  - other components demonstrate the intended stronger pattern by using `aria-label`, proving inconsistency rather than an architectural limitation.
- User impact: assistive technology can announce an unlabeled “button” or inconsistently derive a tooltip title, making close/sign-out and other actions ambiguous.
- Root cause: icon-button naming is not enforced by a reusable component or lint/test rule.
- Recommendation: create or enforce an IconButton API requiring an accessible label; treat `title` as optional tooltip/help text rather than the primary name.
- Acceptance criteria:
  - every icon-only button has an explicit accessible name;
  - decorative icons are hidden from the accessibility tree;
  - lint/component tests prevent unnamed icon buttons;
  - tooltip text, when present, matches but does not replace the accessible label.
- Backlog destination: shared control accessibility candidate

### F-028: Static interactive pages do not consistently support keyboard, ARIA state, or reduced motion

- Status: validated
- Category: accessibility / static platform
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative evidence:
  - Emeril's “Read More” controls are clickable `span` elements with no tabindex, keyboard handler, button role, `aria-expanded`, or controlled-region relationship;
  - Emeril's faction tabs visually toggle classes but do not implement tablist/tab/tabpanel semantics or selected state;
  - Social Security uses native buttons for tabs, but does not implement tab semantics, `aria-selected`, `aria-controls`, or roving keyboard behavior;
  - Social Security calculator outputs update dynamically without live announcements;
  - static pages include pulse, bounce, reveal, and transition animations, while reduced-motion handling exists only in the React global stylesheet;
  - F-014 means some intended focus and responsive classes are not delivered at all.
- User impact:
  - keyboard users cannot activate click-only disclosures;
  - screen-reader users cannot determine active tab or disclosure state;
  - dynamic calculations may be silent;
  - motion-sensitive users cannot disable static-page animations;
  - focus presentation may vary or disappear.
- Root cause: static experiences use independent ad hoc interaction code without a shared accessible component or static build/test standard.
- Recommendation:
  - replace clickable spans/divs with native buttons/links;
  - implement WAI-ARIA tab/disclosure patterns only where native semantics do not suffice;
  - add reduced-motion CSS to the static token/build layer;
  - include static pages in automated keyboard/accessibility checks after resolving F-014.
- Acceptance criteria:
  - every interactive static control is reachable and operable by keyboard;
  - tabs/disclosures announce name, role, and state;
  - dynamic outputs are announced without excessive verbosity;
  - static animations honor reduced-motion preferences;
  - axe and manual keyboard tests pass for maintained static pages.
- Backlog destination: static-platform accessibility candidate

### F-029: The site has no skip-to-content mechanism

- Status: validated
- Category: accessibility / navigation
- Priority: low
- Confidence: high
- Applies to: current `main`
- Surface: React shell and static page conventions
- Evidence: no skip-link implementation is present; the sticky global navigation precedes main content on most React routes.
- User impact: keyboard and switch users must traverse repeated navigation on every route before reaching primary content.
- Root cause: the shared shell does not expose a focusable bypass link or stable main-content target.
- Recommendation: add a visually hidden skip link that becomes visible on focus and targets a stable main landmark; include an equivalent pattern in maintained static pages.
- Acceptance criteria:
  - first Tab reveals “Skip to main content”;
  - activating it moves focus to the main content landmark;
  - behavior works across catalogue/tool routes and does not conflict with modals;
  - static-page template includes the same bypass where repeated navigation exists.
- Backlog destination: shared shell accessibility candidate

## Existing findings revalidated

- F-010 requires both visual descendant-route state and `aria-current`.
- F-014 can remove intended responsive/focus behavior from static pages and increases the urgency of F-028.
- F-019 should be resolved through the same shared accessible dialog primitive as F-023.

## Deferred live validation

- WCAG contrast against actual computed colors and opacity combinations;
- 200% and 400% zoom/reflow;
- screen-reader testing with NVDA/Chrome and VoiceOver/Safari;
- keyboard focus order in each authenticated tool state;
- chart alternatives and canvas descriptions;
- touch target spacing, switch-control behavior, and mobile screen-reader gestures;
- axe-core scans of public, authenticated, modal-open, error, and loading states.

## Next task

`T08. Performance, resilience, and browser compatibility`
