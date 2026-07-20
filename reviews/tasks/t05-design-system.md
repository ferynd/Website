# T05: Shared Component Architecture and Design System

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed:

- global CSS variables, light/dark token sets, shadows, radii, typography, layout utilities, and reduced-motion behavior;
- Tailwind semantic-token mapping and content scanning;
- shared React `Button`, `Input`, `Select`, `Nav`, and `ProjectCard` primitives;
- adoption of shared controls across production tools;
- repeated catalogue/card patterns;
- static-site `shared-styles.css` and tracker-specific CSS;
- representative static pages using the shared stylesheet;
- duplicated, divergent, or undefined styles across React and static implementations.

Visual browser screenshots remain required in T06/T22/T23/T26 to quantify the rendered impact of the static utility-class gap and density choices.

## Positive foundation observations

The React application has a credible semantic foundation:

- light and dark theme token sets for backgrounds, surfaces, borders, three text levels, brand accents, and semantic status colors;
- shared chart-palette constants;
- semantic Tailwind mappings rather than widespread raw color use in core shell pages;
- shared Poppins typography through the root layout;
- a global focus-ring utility;
- a global reduced-motion rule;
- responsive container and typography utilities;
- shared React controls that are widely adopted across Trip Cost, Trip Planner, Conflict Tracker, Date Night, Recipe Standardizer, and Transcriber.

The issue is not the absence of a design system. It is that there are several partially overlapping systems with no reliable build or governance boundary.

## React token and utility architecture

`app/globals.css` is the authoritative React token layer and includes:

- light/dark color values;
- semantic shadows and radii;
- chart hex colors;
- focus and motion behavior;
- container/section utilities;
- shared badge, KPI, and progress-bar classes.

However, tool-specific behavior has also begun entering the global sheet, such as Date Night reveal/sparkle animations. This is manageable at current scale but indicates that `globals.css` is becoming both a design-token layer and a cross-tool feature stylesheet.

A healthier boundary would be:

1. immutable or slow-changing tokens;
2. shared primitives/utilities;
3. tool-local styles colocated with the tool.

## Shared React primitive review

### Button

The shared button size scale uses vertical padding rather than target height:

- `sm`: `px-4 py-4`
- `md`: `px-6 py-6`
- `lg`: `px-8 py-8`

This produces approximate content-box vertical additions of 32, 48, and 64 pixels before line height and borders. The component defaults to `md`.

Evidence of mismatch exists inside the codebase itself: `Nav.tsx` deliberately uses a plain button because the shared Button's `sm` padding would make the header too tall.

Consumers frequently append competing padding classes such as `px-4 py-2` while retaining the component default. Since classes are concatenated without a conflict resolver such as `tailwind-merge`, rendered precedence depends on generated CSS order rather than the caller's intent. This makes density overrides fragile.

### Input and Select

Both controls use:

- `px-4 py-4` for the field;
- `mb-4` between label and field;
- `mt-4` between field and error.

This creates a spacious form scale that can be appropriate for touch-first primary forms but is too coarse as the only density option for settings panels, compact modals, inline tables, and multi-field administrative workflows.

The controls otherwise provide useful automatic IDs and consistent tokenized states. Accessibility linkage is deferred to T07.

### ProjectCard

`ProjectCard` appears in the Style Guide and documentation, but the production Games, Tools, and Trips catalogues manually duplicate their own card markup. The production cards also need capabilities that `ProjectCard` lacks, including icons, access/persistence badges, parent-aware Next.js links, and status metadata.

The problem is therefore not simply “reuse ProjectCard.” The current primitive does not model the real catalogue job. A purpose-built `CatalogCard` plus a central catalogue data structure would be more appropriate, or `ProjectCard` should be removed from the implied production design system.

## Static design-system architecture

`public/shared-styles.css` manually duplicates many values from `app/globals.css`, but the two files are already divergent:

- dark `--text-3` differs between the files;
- the static root token block omits the shadow and radius variables declared in the React layer, while later static rules reference shadow variables;
- component classes such as `.badge`, `.btn-danger`, `.text-primary`, `.kpi`, and `.hbar` are defined more than once with differing values;
- cascade order, rather than an explicit component contract, determines which version wins.

The static sheet also contains broad substring selectors intended as legacy fallbacks:

- every class containing `text-gray` becomes the primary text color;
- every class containing `text-blue` or `text-red` becomes the accent color;
- every class containing `bg-white` or `bg-gray` becomes the same surface color;
- every class containing `border-gray` becomes the same border color.

These rules flatten intentionally distinct shades and semantic colors. A class such as `text-red-900` can become the teal brand accent, and multiple gray text levels can collapse to one primary text value.

## Static Tailwind-style utility coverage failure

The largest T05 issue is that several static pages are authored as though a Tailwind utility bundle is available, but none is built or loaded:

- Tailwind content scanning includes `app`, `pages`, and `components`, not `public`;
- no Tailwind CDN script is present;
- `public/shared-styles.css` is only a small hand-written subset of utility names;
- representative pages reference many undefined classes.

Affected examples include:

### Noir Detective

Uses classes such as:

- `container`, `mx-auto`, `max-w-5xl`;
- `sm:p-8`, `sm:text-6xl`, `md:grid-cols-3`;
- `space-y-4`, `md:col-span-2`, `overflow-hidden`;
- numerous color/opacity/border variants.

### Emeril

Uses classes such as:

- `h-screen`, `justify-center`, `overflow-hidden`;
- `md:text-8xl`, `md:space-y-32`, `md:p-12`;
- `text-slate-*`, `border-red-500`, `text-amber-400`;
- responsive grids and gaps.

### Chicago itinerary

Uses:

- `container`, `mx-auto`, responsive padding;
- extensive flex/grid classes;
- responsive typography and width classes;
- shade-specific gray colors.

### Social Security guide and calculator

Use large Tailwind-style vocabularies for:

- responsive grids and column spans;
- spacing and sizing;
- form layout;
- tabs, colors, borders, shadows, and visibility.

The Nutrition Tracker is less exposed because it loads a much larger tracker-specific stylesheet after `shared-styles.css`. Japan uses its own comprehensive inline CSS and does not depend on the shared static utility subset.

Without matching CSS definitions, browsers ignore the undefined classes. The HTML remains readable, but intended responsive layout, spacing, hierarchy, colors, and interactive states can be partially or substantially absent.

## Chart and visualization tokens

Chart tokens exist in both React and static token sets, but some production chart code uses local hard-coded arrays instead. This is not necessarily incorrect because SVG/canvas libraries often need literal colors, but the duplicated values should be exported through one typed palette or documented as intentionally independent. Otherwise theme changes will not propagate consistently.

## Findings

### F-014: Static pages depend on undefined Tailwind-style utility classes

- Status: validated by source; rendered severity pending browser confirmation
- Category: defect / UX / responsive design / maintainability
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: Noir Detective, Emeril, Chicago itinerary, Social Security guide, Social Security calculator, and potentially other static fragments
- Evidence:
  - Tailwind does not scan `public/`;
  - no Tailwind CDN or generated static utility bundle is loaded;
  - `shared-styles.css` implements only a small subset of referenced utilities;
  - representative pages contain numerous classes absent from that stylesheet.
- User impact: intended responsive grids, spacing, typography, colors, visibility, and interaction styling can silently fail. Pages may appear visually broken or materially different from their authored design, especially on mobile.
- Root cause: static pages were written with Tailwind vocabulary but deployed with a manually maintained partial compatibility stylesheet.
- Recommendation:
  1. Choose an explicit static styling strategy.
  2. Preferred: compile a dedicated static CSS bundle whose content scan includes approved `public/**/*.html` files, or migrate maintained pages into the Next.js application.
  3. Alternatively, replace utility vocabularies with complete page-local CSS, but do not continue expanding a partial Tailwind emulator by hand.
  4. Add a build-time/static analysis check for referenced classes that are absent from the delivered stylesheet.
- Acceptance criteria:
  - every class relied on by maintained static pages has a delivered definition;
  - responsive screenshots at 320, 768, and desktop widths match approved layouts;
  - no production dependency on Tailwind's browser CDN is introduced;
  - static style generation is deterministic and documented;
  - unused/legacy pages are explicitly archived rather than silently left broken.
- Validation: browser screenshots and computed-style sampling in T22/T23/T26.
- Backlog destination: shared static-platform backlog candidate

### F-015: React and static token/component layers are duplicated and already divergent

- Status: validated
- Category: maintainability / design consistency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `app/globals.css`, `tailwind.config.ts`, and `public/shared-styles.css`
- Evidence:
  - color/chart tokens are copied between files rather than generated from one source;
  - token values already differ;
  - static component classes are defined multiple times with conflicting declarations;
  - static rules reference shadow variables not established by the shared static root token block;
  - wildcard legacy selectors erase semantic shade distinctions.
- User impact: visual fixes can affect only one runtime, cascade changes can cause unrelated regressions, and static pages can display misleading status/color semantics.
- Root cause: the static compatibility stylesheet evolved through additive patches without a single generated token source or layered component architecture.
- Recommendation:
  - define design tokens once in a source that can emit/import both React and static CSS;
  - split static output into tokens, reset/utilities, and explicit components;
  - remove duplicate definitions and broad substring selectors;
  - add visual regression coverage for representative React and static surfaces.
- Acceptance criteria:
  - duplicated tokens are generated or imported from one canonical source;
  - each shared class has one authoritative definition per runtime;
  - semantic red/warning/error classes retain their intended meaning;
  - undefined CSS custom properties are eliminated;
  - a token-change test demonstrates consistent React/static output.
- Backlog destination: design-system/platform backlog candidate

### F-016: Shared React form-control sizing is too coarse and overrides are unreliable

- Status: validated
- Category: UX / maintainability
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: shared Button, Input, and Select and their consumers
- Evidence:
  - button sizes use 16/24/32-pixel vertical padding and default to the middle size;
  - Nav explicitly bypasses Button because even `sm` is too tall;
  - Input/Select expose only one spacious density;
  - callers append conflicting padding classes without conflict-aware class merging.
- User impact: forms and settings panels can be unnecessarily tall, dense workflows require one-off styling, and caller overrides may not render as intended.
- Root cause: size names were attached to padding increments rather than semantic control heights/densities, and primitive class composition does not resolve conflicts.
- Recommendation:
  - redesign sizes around compact/default/large target heights and consistent icon/gap behavior;
  - add compact Input/Select density;
  - use a conflict-safe class composition strategy or explicit style props/variants;
  - migrate consumers gradually and review screenshots before changing all controls globally.
- Acceptance criteria:
  - shared controls have documented target heights and density use cases;
  - Nav and compact settings can use the shared primitive without bypasses;
  - caller overrides have deterministic output;
  - touch-primary controls retain at least the required target size;
  - representative Trip Cost, Transcriber, Recipe, and Date Night forms are visually approved.
- Backlog destination: React design-system backlog candidate

### F-017: The documented ProjectCard primitive is disconnected from production catalogues

- Status: validated
- Category: maintainability / information architecture
- Priority: low
- Confidence: high
- Applies to: current `main`
- Surface: Style Guide, Games, Tools, Trips, `ProjectCard`
- Evidence:
  - repository usage places `ProjectCard` in the Style Guide rather than the production catalogue pages;
  - Games, Tools, and Trips repeat similar card structure independently;
  - `ProjectCard` lacks icons, access/persistence metadata, and Next.js link behavior required by current catalogue needs;
  - its default destination is `#`, making the demonstration appear interactive without a destination.
- User impact: card behavior and appearance can drift across catalogues, and the Style Guide implies a reusable primitive that is not actually governing production.
- Root cause: the original project-card abstraction was not updated when catalogues evolved into richer tool listings.
- Recommendation: replace it with a purpose-built `CatalogCard` and centralized catalogue schema supporting icon, description, access, persistence, maturity/status, and parent section, or clearly mark/remove ProjectCard as a non-production example.
- Acceptance criteria:
  - one production component governs equivalent catalogue-card behavior;
  - Games/Tools/Trips use shared semantics where their needs overlap;
  - access metadata from F-013 is represented centrally;
  - cards do not default to a fake `#` destination;
  - visual differences are intentional variants rather than copied markup.
- Backlog destination: React design-system/catalogue backlog candidate

## Items deferred

- exact contrast and accessible-name behavior: T07;
- viewport screenshots and modal/control density: T06;
- performance cost of fonts, Chart.js, and duplicated CSS: T08;
- static-page runtime and visual validation: T22/T23/T26;
- tool-specific UI hierarchy: each tool deep dive.

## Next task

`T06. Responsive and interaction design`
