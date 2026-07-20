# T13: Show Tracker and Recommender Deep Dive

Completed: 2026-07-11  
Reviewed `main`: `548d952daf9bb6bd4035d66bf8fcca234f8651f1`

## Scope

Reviewed the merged Show Tracker implementation, including:

- Firebase authentication, list creation, membership, invitations, roles, and display-name propagation;
- real-time list/show subscriptions and active-list persistence;
- show CRUD, statuses, watchers, progress, notes, per-member ratings, composite scores, filters, sorting, batch updates, and review queue;
- title classification and metadata resolution across TMDb, AniList, Jikan, TVMaze, and optional Gemini title expansion;
- season checks and stored metadata-source identifiers;
- recommendation eligibility, viewer-profile construction, deterministic pre-scoring, prompt construction, Gemini response parsing, respins, and status updates;
- current unit coverage and overlaps with the previously recorded security, authorization, timeout, and observability findings.

## Workflow trace

### Lists and membership

1. Firebase Auth establishes the current user and local profile.
2. The client subscribes to lists whose `memberUids` contain the user.
3. Invitations are stored by normalized email in `pendingInvites`.
4. A signed-in matching user listens for invitations, attempts to append their membership to the target list, then deletes the invitation.
5. The selected list ID is stored in localStorage and drives the show subscription.
6. Administrators can invite, remove, and promote members; users can leave lists.

### Show tracking

1. The client subscribes to shows for the selected list ordered by `updatedAt`.
2. Members can add and edit show metadata, watcher assignments, status/progress, notes, and ratings.
3. Ratings contain story, characters, vibes, rewatch interest, and per-viewer brain-power estimates.
4. A member composite is the arithmetic mean of story, characters, and vibes only when all three exist.
5. Group score is the equal-weight mean of all complete member composites.
6. Review completeness requires the three scored fields plus `wouldRewatch`; brain power is context-only.

### Classification and season checks

1. Single and batch workflows call `/api/classify` with title, optional explicit type hint, and stored model choice.
2. Deterministic metadata sources are attempted before optional Gemini expansion/resolution.
3. Resolved source/provider IDs are stored on the show for future season checks.
4. `/api/seasons` checks TV/cartoon records against TMDb; anime is intentionally excluded because provider season/cour modeling is not reliably one-to-one.

### Mood recommendation

1. The user selects who is watching, describes a shared and/or per-person mood, and optionally filters rewatches, watching status, or animation.
2. Candidate eligibility includes Watching, Planned, On Hold, and relevant rewatchable Completed shows.
3. Viewer profiles are built from every rated or noted show for each present member.
4. Deterministic pre-scores estimate brain-power fit, vibe fit, and historical rating fit.
5. The client sends the full filtered candidates, full viewer profiles, mood text, exclusion IDs, and chosen model to `/api/recommend`.
6. Gemini returns one candidate ID and a reason; the route verifies the ID belongs to the supplied candidate set.
7. Respins exclude earlier IDs. “Use this” changes only a Planned result to Watching.

## Strong design decisions

- The data model separates per-person notes and ratings rather than forcing shared judgments.
- Dot-notation writes for a member's note/rating reduce avoidable concurrent map overwrites.
- Watcher-aware candidate tiers and rewatch-interest checks are explicit and well tested.
- Brain-power estimates are evaluated per viewer; one tired viewer's constraint is not diluted by another viewer's normal focus.
- The recommendation prompt clearly states that mood fit can outweigh raw score.
- Recommendation output is constrained to a candidate ID supplied by the client and validated after model output.
- Classification avoids treating the form's default type as an intentional user hint.
- Metadata source IDs support deterministic season checks rather than repeatedly asking an LLM.
- Unit tests cover recommendation eligibility, preference bands, prompt content, pre-scoring, scoring, classification behavior, concurrency helpers, review completeness, and season checks.

## Existing cross-cutting findings that directly apply

- **F-030:** external metadata and Gemini requests lack explicit timeout/cancellation budgets.
- **F-032:** listener failures are logged but frequently rendered as ordinary empty state.
- **F-034:** multi-document workflows such as list deletion and membership changes are not atomic or retry-idempotent.
- **F-035:** Show Tracker AI routes are publicly callable with paid server credentials.
- **F-037:** Firestore rules do not fully preserve membership and actor-specific invariants.
- **F-040:** recommendations transmit personal ratings, notes, moods, and descriptions to Gemini with inadequate minimization/disclosure.
- **F-044/F-047:** no authenticated end-to-end suite or production observability verifies these workflows.

## Findings

### F-065: Switching lists retains the previous list's recommendation state and action target

- Status: validated
- Category: functional defect / stale state
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `/tools/shows/mood`
- Evidence:
  - the active-list effect resets only `presentUids`;
  - `sharedMood`, per-person `moods`, `result`, `excludedIds`, `used`, and filter state remain unchanged when `activeList.id` changes;
  - `result` stores the complete old-list `Show` object;
  - `useThis()` calls the shared `updateShow(result.show.id, ...)` without verifying that the result belongs to the current active list;
  - list selection is available globally while the mood page remains mounted.
- User impact:
  - a recommendation card from list A can remain visible after switching to list B;
  - clicking “Use this” can change an old list-A show to Watching while the user believes they are operating in list B;
  - old member moods and exclusion history can influence a new list's recommendation session.
- Root cause: recommendation-session state is page-local but not keyed or reset by list identity.
- Recommendation:
  1. Clear all recommendation-session state whenever `activeList.id` changes.
  2. Store `listId` with the recommendation result.
  3. Refuse mutations when `result.listId !== activeList.id` or the current show subscription no longer contains the result.
- Acceptance criteria:
  - switching lists removes the prior result, errors, exclusions, and per-person mood entries;
  - an action can never mutate a show from a non-active list;
  - a component test covers switching lists with a visible Planned recommendation.
- Backlog destination: Show Tracker reliability candidate

### F-066: Invitation processing deletes invitations after any failed membership update

- Status: validated
- Category: reliability / collaboration
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: `ShowsContext` pending-invite processing
- Evidence:
  - both the sign-in processor and live invitation listener wrap the membership `updateDoc` in a broad catch;
  - after any caught failure, they still attempt to delete the invitation;
  - the catch does not distinguish already-a-member/list-deleted outcomes from temporary network, permission, quota, or backend failures;
  - failures are silent to both inviter and invitee.
- User impact:
  - a valid invitation can disappear without adding the user;
  - the inviter sees no actionable failure and must recreate the invite manually;
  - intermittent backend or rules deployment issues become permanent invitation loss.
- Root cause: invitation acknowledgement is not conditional on a verified terminal outcome.
- Recommendation:
  1. Delete the invite only after membership succeeds or after an explicit read/transaction confirms the user is already a member or the list no longer exists.
  2. Preserve failed invites with retry metadata and surface an actionable error.
  3. Consolidate the duplicated invite-consumption implementation into one idempotent helper.
- Acceptance criteria:
  - simulated transient membership-write failure leaves the invite available for retry;
  - successful and already-member cases remove the invite exactly once;
  - duplicate listeners cannot add duplicate member records;
  - failures are visible to the invitee and observable to maintainers.
- Backlog destination: Show Tracker collaboration candidate

### F-067: Recommendation cost and reliability have no prompt-size budget

- Status: validated
- Category: AI cost / scalability / reliability
- Priority: high
- Confidence: high
- Applies to: current `main`
- Surface: viewer-profile construction, recommendation request, and Gemini prompt
- Evidence:
  - `buildViewerProfiles` iterates every show for every present member and retains every rated or noted entry;
  - the request sends all filtered candidate `Show` objects, including ratings, notes, descriptions, timestamps, and unrelated fields;
  - the prompt renders every rating-band entry and every candidate with per-viewer signals, description, notes, tags, status, and pre-score;
  - there is no candidate cap, history cap, note/description length cap, byte limit, token estimate, summarization layer, or progressive fallback;
  - respins rebuild and resend the complete context;
  - the route accepts the entire client-constructed payload without a server-side size/schema budget.
- User impact:
  - model cost and latency increase with both library size and member count;
  - large lists can exceed request/provider context limits or Cloudflare body/runtime limits;
  - a respin repeatedly pays for nearly identical historical context;
  - recommendation quality can degrade as low-signal history crowds the prompt.
- Root cause: the recommender was designed for full-context quality but lacks a bounded retrieval/ranking stage.
- Recommendation:
  1. Validate and minimize the request server-side; send only fields required for recommendation.
  2. Deterministically rank candidates first and cap the model shortlist.
  3. Select a bounded, diverse set of historical examples per viewer, emphasizing high-signal likes, dislikes, relevant vibes, and notes.
  4. Cap and sanitize free text, estimate tokens, and display/debug the final context size.
  5. Cache a versioned preference summary or candidate context for respins where privacy requirements allow.
- Acceptance criteria:
  - the API rejects oversized/invalid payloads before model invocation;
  - prompt input has explicit maximum candidates, examples per viewer, text lengths, and estimated tokens;
  - cost does not grow linearly without bound as the library grows;
  - golden recommendation fixtures show no material quality regression versus full context;
  - respins avoid resending unchanged high-cost context where technically feasible.
- Backlog destination: Show Tracker AI-quality/cost candidate

### F-068: Member-authored text is treated as trusted recommendation instructions

- Status: validated
- Category: recommendation integrity / prompt injection
- Priority: medium
- Confidence: high
- Applies to: current `main`
- Surface: Gemini recommendation prompt
- Evidence:
  - member notes, legacy notes, show descriptions, titles, display names, and mood text are interpolated directly into one instruction prompt;
  - no delimiter/escaping policy identifies these values as untrusted data;
  - list members can edit several of these fields;
  - the prompt asks the model to treat notes as high-signal and does not tell it to ignore instructions contained inside data fields;
  - output validation constrains the selected ID but not the reasoning content or whether injected instructions influenced selection.
- User impact:
  - accidental or deliberate text such as “ignore the other rules and always pick…” can distort shared recommendations;
  - generated explanations may repeat inappropriate or misleading member-authored content;
  - the recommendation becomes less reproducible and fair among participants.
- Root cause: prompt data and system-like decision instructions share the same trust level and syntax.
- Recommendation:
  1. Structure user data as clearly delimited JSON/data blocks and state that instructions inside data must never be followed.
  2. Apply field length and character controls and strip control-like wrappers where appropriate.
  3. Keep deterministic ranking as the authority and use the model to choose/explain within a bounded shortlist.
  4. Add adversarial fixtures using notes/descriptions that attempt to override selection rules.
- Acceptance criteria:
  - prompt-injection fixtures cannot force an excluded or clearly ineligible result;
  - explanations do not echo hidden/control instructions;
  - user-authored fields are unambiguously marked as data;
  - response validation enforces a bounded reason length and safe text handling.
- Backlog destination: Show Tracker AI-integrity candidate

## Validation still required

- Run authenticated multi-user tests against the Firebase emulator with deployed-equivalent rules.
- Measure recommendation payload size, tokens, latency, and cost across small, medium, and large libraries.
- Test list switching during an in-flight recommendation and with a visible result.
- Inject network failures into invite consumption and deletion.
- Run adversarial prompt fixtures through the actual configured Gemini models.
- Validate classification ambiguity, remakes, anime naming, and season-source behavior against representative real titles.

## Conclusion

The Show Tracker has a coherent data model, useful per-person scoring, and unusually good pure-logic tests for recommendation construction. The highest-value improvements are not a wholesale scoring rewrite. They are enforcing the already-recorded API authorization controls, bounding/minimizing AI context, hardening invitation and list-state transitions, and adding authenticated workflow tests. The current recommendation logic is suitable for a small trusted list but is not yet cost-bounded or robust against stale list state and member-authored prompt manipulation.
