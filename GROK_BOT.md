# Grok Bot — Website Backlog Orchestrator

> **Living document.** Maintained by Grok Bot and updated whenever its setup, tooling, or workflow changes. See the [Changelog](#changelog) at the bottom.

## 1. Purpose

Grok Bot ("Website Backlog Orchestrator") drives this repository's backlog end to end:

- **Plans** each item with Claude Code (Opus, read-only plan mode).
- **Implements** with Codex CLI in a sandbox.
- **Verifies** independently (checks, diff scope, acceptance criteria) before anything is published.
- **Handles** Cloudflare Pages / Firebase only when an item needs it, and only with approval.

It follows the repo's own context order — nothing in this file overrides it:

1. [`AGENTS.md`](AGENTS.md) — repository-wide rules, testing policy, commit/PR rules.
2. [`BACKLOG.md`](BACKLOG.md) — selects exactly one workstream.
3. [`backlogs/AGENTS.md`](backlogs/AGENTS.md) + [`backlogs/protocol.md`](backlogs/protocol.md) + **only** the selected active backlog (e.g. [`backlogs/recipe-standardizer.md`](backlogs/recipe-standardizer.md) or [`backlogs/audit-remediation.md`](backlogs/audit-remediation.md)).

`ARCHITECTURE.md`, `SECURITY.md`, archives, and `reviews/` are loaded only when the selected item requires them (per `AGENTS.md`).

## 2. Operating rules

- Works only in **fresh clones / feature branches** on its own Linux box, branched from current `origin/main` (or the base the selected backlog's Parameters block requires).
- **Never** commits or pushes to `main`, and never touches active user/agent branches (e.g. `claude/*`, existing `working/*`).
- **One phase/initiative per PR**; PRs are opened as **drafts** (per `backlogs/protocol.md` step 14).
- Branch names follow the selected backlog's Parameters (e.g. `working/recipe-standardizer-p<N>`, `working/audit-<id>-<slug>`).
- **No deploys, merges, production/Firebase changes, or destructive actions** without James's explicit approval.
- CLI logins live on the bot's box and **persist across chats**; they only need redoing if a token expires or is revoked.
- No secrets, tokens, or private keys are ever committed (Firebase web keys are public identifiers per `AGENTS.md`).

## 3. Environment (as of 2026-10-20)

All tools are installed under `~/.local` (no sudo); `~/.local/bin` is on `PATH`.

| Tool | Version | Auth | Notes |
|---|---|---|---|
| Node.js | 22.23.3 | — | Under `~/.local` |
| Claude Code | 2.1.304 | Claude Pro subscription | Opus available; used for planning |
| Codex CLI | 0.163.0 | ChatGPT sign-in | Default model observed: `gpt-6.1-sol`; used for implementation |
| GitHub CLI (`gh`) | 2.102.0 | `ferynd`, HTTPS | Push branches, open draft PRs |
| wrangler | 4.151.3 | Cloudflare OAuth | Pages project `weekendtrip` → jamesberto.com |
| firebase-tools | 15.34.0 | Google OAuth | Project `jlb-calorietracker`; Firebase connector also signed in |
| Gemini CLI | 0.64.0 | — (unused) | Google stopped serving Gemini CLI to personal accounts on 2026-06-18; Antigravity CLI is the replacement option |

### Known quirks

- Codex 0.163.0 has **no `--full-auto`**; use `--sandbox workspace-write`.
- Always redirect stdin (`</dev/null`) for headless `claude` / `codex` runs, or they may hang waiting for input.
- Run `wrangler` from a directory containing a `package.json`; otherwise it fails with a `/node_modules` cache permission error.
- `gh`, `wrangler`, and `firebase` OAuth flows time out after ~2–5 minutes — finish the browser step promptly, and close stale auth tabs before retrying.

## 4. Pipeline

1. **Select** work per `BACKLOG.md` dispatch + selection algorithm.
2. **Reconcile** the selected backlog's `[p]` items against `main` (per `backlogs/protocol.md`).
3. **Plan** — Claude (Opus, plan mode, read-only) produces a plan for one item/phase.
4. **Implement** — Codex applies the plan inside the workspace sandbox.
5. **Verify** — the bot independently runs the checks required by the `AGENTS.md` testing policy and the backlog, reviews `git diff --stat` for scope, and checks every acceptance criterion.
6. **Fix loop** — at most **one** Codex fix round; if still failing, stop and escalate to James.
7. **Publish** — Conventional Commit with item ID, push the branch, open a draft PR, and record the short SHA + PR number on the backlog item (`[p] pushed — …`).

## 5. How to structure requests

### (a) Claude planning prompt

Template:

```text
Read AGENTS.md, BACKLOG.md, backlogs/AGENTS.md, backlogs/protocol.md, and <selected backlog>.
Item: <ID> — <title>
Acceptance criteria:
- <criterion 1>
- <criterion 2>
Constraints:
- Files in scope: <paths>
- Preserve invariants from AGENTS.md / the backlog (<list relevant ones>)
- No new dependencies unless justified
Output: ordered steps, files to touch, test cases, acceptance checklist, risks.
PLAN ONLY — do not edit any files.
```

Command:

```bash
claude -p "$PROMPT" --model opus --permission-mode plan --output-format json </dev/null > plan.json
```

In `plan.json`: the plan is in `.result`, the model used in `.modelUsage`, and failure in `.is_error`.

### (b) Codex implementation prompt

Template:

```text
Implement PLAN.md. Only touch <paths>. No git commands, no new dependencies.
Follow AGENTS.md conventions (TypeScript, Tailwind tokens from app/globals.css, lucide-react icons).
Run <checks> and report results.
```

Command:

```bash
codex exec --sandbox workspace-write --skip-git-repo-check -C "$REPO" --json -o last.txt "$PROMPT" </dev/null > impl.jsonl
```

Add `-m <model>` to pin a model, `--ephemeral` to skip saving the session.

### (c) How James can ask the bot

- "continue feature rollout" → first actionable item in the feature list in `BACKLOG.md`
- "continue audit remediation" → `backlogs/audit-remediation.md` in wave/dependency order
- "do AR-06" → that named item
- "plan only for P2, don't implement" → Claude plan returned for review, no code changes
- "deploy approved?" → bot reports what's ready to deploy and waits for a yes

The bot will always **ask before deploys, merges, and anything destructive**.

## 6. Verification checklist (before opening a PR)

- [ ] Branch is fresh from current `origin/main` (or the backlog-required base); not `main` or anyone else's branch.
- [ ] `git diff --stat` touches only planned files; no unrelated changes, no new deps unless justified.
- [ ] Required checks pass per `AGENTS.md` testing policy + backlog Parameters (e.g. `npm run lint`, `npm run build`, `npm test`, CalorieTracker `npm test`; docs-only: paths/links validated).
- [ ] Every acceptance criterion is verified; critical/high fixes have regression coverage or a documented reason.
- [ ] Docs updated per `AGENTS.md` documentation ownership.
- [ ] No secrets, tokens, or private keys in the diff.
- [ ] Conventional Commit with item ID; backlog item marked `[p] pushed — …; commit: <sha>; PR: #<n>`.
- [ ] PR is a draft with scope, rationale, item IDs, checks, docs/migrations, follow-ups, residual risk.

## 7. Smoke test record

**2026-10-20** — isolated local test repo (no remote; nothing pushed): a small `slugify` function with tests.

- Claude plan (Opus): 26 s — 13 test cases, 10 acceptance criteria.
- Codex implement: 28 s.
- Independent verification: 13/13 tests passed, all 10 acceptance criteria met, scope clean, no new dependencies.

## Changelog

- **2026-10-20** — Initial setup: tool installs and logins (Claude Code, Codex, gh, wrangler, firebase-tools), Gemini skipped, isolated pipeline smoke test passed, this guide added.
