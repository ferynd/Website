# Grok Bot — Website Backlog Orchestrator

> **Living document.** Maintained by Grok Bot and updated whenever its setup, tooling, or workflow changes. See the [Changelog](#changelog) at the bottom.

## 1. Purpose

Grok Bot ("Website Backlog Orchestrator") drives this repository's backlog end to end:

- **Plans** each item with Claude Code (Opus at high effort, read-only plan mode).
- **Implements** with Codex CLI (primary) or Grok Build (second implementer) in a sandbox.
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
| Codex CLI | 0.163.0 | ChatGPT sign-in | Implementation; model always pinned with `-m` (see §5) |
| Grok Build (`grok`) | 1.0.62 | grok.com subscription (device auth) | Second implementer; `~/.local/bin/grok` |
| GitHub CLI (`gh`) | 2.102.0 | `ferynd`, HTTPS | Push branches, open draft PRs |
| wrangler | 4.151.3 (repo pins 4.107.0) | Cloudflare OAuth (no DNS-edit, Workers Builds, or API-token scopes) | Worker `jamesberto-website`; Pages `weekendtrip` still serves jamesberto.com until the cutover (§3a) |
| firebase-tools | 15.34.0 | Google OAuth | Project `jlb-calorietracker`; Firebase connector also signed in |
| Gemini CLI | 0.64.0 | — (unused) | Google stopped serving Gemini CLI to personal accounts on 2026-06-18; Antigravity CLI is the replacement option |

### Grok Build details

- Signed in via grok.com subscription. Device-code login was approved from James's own device, because xAI's sign-in page rejects the box browser ("Request could not be verified"). `grok models` confirms the login.
- Models: `grok-4.7` (default), `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`.
- Role: second implementer alongside Codex. Use it for parallel or alternate implementations, second opinions on a diff, or when Codex is unavailable.
- Verified flags (from `grok --help` and `~/.grok/docs/user-guide/`):
  - `-p, --single <PROMPT>` / `--prompt-file <PATH>`: headless single-turn run. Headless mode does **not** read piped stdin into the prompt.
  - `-m, --model <MODEL>`: pin the model.
  - `--reasoning-effort` / `--effort <LEVEL>`: `none|minimal|low|medium|high|xhigh|max` (each model accepts only the levels it advertises).
  - `--cwd <DIR>`: working directory.
  - `--sandbox <PROFILE>`: kernel-enforced sandbox, off by default. Built-ins: `off`, `workspace` (write CWD + `~/.grok` + temp), `read-only`, `strict`, `devbox`. Custom profiles (with `deny` lists) go in `~/.grok/sandbox.toml`. Verified on the box: `--sandbox workspace` lets it write inside `--cwd` and blocks writes to `$HOME`.
  - `--permission-mode <default|acceptEdits|auto|dontAsk|bypassPermissions|plan>`. In headless runs, any tool call that needs approval is refused (exit code stays 0, stderr says `permission required: ...`). `acceptEdits` did **not** allow file writes headless on 1.0.62. Use `--always-approve` (alias `--yolo`, same as `bypassPermissions`), and always pair it with `--sandbox workspace`.
  - `--output-format plain|json|streaming-json|streaming-messages-json`. In `json`, the reply is in `.text` and the stop reason in `.stopReason` (`end_turn` on success), with `.modelUsage` and `.total_cost_usd`.
  - `--max-turns <N>`, `--no-plan`, `--disable-web-search`, `-w, --worktree [NAME]` + `--worktree-ref <REF>` (isolated git worktree).

### Known quirks

- Codex 0.163.0 has **no `--full-auto`**; use `--sandbox workspace-write`.
- Always redirect stdin (`</dev/null`) for headless `claude` / `codex` / `grok` runs, or they may hang waiting for input (confirmed again for `codex exec` on 2026-10-20).
- If Codex reports `Your workspace is out of credits`, the ChatGPT workspace has run out of Codex usage. Fall back to Grok Build, or wait for credits to reset.
- Run `wrangler` from a directory containing a `package.json`; otherwise it fails with a `/node_modules` cache permission error.
- `opennextjs-cloudflare deploy -- --message "..."`: the message goes through `/bin/sh`, so parentheses break it. Use a plain slug.
- Before `npm run cf:build`, move `public/tools/CalorieTracker/node_modules` aside (it exists on the box only for the CalorieTracker tests). Otherwise OpenNext copies it into the Worker's public assets.
- `gh`, `wrangler`, and `firebase` OAuth flows time out after ~2–5 minutes — finish the browser step promptly, and close stale auth tabs before retrying.

## 3a. Hosting and deploy flow (as of 2026-10-20)

- **Firebase:** Firestore rules from the AR-03 release are live: ruleset `47cb93f9-4008-4b73-a8f8-cc469f8b8ae4`, deployed from PR #160's `firestore.rules`. Roll back by re-releasing `7c3d1850-1364-4b63-a283-711021545010` (= `main@074c307`). Deploy only with `npx firebase deploy --only firestore:rules --project jlb-calorietracker`. Storage is deferred.
- **Worker:** `jamesberto-website` (OpenNext). Preview at <https://jamesberto-website.arkkahdarkkahd.workers.dev>. It has secrets for Gemini, GPT, and TMDB. Manual deploy: `npm run cf:build && npx opennextjs-cloudflare deploy -- --message <slug>`, run from a worktree. Roll back with `npx wrangler rollback <version-id>`.
- **Pages:** `weekendtrip` still serves jamesberto.com and www. Once #160 is on `main`, Pages builds fail (it is Workers-only code), and Pages keeps serving its last good deployment.
- **Cutover status: blocked on James.** Attaching the custom domains fails with Cloudflare 100117: "Hostname already has externally managed DNS records". The apex and www DNS records that Pages created must be deleted, and the bot's wrangler OAuth has no DNS-edit scope. James's steps:
  1. Dashboard → `jamesberto.com` zone → DNS → delete the `jamesberto.com` and `www` records that point to `weekendtrip.pages.dev`.
  2. Right away, in Worker `jamesberto-website` → Settings → Domains & Routes → Add → Custom domain, add `jamesberto.com` and then `www.jamesberto.com`. The site is down between steps 1 and 2, so do them back to back.
  3. Then the bot commits the matching `wrangler.jsonc` `routes` (`custom_domain: true`, saved in `~/runs/pr-160/cutover/wrangler-custom-domains.patch`), verifies, and removes both custom domains from Pages `weekendtrip`.
- **Cutover rollback:** Worker `jamesberto-pages-proxy` (source in `/workspace/pages-proxy` on the box) proxies `weekendtrip.pages.dev`. Add the same two custom-domain routes to it and `wrangler deploy`, and the domains move over without any DNS edit. The full revert is to delete the Worker custom domains and re-add both domains to Pages.
- **Auto-deploy: needs James.** Workers Builds can't be reached with the wrangler OAuth token. In the Dashboard: Worker `jamesberto-website` → Settings → Builds → Connect `ferynd/Website`, production branch `main`, build command `npm run cf:build`, deploy command `npx opennextjs-cloudflare deploy`, non-production branch command `npx opennextjs-cloudflare upload`. The GitHub Actions fallback would need a `CLOUDFLARE_API_TOKEN` that the bot can't create, so until then deploys are manual from `main`.
- **Smoke check:** `~/runs/pr-160/smoke.sh <base-url>` (on the box). A Worker response has an `x-opennext-cache` header; a Pages response has `x-matched-path`.

## 4. Pipeline

1. **Select** work per `BACKLOG.md` dispatch + selection algorithm.
2. **Reconcile** the selected backlog's `[p]` items against `main` (per `backlogs/protocol.md`), and run the **resume check**: look for an existing run record, branch, or PR for the item (§6) and resume instead of duplicating work.
3. **Plan**: Claude (Opus, high effort, plan mode, read-only) writes `plan.json`.
4. **Handoff (scripted, required)**: validate `plan.json` and extract `PLAN.md`; abort if it fails (§5b). Both files live in the run record.
5. **Implement**: Codex (model pinned per §5a) or Grok Build implements `PLAN.md` inside its sandbox.
6. **Verify** — the bot independently runs the checks required by the `AGENTS.md` testing policy and the backlog, reviews `git diff --stat` for scope, and checks every acceptance criterion.
7. **Fix loop**: at most **one** implementer fix round; if still failing, stop and escalate to James.
8. **Publish**: Conventional Commit with item ID, push the branch, open a draft PR (body records the model + effort used for each step), record the short SHA + PR number on the backlog item (`[p] pushed — …`), and update the run record.

## 5. How to structure requests

### (a) Model selection policy (James's rule)

**Always tailor the model to the ask and use the lowest tier that fits.** Never rely on a CLI's default model (the defaults are higher tiers). Always pin the model and effort explicitly, and record both in the PR body.

| Task type | Tool | Model | Effort |
|---|---|---|---|
| Planning (normal default) | Claude Code | `--model opus` | `--effort high` |
| Planning, trivial/docs-only item (or skip a separate plan) | Claude Code | `--model sonnet` | `--effort medium` |
| Standard implementation, file retrieval, reading, editing, docs, mechanical changes | Codex | `-m gpt-6-luna` | `-c model_reasoning_effort=medium` (`low` for purely mechanical edits) |
| Broader security, refactoring, cross-cutting changes | Codex | `-m gpt-6.1-sol` | `-c model_reasoning_effort=high` |
| Exceptional hard case (only with written justification in the PR) | Codex | `-m gpt-6-astra` | `-c model_reasoning_effort=high` |
| Second implementation / second opinion / Codex unavailable | Grok Build | `-m grok-4.7-build-fast` (standard) or `-m grok-4.7` (complex) | `--effort medium` / `high` |

- **Prefer Luna** whenever the plan gives explicit, step-level instructions. The orchestrator then verifies the result closely (checks, diff scope, acceptance criteria), which keeps overhead low.
- Escalate one tier only after a concrete failure or when the item is clearly security- or refactor-heavy, and note why in the PR.
- Verified flags (2026-10-20):
  - Claude Code 2.1.304: `--model <alias|name>` and `--effort <low|medium|high|xhigh|max>`. A test run with `--model opus --effort high` returned `.modelUsage` → `claude-opus-5-5`.
  - Codex 0.163.0: `-m <model>` and `-c model_reasoning_effort=<low|medium|high|xhigh|max>`. Codex accepts the key under `--strict-config` and echoes it in its run header (`reasoning effort: low`). The models cache lists levels up to `max` for `gpt-6-luna` and up to `ultra` for `gpt-6.1-sol` / `gpt-6-astra`.
  - Grok Build 1.0.62: `-m <model>` and `--effort <level>` (see §3).

### (b) Plan → handoff (Claude)

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
Output: ordered, step-level instructions (explicit enough for a lower-tier implementer),
files to touch, test cases, acceptance checklist, risks.
PLAN ONLY — do not edit any files.
```

Plan, then the **required scripted handoff**. If any step fails, abort; never implement from an empty or errored plan:

```bash
RUN="$HOME/runs/$ITEM"; mkdir -p "$RUN/checks"
claude -p "$PROMPT" --model opus --effort high --permission-mode plan \
  --output-format json </dev/null > "$RUN/plan.json"

jq -e '.is_error == false' "$RUN/plan.json" >/dev/null \
  && jq -r '.result' "$RUN/plan.json" > "$RUN/PLAN.md" \
  && test -s "$RUN/PLAN.md" \
  || { echo "plan handoff failed" >&2; exit 1; }

cp "$RUN/PLAN.md" "$REPO/PLAN.md"   # implementer input; never committed
```

`jq` is installed at `/usr/bin/jq`. `plan.json` also gives the model used (`.modelUsage`). `PLAN.md` in the repo is scratch input: delete it before committing, or keep it out of `git add`.

### (c) Implementation prompt (Codex or Grok)

Template:

```text
Implement PLAN.md exactly. Only touch <paths>. No git commands, no new dependencies.
Follow AGENTS.md conventions (TypeScript, Tailwind tokens from app/globals.css, lucide-react icons).
Run <checks> and report results.
```

Codex (default choice; pin the model per §5a):

```bash
codex exec -m gpt-6-luna -c model_reasoning_effort=medium \
  --sandbox workspace-write --skip-git-repo-check -C "$REPO" \
  --json -o "$RUN/codex-last.txt" "$PROMPT" </dev/null > "$RUN/impl.jsonl"
```

Use `-m gpt-6.1-sol -c model_reasoning_effort=high` for security/refactor items. Add `--ephemeral` to skip saving the session.

Grok Build (second implementer or alternate implementation):

```bash
grok -p "$PROMPT" -m grok-4.7-build-fast --effort medium \
  --cwd "$REPO" --sandbox workspace --always-approve \
  --output-format json </dev/null > "$RUN/grok.json"
jq -e '.stopReason == "end_turn"' "$RUN/grok.json"
```

Use `--output-format streaming-json` when parsing progress events, and `-w <name> --worktree-ref <base>` to run an alternate implementation in its own git worktree without disturbing the main checkout. Without `--always-approve`, headless Grok refuses every edit, so always keep it inside `--sandbox workspace`.

### (d) How James can ask the bot

- "continue feature rollout" → first actionable item in the feature list in `BACKLOG.md`
- "continue audit remediation" → `backlogs/audit-remediation.md` in wave/dependency order
- "do AR-06" → that named item
- "plan only for P2, don't implement" → Claude plan returned for review, no code changes
- "have Grok take a second pass" → alternate implementation or review with Grok Build
- "deploy approved?" → bot reports what's ready to deploy and waits for a yes

The bot will always **ask before deploys, merges, and anything destructive**.

## 6. Run records and execution recovery

For each backlog item, the orchestrator keeps a run record **outside the repo** at `~/runs/<item-id>/`:

```text
~/runs/<item-id>/
  run.json        # state (below)
  plan.json       # raw Claude output
  PLAN.md         # extracted plan (handoff output)
  impl.jsonl / grok.json / codex-last.txt
  checks/<cmd>.log  # lint, build, test logs
```

`run.json` fields:

```json
{
  "item": "AR-06",
  "backlog": "backlogs/audit-remediation.md",
  "base_sha": "<origin/main SHA at start>",
  "branch": "working/audit-ar-06-<slug>",
  "plan_path": "~/runs/AR-06/PLAN.md",
  "models": {
    "plan": "claude opus / effort high",
    "implement": "codex gpt-6-luna / effort medium"
  },
  "checks": { "lint": "pass", "build": "pass", "test": "pass" },
  "commit_sha": "<sha>",
  "pr": 0,
  "status": "planned | implementing | verifying | pushed | pr-open | blocked | done",
  "updated": "<ISO timestamp>"
}
```

**On start (resume check):** before planning, look for (1) `~/runs/<item-id>/run.json`, (2) a remote branch for the item (`git ls-remote --heads origin '<branch-pattern>'`), and (3) an open PR (`gh pr list --search "<item-id>" --state all`). If any exists, resume from the recorded `status` (for example, re-verify and push instead of re-planning). Never open a second branch or PR for the same item. Update `run.json` after every step.

## 7. Verification checklist (before opening a PR)

- [ ] Branch is fresh from current `origin/main` (or the backlog-required base); not `main` or anyone else's branch.
- [ ] `git diff --stat` touches only planned files; no unrelated changes, no new deps unless justified.
- [ ] Required checks pass per `AGENTS.md` testing policy + backlog Parameters (e.g. `npm run lint`, `npm run build`, `npm test`, CalorieTracker `npm test`; docs-only: paths/links validated).
- [ ] Every acceptance criterion is verified; critical/high fixes have regression coverage or a documented reason.
- [ ] Docs updated per `AGENTS.md` documentation ownership.
- [ ] No secrets, tokens, or private keys in the diff.
- [ ] Conventional Commit with item ID; backlog item marked `[p] pushed — …; commit: <sha>; PR: #<n>`.
- [ ] PR is a draft with scope, rationale, item IDs, checks, docs/migrations, follow-ups, residual risk, and **model + effort used** per step.
- [ ] `PLAN.md` (scratch) is not in the commit; run record `~/runs/<item-id>/run.json` is updated.

## 8. Smoke test record

**2026-10-20** — isolated local test repo (no remote; nothing pushed): a small `slugify` function with tests.

- Claude plan (Opus): 26 s — 13 test cases, 10 acceptance criteria.
- Codex implement: 28 s (default model, before the model policy existed; models are now always pinned).
- Independent verification: 13/13 tests passed, all 10 acceptance criteria met, scope clean, no new dependencies.

## Changelog

- **2026-10-20** — Hosting and release: PR #161 merged, and the Firestore AR-03 rules are deployed and verified live (§3a). PR #158 is merged into the release branch, and the Worker is deployed and smoke-checked. The jamesberto.com cutover is blocked on James deleting the Pages DNS records, and Workers Builds needs dashboard setup. A rollback proxy Worker is ready. Added the deploy quirks (the `--message` slug, moving the CalorieTracker `node_modules` aside).

- **2026-10-20** — Added Grok Build 1.0.62 as a second implementer (verified flags, sandbox, headless usage), the model selection policy (lowest fitting tier, always pinned, recorded in PRs), the scripted plan handoff (`plan.json` → `PLAN.md` with validation), and per-item run records for execution recovery. Noted the Codex "out of credits" failure mode.
- **2026-10-20** — Initial setup: tool installs and logins (Claude Code, Codex, gh, wrangler, firebase-tools), Gemini skipped, isolated pipeline smoke test passed, this guide added.
