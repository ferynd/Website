# T21: Social Security Calculator Deep Dive

Completed: 2026-07-15  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the complete current static Social Security Financial Planner, including:

- age-65, age-66, and age-67 claiming-strategy inputs;
- benefit COLA, general inflation, spending, other income, and investment-return assumptions;
- simple and advanced annual cash-flow modes;
- nominal and inflation-adjusted balance calculations;
- crossover detection and month-level break-even labels;
- treatment of negative balances;
- input bounds and failure behavior;
- chart rendering, keyboard/screen-reader behavior, CDN dependencies, and test coverage;
- consistency with the separate Social Security guide and current SSA retirement rules.

Current SSA rules were checked against official SSA material, including:

- [Starting Your Retirement Benefits Early](https://www.ssa.gov/benefits/retirement/planner/agereduction.html);
- [Benefits for people born in 1960 or later](https://www.ssa.gov/benefits/retirement/planner/1960.html);
- [Receiving Benefits While Working](https://www.ssa.gov/benefits/retirement/planner/whileworking.html).

## Current workflow trace

1. The user selects a projection end age, inflation and COLA rates, and three manually entered monthly benefit amounts for claiming at 65, 66, or 67.
2. Optional common annual spending, common annual extra income, and a common investment return can be enabled.
3. Advanced mode allows age-specific spending, income, and return assumptions.
4. For each claiming strategy, the model starts a balance at zero at age 65.
5. At each integer age, the previous balance receives the selected return, then a full annual Social Security benefit plus common income minus common spending is added.
6. A second balance series uses a real return and deflates each annual cash flow into age-65 dollars.
7. The tool finds the first annual interval where age 66 exceeds age 65 and where age 67 exceeds age 66, linearly interpolates within that interval, and reports the result to a month.
8. Both nominal and inflation-adjusted charts display account-balance lines and break-even summaries.

## Strong design decisions

- Nominal and inflation-adjusted views are separated clearly.
- The real-return formula `(1 + nominal return) / (1 + inflation) - 1` is correct.
- Simple and advanced annual assumptions are separated without hidden persistence to a backend.
- Advanced values are cached when switching modes.
- Chart interaction is immediate and recalculation is debounced.
- The implementation uses a linear age axis and explicit crossover annotations rather than relying only on visual line inspection.
- Input labels and custom switches are generally keyboard reachable.
- Benefit amounts are user-editable rather than falsely deriving a personalized entitlement from insufficient earnings-history data.

## Findings

### F-113: Spending and other income cannot affect claiming break-even despite being presented as strategy inputs

- Status: validated
- Category: financial-model correctness / misleading interaction
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: spending, extra-income, advanced cash-flow inputs, both break-even panels, and explanatory copy
- Evidence:
  - every claiming strategy receives the same spending and extra-income amount for a given year;
  - pairwise strategy differences therefore cancel those common cash flows exactly;
  - the same common return multiplier is then applied to each strategy difference;
  - the inflation-adjusted strategy difference is the nominal difference divided by the same common deflator, so nominal and real crossover ages must also be identical;
  - the UI nevertheless says break-even points can differ when investment returns or spending/income are enabled and devotes separate nominal and real summary cards to them.
- User impact:
  - users can spend substantial effort entering detailed spending or income scenarios that cannot change the claiming recommendation shown by the break-even cards;
  - the interface suggests a more integrated retirement-planning model than the algebra actually implements;
  - identical nominal and real break-even outputs can look like independent confirmation rather than the same comparison expressed in different units.
- Root cause: all non-benefit cash flows are strategy-independent, so they change absolute balances but not relative claiming-strategy balances.
- Recommendation:
  1. State explicitly that common spending and income affect projected solvency only, not claiming break-even.
  2. Remove the claim that nominal and real crossovers may differ under the current model.
  3. Either show one crossover result or add genuinely strategy-dependent effects such as earnings-test withholding, taxes, Medicare premiums, or different portfolio withdrawals.
  4. Add algebraic invariant tests proving which inputs may and may not change crossover ages.
- Acceptance criteria:
  - the UI accurately distinguishes absolute-balance assumptions from claiming-strategy assumptions;
  - changing a common cash-flow input does not imply a changed break-even unless the implemented model makes it strategy-dependent;
  - nominal and real crossover summaries are not presented as independent results when they are mathematically identical;
  - tests cover common and strategy-specific cash-flow cases.
- Backlog destination: urgent Social Security calculator modeling candidate

### F-114: The benefit inputs have no valuation-date contract, so COLA can bias early-versus-late claiming

- Status: validated model ambiguity; deterministic error when inputs are same-date or today's-dollar estimates
- Category: benefit modeling / COLA correctness
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: monthly benefit inputs, COLA setting, all projected balances, and break-even ages
- Evidence:
  - the tool asks only for monthly benefits at ages 65, 66, and 67, with no indication whether they are age-65 dollars, current dollars, or future nominal amounts at each claiming date;
  - COLA begins only after each strategy starts receiving benefits;
  - therefore the age-65 input receives two COLAs by age 67 while the age-67 input receives none before its first modeled payment;
  - the default values resemble same-basis early-retirement reduction amounts rather than independently inflated future nominal checks.
- User impact:
  - entering all three values from one SSA estimate screen or in today's dollars can systematically advantage the early strategy;
  - entering future nominal values can be valid, but the tool gives no instruction allowing the user to know which interpretation is expected;
  - break-even ages can shift materially based solely on an undocumented unit convention.
- Root cause: benefit amount and valuation date are modeled as one scalar even though COLA requires a common base date or explicit per-strategy nominal dates.
- Recommendation:
  1. Define one supported contract: preferably all benefit estimates in today's dollars at a stated base date.
  2. Apply COLA consistently from that base date to every strategy, including years before claiming.
  3. Alternatively, let users mark each amount as a future nominal amount and disable pre-claim COLA for that mode.
  4. Display a worked example and test both modes.
- Acceptance criteria:
  - every benefit input states its dollar year;
  - equivalent same-basis inputs produce the same results regardless of whether they are entered as real or converted nominal values;
  - COLA is never applied to one strategy over a period omitted from another strategy without an explicit reason;
  - regression tests cover zero COLA, same-date estimates, and future nominal estimates.
- Backlog destination: urgent Social Security calculator benefit-basis candidate

### F-115: Work income does not trigger the retirement earnings test before full retirement age

- Status: validated
- Category: Social Security rule correctness / early-claiming comparison
- Priority: high
- Confidence: high
- Applies to: users entering wages or self-employment income while claiming before FRA
- Surface: Extra Annual Income, advanced yearly income, age-65/66 strategy benefits, and break-even results
- Evidence:
  - extra income is added directly to every strategy balance;
  - the model does not ask whether income is wages, self-employment profit, pension, or investment income;
  - it never reduces benefits for excess earned income before FRA;
  - SSA states that benefits may be reduced when a beneficiary is under FRA and exceeds the annual earnings limit, with a separate rule in the year FRA is reached;
  - the same earnings may later increase the worker's benefit if they replace a lower earnings year, which is also not modeled or disclosed.
- User impact:
  - early-claim scenarios can be materially overstated for a person who continues working;
  - the very input most likely to represent continued employment is treated as beneficial cash without its Social Security consequence;
  - break-even results can favor claiming earlier when actual checks would be withheld.
- Root cause: generic retirement cash flow and Social Security entitlement rules are combined without income classification.
- Recommendation:
  1. Split other income into earned income and non-earned income.
  2. Ask for birth year/FRA and calendar years so official earnings-test rules can be applied or clearly estimated.
  3. At minimum, warn and disable authoritative break-even language when earned income is entered before FRA.
  4. Link to the official SSA earnings-test calculator for final validation.
- Acceptance criteria:
  - earned income above applicable limits reduces modeled pre-FRA benefits or produces a blocking limitation warning;
  - pensions and investment income are not incorrectly subjected to the earnings test;
  - the FRA-year rule uses only earnings before the FRA month;
  - tests cover under-FRA, FRA-year, post-FRA, earned, and unearned income scenarios.
- Backlog destination: urgent Social Security calculator earnings-test candidate

### F-116: An annual lump-sum model reports month-level break-even precision and full first-year benefits

- Status: validated
- Category: time-resolution correctness / false precision
- Priority: high
- Confidence: high
- Applies to: all crossover summaries
- Surface: annual benefit timing and `Age Xy Ym` labels
- Evidence:
  - the model has only integer-age observations;
  - a strategy receives a full 12 months of benefits as soon as the loop reaches its starting age;
  - returns are applied once at the beginning of each modeled year and all cash flows are added as one annual amount;
  - crossover months are produced by linear interpolation between two annual ending balances;
  - no birth month, claiming month, payment timing, or monthly cash-flow schedule exists;
  - SSA entitlement and reduction calculations operate by month, including special treatment for birthdays on the first of a month.
- User impact:
  - the displayed month can imply decision precision the model does not contain;
  - partial first years and payment timing can move the true crossover by months;
  - the result can be quoted as a specific age even though it is only an interpolation of annual lumps.
- Root cause: presentation precision exceeds model resolution.
- Recommendation: calculate monthly from an explicit birth/claim month and monthly benefits, or report only an approximate whole-year range and label the annual timing convention prominently.
- Acceptance criteria:
  - month-level output is backed by monthly cash flows;
  - first and final partial years use the correct number of benefit months;
  - claiming eligibility and birthday-month rules are documented;
  - tests compare monthly results with analytically solvable no-return cases.
- Backlog destination: urgent Social Security calculator time-resolution candidate

### F-117: The calculator restricts strategy selection to ages 65, 66, and 67 without establishing the user's FRA

- Status: validated
- Category: claiming-strategy completeness / personalization
- Priority: medium
- Confidence: high
- Applies to: public tool usage outside its unstated original scenario
- Surface: strategy set and benefit inputs
- Evidence:
  - `startAges` is hard-coded to `[65, 66, 67]`;
  - no birth year, FRA, or claim month is collected;
  - SSA allows retirement claims beginning at 62 and delayed retirement credits through age 70;
  - FRA varies by birth year, and survivor-benefit FRA can differ from retirement-benefit FRA.
- User impact:
  - the tool excludes many common strategies, including 62, 64, 68, 69, and 70;
  - age 67 is not universally FRA;
  - a generic public user can interpret a scenario-specific comparison as a complete claiming analysis.
- Root cause: a calculator built around one person's three candidate ages is presented as a general planner.
- Recommendation: either label the tool as a narrow 65/66/67 custom comparison or collect birth year and support any valid monthly claim age from 62 through 70.
- Acceptance criteria:
  - the supported population and strategy range are explicit;
  - FRA is derived from official birth-year rules when used;
  - users can compare the claiming ages material to their situation;
  - benefit inputs remain tied to the selected claim ages.
- Backlog destination: Social Security calculator scope candidate

### F-118: “Total Account Balance” is actually a zero-start cumulative cash-flow balance

- Status: validated
- Category: financial semantics / solvency interpretation
- Priority: medium
- Confidence: high
- Applies to: both charts and all spending/income scenarios
- Surface: chart titles, y-axis meaning, and opening state
- Evidence:
  - every strategy balance is initialized to zero;
  - there is no opening savings, investment balance, pension asset, or debt input;
  - the chart is titled “Total Account Balance” rather than cumulative modeled surplus/shortfall;
  - common spending can drive the line negative even though no source account or borrowing facility is modeled.
- User impact:
  - users may read the plotted amount as projected net worth or retirement-account solvency;
  - absolute values are not meaningful for a person with existing assets or liabilities;
  - a negative value has no defined financial interpretation.
- Root cause: a marginal cash-flow accumulator is labeled as a complete account.
- Recommendation: rename it to cumulative modeled surplus/shortfall, or add an opening balance and define which account pays deficits and receives surpluses.
- Acceptance criteria:
  - the chart title matches the mathematical quantity;
  - an account-balance mode includes opening assets and explicit cash-flow timing;
  - negative balances have a documented financing assumption;
  - help text distinguishes strategy comparison from full retirement solvency.
- Backlog destination: Social Security calculator financial-semantics candidate

### F-119: Negative balances earn the selected investment return as though debt and investments have the same rate

- Status: validated
- Category: financial-model correctness / negative-balance handling
- Priority: medium
- Confidence: high
- Applies to: scenarios where cumulative spending exceeds benefits and income
- Surface: simple and advanced investment-return modes
- Evidence:
  - the implementation deliberately multiplies every balance by `1 + earnRate`, including negative balances;
  - a positive “Investment Return” therefore makes a negative balance more negative;
  - no borrowing rate, credit cost, cash floor, liquidation constraint, or separate asset/debt state exists.
- User impact:
  - absolute shortfall projections can be materially distorted;
  - a portfolio return is silently repurposed as a borrowing APR once the balance crosses zero;
  - comparisons may appear financially realistic while mixing incompatible economic assumptions.
- Root cause: one scalar balance and one rate represent both invested assets and financed deficits.
- Recommendation: prevent balances below zero in an investment-only model, or model assets and debt separately with explicit borrowing assumptions.
- Acceptance criteria:
  - positive investment returns are not automatically applied to debt;
  - crossing zero produces a defined behavior or clear warning;
  - advanced scenarios can specify financing costs when negative balances are allowed;
  - tests cover positive, zero, and negative balances under positive and negative returns.
- Backlog destination: Social Security calculator balance-model candidate

### F-120: HTML input limits are not enforced by the calculation layer

- Status: validated source risk; exact browser interactions require runtime validation
- Category: validation / resilience
- Priority: medium
- Confidence: high
- Applies to: all numeric inputs
- Surface: projection generation and chart updates
- Evidence:
  - min/max attributes exist in markup, but `getInputs` reads raw values without checking validity or clamping;
  - `maxAge` is used directly to create an array length;
  - benefit, inflation, COLA, spending, income, and return values can be inconsistent or out of the displayed bounds if typed, pasted, scripted, or restored by the browser;
  - no inline error state blocks recalculation.
- User impact:
  - invalid ages can throw or produce empty projections;
  - negative benefits or extreme rates can create plausible-looking but nonsensical charts;
  - a browser constraint violation does not necessarily prevent JavaScript from using the value.
- Root cause: presentation constraints are treated as domain validation.
- Recommendation: validate and normalize a typed input object before calculation, show field-level errors, and preserve the last valid result instead of recalculating with invalid state.
- Acceptance criteria:
  - calculation functions accept only validated bounded inputs;
  - invalid fields have associated, announced error messages;
  - charts never receive NaN, Infinity, or invalid array lengths;
  - boundary and malformed-input tests cover every field.
- Backlog destination: Social Security calculator validation candidate

## Important scope limitations not currently modeled

The current tool is a deterministic gross-cash-flow comparison, not a complete claiming optimizer. It does not model:

- federal or state taxes on benefits and other income;
- Medicare premiums or IRMAA;
- spousal, divorced-spouse, survivor, disability, or family benefits;
- mortality probabilities, health, bequest goals, or risk tolerance;
- benefit recomputation from continued covered earnings;
- suspension, withdrawal, deemed filing, or retroactive-claim rules;
- sequence-of-returns risk or stochastic investment outcomes.

These omissions are not individually defects if the tool is labeled narrowly, but the current “Financial Planner” framing and lack of a prominent limitation statement make them important to disclose.

## Revalidated cross-cutting findings

- F-014/F-028/F-046: the page uses a large Tailwind-style static utility surface and custom interactions outside the primary Next.js validation pipeline.
- F-026: chart and summary changes are not announced through a live region.
- F-033: Chart.js, the annotation plugin, and Google Fonts are loaded from mutable third-party CDNs without a local fallback or integrity policy.
- F-045: canvas charts and responsive behavior lack automated browser/accessibility testing.
- F-047: runtime calculation failures are not captured by production telemetry.
- F-049: no dedicated test suite covers the calculator's financial functions.

## Test assessment

No dedicated tests were found for the Social Security calculator. High-value coverage should include:

- analytically solvable zero-return break-even cases;
- proof that common cash flows cancel from strategy differences;
- proof that nominal and real crossover signs are identical under the current common-deflator model;
- consistent COLA treatment for today's-dollar and future-nominal inputs;
- monthly first-year and crossover timing;
- earnings-test withholding before FRA and in the FRA year;
- negative-balance behavior;
- birth-year/FRA boundaries and claim ages 62 through 70;
- malformed and out-of-range inputs;
- keyboard, screen-reader, narrow-screen, and CDN-failure behavior.

## Runtime validation required later

T26 should verify:

1. default and edge-case output against an independent spreadsheet or script;
2. spending/income invariance and nominal/real crossover identity;
3. same-basis versus future-nominal COLA scenarios;
4. a working-before-FRA scenario against SSA's official earnings-test calculator;
5. monthly versus annual break-even error magnitude;
6. negative balances under positive investment returns;
7. out-of-range typing, paste, and browser restoration behavior;
8. mobile table/chart overflow, keyboard switches, and screen-reader announcements;
9. behavior when either CDN dependency is unavailable.

## Outcome

The calculator's basic compounding and inflation formulas are internally coherent, and the editable benefit inputs avoid pretending to calculate a personalized entitlement from no earnings history. However, its claiming-strategy decision support is materially weaker than its “Financial Planner” framing. Common spending and income cannot influence break-even, COLA basis is undefined, earned income does not trigger the retirement earnings test, annual cash flows are presented with month-level precision, and negative balances are treated as investments. The tool should not be used as authoritative claiming guidance until those modeling boundaries are corrected or prominently constrained.