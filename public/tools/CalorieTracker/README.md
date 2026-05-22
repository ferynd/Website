# Rolling Balance Nutrition Tracker

A Firebase-backed, client-side nutrition tracker built with plain JavaScript ES modules and Chart.js. Runs as a standalone static app under `/public/tools/CalorieTracker/` and is linked from the main site's Tools page.

> **Active improvement work:** See [`IMPROVEMENTS.md`](./IMPROVEMENTS.md) for the prioritized punch list (45 items across security, math accuracy, mobile UX, accessibility, and code structure) with per-item completion tracking and suggested session groupings for Claude Code agents.

---

## Purpose and user workflows

- **Log daily food** — search a personal food database, enter nutrients manually, or paste a block of text for automatic parsing into individual items.
- **Track full nutrition** — macros (calories, protein, carbs, fat), 10 daily-floor micronutrients, 9 averaged micronutrients, fiber, omega-3, and choline.
- **Log exercise** — add detailed sessions (activity type, duration, intensity, optional distance/steps/wearable calories) or use a quick day-level activity selector.
- **Analyze energy** — upload a weight CSV, view empirical TDEE and rest-day estimates, fill missing days, mark vacation ranges, and apply underreporting adjustments.
- **Generate targets** — enter body metrics and a goal, press Auto-Calculate, review the generated targets and warnings, pin any nutrient to a manual override, and apply.
- **Export data** — download daily logs as CSV, saved foods as CSV, or targets as JSON.

---

## Tab structure

| Tab | Content |
|---|---|
| **Today** | Date picker, Day Activity Level quick-select, exercise session list, food item input with database dropdown, food items log, paste-and-parse (collapsible), manual nutrient staging (collapsible), and a compact macro summary bar in the app header |
| **Nutrients** | Status summary grid, filter chip bar, per-nutrient progress rows (daily floors shown every day; fat-soluble vitamins and stored minerals shown as 7-day rolling averages), UL warning badges, source badges, and a multi-series Chart.js chart with chip-based nutrient selection |
| **Energy** | Weight CSV upload area, TDEE/BMR KPI cards, confidence level, imputation table, plateau status, missing-day population tool, vacation range fill tool, underreporting true-up tool, and estimate management (lock / remove individual estimates) |
| **Profile & Goals** | Manual weight override, body metrics (sex, birth date or age, height, body fat %), baseline activity level, goal type (fat loss / maintenance / recomp / muscle gain / performance / custom), target weight and date, Auto-Calculate button, target preview with warnings, per-nutrient manual override checkboxes, and Apply / Save Profile buttons |
| **Settings** | Manual baseline target fields for every nutrient, export buttons (targets JSON, saved foods CSV, daily log CSV), Save Targets button |

---

## File / module map

```
CalorieTracker/
├── index.html              # App shell: tab panels, modals, nav
├── main.js                 # Entry point: imports, Firebase auth, app startup
├── styles.css              # Tracker-specific utility CSS (loaded after shared-styles.css)
├── firebaseConfig.js       # Firebase project keys (excluded from version control)
├── config.js               # App-level config: appId, chart colors, debug flag
├── constants.js            # Nutrient lists, DAY_ACTIVITY_LEVELS, BANKING_CONFIG, DEFAULT_TARGETS, nutrientMap
│
├── state/
│   ├── store.js            # Global state object and DOM cache (state.{userId, dailyEntries, ...})
│   └── schema.js           # Pure normalization: normalizeEntry, normalizeUserProfile, normalizeGoalSettings, prepareXForSave
│
├── services/
│   ├── firebase.js         # Firebase init + all Firestore/Auth CRUD functions
│   └── data.js             # Orchestrates data load, food item rendering, exercise session helpers
│
├── events/
│   └── wire.js             # Attaches DOM event listeners (buttons, inputs, tab switches)
│
├── ui/
│   ├── dashboard.js        # Today tab dashboard + Nutrients tab rendering + tab controller
│   ├── chart.js            # Chart.js multi-series nutrient chart (chip selection, timeframe)
│   ├── modals.js           # Confirmation modal and duplicate food dialog helpers
│   └── nutrientHelpers.js  # resolveWeightKg, computeTrendDirection, classifyTargetSource
│
├── analysis/
│   ├── engine.js           # TDEE/BMR estimation, EWMA smoothing, water-weight correction, imputation, plateau
│   ├── analysisUI.js       # Renders Energy tab: KPIs, weight chart, fill/vacation/true-up tools
│   ├── weightParser.js     # Parses Withings/Garmin/Apple Health weight CSV formats
│   └── weightUpload.js     # Handles CSV file input, calls parser, calls saveWeightEntriesBatch
│
├── targets/
│   ├── targetEngine.js     # Pure auto-target calculator (calories, macros, all micronutrients)
│   ├── nutritionReferences.js  # DRI tables, UL table, PAL multipliers, RMR formulas
│   └── targetUI.js         # Profile & Goals tab wiring: form read/write, override grid, apply flow
│
├── food/
│   ├── dropdown.js         # Food name autocomplete dropdown
│   ├── manager.js          # Food database modal: view, edit, delete saved foods
│   └── save.js             # Save food item to Firestore (duplicate detection, blank-name flow)
│
├── staging/
│   └── parser.js           # Paste-and-parse: extracts nutrient values from free-form text
│
├── exports/
│   └── exporters.js        # CSV and JSON export helpers
│
└── utils/
    ├── ui.js               # showMessage, handleError, debugLog, formatNutrientName
    └── time.js             # getTodayInTimezone, getPastDate, formatDate
```

Test files (`*.test.js`) live alongside their subjects and run via Vitest.

---

## Static app architecture

The tracker is a browser-native ES module app — no bundler is required to run it. Firebase is imported from the ESM CDN (`gstatic.com/firebasejs/11.x`). Vite is available as a dev server and for test running but is not needed in production.

**Startup sequence:**
1. `main.js` imports all modules in parallel via `Promise.all`.
2. `cacheDom()` stores frequently accessed DOM nodes in `state.dom`.
3. `ensureDateInput()` sets the date picker to today.
4. `wire()` attaches all event listeners.
5. Firebase `onAuthStateChanged` fires; if a user is present, `loadUserData()` fetches all Firestore collections in parallel and populates the UI.
6. If no user is present, the app attempts anonymous sign-in automatically.

---

## Firebase collections

All data lives under `artifacts/${appId}/users/{userId}/`. `appId` is exported from
`config.js` and resolves to `window.__app_id` when that global is set (Canvas / hosted
environment) or falls back to `'default-app-id'` for local development.

| Collection / path | Contents |
|---|---|
| `targets/baseline` | Baseline nutrient target map |
| `dailyEntries/{YYYY-MM-DD}` | Per-day entry (see schema below) |
| `foodItems/{foodId}` | Saved food item with nutrient values |
| `weightEntries/{docId}` | Weigh-in reading from CSV upload |
| `profile/userProfile` | Body metrics and baseline activity level |
| `goals/goalSettings` | Goal type, target weight/date, manual overrides |

---

## Daily entry schema (v2)

```js
{
  // Metadata
  date: 'YYYY-MM-DD',
  schemaVersion: 2,
  entryType: 'logged' | 'estimate' | 'vacation' | 'mixed',

  // Nutrient totals (sum of all food items × quantity)
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  // ... all other nutrient keys from constants.allNutrients

  // Food items
  foodItems: Array<{
    id: string,           // stable UUID
    name: string,
    quantity: number,     // multiplier (e.g. 2 = double the per-unit values)
    calories: number,     // per-unit values
    protein: number,
    // ... all other nutrient keys
    timestamp: string,    // ISO date of addition
  }>,

  // Exercise
  exerciseSessions: Array<{
    id: string,
    activityType: string,    // key from ACTIVITY_TYPES
    durationMin: number,
    intensity: 'easy' | 'moderate' | 'hard' | 'very_hard',
    rpe?: number,
    distanceValue?: number,
    distanceUnit?: 'km' | 'mi',
    steps?: number,
    wearableCalories?: number,
    manualCalories?: number,
    notes?: string,
  }>,
  dayActivityLevel: 'rest' | 'light' | 'medium' | 'heavy' | 'custom' | null,

  // Estimate metadata (null for fully logged days)
  estimateMeta: null | {
    method: string | null,
    modelVersion: string | null,
    confidence: string | null,
    sourceDataWindow: string | null,
    createdAt: string,
    updatedAt: string,
    locked: boolean,
    previousEstimate: number | null,
  },
  manualLock: boolean,       // when true, auto-fill skips this day

  // Vacation / partial adjustment
  vacationDayType: string | null,
  calorieAdjustmentItems: Array,

  // Legacy field preserved for old clients
  trainingBump: number,      // only present on pre-v2 entries
}
```

**Schema backward compatibility:** `normalizeEntry()` (in `state/schema.js`) upgrades any stored document to v2 shape in memory without writing back. The original `trainingBump` field is mapped to `dayActivityLevel` in memory only; it is never removed from Firestore unless the user explicitly saves the day.

---

## Weight upload behavior and CSV import

- `analysis/weightParser.js` auto-detects Withings, Garmin, and Apple Health export formats by inspecting the header row. Generic CSVs with a date column and a weight column also work.
- Weights are converted to lbs internally. The parser records `originalUnit` for reference.
- `saveWeightEntriesBatch()` (in `services/firebase.js`) uses Firestore batched writes in chunks of 450 documents to stay within the 500-operation batch limit. Re-uploading the same CSV is idempotent — document IDs are derived from the timestamp so existing docs are overwritten.
- Local state (`state.weightEntries`) is updated inline after each batch; no full refetch is needed.

---

## Exercise calorie priority

For each session in `exerciseSessions`, the calorie estimate follows this priority:

```
manualCalories > wearableCalories > MET-based estimate
```

MET values come from the 2024 Compendium of Physical Activities. The formula is:

```
kcal = MET × intensity_scale × body_weight_kg × duration_hours
```

The bump values for `dayActivityLevel` are:

| Level | Bump |
|---|---|
| rest | 0 kcal |
| light | +100 kcal |
| medium | +200 kcal |
| heavy | +350 kcal |
| custom | 0 kcal (sessions provide the value) |

**Priority order** (`getEntryExerciseKcal` in `exercise/met.js`):

1. `exerciseSessions` (non-empty) → sum of all session estimates.
2. Positive legacy `trainingBump` → the exact stored number is used as-is.
   `normalizeEntry()` may derive a `dayActivityLevel` from it in memory, but that
   derivation is lossy (e.g. 280 → medium = 200, 400 → heavy = 350), so the original
   field is always preferred over the derived level.
3. `dayActivityLevel` → bump from the table above, only when no positive `trainingBump` exists.

---

## Nutrition target engine overview

`targets/targetEngine.js` runs a pure function `generateTargets(profile, goals, analysisResults)`:

1. Resolves body weight (manual override > smoothed upload > profile).
2. Computes RMR via Mifflin-St Jeor (sex + age + height + weight) or Cunningham (lean mass, when body fat % is provided).
3. Applies the PAL multiplier for baseline activity level to get formula TDEE.
4. Applies goal-specific calorie adjustments (deficit for fat loss, surplus for muscle gain, etc.).
5. If empirical TDEE from the analysis engine is available at sufficient confidence, it replaces the formula estimate.
6. Sets protein by g/kg body weight (goal-specific rates: 2.2 g/kg for fat loss/recomp, 1.6–1.8 g/kg for other goals).
7. Enforces the fat floor (`fatMinimum`, default 50 g).
8. Fills remaining calories with carbohydrates.
9. Looks up DRI micronutrient targets using age and sex bands.
10. Applies any `manualTargetOverrides` stored in goal settings.
11. Checks micronutrients against the UL table and returns a `warnings` array.

---

## Energy model overview and limitations

The analysis engine (`analysis/engine.js`) is designed for gradual fat-loss tracking where weigh-ins and food logs are both available. Key behaviors:

- EWMA smoothing (span 10, α ≈ 0.18) removes day-to-day scale noise before computing weight change rate.
- OLS regression on predictor variables (sodium, carbs) estimates water-weight held on high-intake days; corrections are capped at ±2 lb.
- Multi-horizon TDEE estimates (14, 28, 42, 56 days) let the engine detect whether recent intake has shifted.
- A grid search constrains empirical TDEE to a plausible PAL range so extreme outliers (illness, data gaps) do not blow up the estimate.

**Known limitations:**
- The engine requires at least 14 weight + calorie days for a rough estimate; accuracy improves significantly above 42 days.
- Vacation entries and estimated days are excluded from TDEE regression to avoid circular feedback.
- The water-weight regression needs 20+ days with complete sodium/carb data to activate; below that, a bucket-based correction is used.
- The model assumes a roughly stable body composition goal. Aggressive muscle-building or extreme deficit phases produce noisier estimates.

---

## Missing calories, vacation days, and estimate locking/removal

- **Missing-day fill** (`getBlankDaysForPopulation`): identifies past days that have weight data but no calorie log, then fills them with an empirical estimate derived from surrounding data.
- **Vacation-range fill** (`buildVacationDayEntry`): fills a date range with a configurable vacation-type calorie estimate (maintenance, light surplus, or explicit kcal).
- **Underreporting true-up** (`buildPartialDayAdjustment`): identifies days where logged calories appear too low relative to weight evidence, and adds a synthetic adjustment item.
- **Synthetic food items** have names like `"Day's estimate"`, `"Estimated vacation day"`, or `"Unlogged intake estimate"`, and IDs prefixed with `est-`, `vac-`, or `adj-`.
- **Locking**: `manualLock: true` / `estimateMeta.locked: true` prevents the auto-fill logic from overwriting an estimate the user has manually adjusted.
- **Removal**: `removeEstimateItem()` in `services/firebase.js` removes a single synthetic food item without touching real logged foods. Nutrient totals are recomputed from the remaining items.

---

## Nutrients tab behavior

- **Daily floors** (fiber, potassium, magnesium, sodium, calcium, choline, B12, folate, vitamin C, B6): tracked against the daily target every day.
- **Averaged nutrients** (fat-soluble vitamins A/D/E/K, stored minerals selenium/iodine/phosphorus/iron/zinc, omega-3): compared against targets using a 7-day rolling average.
- **UL warnings** (`.nt-badge-ul`): shown when a daily value or rolling average exceeds the Tolerable Upper Intake Level from the DRI tables.
- **Source badges**: `.nt-badge-override` (📌 manually pinned target — user explicitly set a value in overrides), `.nt-badge-custom` (✏️ custom target — the saved target differs from the DRI/default; set by the goal engine or a manual settings save), `.nt-badge-scale` (⚡ exercise-scaled electrolyte suggestion for Na/K/Mg on high-activity days). DRI/default targets show no badge.
- **Chart**: multi-series Chart.js line chart with chip-based nutrient selection. Selected chips survive tab and date changes (stored in module-level `_chartState`). Selecting no chips clears the chart data so no stale lines remain visible.
- **Filter chips**: filter the nutrient list by category (Macros, Vitamins, Minerals, Optional). Chips state is preserved across re-renders via module-level `_nutrientFilter`.

---

## Local test and build commands

Run from `public/tools/CalorieTracker/`:

```bash
npm test          # run Vitest test suite (303 tests across 6 files)
npm run dev       # start Vite dev server at localhost:5173
npm run build     # Vite production build (optional — the app runs directly as static files)
npm run preview   # preview the Vite build
```

Vitest is installed at the repo root (`node_modules/.bin/vitest`). Run `npm install` at the repo root if the binary is missing.

---

## Manual smoke-test checklist

- [ ] Load the page → spinner shown → guest sign-in → main content appears
- [ ] Login / Sign Up modal → email login → user status shows email
- [ ] Date picker → change to a past date → food items and dashboard update
- [ ] Paste & Parse (collapsible) → paste multi-food text → parse → staged values appear
- [ ] Add food (+) → item appears in food list → totals update → macro header updates
- [ ] Subtract food (−) → negative item appears → totals decrease
- [ ] Inline quantity input → change qty → totals update → debounced save (400 ms)
- [ ] Remove food item (×) → confirmation modal → item removed → totals update
- [ ] Save Food Item → saved to database → staging area preserved
- [ ] Food Manager → Manage button → list appears → edit / delete work
- [ ] Day Activity Level → select Medium → calorie target adjusts in dashboard
- [ ] Add Exercise Session → modal → fill fields → live estimate updates → Save → session listed
- [ ] Edit exercise session → pre-filled modal → save → updated
- [ ] Remove exercise session → gone from list → dashboard updates
- [ ] Nutrients tab → filter chips → chart chip selection → chart renders
- [ ] Energy tab → weight CSV upload → progress shown → KPIs appear
- [ ] Energy tab → Fill Missing Days → confirmation → estimates saved
- [ ] Energy tab → Vacation Fill → date range → saves vacation entries
- [ ] Energy tab → Remove estimate → synthetic item removed
- [ ] Profile & Goals → fill body metrics → Auto-Calculate → targets preview with warnings → Apply
- [ ] Settings → manual target override → Save Targets → reloads correctly
- [ ] Export → Daily Log CSV → Targets JSON → Saved Foods CSV
- [ ] Logout → login modal shown → re-login → data restored
- [ ] Mobile (390px) → no horizontal scroll → touch targets usable → modals fit screen

---

## Known limitations

- No offline support. The app requires a live Firebase connection; data does not cache to IndexedDB or localStorage beyond what the Firebase SDK handles internally.
- The duplicate-food dialog uses a plain HTML table with hardcoded color classes that render as unstyled on some themes — cosmetic only, functionality is unaffected.
- The weight analysis engine requires at least 14 days of paired weight + calorie data for any estimate; results below 28 days should be treated as rough guides.
- Guest (anonymous) users' data is tied to the browser session. Signing out as a guest permanently loses all data unless the account is upgraded to email/password before sign-out (not currently implemented).
- The CSV importer covers Withings, Garmin, and Apple Health export formats. Other smart scale exports may need manual column mapping.
