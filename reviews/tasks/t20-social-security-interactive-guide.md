# T20: Social Security Interactive Guide Deep Dive

Completed: 2026-07-14  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete static interactive guide at `public/tools/social-security/index.html`, including:

- the personalized assumptions for claiming age, full retirement age, monthly benefit, PIA, retirement month, and earnings;
- the first-year monthly earnings-rule simulator;
- the annual retirement earnings-test simulator and Chart.js output;
- the full-retirement-age adjustment estimate;
- the 2027 pre-FRA earnings-limit explanation and COLA language;
- the federal Social Security taxability and rough income-tax calculator;
- navigation, responsive behavior, accessibility, external dependencies, source governance, and updateability;
- current official SSA and IRS guidance as of July 2026.

## Current workflow trace

1. The page opens as a static guide with six visual tabs.
2. “The Basics” states one fixed user profile: FRA 67, benefits started before FRA, and a one-month payment lag.
3. The 2025 simulator applies a fixed $1,950 monthly threshold to September through December and treats each check as entirely paid or withheld.
4. The 2026 simulator applies a fixed $23,400 annual threshold, calculates $1 withheld for every $2 above it, and displays exact annual benefits received versus withheld.
5. The 2027 panel divides total withheld dollars by a fixed $1,300 monthly check, rounds to months, and removes that many early-claim reduction months from a fixed $1,500 PIA.
6. The tax calculator assumes a single filer, computes combined income from wages, other taxable income, and half of benefits, estimates taxable benefits, subtracts a fixed $15,000 standard deduction, and applies selected 2025 brackets.
7. All calculations are browser-local and no data is saved.

## Strong design decisions

- The guide breaks a difficult topic into concept-focused sections and immediate examples.
- Inputs update results instantly without collecting personal information or requiring an account.
- The annual earnings-test chart makes the withholding tradeoff visually understandable.
- The guide distinguishes earnings-test withholding from permanent forfeiture.
- It correctly explains that earnings limits disappear beginning with the month full retirement age is reached.
- It correctly excludes common pension and investment income from the retirement earnings test.
- It includes an informational-only tax disclaimer.

## Findings

### F-107: The guide now publishes obsolete earnings-test limits as operative rules

- Status: validated
- Category: financial guidance / stale legal parameters
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: 2026 annual simulator, 2027 pre-FRA explanation, labels, and calculated results
- Evidence:
  - the page hardcodes the 2026 under-FRA annual limit as `$23,400` and describes it as an estimate;
  - SSA’s current 2026 limit is `$24,480`;
  - the page describes a 2027 year-of-FRA limit of `$62,160` before that year’s official figure is available, while the current 2026 year-of-FRA limit is `$65,160`;
  - the page contains no “data current as of” date, source links, or stale-data guard.
- User impact:
  - the simulator overstates withheld 2026 benefits for earnings between $23,400 and $24,480 and for all earnings above the true limit;
  - a user may make work or cash-flow decisions using a projected 2027 threshold presented inside an otherwise authoritative guide;
  - the yearly labels make stale figures appear intentionally current.
- Root cause: annually indexed government parameters are embedded directly in a static page with no update contract or source metadata.
- Recommendation:
  1. Update 2026 to the official `$24,480` and `$65,160` values.
  2. Do not publish a 2027 number as operative until SSA announces it; label projections clearly and isolate them from calculations.
  3. Add official SSA source links, effective year, last-reviewed date, and a prominent stale-year warning.
  4. Move yearly constants into a documented data object with tests and an annual review owner.
- Acceptance criteria:
  - every active year matches current SSA figures;
  - future estimates cannot be mistaken for official limits;
  - stale-year detection disables or warns on calculations;
  - boundary tests cover exactly at, $1 below, and $1 above each threshold.
- Backlog destination: urgent Social Security guide accuracy candidate

### F-108: The tax calculator can materially misstate federal tax while appearing personalized

- Status: validated
- Category: tax calculation correctness / scope disclosure
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: “Will My Benefits Be Taxed?” calculator
- Evidence:
  - the calculator silently assumes single filing status and uses only the `$25,000` and `$34,000` single-filer provisional-income thresholds;
  - it omits tax-exempt interest from combined income, even though that is part of the federal Social Security tax worksheet;
  - it subtracts only a fixed `$15,000` standard deduction and does not model the additional age-65 deduction or other currently applicable senior provisions;
  - it does not ask whether the user is married, lived with a spouse while filing separately, itemizes, has qualified deductions, or has other taxable income categories;
  - it computes a final dollar “Estimated Federal Tax,” not merely taxable Social Security, which amplifies the apparent precision.
- User impact:
  - married, married-filing-separately, age-65+, tax-exempt-interest, itemizing, and deduction-eligible users can receive materially wrong taxability and tax-bill estimates;
  - a server or tipped worker can see a tax estimate that ignores relevant current-law treatment;
  - the small disclaimer does not identify the omitted inputs or the assumed filing profile.
- Root cause: a narrow illustrative worksheet is presented as a general tax calculator without collecting the variables required for a federal tax estimate.
- Recommendation: either remove the tax-bill estimate and limit the tool to a clearly scoped provisional-income illustration, or implement filing status, age, spouse-living-apart rules, tax-exempt interest, current deductions, current brackets, and explicit tax-year versioning from official IRS instructions.
- Acceptance criteria:
  - the calculator states its filing status, tax year, assumptions, and exclusions before showing a result;
  - unsupported filing situations are blocked or routed to official IRS tools;
  - combined income includes all required worksheet inputs;
  - test fixtures reconcile to official IRS examples and current Form 1040/SSA worksheet logic.
- Backlog destination: urgent Social Security tax-calculation candidate

### F-109: The ARF “payback” calculation converts withheld dollars into rounded months and can produce a false permanent increase

- Status: validated algorithmic defect
- Category: benefit recomputation accuracy
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: 2027 & Beyond adjustment estimate
- Evidence:
  - the page sums theoretical withheld dollars and divides by a fixed `$1,300` benefit;
  - it rounds that ratio to the nearest whole month;
  - SSA adjusts for months in which benefits were actually withheld, while annual-test administration may withhold whole checks and later return a residual amount;
  - the page does not model which checks SSA would withhold, later residual payments, partial entitlement months, family benefits, or the actual entitlement record;
  - the result is presented as an exact permanent monthly increase and new FRA benefit.
- Example: a theoretical `$800` annual deduction on a `$600` monthly benefit can lead SSA to withhold two checks and later return `$400`; simple dollar/month rounding does not reproduce the entitlement-month record reliably.
- User impact: the page can overstate or understate the permanent FRA adjustment and imply that every withheld dollar directly buys a proportional benefit increase.
- Root cause: benefit-withholding cash flow and reduction-factor entitlement months are treated as the same quantity.
- Recommendation: do not calculate ARF from dollars alone. Require actual months withheld from the SSA record or model SSA’s check-withholding sequence explicitly, label residual repayments separately, and route users to their `my Social Security` estimate for authoritative recomputation.
- Acceptance criteria:
  - fractional withheld-dollar cases cannot be rounded into unsupported entitlement months;
  - residual repayments are separated from permanent recomputation;
  - scenarios reconcile to official SSA examples;
  - the output is labeled an illustration unless based on actual withheld-month records.
- Backlog destination: urgent Social Security recomputation candidate

### F-110: The first-year monthly simulator omits eligibility conditions and self-employment work tests

- Status: validated
- Category: retirement earnings-test rules / misleading simplification
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: 2025 monthly-rule simulator and explanatory text
- Evidence:
  - the page says the user gets a check for any month earnings are `$1,950 or less`;
  - the special monthly rule applies only in a qualifying grace year, usually the first retirement year;
  - a month must be considered retired, and substantial services in self-employment can disqualify it even when earnings are below the dollar threshold;
  - the simulator collects only wages/tips and has no grace-year or self-employment inputs.
- User impact: self-employed users or users outside the one-year special-rule window can be told a check is payable when the monthly rule does not apply.
- Root cause: the threshold is modeled as a universal monthly eligibility rule instead of one condition inside a limited exception.
- Recommendation: add an eligibility gate, retirement/grace-year explanation, self-employment-hours questions, and a clear “not covered by this simulator” result where facts are insufficient.
- Acceptance criteria:
  - the simulator cannot run without confirming the special rule applies;
  - substantial-services cases are handled or explicitly excluded;
  - official SSA examples are reproduced;
  - later years default to the annual test, not the monthly rule.
- Backlog destination: Social Security monthly-rule accuracy candidate

### F-111: The annual simulator presents theoretical reduction as exact cash received

- Status: validated
- Category: payment timing / cash-flow accuracy
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: 2026 annual chart and summary
- Evidence:
  - the calculator subtracts the formula deduction directly from 12 months of benefits and labels the remainder “Benefits Received”;
  - SSA commonly withholds whole monthly checks until the required deduction is met and later pays any excess amount withheld;
  - the guide does not show which checks would be withheld, timing of resumed payments, or a later residual payment;
  - the displayed fractional annual amount is therefore not necessarily the cash received during that calendar year.
- User impact: users can plan monthly cash flow around an annual total and payment pattern SSA will not actually use.
- Root cause: statutory deduction amount and administrative payment timing are collapsed into one exact annual-receipt value.
- Recommendation: distinguish “required earnings-test reduction” from “estimated checks withheld,” simulate whole-check withholding and residual reconciliation, and avoid claiming exact receipt timing without SSA-specific inputs.
- Acceptance criteria:
  - statutory reduction, checks withheld, payments resumed, and residual later payment are separately displayed;
  - official SSA examples reconcile exactly;
  - the chart cannot label a theoretical net as exact received cash.
- Backlog destination: Social Security cash-flow candidate

### F-112: A personalized scenario is presented as a general guide without editable identity assumptions

- Status: validated
- Category: scope / personalization transparency
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: all sections
- Evidence:
  - constants fix FRA at 67, start age at 65, PIA at `$1,500`, monthly benefit at `$1,300`, and FRA month at September 2027;
  - the copy repeatedly uses “your” and the Tools page describes a general learning simulator;
  - users cannot edit birth date, claiming month, benefit amount, PIA, filing status, or year;
  - FRA is not 67 for every birth year and the early-retirement reduction formula differs when more than 36 months early.
- User impact: visitors can reasonably interpret results as applicable to them even though the page is one person’s fixed scenario.
- Root cause: an originally personalized explanatory artifact was published in the general tools catalogue without a profile boundary.
- Recommendation: either label the page prominently as a fixed example for a specified birth/claim scenario or collect the minimum facts needed to generate user-specific rules and dates.
- Acceptance criteria:
  - the scenario owner/profile is explicit before any “your” language;
  - incompatible users are not shown personalized conclusions;
  - editable mode derives FRA and reduction rules from birth date and claim date;
  - tests cover FRA schedules and claims more than 36 months early.
- Backlog destination: Social Security scope and personalization candidate

## Revalidated cross-cutting findings

- F-014: the page uses extensive Tailwind utility classes but loads only `shared-styles.css`; most layout, color, spacing, and responsive classes are not defined by the repository’s static stylesheet and require live visual confirmation.
- F-028: tab buttons lack complete tab roles, selected-state semantics, keyboard navigation, controlled-panel relationships, and announced dynamic results.
- F-033: Chart.js and Google Fonts are loaded from mutable third-party CDNs without local fallback or integrity control.
- F-046: the static guide has no automated calculation, DOM, accessibility, or link-validation tests.
- F-047: runtime errors or failed CDN loads have no production telemetry or user-facing recovery state.

## Additional observations

- Several strings contain Markdown `**bold**` syntax inside HTML paragraphs, so the asterisks display literally.
- The range input has no synchronized numeric entry, limiting precise boundary testing and keyboard efficiency.
- Negative numeric inputs are not constrained and can create nonsensical income/tax states.
- Dynamic results use color heavily and are not exposed through `aria-live` regions.
- The guide links no official source directly and does not identify who maintains the annual constants.

## Test assessment

No dedicated tests were found for this guide. High-value coverage should include:

- official annual/monthly thresholds and stale-year detection;
- first-year-rule eligibility and self-employment substantial-services cases;
- whole-check withholding and residual repayment examples;
- withheld-month ARF examples and claims more than 36 months early;
- filing status, age, tax-exempt interest, and official taxable-benefit worksheet cases;
- negative, blank, decimal, extreme, and exact-boundary inputs;
- keyboard tab behavior, live-region announcements, chart fallback, and narrow-viewport layout;
- offline/CDN-failure behavior.

## Runtime validation required later

T26 should verify:

1. live styling at desktop and approximately 390 px width;
2. keyboard and screen-reader operation of all tabs and dynamic outputs;
3. exact SSA examples for annual withholding, first-year monthly rules, and later recomputation;
4. current tax-year results against IRS worksheet examples;
5. Chart.js failure and slow-network behavior;
6. boundary inputs and negative/invalid values.

## Outcome

The guide has a useful educational structure, but its most decision-relevant figures and calculations are not safe to treat as current individualized guidance. The 2026 earnings limit is obsolete, the 2027 limit is an unsupported projection, the tax calculator omits required profile and income variables, and the ARF estimate conflates withheld dollars with actual withheld entitlement months. Until those issues are corrected, the page should be labeled as a dated fixed example rather than a current Social Security planning tool.
