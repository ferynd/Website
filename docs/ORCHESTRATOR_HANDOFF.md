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

As of 2026-11-09 16:29 CT. Verify heads before relying on this section.

Merged on `main` (`497f941`): #185 through #196. PR #197 records that #69's private add, edit, and save stay open. The parent merges #197. This plan follows that correction.

James approved only the read-only #60 census and backup. The parent is running it. Do not query or export production. Do not treat that approval as permission to flip a write flag.

The plan is [the 2026-11-09 requirements review](nutrition/REQUIREMENTS_REVIEW_2026-11-09.md). Next code, after this docs PR, keeps both write flags false:

1. #72 yield, water, fat, and retention.
2. #73 research evidence on the applied draft.
3. #74 honest lookup status, with no live call.
4. #75 remaining doc compatibility notes.
5. #78 beta tab label and explicit abandon copy.
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
