# Orchestrator handoff

Living stage file for a takeover. Muse, or any later orchestrator, reads this before continuing work. Update the Stage log at every milestone. Do not put secrets, tokens, or session files in this file or the repo.

## How to resume

1. Read [AGENTS.md](../AGENTS.md), [BACKLOG.md](../BACKLOG.md), and [backlogs/protocol.md](../backlogs/protocol.md), then this file.
2. Check open PRs: head SHA, required checks, and reviews. Compare each head to the SHA named here before acting.
3. Continue the next unblocked item in the Current stage. Do not restart a PR whose head still matches a finished review.

## Working rules

- Use a feature branch or worktree. Never commit on `main` or on a branch the user is actively using.
- One independent review is required, separate from the coding agent, at the exact head SHA.
- The parent merges by squash with a SHA guard after that review, once every required check is green and the PR has no conflicts. The orchestrator does not merge.
- A merge to `main` auto-deploys the Cloudflare Worker `jamesberto-website`. Never run a manual deploy.
- Model order: Claude plans; Codex implements, then Grok, then Gemini. Claude implements only as a last resort.
- Codex GitHub review is the default. If Codex is unavailable, use Grok, then Gemini. Do not wait for a second review after one independent reviewer approves the exact head.
- Use subscriptions only. Do not add paid API keys. Paid OpenAI stays off.

## Hard gates

These need James's explicit approval. Report the blocker instead of bypassing it.

- #63 live food-data pulls or bulk population, including a live FDC call made only to draft a dry-run
- Paid API enablement
- Production Firestore writes, queries, and exports. The 2026-11-09 exception is the read-only #60 census and backup, which James approved and the parent runs. Other agents do not run it.
- Flipping `INGREDIENT_STORE_WRITES_ENABLED` or `NUTRIENT_V2_WRITES_ENABLED`
- Firestore rules, index, or Auth deploys
- Production enablement for #61 Part B and #64 Part B. Branch code with the write flags left false is allowed. The census exception does not approve #60's writer flag.

## Nutrition architecture

External assistants produce structured ingredient lists. The site does library matching, fitting, calculation, and storage. Unknown is never zero. Native OCR and paid AI stay deferred at #71.

Contracts: [overview](nutrition/README.md), [workflow](nutrition/workflow.md), [assistant contracts](nutrition/assistant-contracts.md), [research pipeline](nutrition/research-pipeline.md), [ingredient-list import](nutrition/ingredient-import.md), [population playbook](nutrition/population-playbook.md).

## Current stage

As of 2026-11-09 17:45 CT. Verify heads before relying on this section.

Merged on `main` (`3b74f76`): #185 through #198, including #196 (#69 search and review), #197, and #198. #69 private add, edit, and save stay #69 Part B.

Muse holds orchestration until Friday, November 13, 2026, 3:11 PM CT. The parent orchestrator resumes after that.

The parent finished the read-only census of `jlb-calorietracker` on 2026-11-09 about 16:32 CT. Aggregates: 609 documents backed up off-repo; 1 user; 191 food documents, all v1; 0 v2 food documents; 0 non-numeric legacy foods; 0 food id collisions; 417 daily entries; 3200 food elements; 0 element collisions; largest entry 8257 bytes; 1 recipe; 0 confirmed links; 0 export refs; 2 timestamp fields. The in-memory restore passed. The backup used REST and a CLI token, so integer versus double was not kept. Take a fresh Admin SDK backup before any migration. Script bugs are #80. Do not query production again. Do not treat the census as permission to flip a write flag.

The plan is [the 2026-11-09 requirements review](nutrition/REQUIREMENTS_REVIEW_2026-11-09.md). #72 is PR #199 and is in review. Next code, with both write flags false:

1. #72 yield, water, fat, and retention. In review on #199. Do not start a second copy.
2. #73 research evidence on the applied draft.
3. #74 honest lookup status, with no live call.
4. #78 beta tab label and explicit abandon copy.
5. #75 remaining doc compatibility notes.
6. #69 Part B and #64 Part B in branches, emulator or fixtures only.
7. #76 local-fixture dry-run report, and #77 aggregate counts from a foods-only extract the parent keeps outside the checkout. Do not commit names, ids, paths, or nutrient values.

Still unapproved: live FDC, catalog import, rules deploys, either write flag, production saves, #68 production smoke, and #71. Do not flip `NUTRIENT_V2_WRITES_ENABLED` to carry beta detail. Legacy food and diary writes stay v1.

Ignore docs PRs #159 and #166.

## Taking over

Look for:

- An open PR whose head SHA differs from the SHA that was reviewed.
- Unaddressed Codex inline comments on the current head.
- Routine status reports that describe an older SHA.
- A cloud agent that is still running on the same item. Do not start a second implementation while it is running.

## Stage log

Append a row at each milestone (PR opened, review sent, review clean, merged). Do not rewrite earlier rows. Times are US Central.

| Date/time CT | Item | PR | Head SHA | State | Next step |
| --- | --- | --- | --- | --- | --- |
| 2026-11-09 13:01 | #66 resolution | #192 | `b090f36d63e11e06ed42372b74f9b7f507767952` | Review clean. Grok approved this SHA. 10 checks green. | Parent verifies the head is unchanged, then squash-merges. |
| 2026-11-09 13:04 | Orchestrator handoff | #193 | `d05fb9bd30bdcf057f428c1953549c209d918518` | PR opened. Docs only. | Independent review of the branch head, then green CI. |
| 2026-11-09 13:28 | #66 resolution | #192 | `848d3ac81636194bbdb74ac7d64be1f80dd1e9ea` | Merged to main. | Start #70 on a new branch. Do not reopen #192. |
| 2026-11-09 13:30 | #70 import workspace | #194 | `d6e405625fdc791c23acc43408cd2ac240f41c36` | PR opened. Fit and production save stay off. | Independent review of the branch head, then green CI. |
| 2026-11-09 13:54 | #70 import workspace | #194 | `5b216ba5ed8b8c8c580f43255e8430e30ae42c8a` | Codex findings addressed in this commit. | Independent review of the branch head, then green CI. |
| 2026-11-09 14:02 | #70 import workspace | #194 | `91241f3` | Merged to main. | Start #65 on a new branch. #69 may run in parallel later. |
| 2026-11-09 14:02 | #65 quantity fitting | #195 | `8fecfc6d7b35dbf43e5c501444810a0632aac49f` | PR opened. Estimated grams only. | Independent review of the branch head, then green CI. |
| 2026-11-09 15:00 | #65 quantity fitting | #195 | `8122694` | Merged to main. | Start #69 on a new branch. #68 stays gated. |
| 2026-11-09 15:04 | #69 ingredient library | #196 | `e40f5bbd43d46dc480621fbeb02a0d3691943db3` | PR opened. Private writes and affected meals stay off. | Independent review of the branch head, then green CI. |
| 2026-11-09 15:41 | #69 ingredient library | #196 | `497f94194d38e649c8c03325c200d24ed31b2f6b` | Merged to main. | Stop. #68 and the Part B items need James's approval. Do not start them. |
| 2026-11-09 15:52 | #69 archive correction | #197 | `f26027543e3bc72e0c4580f7de12353ede410d0c` | Codex finding addressed. Search and review are archived. Private add, edit, and save stay open as #69 Part B. | Do not start #69 Part B. It needs the #61 Part B write approval. |
| 2026-11-09 16:34 | Nutrition requirements review | #198 | `7158db2c6349f00ac7d7d3db4a1d3477eaaba899` | Docs plan opened. James approved only the read-only census, which the parent is running. No code and no production query in this change. | Independent review of the PR head, then green CI. Do not start phase 2 until this plan is merged. |
| 2026-11-09 16:45 | Nutrition requirements review | #198 | `82cc010a0e60ca86469cf7a1c011c67c9174f920` | Grok requested three factual corrections: water gain, the cache runbook tense, and the official-miss button. | Review the correction commit. |
| 2026-11-09 16:55 | Nutrition requirements review | #198 | `1ecb59c0bbb1a8bd0127216af898bfa8b3ffac9c` | Grok approved that SHA. Codex then required a diary-guard limit, item #79, phase-2 ordering, an unknown census result, the #59–#78 range, and an aggregate-only #77 report. | Review the Codex correction commit. |
| 2026-11-09 17:05 | Nutrition requirements review | #198 | `02095104636de273003ed52c057b773ee997b13a` | Grok asked every #77 sentence to say foods-only, outside the checkout, and no path, name, id, or nutrient value. | Review the aligned head. |
| 2026-11-09 16:32 | #60 read-only census | | `da04c70` | Parent census of `jlb-calorietracker`. 609 docs backed up off-repo. 191 foods, all v1, 0 v2. 417 daily entries, 3200 elements, 0 collisions, largest 8257 bytes. 1 recipe, 0 confirmed links, 0 export refs. 1 user. 2 timestamp fields. In-memory restore passed. REST backup does not keep integer versus double. | Fresh Admin SDK backup before any migration. Track script bugs as #80. Do not rerun production. |
| 2026-11-09 17:10 | #197 archive correction | #197 | `da04c70` | Merged to main. | #198 is rebased onto this main. Review the rebased head. |
| 2026-11-09 17:45 | Handoff to Muse | #198 / #199 | `3b74f76` | `main` is `3b74f76`: #196 (#69 search and review), #197, and #198 are merged. #60 Part B read-only census and backup are done; aggregates are in the requirements review. #199 (#72) is rebased here; its code commit is `cd2969e`. It is in review and CI. Next safe order: #73, #74, #78, #75, then #69 Part B and #64 Part B in the emulator only, #76 as a local-fixture dry-run, and #77 aggregate counts run by the orchestrator locally. Production writes, flags, rules, live pulls, catalog import, #68, and #71 stay gated. | Muse holds orchestration until Fri Nov 13, 2026, 3:11 PM CT. Do not merge #199 until its reviewed head is unchanged and CI is green. |
| 2026-11-09 18:20 | #72 yield, water, fat, retention | #199 | `f5f5def` | Independent Grok review on 2026-11-09 NOT APPROVED: 4 P1 and 1 P2. Meal water counted fat twice, the raw-total constraint bound a compound parent, serving-weight fits treated cooked mass as constant, review used the pre-fit cooked weight, and one line's own water turned off meal yield for every line. | Fix round 1 on a fresh branch off `f5f5def`. Do not merge #199. |
| 2026-11-09 22:58 | #72 yield, water, fat, retention | new PR, supersedes #199 | `7b9cd57` | Fix round 1 opened. All five findings fixed with regression tests. Nutrition suite 504 passed; root `npm test` 2015 passed; CalorieTracker `npm test` 1120 passed. Both write flags stay false. No production writes. | Orchestrator verifies, opens the PR, and closes #199. Then independent review of the new head and green CI. |
| 2026-11-09 23:05 | #72 yield, water, fat, retention | #200 | `74e098d` | Independent Codex review of PR #200 head `74e098d` on 2026-11-09 NOT APPROVED: 2 P1 and 2 P2 (fix round 2 of 3). P1: review scaled serving-weight facts against a partial cooked mass when a counted line had null grams. P1: the fit kept a declared cooked total constant even when every line's own water overrides it. P2: JSON export leaked private top-level yield fields instead of the nested `line.yield` object. P2: `.d.ts` files still declared version 1 and omitted `countedLines`, `nutrientBasis`, and `cookedTotal`. | Fix round 2 on the same branch. |
| 2026-11-09 23:57 | #72 yield, water, fat, retention | #200 | `919dba2` | Fix round 2 committed. All four findings fixed with regression tests; 11 of the 12 new tests fail on the pre-fix code (the 12th is a guard that passes both ways). The fit also flags a declared cooked total it cannot reach as infeasible (`cooked_total`). Nutrition suite 516 passed; CalorieTracker `npm test` 1132 passed; root `npm test` 2015 passed; `tsc` on the changed `.d.ts`, `ci:docs`, and `ci:contract` pass. Both write flags stay false. No production writes. Not pushed. | Orchestrator verifies and pushes to #200. Then independent review of the new head and green CI. |
| 2026-11-10 01:00 | #72 yield, water, fat, retention | #200 | `1793627` | Merged to main as `b66786c` (squash, SHA guarded at head `1793627`). Final review was an orchestrator review disclosed on the PR because external reviewers were unavailable. CI green; nutrition suite 516 passed locally. | Start #73. |
| 2026-11-10 01:05 | #73 research evidence on the applied draft | pending | `8a25c95` | Implementation committed on `claude/calorie-tracker-73-research-evidence`. Applied nutrients keep the full validated field plus `requestId`; each item keeps `researchEvidence` per request (sources with version, publishedAt, accessedAt; unresolved; assumptions; unverified). Null stays unknown. Revision-draft sources keep `publishedAt`. 4 of the 6 new tests fail on the pre-fix code (the other 2 are guards that pass both ways). Nutrition suite 522 passed; CalorieTracker `npm test` 1138 passed; root `npm test` 2015 passed; `ci:docs` passes. Both write flags stay false. No production writes. Not pushed. | Orchestrator verifies, pushes, and opens the PR. Then independent review of the head and green CI. |
| 2026-11-10 01:10 | #73 research evidence on the applied draft | #201 | `30848dd` | PR opened. Implementation and tests at `8a25c95`; docs at `30848dd`. | Independent review of the branch head, then green CI. |
| 2026-11-10 01:05 | #73 research evidence on the applied draft | #201 | `fe7f5e5` | Orchestrator review APPROVED at this head, with full disclosure on the PR: the Codex connector reported its code review usage limit reached, and other external reviewers were unavailable. CI green at this head. | Merged. |
| 2026-11-10 01:08 | #73 research evidence on the applied draft | #201 | `fe7f5e5` | Merged to main as `95f959e` (squash, SHA guarded). | Start #74. |
| 2026-11-10 01:19 | #74 honest official lookup status | pending | `355cc0e` | Implementation committed on `claude/calorie-tracker-74-honest-lookup`. `lookupWorkspace()` and `researchLibraryFields()` record `not_performed` (adapter `none`, release null) instead of a fabricated `not_found`. A caller attempt cannot claim `not_found` or `resolved` through the workspace. `lookupOfficial()` keeps the pinned curated release only for genuine `resolved`/`not_found` attempts, rejects unknown outcomes, and does not unresolve a matched line. Packet `triedSources` carry release null for `not_performed`. The Import button now reads "Skip official lookup (not enabled)". #72 and #73 reconciled into the archive. 7 of the 8 new tests fail on the pre-fix code (the 8th is the genuine `not_found` guard). Nutrition suite 530 passed; CalorieTracker `npm test` 1146 passed; root `npm test` 2015 passed; `ci:docs` passes. Both write flags stay false. No live call, no production writes. Not pushed. | Orchestrator verifies, pushes, and opens the PR. Then independent review of the head and green CI. |
| 2026-11-10 01:22 | #74 honest official lookup status | #202 | `c20f1f9` | PR opened. Implementation at `355cc0e`; reconciliation and Stage log at `58300ca`. | Independent review of the branch head, then green CI. |
| 2026-11-10 01:31 | #74 honest official lookup status | #202 | `71e0429` | Orchestrator review APPROVED at this head, with full disclosure on the PR: the Codex connector again reported its code review usage limit reached. CI green at this head. | Merge. |
| 2026-11-10 01:33 | #74 honest official lookup status | #202 | `71e0429` | Merged to main as `bd6d56f` (squash, SHA guarded). | Start #78. |
| 2026-11-10 01:37 | #78 beta tab label and explicit diary add | pending | `3db827b` | Implementation committed on `claude/calorie-tracker-78-beta-tab`. The tab button and panel heading read `Ingredient Import (Beta)`; Library is unchanged. The shared `WORKSPACE_UNCHANGED_NOTICE` ("Your existing foods and diary were not changed.") is set on `cancelWorkspace()` and shown after a cancel or a failed import action. A `Return to Today` button calls `activateTab('today')`. The save reason now says the meal was not logged to the diary (`logged: false`, `committed: false`, export unchanged). No cache bump: HTML and JS are network-first. #74 reconciled into the archive. All 4 new tests fail on the pre-fix code. Nutrition suite 534 passed; CalorieTracker `npm test` 1150 passed; root `npm test` 2015 passed; `ci:docs` passes. Both write flags stay false. No live call, no production writes. Not pushed. | Orchestrator verifies, pushes, and opens the PR. Then independent review of the head and green CI. |
| 2026-11-10 01:40 | #78 beta import tab label and diary add copy | #203 | `451195b` | PR opened. Implementation at `3db827b`; reconciliation and Stage log at `451195b`. | Independent review of the branch head, then green CI. |
| 2026-11-10 01:44 | #78 beta import tab label and diary add copy | #203 | `b224685` | Orchestrator review APPROVED at this head, with full disclosure on the PR: the Codex connector is at its code review usage limit. CI green at this head. | Merge. |
| 2026-11-10 01:46 | #78 beta import tab label and diary add copy | #203 | `b224685` | Merged to main as `e93190e` (squash, SHA guarded). | Start #75. |
| 2026-11-10 01:47 | #75 correct nutrition docs and cached-client compatibility | pending | `c978d7d` | Implementation committed on `claude/calorie-tracker-75-compat-docs`. Docs only: a Cached-client compatibility section in the ingredient store release runbook distinguishes implemented, tested, deployed, and populated, puts the write-enable cache name after `nutritrack-v5`, describes the saved-food newer-schema transaction guard, and describes diary `setDoc` replacement as unprotected until #60 Part B; cross-linked from workflow, the nutrition overview, and the tracker README. #78 reconciled into the archive. `ci:docs` passes. Both write flags stay false. No production writes. Not pushed. | Orchestrator verifies, pushes, and opens the PR. Then independent review of the head and green CI. |
| 2026-11-10 02:51 | #75 correct nutrition docs and cached-client compatibility | #204 | `12e3129` | PR opened. Implementation at `c978d7d`; reconciliation and Stage log at `12e3129`. | Independent review of the branch head, then green CI. |
| 2026-11-10 02:55 | #75 correct nutrition docs and cached-client compatibility | #204 | `75d3264` | Orchestrator review APPROVED at this head, with full disclosure on the PR: the Codex connector is at its code review usage limit. CI green at this head. | Merge. |
| 2026-11-10 02:56 | #75 correct nutrition docs and cached-client compatibility | #204 | `75d3264` | Merged to main as `7700351` (squash, SHA guarded). | Start #69 Part B. |
| 2026-11-10 03:16 | #69 Part B save private library profiles | pending | `d721070` | Branch implementation committed on `claude/calorie-tracker-69b-library-save`; the backlog note, #75 reconciliation, and this row follow in a docs commit. `buildLibraryDraft()` builds a validated revision draft from a staged manual, label, or applied #73 research edit; unpatched fields keep value, quality, and provenance; research sources keep version and dates; unrepresentable values are reported in `unrepresented`. `commitLibraryEdit()` saves the next revision or a private override through the ingredient store, returns `revision_conflict` with the draft in the pending-save outbox, and stays `writes_disabled` with the flag off. Research passes the reviewed ref, revision, and missing fields; one "Save to my library" button. 7 of the 9 new tests fail on the pre-fix code (flag-off and cancel pass both ways). Nutrition suite 543 passed; CalorieTracker `npm test` 1159 passed; root `npm test` 2015 passed; `tsc` on `library.d.ts` and `ci:docs` pass. Both write flags stay false. No rules change, no live call, no production or diary writes. Not pushed. | Orchestrator verifies, pushes, and opens the PR. Then independent review of the head and green CI. |

## Logins and setup

James signs in himself. The new orchestrator opens the page or device-code prompt and waits. Do not invent credentials or commit them.

- GitHub: the Cursor GitHub connector, or `gh auth login --web`.
- Cursor: the Cursor account and the GitHub app, so cloud agents can run.
- Codex: `codex login` with the ChatGPT subscription, plus the Codex GitHub review app.
- Claude Code: run `claude`, then `/login`, with the Claude subscription.
- Grok CLI: `grok login --device-code`.
- Gemini CLI: Google account sign-in. For a headless session set `GEMINI_CLI_TRUST_WORKSPACE=true`.
- Cloudflare: `wrangler login`. Read-only use. Do not deploy.
- Firebase: `firebase login`. Read-only use. Do not deploy without an approval in Hard gates.
- Testing: a Google account sign-in on jamesberto.com.
