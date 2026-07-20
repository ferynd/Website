# T19: Nutrition Tracker Deep Dive

Completed: 2026-07-14  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete current merged implementation of the static CalorieTracker application, including:

- Firebase initialization, anonymous/email/custom-token authentication, account switching, and per-UID storage;
- daily-date selection, food logging, saved-food creation/editing/deletion, quantity changes, subtraction, undo, and staging;
- schema normalization, legacy-entry migration, estimates, vacation entries, partial-day adjustments, and save preparation;
- nutrient totals, daily floors, rolling averages, exercise sessions, activity-level fallbacks, and dashboard/chart inputs;
- weight CSV parsing and batched persistence, multi-weigh-in selection, TDEE/BMR analysis, water-weight correction, imputation, confidence, and plateau logic;
- profile and goal persistence, age/current-weight resolution, BMR/TDEE selection, macro targets, DRI lookup, UL warnings, and manual overrides;
- saved-food and daily-log CSV/JSON import/export;
- Firestore privacy, static CDN dependencies, multi-device behavior, failure recovery, accessibility, and the 584-test suite described by the project backlog;
- integration assumptions used by Recipe Standardizer.

## Current workflow trace

1. The static app dynamically imports its local modules and initializes Firebase from CDN ESM modules.
2. When Firebase reports no authenticated user, the app automatically creates or resumes an anonymous account.
3. User data loads in parallel: targets, the most recent 365 daily entries, all weight entries, profile, goals, then saved foods.
4. The selected calendar day is loaded into one global `dailyFoodItems` array.
5. Food nutrients are staged manually, pasted and parsed, or loaded from the saved-food library, then added to the selected day as per-unit nutrient values multiplied by quantity.
6. Daily documents contain nutrient totals, embedded food snapshots, exercise/activity data, and estimate metadata.
7. Weight uploads are parsed, normalized, and persisted in batches with deterministic timestamp-based document IDs.
8. The energy engine merges weight and nutrition dates, selects representative daily weights, applies water correction, estimates TDEE/BMR, imputes gaps, and reports confidence.
9. The target engine resolves current weight, calculates RMR/TDEE and macro/micronutrient targets, then allows manual overrides.
10. Data exports include targets JSON, saved-food CSV, and full normalized daily-history CSV.

## Strong design decisions

- The application has a documented modular architecture despite being a static, browser-native app.
- Core normalization, target, exercise, weight-parser, and energy-analysis logic is separated into pure modules with extensive tests.
- Daily food logs embed nutrient snapshots, so editing or deleting a saved food does not rewrite history.
- New and legacy daily entries are normalized into a documented v2 in-memory shape before use.
- Deferred historical-day operations have a dedicated `saveDailyEntrySnapshot` path designed to avoid reading another selected day’s global food array.
- Weight uploads use deterministic document IDs and chunked Firestore batches, making same-file reimports largely idempotent.
- Multi-weigh-in days select a representative reading using a preferred window and robust median behavior.
- The analysis engine exposes uncertainty and confidence rather than presenting all empirical estimates as equally reliable.
- Target generation distinguishes formula, empirical-rest-day, observed, and recent TDEE sources and avoids obvious exercise double counting in its selection rules.
- Food names rendered through dynamic HTML are escaped in the primary list and manager views.
- Users are explicitly warned that edits do not synchronize in real time across devices.
- Export reads the complete daily-entry collection rather than silently limiting history to the initial 365-day working set.

## Findings

### F-098: A delayed quantity save can overwrite one day with another day’s food list

- Status: validated
- Category: daily-log data integrity / date-state race
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: inline food quantity editing and date navigation
- Evidence:
  - inline quantity changes update local state and schedule persistence after a 400 ms debounce;
  - the timer captures the edited `dateStr` and entry, but calls `saveDailyEntry(dateStr, entry)`;
  - `saveDailyEntry` ignores `entry.foodItems` and always rebuilds the saved food array from global `state.dailyFoodItems`;
  - changing the date replaces `state.dailyFoodItems` with the newly selected day before the timer necessarily fires;
  - date navigation does not flush or cancel the pending quantity persistence safely;
  - a second quantity edit uses one global timer and can cancel the first day’s pending save entirely.
- User impact:
  - changing dates immediately after a quantity edit can save the newly selected day’s food list into the previously edited date;
  - two rapid edits on different days can silently discard the first edit;
  - nutrient totals and embedded item snapshots can become internally inconsistent across days.
- Root cause: a deferred historical-day write uses the current-day snapshot helper instead of the existing entry-owned snapshot path, combined with one cross-day debounce timer.
- Recommendation:
  1. Use `saveDailyEntrySnapshot(dateStr, immutableEntrySnapshot)` for delayed quantity persistence.
  2. Maintain pending writes per date or flush the edited date before changing selection.
  3. Clone the item array and entry at edit time so later global mutations cannot alter the queued payload.
  4. Surface save status and retry failures instead of allowing an unhandled timer promise.
- Acceptance criteria:
  - switching dates at every point during the debounce cannot change the edited day’s payload;
  - edits on two dates within 400 ms both persist;
  - a rejected save restores or visibly marks the unsaved local value;
  - automated fake-timer tests cover edit, date switch, second edit, logout, and refresh races.
- Backlog destination: urgent CalorieTracker daily-log integrity candidate

### F-099: Distinct saved-food names can silently overwrite each other through slug collisions

- Status: validated
- Category: saved-food data loss / identifier design
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: manual food saving, duplicate handling, and CSV import
- Evidence:
  - duplicate detection compares case-insensitive display names only;
  - the Firestore document ID is generated by lowercasing the name and replacing every non-ASCII alphanumeric character with `_`;
  - different names can therefore generate the same ID, for example `PB&J`, `PB J`, and `PB-J`;
  - manual saving and CSV import both use unconditional `setDoc` at that derived ID;
  - CSV import reports the row as imported even when it replaced a different food sharing the slug.
- User impact:
  - an unrelated saved food can disappear without confirmation;
  - Recipe Standardizer links that point to the overwritten document can silently change nutritional meaning;
  - bulk imports can overwrite multiple existing foods while reporting success.
- Root cause: display-name duplicate detection and storage-key collision detection use different equivalence rules.
- Recommendation: use generated immutable document IDs plus a separate normalized-name index, or check the destination document before every write and require an explicit replace/rename decision when its stored name differs.
- Acceptance criteria:
  - two distinct names that normalize similarly coexist without overwrite;
  - import reports collisions separately from successful creations;
  - replacing an existing document always requires explicit confirmation;
  - collision tests include punctuation, whitespace, Unicode, blank names, and repeated underscores.
- Backlog destination: urgent CalorieTracker saved-food integrity candidate

### F-100: Automatic anonymous sign-in provides no safe path to convert or switch accounts

- Status: validated
- Category: identity / data continuity
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: first visit, Login / Sign Up access, logout, and guest data ownership
- Evidence:
  - when no user exists, the auth callback immediately calls anonymous sign-in;
  - once any user is signed in, including an anonymous user, the UI hides the Login / Sign Up button and shows only Logout;
  - logout triggers the unauthenticated callback, which immediately creates another anonymous session;
  - email signup creates a separate account rather than linking credentials to the current anonymous user;
  - no `linkWithCredential`, guest-data migration, merge, or account-switch workflow exists.
- User impact:
  - a first-time visitor is placed into a persistent guest UID and cannot normally expose the email login/signup interface from that state;
  - logging out can strand data under the previous anonymous UID and immediately replace it with a new guest identity;
  - even if email signup is reached through a race or manual state manipulation, guest history is not transferred.
- Root cause: guest mode is implemented as unconditional authentication fallback rather than an explicit temporary-account lifecycle.
- Recommendation:
  1. Keep Login / Sign Up available for anonymous users.
  2. Convert anonymous accounts with Firebase credential linking so the UID and data remain unchanged.
  3. Make logout end at a stable signed-out screen rather than automatically creating another identity.
  4. Explain guest persistence/retention and provide export or migration recovery before destructive identity changes.
- Acceptance criteria:
  - an anonymous user can create an email login without changing UID or losing any data;
  - logout does not silently create another account;
  - switching to an existing account requires an explicit merge/discard/export decision for guest data;
  - integration tests cover first visit, guest logging, upgrade, logout, login, refresh, and credential collision.
- Backlog destination: urgent CalorieTracker identity candidate

### F-101: Historical analysis can replace exact legacy exercise calories with a coarse activity band

- Status: validated
- Category: energy-analysis accuracy / schema migration
- Priority: high
- Confidence: high
- Applies to: legacy daily entries with positive `trainingBump` and no detailed sessions
- Surface: merged analysis rows, exercise-adjusted TDEE, and historical energy estimates
- Evidence:
  - `normalizeEntry` derives `dayActivityLevel` from legacy `trainingBump` values, for example 280 becomes `medium`;
  - `deriveExerciseCalories` in the analysis engine checks `dayActivityLevel` before `trainingBump`;
  - the shared dashboard/chart helper correctly does the opposite and documents the exact legacy value as authoritative because the mapping is lossy;
  - the README also states the original positive `trainingBump` must be preferred;
  - therefore the dashboard can use 280 kcal while the analysis engine uses the medium-band 200 kcal for the same stored day.
- User impact:
  - historical exercise expenditure can be understated or overstated;
  - empirical TDEE, imputation, and confidence inputs can differ from the visible daily calculation;
  - results vary depending on which code path consumes the same entry.
- Root cause: duplicated exercise-resolution logic has diverged during schema migration.
- Recommendation: make the analysis engine use the shared `getEntryExerciseKcal` semantics or a single pure resolver that returns calories plus source metadata, with legacy bump before derived activity level.
- Acceptance criteria:
  - all dashboard, chart, target, and analysis consumers resolve identical exercise calories for the same entry;
  - legacy values such as 120, 280, and 400 remain exact;
  - new quick-select entries without `trainingBump` still use activity bands;
  - regression tests cover normalized legacy entries and merged analysis rows.
- Backlog destination: urgent CalorieTracker analysis-correctness candidate

### F-102: Removing an estimate rounds every remaining nutrient to a whole number

- Status: validated
- Category: nutrition precision / correction workflow
- Priority: medium
- Confidence: high
- Applies to: mixed or estimated days where one synthetic item is removed
- Surface: `removeEstimateItem`
- Evidence:
  - after removing the selected synthetic food, every nutrient total is recomputed from remaining foods;
  - the recomputation applies `Math.round` to every key in `allNutrients`;
  - the same list includes protein, fats, omega-3, vitamin B12, vitamin B6, and other values whose meaningful targets and logged quantities contain decimals;
  - normal daily saves otherwise preserve numeric decimals.
- User impact:
  - correcting an estimate can permanently change unrelated real-food nutrient totals;
  - small micronutrient values can experience large proportional errors, such as 0.6 becoming 1 or 0.4 becoming 0;
  - rolling-average and target-compliance results can shift after a correction that should only remove one item.
- Root cause: display-oriented whole-number rounding is applied to persisted canonical totals.
- Recommendation: preserve full calculation precision in state and Firestore, and round only at presentation boundaries using nutrient-appropriate decimal rules.
- Acceptance criteria:
  - removing an estimate produces the exact sum of remaining embedded items within numeric tolerance;
  - nutrient-specific precision survives save/reload;
  - tests cover fractional macros, milligrams, micrograms, and repeated remove/undo cycles.
- Backlog destination: CalorieTracker correction-accuracy candidate

### F-103: Birth dates can produce an age one year too high near the birthday in Chicago

- Status: validated algorithmic defect; exact affected hours depend on runtime timezone
- Category: date/time correctness / target generation
- Priority: medium
- Confidence: high
- Applies to: profiles using an ISO date-only `birthDate`
- Surface: DRI age band, Mifflin-St Jeor calculation, and generated targets
- Evidence:
  - `resolveAge` parses `YYYY-MM-DD` using `new Date(profile.birthDate)`;
  - ECMAScript treats an ISO date-only string as UTC midnight;
  - the function then compares the parsed date using local `getMonth()` and `getDate()` values;
  - in America/Chicago, UTC midnight is the prior local evening, so the stored birthday can appear one calendar day earlier;
  - existing tests allow a two-year range and do not exercise the day before/on/after a birthday under a fixed timezone.
- User impact: age can increment one day early, potentially selecting a different DRI age band and slightly changing RMR/target results around boundary birthdays.
- Root cause: date-only domain data is parsed as an instant and then interpreted with local calendar getters.
- Recommendation: parse year, month, and day components directly or compare date-only strings in the configured timezone; inject `today` into the pure function for deterministic tests.
- Acceptance criteria:
  - age changes only on the configured local birthday;
  - behavior is identical across browser/system timezones;
  - tests cover leap-day births, DRI boundary ages, and the day before/on/after the birthday.
- Backlog destination: CalorieTracker target-date correctness candidate

### F-104: Concurrent devices can silently overwrite an entire daily log

- Status: validated source risk; overwrite reproduction requires multi-client runtime validation
- Category: data integrity / concurrency
- Priority: high
- Confidence: high
- Applies to: edits to the same date from multiple tabs/devices
- Surface: daily food items, exercise sessions, activity level, estimates, and corrections
- Evidence:
  - daily state is loaded once and the application explicitly does not listen for real-time updates;
  - every daily save uses `setDoc` to replace the full day document;
  - food, activity, exercise, estimate, and correction actions all modify local copies of that shared document;
  - no revision, transaction precondition, last-seen timestamp, or merge/conflict screen exists;
  - the sync notice tells users to refresh but cannot prevent stale writes.
- User impact:
  - a later save from a stale tab can erase food, exercise, or correction work completed elsewhere;
  - the user receives no indication that remote changes were overwritten;
  - the problem is especially likely during phone/desktop logging of the same day.
- Root cause: whole-document optimistic writes are used without a concurrency contract.
- Recommendation: subscribe to the selected day or store independently mutable records in subcollections; at minimum add revision checks and an explicit conflict-resolution flow before replacing a changed document.
- Acceptance criteria:
  - two clients changing different portions of one day do not silently lose either change;
  - same-field conflicts are surfaced with both versions;
  - queued offline/stale writes cannot overwrite a newer revision unnoticed;
  - emulator/E2E tests cover concurrent food additions, quantity edits, exercise changes, and corrections.
- Backlog destination: urgent CalorieTracker synchronization candidate

### F-105: Renaming a saved food through the manager creates a second item instead of renaming it

- Status: validated
- Category: saved-food lifecycle / UX semantics
- Priority: medium
- Confidence: high
- Applies to: saved-food manager edit workflow
- Surface: Edit, staging, and Save Food Item
- Evidence:
  - Edit loads the selected food into the generic staging inputs but does not retain its original document ID;
  - the user is told to modify values and save “to update”;
  - saving derives a new document ID exclusively from the current name;
  - changing the name therefore writes a new document and leaves the original document unchanged.
- User impact: intended renames produce duplicates, stale search results, and ambiguous Recipe Standardizer matches; users must discover and delete the old item manually.
- Root cause: the manager has no explicit edit identity or rename operation.
- Recommendation: retain the original document ID during edit, distinguish update from copy/save-as-new, and implement rename atomically as create-new plus delete-old with collision handling and confirmation.
- Acceptance criteria:
  - ordinary edits update the selected record;
  - rename produces exactly one final record unless the user chooses copy;
  - collisions and linked-recipe implications are displayed before commit;
  - tests cover rename, cancellation, collision, and failed delete after create.
- Backlog destination: CalorieTracker saved-food lifecycle candidate

### F-106: CSV exports do not neutralize spreadsheet formulas in user-controlled cells

- Status: validated source risk; execution depends on spreadsheet application
- Category: export security / CSV injection
- Priority: medium
- Confidence: high
- Applies to: saved-food CSV exports opened in formula-evaluating spreadsheet software
- Surface: food name and other string cells
- Evidence:
  - imported and manually entered food names are user-controlled;
  - CSV export correctly quotes and escapes double quotes but does not neutralize leading `=`, `+`, `-`, `@`, tab, or carriage-return formula markers;
  - CSV import accepts such names and export reproduces them;
  - common spreadsheet applications can interpret these cells as formulas when the CSV is opened.
- User impact: importing an untrusted food CSV and later opening an export can trigger formula execution, external links, or misleading spreadsheet content.
- Root cause: CSV syntactic escaping is treated as equivalent to spreadsheet formula neutralization.
- Recommendation: apply a dedicated safe-cell encoder that prefixes dangerous leading characters while preserving a reversible value, and document the export’s trust boundary.
- Acceptance criteria:
  - dangerous string prefixes open as literal text in supported spreadsheet applications;
  - ordinary names and Unicode round-trip correctly;
  - tests cover whitespace-prefixed formulas, tabs, carriage returns, and JSON-containing cells.
- Backlog destination: CalorieTracker export-security candidate

## Revalidated cross-cutting findings

- F-028/F-046: the static app has substantial custom interaction and remains outside the primary Next.js accessibility and quality pipeline.
- F-032: some fetch operations still convert failures into empty collections, while startup now surfaces core load failures more clearly.
- F-033: production depends on mutable third-party Chart.js, Font Awesome, Google Fonts, and Firebase CDN assets without a local fallback or integrity policy.
- F-043/F-044/F-045: Firestore ownership, authenticated workflows, responsive layout, and accessibility do not have repository-wide emulator/browser gates.
- F-047: failures are console/UI-message based and are not captured by production telemetry.

## Test assessment

The tool has the broadest pure-logic test suite in the repository. Coverage includes:

- entry/profile/goal normalization and migrations;
- food parsing, nutrient clamping, quantity behavior, and import/export helpers;
- exercise MET calculations and activity priority in the shared helper;
- weight CSV formats, date parsing, preferred-window selection, batched behavior, and analysis helpers;
- water correction, TDEE blocks, imputation, true-up, weekday averages, plateau logic, and uncertainty;
- target generation, BMR/TDEE source selection, macro/micronutrient targets, DRI bands, UL warnings, and overrides;
- dashboard/chart data preparation and many correction workflows.

Missing high-value regression coverage includes:

- delayed quantity edit followed by immediate date switching;
- two quantity edits on different days inside one debounce window;
- saved-food slug collisions in manual save and CSV import;
- anonymous-account upgrade and guest-data migration;
- normalized legacy `trainingBump` consistency between dashboard and analysis engine;
- fractional nutrient preservation after estimate removal;
- exact birthday boundaries under fixed timezones;
- concurrent same-day writes from two clients;
- saved-food rename semantics;
- CSV formula neutralization;
- Firestore owner-only rule tests and authenticated browser workflows.

## Runtime validation required later

T26 should verify:

1. the F-098 quantity/date race with artificial network latency and rapid navigation;
2. saved-food collision and import reporting using punctuation/Unicode names;
3. first-visit guest flow, attempted account creation, logout, and data recovery;
4. legacy training-bump days through both dashboard and Energy analysis;
5. estimate removal with fractional nutrient values;
6. birthday calculations under Chicago and non-Chicago browser timezones;
7. two-device edits to the same day;
8. saved-food rename behavior and Recipe Standardizer link consequences;
9. exported formula-like names in Excel, Google Sheets, and LibreOffice;
10. large multi-year datasets, mobile layout, keyboard navigation, and offline/CDN failure behavior.

## Outcome

Nutrition Tracker has a substantial, thoughtfully documented calculation engine and unusually broad pure-function coverage. The remaining risks are concentrated at state and identity boundaries rather than basic arithmetic: delayed global-state persistence can corrupt dates, saved-food IDs can collide, guest accounts cannot be safely upgraded, legacy exercise migration diverges between analysis and display, and concurrent whole-day writes can erase data. Those issues should be corrected before the tracker is treated as a durable multi-device health record.