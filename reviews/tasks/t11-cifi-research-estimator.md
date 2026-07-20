# T11: CIFI Research Estimator Deep Dive

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete single-page tool, including:

- scientific/suffix parsing;
- payout-cycle conversion;
- constant-rate estimate;
- linear, exponential, and logarithmic regression;
- model auto-selection and override behavior;
- analytic/numeric target-time solving;
- history, era baseline, and backtest behavior;
- chart generation, zoom/pan, hover, and cumulative rendering;
- localStorage persistence and corruption handling;
- mobile, keyboard, accessibility, destructive actions, and error states;
- documentation and test coverage.

The tool has no external service or Firebase dependency. All calculations and stored history remain in the browser.

## Positive observations

- The core product goal is understandable and the primary workflow is compact: enter target/rate/timing, log rates over time, then compare constant and growth-adjusted estimates.
- Supported suffixes are visible through an in-product dictionary.
- Inputs reject unknown suffixes and non-positive scientific values.
- Linear and exponential target-time equations correctly distinguish growing, constant, and declining cases at a high level.
- Rate history is timestamped and supports selecting a later modeling era.
- Backtest truncation is conceptually useful for evaluating what an earlier forecast would have shown.
- The chart is dependency-free and supports rate and cumulative views.
- Persistence is namespaced, device-local, and tolerant of localStorage being unavailable.
- The page has a responsive two-column-to-one-column structure and does not depend on server availability.

The primary reliability problem is that the interface presents exploratory curve fitting as a current forecast without sufficiently strong data-state or model-validity controls.

## Calculation trace

### Constant estimate

The constant-rate result is:

`target / ratePerPayout * ticksPerPayout * secondsPerTick`

This is internally consistent when “Target Amount” means the amount still remaining to be earned.

The UI does not explicitly say “remaining amount,” so a user entering a total research requirement rather than remaining research will overstate time. This is a wording/usage ambiguity rather than a proven formula defect.

### Growth estimate

The fitted models estimate payout rate as a function of elapsed wall-clock seconds. The future solver integrates predicted payout rate divided by payout-cycle duration until the requested target amount is accumulated.

This is a reasonable model form, but it assumes:

- recent historical wall-clock growth continues into the forecast horizon;
- no upgrades/resets/regime changes occur unless the user manually sets a new era;
- payout timing remains constant;
- logged points are ordered, valid, and representative;
- the target is remaining amount from “now,” not a total target including existing progress.

Those assumptions need to be explicit in the product and test fixtures.

## Findings

### F-050: Growth projections can ignore the visible current rate and use a stale logged rate

- Status: validated
- Category: correctness / state clarity
- Priority: high
- Confidence: high
- Applies to: current `main`
- Evidence:
  - the constant-rate estimate uses the current parsed `rate` input;
  - once at least two active history points exist, every dynamic solver instead uses `activeHistory[activeHistory.length - 1].rateValue` as the current rate;
  - changing the visible Rate per Payout field does not update the history point or dynamic forecast baseline until the user presses Log Current Rate;
  - the result card does not state which logged point/rate anchors the growth projection;
  - the same page can therefore show a constant estimate based on one rate and a growth estimate based on another.
- Example impact:
  - latest logged rate: 35d;
  - visible current rate: 100d;
  - constant estimate uses 100d;
  - growth estimate starts at 35d while appearing to be the forecast for the current configuration.
- User impact:
  - the primary estimate can be materially stale;
  - comparison and “time saved by growth” become misleading because the two values use different starting rates;
  - users may change the rate specifically to update the forecast and receive no indication that it did not.
- Root cause: current configuration state and model-history state are independent but presented as one coherent calculation.
- Recommendation:
  - make one source authoritative;
  - preferred: require/offer logging the current rate as an explicit timestamped observation and show “forecast anchored at X from [time]”;
  - alternatively, rebase the fitted curve to the current input rate while retaining the fitted growth parameter;
  - mark the growth forecast stale whenever current input differs from the latest active history point.
- Acceptance criteria:
  - the rate displayed as current and the rate used as the forecast starting point are always identical or explicitly differentiated;
  - changing current rate causes a visible stale-model state before recalculation;
  - “time saved” never compares estimates with undisclosed different baselines;
  - unit tests cover current-rate edits with two or more history points, era selection, and backtesting.
- Backlog destination: urgent CIFI correctness candidate

### F-051: Auto model selection is statistically underdetermined and presented with excessive confidence

- Status: validated
- Category: modeling accuracy / decision support
- Priority: high
- Confidence: high
- Applies to: current `main`
- Evidence:
  - forecasting activates with only two points;
  - linear, exponential, and logarithmic models each have two fitted parameters and can interpolate two positive points essentially perfectly;
  - auto-selection compares only in-sample R² and defaults to linear unless another model exceeds it by 0.005;
  - MAPE is displayed but not used for selection;
  - negative R² values are clamped to zero, hiding “worse than the mean” fit quality;
  - no cross-validation, holdout error, horizon penalty, parameter plausibility constraint, or minimum elapsed duration is used;
  - the UI labels the result as a projection and offers “Auto (Choose Best Fit).”
- User impact:
  - two closely spaced manual logs can produce a confident long-horizon forecast even though model family selection is mathematically indeterminate;
  - short-term noise can be extrapolated into enormous time differences;
  - an R² near 100% can be mistaken for forecast accuracy rather than in-sample interpolation quality;
  - users have little basis for choosing an override.
- Root cause: goodness-of-fit statistics are used as forecasting confidence without enough observations or out-of-sample validation.
- Recommendation:
  - keep two points for visualization but do not call the selected curve “best fit” or use it as a trusted forecast;
  - require a minimum number of observations and minimum time span before auto forecasting;
  - use rolling-origin/leave-last-out backtesting once enough points exist;
  - report forecast stability/range across plausible models rather than one precise answer;
  - retain negative R² and explain it;
  - warn when extrapolation horizon greatly exceeds observed history.
- Acceptance criteria:
  - auto forecast is unavailable or explicitly low-confidence with fewer than the documented minimum points/span;
  - identical two-point fits do not imply one model is objectively superior;
  - model selection uses out-of-sample error or a documented complexity-aware method;
  - forecast confidence distinguishes fit quality from extrapolation reliability;
  - tests cover flat, linear, exponential, noisy, regime-change, and very-short-history fixtures.
- Backlog destination: CIFI model-governance candidate

### F-052: The declining logarithmic solver can report reachable targets as impossible

- Status: validated mathematically from source
- Category: calculation defect
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: forced or auto-selected logarithmic model with negative logarithmic slope
- Evidence:
  - `solveLogarithmic` assumes accumulated output is monotonic over its search interval;
  - it first evaluates accumulation at a fixed upper bound of `1e15` seconds and returns Infinity when that value is below target;
  - for a negative logarithmic slope, predicted rate eventually crosses below zero and the un-clamped analytic integral decreases without bound;
  - a target may be reached before the zero-rate point even though accumulation at `1e15` is far below that target;
  - chart rate rendering clamps logarithmic rate to zero, but the solver integrates the negative-rate continuation, so chart and solver use inconsistent model behavior.
- Demonstrative case:
  - current rate 100, logarithmic slope -10 at elapsed time 100 seconds;
  - predicted rate remains positive for roughly 2.22 million additional seconds;
  - maximum reachable accumulation before zero rate is roughly 22.2 million payout-rate-seconds;
  - a target requiring only 1 million is reachable;
  - the current upper-bound check observes the later negative integral and returns Infinity.
- User impact: a valid forced/selected model can display `> 100y` or an effectively impossible result for a target that the same positive-rate curve reaches much earlier.
- Root cause: binary search is applied across a non-monotonic unbounded integral without solving/clamping the zero-rate horizon.
- Recommendation:
  - for negative logarithmic slope, solve the time where predicted rate reaches zero;
  - evaluate maximum accumulation at that point;
  - return Infinity only when the target exceeds that maximum;
  - binary-search only on the monotonic interval `[0, tauZero]`;
  - use the same non-negative rate definition for solver and chart.
- Acceptance criteria:
  - every declining logarithmic fixture correctly distinguishes reachable and unreachable targets;
  - solver and chart integrate the same clamped rate function;
  - boundary tests cover target just below/equal/above maximum accumulation;
  - no negative future payout rate contributes to cumulative output;
  - forced logarithmic mode never reports Infinity solely because the arbitrary far-future upper bound passed the curve's maximum.
- Backlog destination: urgent CIFI calculation candidate

### F-053: Chart zoom/pan can trap page scrolling and enter invalid time domains

- Status: validated by source; device severity requires browser testing
- Category: interaction / mobile / chart correctness
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - the chart installs a non-passive wheel listener and always calls `preventDefault`, converting normal wheel/trackpad scrolling over the chart into zoom;
  - the SVG applies `touch-none`, disabling native touch panning/scrolling while a gesture starts over a large mobile chart region;
  - pointer pan and wheel zoom do not clamp the lower time domain to zero;
  - negative ticks are passed to `formatDuration`, which renders every non-positive value as `0s`;
  - model evaluation clamps negative fit time to zero while axis positions remain negative, producing a repeated/flat pre-history region.
- User impact:
  - desktop users can unexpectedly lose vertical page scrolling over the chart;
  - mobile users may be unable to scroll the page when touching the chart;
  - panning left can produce multiple misleading `0s` labels and meaningless pre-baseline space;
  - there is no keyboard or reset-zoom control.
- Root cause: exploratory pointer gestures were implemented without coexistence rules for page navigation or bounded chart-domain state.
- Recommendation:
  - require an explicit modifier or chart-control mode for wheel zoom, or provide visible zoom controls;
  - allow vertical page scrolling and use a narrower `touch-action` policy;
  - clamp domain start to zero and define a finite maximum;
  - provide Reset view and keyboard-accessible pan/zoom controls;
  - expose a textual chart summary/table.
- Acceptance criteria:
  - normal wheel/touch gestures can scroll the page;
  - chart interaction is intentional and discoverable;
  - time domain never becomes negative;
  - all chart functions are keyboard-operable or have equivalent controls;
  - mobile Safari/Chrome and desktop trackpad tests pass.
- Backlog destination: CIFI chart UX candidate

### F-054: Persisted and parsed numeric state is not schema-validated or bounded

- Status: validated
- Category: resilience / data validation
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - `useStickyState` accepts any valid JSON value and casts it to the expected type without validation/version migration;
  - a valid but malformed stored history value can cause `.length`, `.findIndex`, `.slice`, `.map`, or timestamp/rate calculations to throw or become NaN;
  - scientific parsing accepts arbitrary exponents and marks the input valid before verifying the calculated value is finite;
  - values such as `1e309` produce Infinity but remain `valid: true`;
  - stored history points are not checked for finite positive rate, finite timestamp, unique ID, or chronological ordering;
  - model overrides and baseline IDs are trusted from storage.
- User impact:
  - corrupted, manually edited, or older-version localStorage can crash the page or produce nonsensical forecasts;
  - non-finite inputs can propagate into results and SVG coordinates;
  - there is no visible recovery path except clearing storage externally or Reset if the page still renders.
- Root cause: persistence catches JSON parse failures but does not validate successful parses.
- Recommendation:
  - replace per-key casts with one versioned stored-state object and a pure parser;
  - validate/clamp every field and history point;
  - reject non-finite calculated values and cap supported exponents/horizons;
  - sort or reject non-monotonic timestamps;
  - preserve recoverable valid fields and show a non-blocking reset notice.
- Acceptance criteria:
  - malformed JSON, wrong-shaped JSON, Infinity, NaN-equivalent strings, duplicate IDs, reversed timestamps, unknown model values, and deleted baseline points never crash the page;
  - unsupported magnitudes receive a clear validation error;
  - migrations are deterministic and tested;
  - one-click reset recovers from every invalid stored state.
- Backlog destination: CIFI persistence/resilience candidate

### F-055: Core estimator math and workflow have no dedicated tests

- Status: validated
- Category: test coverage / correctness assurance
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Evidence:
  - the entire parser, regressions, solvers, model selection, storage hook, chart calculations, and UI reside in one page file;
  - no CIFI test file was discovered;
  - the correctness defects in F-050 and F-052 are deterministic cases that unit tests should catch;
  - current functions are not exported or separated for focused testing.
- User impact: formula changes, suffix additions, browser-state changes, and chart refactors can silently change estimates.
- Root cause: the tool was implemented as a self-contained page prototype rather than a tested calculation module plus UI.
- Recommendation:
  - extract parser, model fitting, model selection, integration/solvers, stored-state parsing, and chart-domain helpers into pure modules;
  - add fixture-based and property-based tests;
  - add a small browser workflow test for log, baseline, backtest, reset, and reload.
- Acceptance criteria:
  - suffix/e-notation parser tests include bounds and non-finite values;
  - analytic solvers are checked against numerical integration across growing/flat/declining cases;
  - model-selection tests cover insufficient and noisy histories;
  - F-050/F-052 regressions have permanent tests;
  - storage and complete user workflow are covered.
- Backlog destination: CIFI test candidate; aligns with F-044/F-049

## Accessibility and UX revalidation

The CIFI page independently reproduces shared issues already recorded:

- configuration labels are not associated with input IDs;
- validation text is not connected through `aria-describedby`/`aria-invalid`;
- chart tabs expose selected state only visually;
- the delete-history-point icon button has no explicit accessible name;
- the suffix modal lacks dialog semantics, focus containment, Escape handling, and focus restoration;
- chart information is hover/vision dependent and has no tabular/text equivalent;
- Reset All and Clear History execute immediately without confirmation or undo;
- history has no export/import, so device loss or browser clearing removes the only modeling record.

These are covered by F-023 through F-027 and should be implemented using shared primitives rather than CIFI-only fixes.

## Product recommendations

### Clarify the estimate contract

The primary labels should answer:

- Is Target Amount the remaining amount or total goal?
- Is Rate per Payout the current observed rate or a hypothetical rate?
- Which historical observation anchors the projection?
- How much history and elapsed time support the model?
- How far beyond the observed period is the estimate extrapolating?

### Prefer ranges over false precision

A useful decision view would show:

- constant-rate estimate;
- plausible-model range;
- selected central estimate;
- data span and sample count;
- holdout/backtest error;
- explicit low/medium/high confidence;
- warning when a reset/upgrade likely created a new regime.

### Make backtesting measurable

The current simulation truncates history but does not compare its forecast to the later observed points. A stronger workflow would:

1. choose a cutoff;
2. fit only pre-cutoff points;
3. predict later logged rates or cumulative output;
4. calculate actual forecast error;
5. compare models over multiple cutoffs.

This would produce evidence for model choice rather than only an illustrative past-view mode.

## Next task

`T12. Transcriber`
