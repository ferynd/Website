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

As of 2026-11-09 13:01 CT. Verify heads before relying on this section.

Merged on `main` (`df864e1`): #185, #186, #187, #188, #189 (#62, `91e10ad`), #190 (#67 import, `f3ff0c7`), #191 (#64 Part A calculation, `df864e1`).

Open: [PR #192](https://github.com/ferynd/Website/pull/192), the #66 missing-ingredient resolution ladder, at head `b090f36d63e11e06ed42372b74f9b7f507767952`. Grok re-review approved that exact SHA (`bc-726ee1d0-99e9-593c-843d-91fc5fe2896f`) and all 10 checks were green. It is ready to merge after a fresh check that the head is still that SHA.

Next order: #70 import workspace, then #65 fitting, then #69 library, then #68 end-to-end. #63 stays gated. Ignore docs PRs #159 and #166.

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
