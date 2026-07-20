# T22: Games and Interactive Static Experiences Deep Dive

Completed: 2026-07-15  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed every game currently exposed by `app/games/page.tsx`:

- `public/games/noir_detective_idea/index.html` — Shadows Over Boston;
- `public/games/Emeril_A_World_Divided/index.html` — Emeril: A World Divided.

The review covered:

- catalogue promises versus actual interaction;
- content structure and navigation;
- audio behavior and media controls;
- disclosure, tab, and scroll-reveal interactions;
- keyboard and assistive-technology semantics;
- reduced-motion behavior;
- progressive enhancement and JavaScript failure;
- responsive content expansion and clipping;
- asset/CDN dependencies, static utility styling, and test coverage.

## Inventory and workflow trace

### Shadows Over Boston

1. The Games catalogue describes the page as an interactive detective-story concept.
2. The page presents a static setting introduction, case premise, and four investigator profiles.
3. A local MP3 is preloaded and playback is attempted automatically on page load.
4. If autoplay is blocked, JavaScript creates an “Enable sound” button.
5. After playback starts, no persistent media control remains.

### Emeril: A World Divided

1. A full-screen hero leads into lore sections.
2. Most major sections begin visually hidden with a custom scroll-reveal class.
3. `IntersectionObserver` adds a visible class when each section enters the viewport.
4. Two lore sections use custom “Read More” clickable spans to expand content.
5. Three faction buttons switch between mutually exclusive content panels.
6. Multiple decorative animations run continuously or during scrolling/expansion.

## Strong design decisions

- Both pages are self-contained and do not collect or persist user data.
- Both have a clear visual identity appropriate to their fiction.
- Noir supplies meaningful alt text for all major images.
- Emeril uses actual `<button>` elements for the faction selectors rather than clickable generic containers.
- Emeril's tab switching is delegated through one container and safely resolves only known content IDs.
- Background colors and local content remain available if external font requests fail.
- The pages avoid unnecessary application frameworks for small static experiences.

## Findings

### F-121: Noir audio can start without any pause, stop, mute, or volume control

- Status: validated
- Category: accessibility / unexpected media
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: `#bg-audio` and generated Enable sound button
- Evidence:
  - the audio element uses `preload="auto"` and playback is attempted during the window load event;
  - the audio element has no `controls` attribute;
  - if autoplay succeeds, no visible control is ever created;
  - if autoplay is blocked, the generated button only starts playback and removes itself immediately;
  - no pause, stop, mute, volume, playback-status, or replay control exists.
- User impact:
  - a user can receive unexpected audio and have no page-level way to stop it;
  - keyboard, screen-reader, sensory-sensitive, and shared-environment users lose control of media playback;
  - the only dependable escape may be muting the browser/device or leaving the page.
- Root cause: autoplay recovery is treated as a one-shot enable action instead of a media-control state.
- Recommendation:
  1. Do not autoplay by default.
  2. Provide a persistent play/pause button with an accessible name and state.
  3. Expose volume or mute control when audio is longer than a brief effect.
  4. Avoid `preload="auto"` unless the user has opted into playback.
  5. Preserve the control after playback starts and handle rejected play promises visibly.
- Acceptance criteria:
  - audio never begins without an explicit user action, or a persistent stop/pause control is available immediately;
  - the control is keyboard operable and announces play state;
  - users can stop sound without navigating away;
  - autoplay-blocked, autoplay-allowed, replay, and media-error paths are tested.
- Backlog destination: urgent game-media accessibility candidate

### F-122: Noir is catalogued as an interactive game but contains no investigation or choice interaction

- Status: validated
- Category: product positioning / discovery
- Priority: low
- Confidence: high
- Applies to: current Games catalogue and Noir page
- Surface: card description and page experience
- Evidence:
  - the catalogue calls it an “interactive detective story concept” and places it under Games;
  - the page contains static setting, case, and character material;
  - its only interaction is enabling background audio when autoplay fails;
  - there are no choices, clues, branching state, puzzle, progression, or game instructions.
- User impact: visitors expecting a playable prototype receive a pitch/concept page and may interpret the experience as unfinished or broken.
- Root cause: concept showcase and game prototype are not distinguished in information architecture.
- Recommendation: relabel it as a setting/campaign concept or add a clearly described playable interaction.
- Acceptance criteria:
  - catalogue copy accurately states whether the destination is a concept page, lore page, or playable game;
  - the page provides a clear next action if gameplay exists;
  - static concepts are not represented as completed interactive experiences.
- Backlog destination: games catalogue clarity candidate

### F-123: Emeril's Read More controls are not keyboard controls and do not expose disclosure state

- Status: validated
- Category: accessibility / disclosure interaction
- Priority: high
- Confidence: high
- Applies to: both Read More/Less interactions
- Surface: `.read-more-btn` and `.details-content`
- Evidence:
  - each trigger is a `<span>` with a click listener;
  - the spans have no `tabindex`, button role, keyboard handler, `aria-expanded`, or `aria-controls`;
  - collapsed content is hidden only through max-height, overflow, and opacity, so it is not semantically hidden from assistive technology;
  - changing visible text to Read Less is the only state communication.
- User impact:
  - keyboard-only users cannot reach or activate the disclosures;
  - screen-reader users may encounter content that sighted users are told is collapsed;
  - disclosure state and controlled-region relationship are not announced.
- Root cause: a visual text treatment is used as a custom button without implementing button or disclosure semantics.
- Recommendation: use native `<button>` controls with `aria-expanded` and `aria-controls`, and use `hidden` or equivalent semantic state for collapsed content.
- Acceptance criteria:
  - disclosure triggers are reachable and activatable with keyboard and assistive technology;
  - collapsed content is absent from both visual and accessibility navigation;
  - expanded/collapsed state is announced;
  - focus remains stable after activation.
- Backlog destination: urgent Emeril accessibility candidate

### F-124: Emeril's expanded lore can remain permanently clipped at 1000 pixels

- Status: validated
- Category: responsive content loss / disclosure correctness
- Priority: high
- Confidence: high
- Applies to: `.details-content.expanded`, especially `#world-details`
- Surface: Read More expansion on desktop and mobile
- Evidence:
  - collapsed containers use `overflow: hidden`;
  - expanded containers set a fixed `max-height: 1000px` rather than the actual content height;
  - the world-details region contains an illustration and five long paragraphs;
  - its rendered height can readily exceed 1000 pixels, particularly at narrow widths;
  - excess content remains clipped even though the trigger says Read Less, implying the entire section was revealed.
- User impact:
  - users can be prevented from reading the end of the lore after explicitly expanding it;
  - mobile users are most affected because line wrapping substantially increases height;
  - the failure looks like missing content rather than a scrollable region.
- Root cause: an animation convenience constant is treated as a content-capacity guarantee.
- Recommendation: use native `<details>`, animate from measured `scrollHeight`, or remove the height cap after the opening transition.
- Acceptance criteria:
  - every expanded section displays its complete content at all supported widths and font scales;
  - expansion animation does not impose a final clipping height;
  - tests include 200% text zoom and narrow mobile widths;
  - dynamic content growth after expansion remains visible.
- Backlog destination: urgent Emeril responsive-content candidate

### F-125: Emeril's primary content is visually unavailable when JavaScript or IntersectionObserver fails

- Status: validated source risk; failure reproduction pending runtime validation
- Category: progressive enhancement / resilience
- Priority: high
- Confidence: high
- Applies to: all `.scroll-reveal` sections
- Surface: main lore content below the hero
- Evidence:
  - `.scroll-reveal` starts with `opacity: 0` and a translated position;
  - visibility is restored only when JavaScript creates an `IntersectionObserver` and adds `.is-visible`;
  - there is no no-script fallback, feature detection, timeout fallback, or default-visible state;
  - an unsupported API or earlier script failure can leave the majority of the page permanently transparent.
- User impact:
  - the page can appear almost empty despite all content being present in the document;
  - restrictive browsers, script failures, privacy tools, or future API regressions can block the experience;
  - sighted and screen-reader users can receive inconsistent content states because opacity does not remove content semantically.
- Root cause: animation is implemented as a prerequisite for visibility rather than an enhancement applied after capability detection.
- Recommendation: render content visible by default, then add an animation-enabled class only after JavaScript and observer support are confirmed.
- Acceptance criteria:
  - all content remains readable with JavaScript disabled and when `IntersectionObserver` is unavailable;
  - animation setup failure cannot leave content transparent;
  - visual and accessibility-tree visibility remain aligned;
  - fallback behavior is browser-tested.
- Backlog destination: urgent Emeril resilience candidate

### F-126: Emeril's faction tabs omit tab semantics and expected keyboard navigation

- Status: validated
- Category: accessibility / tab interaction
- Priority: medium
- Confidence: high
- Applies to: three faction selectors and panels
- Surface: `#tab-buttons`, `.tab-button`, and `.tab-content`
- Evidence:
  - the controls are buttons but have no `role="tab"`, parent `role="tablist"`, `aria-selected`, `aria-controls`, or managed tab stops;
  - content panels have no `role="tabpanel"` or accessible labels;
  - only pointer/click activation is implemented;
  - Left/Right/Home/End keyboard behavior expected for a tab interface is absent;
  - active state is communicated visually through color and border only.
- User impact: assistive technology receives three unrelated buttons rather than one tab set, and keyboard users must tab through every selector rather than navigate the composite control predictably.
- Root cause: visual tabs are implemented as generic button-driven content switching.
- Recommendation: implement the WAI-ARIA tab pattern or use a simpler disclosure/list pattern that matches the actual interaction.
- Acceptance criteria:
  - selected state and controlled panel are programmatically exposed;
  - arrow, Home, and End keys operate consistently if the tab pattern is retained;
  - only the active panel is exposed as active content;
  - focus and active styling remain synchronized.
- Backlog destination: Emeril interaction-accessibility candidate

### F-127: Game animations do not respect reduced-motion preferences

- Status: validated
- Category: accessibility / motion sensitivity
- Priority: medium
- Confidence: high
- Applies to: Emeril scroll reveal, disclosure transition, portal pulse, and hero bounce
- Surface: page animations
- Evidence:
  - scroll reveal uses opacity and vertical movement transitions;
  - disclosures animate height and opacity for up to 0.7 seconds;
  - the portal icon runs an infinite scale/glow animation;
  - the hero includes an `animate-bounce` utility intent;
  - no `prefers-reduced-motion` media query or user control is present.
- User impact: people who request reduced motion can still receive repeated scaling, bouncing, and movement effects.
- Root cause: motion is treated as universal decoration instead of a preference-sensitive enhancement.
- Recommendation: disable nonessential transforms, pulses, and smooth transitions under `prefers-reduced-motion: reduce` and ensure content remains immediately visible.
- Acceptance criteria:
  - the operating-system reduced-motion preference suppresses nonessential motion;
  - disclosures remain understandable without animation;
  - no infinite scale/bounce animation runs in reduced-motion mode;
  - automated CSS checks and manual browser validation cover the preference.
- Backlog destination: game motion-accessibility candidate

## Revalidated cross-cutting findings

- F-011: Emeril has no in-page route back to Games or the site hub; Noir links only to the home hub rather than its parent catalogue.
- F-014: both pages rely extensively on Tailwind-style utility classes that are not provided by a Tailwind build. `shared-styles.css` implements only a small subset, so responsive grids, spacing, sizing, colors, and animations require live visual validation and are likely incomplete.
- F-028: the static interaction platform lacks consistent keyboard, ARIA, and reduced-motion behavior.
- F-033: Google Fonts and Noir's external texture asset remain third-party runtime dependencies without integrity or local fallback policy.
- F-045/F-046: neither page is exercised by automated responsive, accessibility, or static-page quality gates.
- F-047: media, observer, and interaction failures are not captured by production telemetry.
- F-049: no dedicated tests cover either game's behavior.

## Test assessment

No game-specific tests were found. High-value coverage should include:

- autoplay allowed, autoplay blocked, playback error, pause, replay, and keyboard media control;
- no-JavaScript and no-IntersectionObserver rendering;
- disclosure keyboard behavior and semantic hidden state;
- full expanded-content height at mobile, desktop, 200% zoom, and large default fonts;
- tab ARIA state and arrow-key navigation;
- reduced-motion behavior;
- missing local image/audio and unavailable external asset behavior;
- static utility-class coverage or visual-regression screenshots.

## Runtime validation required later

T26 should verify:

1. actual layout under the repository's limited `shared-styles.css` utility set;
2. all referenced local images and audio in production;
3. audio behavior across Chrome, Safari, Firefox, and mobile autoplay policies;
4. Emeril with JavaScript disabled and `IntersectionObserver` removed;
5. world-details expansion at narrow widths and 200% zoom;
6. keyboard and screen-reader operation of disclosures and faction tabs;
7. reduced-motion rendering;
8. third-party font/texture failures and slow connections.

## Outcome

The two game pages have strong atmosphere and require little infrastructure, but they are better described as concept/lore showcases than completed games. Noir's audio lifecycle removes user control, while Emeril's custom disclosures, fixed expansion height, JavaScript-gated visibility, tab semantics, and motion behavior create concrete accessibility and content-loss defects. These pages should be made progressively enhanced and fully controllable before being used as examples of polished interactive work.