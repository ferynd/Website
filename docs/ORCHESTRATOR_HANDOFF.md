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

- #63 live food-data pulls or bulk population
- Paid API enablement
- Production Firestore writes
- Flipping `INGREDIENT_STORE_WRITES_ENABLED` or `NUTRIENT_V2_WRITES_ENABLED`
- Firestore rules, index, or Auth deploys
- Part B of #60, #61, and #64

## Nutrition architecture

External assistants produce structured ingredient lists. The site does library matching, fitting, calculation, and storage. Unknown is never zero. Native OCR and paid AI stay deferred at #71.

Contracts: [overview](nutrition/README.md), [workflow](nutrition/workflow.md), [assistant contracts](nutrition/assistant-contracts.md), [research pipeline](nutrition/research-pipeline.md), [ingredient-list import](nutrition/ingredient-import.md), [population playbook](nutrition/population-playbook.md).

## Current stage

As of 2026-11-09 14:02 CT. Verify heads before relying on this section.

Merged on `main` (`91241f3`): #185, #186, #187, #188, #189 (#62, `91e10ad`), #190 (#67 import, `f3ff0c7`), #191 (#64 Part A calculation, `df864e1`), #192 (#66 resolution, `848d3ac`), #193 (orchestrator handoff, `4aaf892`), and #194 (#70 Import workspace, `91241f3`).

Open: #65 quantity fitting is the active item. #69 library may run in parallel and is not in this change. Production saving and #63 stay gated.

Next after #65: #69 library, then #68 end-to-end. Ignore docs PRs #159 and #166.

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
