# T08: Performance, Resilience, and Browser Compatibility

Completed: 2026-07-10  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed source-level behavior for:

- external API request lifetimes, retries, fallbacks, and cancellation;
- Firebase listener errors, stale/empty-state handling, and concurrent writes;
- multi-document consistency and retry safety;
- static third-party script/font dependencies;
- Nutrition Tracker service-worker caching;
- large media/image handling and browser API assumptions;
- route/component failure containment;
- performance-sensitive list, timeline, chart, and static-page patterns.

Network traces, bundle sizes, Core Web Vitals, memory profiles, browser compatibility runs, and deployed-provider timeout behavior require T26 live validation.

## Positive performance and resilience controls

- Next.js uses `next/font`, avoiding a runtime Google Fonts dependency for the React shell.
- React catalogue pages and most tools use straightforward responsive layouts without obviously excessive animation or rendering loops.
- Transcriber validates upload limits on both client and server, preprocesses oversized recordings, caps concurrency, supports retry/resume caches, sanitizes upstream errors, and preserves successful chunks after partial failure.
- Trip Planner and Date Night compress uploaded images and use hash-based filenames.
- Trip Planner stores events and ideas as separate Firestore documents rather than growing one itinerary document indefinitely.
- Recipe Standardizer validates stored recipes again on load and treats nutrition matching as optional rather than blocking the core workflow.
- Several Firestore helper layers accept explicit listener error callbacks.
- Nutrition Tracker's service worker precaches its local application shell, caches an exact Chart.js version opportunistically, uses stale-while-revalidate behavior for same-origin resources, and excludes Firebase/analytics endpoints from synthetic caching.
- Global React CSS honors reduced-motion preferences.

## Findings

### F-030: Outbound API requests have no explicit timeout or cancellation budget

- Status: validated
- Category: reliability / performance / cost control
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - shared Gemini request helper;
  - OpenAI transcription route and its clip retry/fallback calls;
  - Firebase signing-key retrieval;
  - Transcriber status checks and Gemini file lifecycle;
  - Show Tracker AI/metadata calls.
- Evidence:
  - repository search found no `AbortController` or `AbortSignal.timeout` usage;
  - `callGemini` performs an unbounded `fetch` and waits for body parsing;
  - the OpenAI transcription route can issue the primary request, a known-speaker retry, and a Whisper fallback sequentially, each without a request deadline;
  - Firebase JWKS retrieval is cached but the cache miss request has no timeout;
  - client status requests similarly have no cancellation when components unmount or the user retries.
- User impact:
  - a slow or half-open upstream can leave the interface in an indeterminate running state until the browser, provider, edge platform, or network stack eventually aborts;
  - sequential fallback paths can multiply total wait time and edge resource use;
  - users may retry manually, producing concurrent duplicate provider work and cost;
  - provider/platform timeouts can surface as generic failures with no stage-specific recovery guidance.
- Root cause: requests rely on implicit infrastructure timeouts rather than a shared operation-level deadline contract.
- Recommendation:
  1. Add a shared timeout/cancellation wrapper for server and client requests.
  2. Define separate budgets for small metadata/status calls, model generation, file upload/activation, and transcription.
  3. Propagate client cancellation where possible and stop scheduling fallback work after cancellation.
  4. Retry only explicitly retryable failures, with bounded exponential backoff and jitter.
  5. Preserve stage/provider/model context in timeout errors without leaking secrets or transcript content.
- Acceptance criteria:
  - every external request has a documented finite deadline;
  - aborts are classified separately from provider rejection;
  - user cancellation prevents new chunks/fallbacks and does not corrupt resume state;
  - retries are bounded, status-aware, and observable;
  - tests cover hung fetches, timeout during upload, timeout during response body, fallback after timeout, and component unmount.
- Backlog destination: shared API resilience plus Transcriber/Shows follow-up

### F-031: Trip Cost uses non-transactional whole-array writes for shared financial data

- Status: validated
- Category: data integrity / concurrency / scalability
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: `app/tools/trip-cost/TripContext.tsx`
- Evidence:
  - participants, expenses, and payments are stored as arrays on one trip document;
  - add/update/delete operations derive a complete replacement array from the listener's current client-side snapshot;
  - writes use `setDoc(..., { merge: true })` but replace the entire array field;
  - no Firestore transaction, version precondition, atomic array operation suitable for object edits, or conflict detection is used;
  - the tool is explicitly collaborative and multiple participants can operate concurrently.
- User impact:
  - two users adding expenses at nearly the same time can each write an array based on the same prior snapshot, causing the later write to erase the earlier expense;
  - concurrent edits/deletes/payments can resurrect or overwrite data;
  - balances and settlement suggestions can silently become incorrect;
  - every mutation rewrites the complete financial history and approaches Firestore's document-size/write-amplification limits as the trip grows.
- Root cause: a prototype-friendly embedded-array document model was retained after the tool became a shared multi-user application.
- Recommendation:
  - migrate participants, expenses, payments, and audit entries to subcollections with one document per record;
  - use transactions/batches for coupled invariants and derived metadata;
  - preserve stable IDs and provide a migration/backfill path;
  - avoid persisting derived balances that can be calculated from authoritative records;
  - add concurrency tests using two simulated clients.
- Acceptance criteria:
  - concurrent additions from two clients both persist;
  - edit/delete conflicts are detected or resolved deterministically;
  - no ordinary mutation rewrites unrelated history;
  - historical trips migrate without balance changes;
  - settlement calculations pass before/after migration fixtures;
  - Firestore rules enforce record-level participant/admin permissions.
- Backlog destination: urgent Trip Cost data-model candidate; revalidate in T17 and T24

### F-032: Several real-time data failures are hidden or rendered as valid empty state

- Status: validated
- Category: reliability / error recovery
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative surfaces:
  - Date Night;
  - Trip Cost;
  - Trip Planner;
  - Show Tracker.
- Evidence:
  - Date Night creates five Firestore listeners without error callbacks;
  - Trip Cost's trip and audit listeners omit error callbacks;
  - Trip Planner's low-level watchers return errors by passing `null`/empty arrays, but `PlanContext` callbacks ignore the error argument and accept those values as ordinary state;
  - Show Tracker listener failures are written to `console.error`, while the UI receives an empty/stopped state without a persistent user-facing error or retry state;
  - stronger error propagation already exists in Conflict Tracker and Recipe Standardizer, demonstrating that the failure is inconsistent rather than unavoidable.
- User impact:
  - permission, missing-index, expired-auth, offline, quota, and transient backend failures can look like “no data,” “not found,” or an empty list;
  - users may create replacement records, repeat work, or assume collaborators deleted content;
  - stale data can remain visible without an offline/error indicator;
  - support diagnosis depends on opening developer tools.
- Root cause: contexts model data and loading state but do not consistently model listener health, last successful synchronization, or retryability.
- Recommendation:
  - standardize a listener state model: loading, ready, stale/offline, recoverable error, authorization error;
  - preserve last-known data on transient failures instead of replacing it with empty arrays;
  - surface concise retry/re-auth/index guidance;
  - log structured error category and affected query without sensitive content;
  - add emulator tests that force permission-denied, unavailable, and missing-index errors.
- Acceptance criteria:
  - listener errors never masquerade as a valid empty collection;
  - transient failures preserve and label last-known data;
  - authorization failures prompt the correct account/action;
  - each affected tool exposes retry or automatic reconnection state;
  - tests verify all listener error callbacks reach the UI state model.
- Backlog destination: cross-tool Firebase resilience candidate

### F-033: Critical static-tool functionality depends on mutable third-party CDN scripts without a fallback

- Status: validated
- Category: availability / supply-chain resilience / performance
- Priority: high
- Confidence: high
- Applies to: current `main`
- Affected surfaces:
  - Social Security guide;
  - Social Security calculator;
  - Nutrition Tracker charts and icons/fonts;
  - Chicago itinerary's external Chart.js include.
- Evidence:
  - Social Security guide loads an unversioned `chart.js` package URL;
  - Social Security calculator pins only major versions (`chart.js@4`, annotation plugin `@3`) and immediately calls `Chart.register` in the document head;
  - no external script uses Subresource Integrity;
  - no local fallback or guarded feature initialization is present;
  - calculator scripts instantiate charts directly, so a blocked/failed CDN can throw and halt subsequent calculator initialization;
  - Nutrition Tracker is better protected by exact-version service-worker caching, but first installation still depends on successful external retrieval and its Google Fonts/Font Awesome resources are not part of the explicit runtime cache list.
- User impact:
  - privacy blockers, enterprise filters, CDN outages, DNS failures, or upstream package changes can partially or completely disable financial calculations/charts;
  - major-only or unversioned URLs can change behavior without a repository commit or review;
  - third-party compromise or accidental incompatible release expands the production supply-chain surface.
- Root cause: static prototypes load browser-ready dependencies directly instead of using the repository's package/build pipeline or vendored immutable assets.
- Recommendation:
  - self-host or bundle exact dependency versions as repository/build artifacts;
  - eliminate unversioned and major-only production URLs;
  - gracefully initialize non-chart calculator functionality when chart rendering is unavailable;
  - provide visible dependency-load errors rather than failing silently;
  - define CSP/SRI strategy in T09 for any unavoidable third-party resources.
- Acceptance criteria:
  - maintained tools remain functional with third-party CDNs blocked;
  - dependency upgrades occur only through reviewed lockfile/repository changes;
  - chart load failure produces a clear degraded state and does not stop calculations;
  - offline/PWA tests cover first install and subsequent launches;
  - no critical production script is loaded from a mutable URL.
- Backlog destination: static-platform/dependency candidate; security aspects revalidated in T09

### F-034: Multi-document workflows can leave partial state and are not retry-idempotent

- Status: validated
- Category: data integrity / resilience
- Priority: high
- Confidence: high
- Applies to: current `main`
- Representative workflows:
  - Date Night candidate acceptance;
  - Show Tracker list deletion and invite processing;
  - Conflict Tracker reflection save/delete flows;
  - Trip Planner event/idea mutation plus parent timestamp/audit entry.
- Evidence:
  - Date Night increments date and modifier counters sequentially before creating the accepted roll document;
  - a failure after any increment leaves counters changed without the corresponding accepted roll, and retrying can increment them again;
  - Show Tracker deletes child show documents and then the list without a batch/transaction;
  - Conflict Tracker writes a reflection and then separately updates the conflict's presence flag, and deletes reflections before the conflict document;
  - Trip Planner writes an event, separately updates the planner timestamp, then appends an audit entry; a late failure can make the action appear failed after the primary mutation committed.
- User impact:
  - counters, status flags, audit logs, and parent/child records can disagree;
  - retrying after an ambiguous failure can duplicate records or counters;
  - cleanup may require direct database repair;
  - users cannot know whether an operation that reported failure actually committed partially.
- Root cause: logically single actions span multiple Firestore writes without a batch, transaction, server-side idempotency key, or compensating-recovery design.
- Recommendation:
  - use Firestore transactions/write batches where all documents fit the same atomic operation;
  - for operations exceeding batch/security constraints, use an idempotent workflow record with a stable operation ID and resumable state machine;
  - distinguish primary mutation failure from secondary audit/metadata failure;
  - make destructive cascades recoverable and observable.
- Acceptance criteria:
  - forced failure at every step either commits the whole logical operation or leaves a detectable/resumable state;
  - retrying the same operation ID is safe;
  - Date Night counters cannot advance without one accepted-roll record;
  - list/conflict deletes cannot silently strand partially deleted children;
  - primary successful actions are not reported as wholly failed solely because an audit write failed;
  - emulator tests inject failures between every write.
- Backlog destination: cross-tool data-integrity candidate; detail in tool deep dives

## Performance and compatibility risks deferred to tool reviews

### Transcriber memory and browser APIs

Long-audio preprocessing decodes entire recordings into browser memory before chunk encoding. The current architecture deliberately uses mono 16 kHz and per-chunk rendering to reduce peak usage, but multi-hour inputs can still require hundreds of megabytes. T12 must profile:

- peak memory on representative desktop browsers;
- tab crashes/reload behavior;
- Web Audio decode compatibility for common phone containers;
- MediaRecorder, IndexedDB, clipboard, and AudioContext capability failures;
- cancellation cleanup and object lifetime.

### Large-list and document growth

- Show Tracker subscribes to all shows in the active list and filters/sorts client-side.
- Date Night subscribes to full roll history and full pools.
- Japan itinerary embeds a large operational dataset and renders dense tables client-side.
- Recipe Standardizer stores each complete recipe in one document, currently reasonable but requiring a practical size guard.

Deep dives should define expected maximum records and pagination/virtualization thresholds before these become defects.

### Error boundaries and observability

No route-level `error.tsx` boundary was discovered. Framework defaults may recover at navigation boundaries, but tool-specific recovery, telemetry, and user-safe reset behavior should be addressed in T10 rather than duplicated here.

### Static images and layout stability

Representative static pages use images without systematic intrinsic dimensions or lazy loading. F-014 currently prevents reliable rendering analysis; T22/T23/T26 should measure transfer size, cumulative layout shift, and below-the-fold loading once the static CSS strategy is known.

## Live validation required

- Lighthouse/Web Vitals for representative public and authenticated routes;
- production bundle analysis and route-level JavaScript transfer;
- throttled-network provider calls and deadline behavior;
- Firestore emulator concurrency and injected-failure tests;
- offline/online transitions and first-install PWA behavior;
- Safari/iOS and Firefox compatibility for Web Audio, pointer capture, IndexedDB, clipboard, and `Intl` time-zone formatting;
- memory profiles for 30-minute, 90-minute, and 3-hour audio;
- static tools with CDN hosts blocked.

## Next task

`T09. Security and privacy architecture`
