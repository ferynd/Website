# Continuous integration

Staged, release-blocking checks for `ferynd/Website` (AR-06 / T27). Workflow: `.github/workflows/ci.yml`. Contract: `.github/ci/contract.json`.

## Stages

| Stage | Blocking? | Owner | Local command |
|---|---|---|---|
| `lint` | yes | @ferynd | `npm run lint` |
| `unit-core` | yes | @ferynd | `npm test` |
| `unit-calorie-tracker` | yes | @ferynd | `cd public/tools/CalorieTracker && npm test` |
| `api-contract` | yes | @ferynd | `npm run test:api` |
| `docs-manifest` | yes | @ferynd | `npm run ci:contract && npm run ci:docs` (+ actionlint) |
| `rules-emulator` | yes | @ferynd | `npm run test:rules` (Java 21) |
| `build-cloudflare` | yes | @ferynd | `npm run cf:build` |
| `browser-public` | yes (HTTP smoke) | @ferynd | `npm run build` then `next start -p 3100` and `npm run ci:smoke -- --profile local --base-url http://127.0.0.1:3100` |
| `ci-gate` | yes (aggregate) | @ferynd | (CI only) fails unless every blocking stage succeeded |
| `browser-auth` | pending → AR-18 | @ferynd | — |
| `concurrency` | pending → AR-18 | @ferynd | — |
| `deploy-smoke` | post-deploy only | @ferynd | `node scripts/ci/http-smoke.mjs --profile deployed --target production\|workers-dev` |

Pending stages are recorded in `contract.json` with owner, follow-up, and review-by date. They are **not** workflow jobs, so they cannot show a fake green check. `docs-manifest` fails if any T27 stage is neither a job nor a valid pending entry, or if a pending/post-deploy stage lists `tests` patterns (only blocking stages run tests).

`docs-manifest` also enforces workflow policy (SHA-pinned actions, no artifact upload, `persist-credentials: false`, no `write` permission in any quoting, and no `secrets` context access in `ci.yml` in any form) and validates documentation links, including `#fragment` targets against GitHub-style heading slugs or explicit `id`/`name` anchors in Markdown files.

`browser-public` is HTTP-level only in AR-06 (catalogue routes, no-JS catalogue links, Japan 404, security headers, unauthenticated transcriber probes, and a 404 for the `.map` of every JS chunk referenced by any smoked page). Accessibility, keyboard, mobile, reduced-motion, and real browser-auth/concurrency harnesses are AR-18.

## Required checks for James (branch protection)

Require these exact GitHub check names on `main`:

1. `ci-gate`
2. `lint`
3. `unit-core`
4. `unit-calorie-tracker`
5. `api-contract`
6. `docs-manifest`
7. `rules-emulator`
8. `build-cloudflare`
9. `browser-public`

Remove the old PR #157 names if they were ever required: `Site (lint, build, test)` and `CalorieTracker (test)`.

Do **not** require `deploy-smoke` on pull requests.

## Registering a test

1. Put the file where its stage owns it (`app/**/*.test.ts(x)`, `scripts/**/*.test.ts`, `public/tools/CalorieTracker/**/*.test.js`, `tests/rules/**`, or `tests/api/**`).
2. Confirm `.github/ci/contract.json` already maps that path via exactly one **blocking** stage's `tests` regex (or extend the regex in the same PR). `.test.*` and registered `.spec.*` files are both subject to ownership and quarantine scanning.
3. CalorieTracker tests must also be listed in `public/tools/CalorieTracker/package.json`'s `test` script.
4. Root Vitest excludes CalorieTracker, `tests/rules`, and `tests/api` so each suite has one owner.

## Flaky quarantine

File: `.github/ci/quarantine.json`.

Every skip-style call (`.skip`, `.todo`, `.fails`, `xit`, `xdescribe`) needs a `// ci-quarantine: <id>` comment on the line above that points to an unexpired entry:

```json
{
  "id": "Q-001",
  "stage": "unit-core",
  "test": "file > describe > case",
  "owner": "@ferynd",
  "issue": "https://github.com/ferynd/Website/issues/N",
  "added": "2026-11-05",
  "expires": "2026-12-05",
  "reason": "…"
}
```

Rules: owner, real issue URL, expiry ≤ 30 days after `added`. `.only`, Vitest `retry` (quoted, computed, or assigned spellings included), and `--retry` are always forbidden. Expired/orphaned entries fail `docs-manifest`. Quarantine never makes a stage non-blocking.

## Artifacts and privacy

AR-06 uploads **no** CI artifacts. Scripts print method/path/status/check name only — never bodies, tokens, or user content. Fixtures must be synthetic (`example.com`, `FAKE`/`EXAMPLE` key shapes). Redacted Playwright traces land in AR-18 deliberately.

## Sensitive allowlist

`.github/ci/sensitive-allowlist.json` entries need `file`, `pattern`, `owner`, `reason`, `reviewBy` (and optional exact `match`). Firebase web keys (`AIza…`) are public client identifiers (AGENTS.md). The allowlist permits **only the exact** Firebase `apiKey` string (any path, including bundles). Any other `AIza…` value (for example a leaked `GEMINI_API_KEY`) fails CI. The allowlist is also seeded for the already-public admin email in rules fixtures and the synthetic OpenAI-shaped redaction fixture. New hits outside the allowlist fail CI; do not silently broaden patterns — ask before allowlisting real content.

Patterns include private keys, OpenAI/GitHub/Slack/Google key shapes, bearer JWTs (`jwt-token`, which covers `TMDB_READ_ACCESS_TOKEN`), and 32-hex TMDB v3 keys (`tmdb-api-key`, flagged only within TMDB/`api_key` context). There are no filename-based exemptions: `PLAN.md`, `VERIFY.md`, and other notes are scanned like any file. Synthetic fixtures use a `FAKE`/`EXAMPLE` marker inside the matched value, or (for shapes that cannot carry one, such as hex keys) an exact `file` + `pattern` + `match` allowlist entry.

## Deploy smoke

Workflow: `.github/workflows/deploy-smoke.yml` (manual `workflow_dispatch` with `target=production|workers-dev`, plus a daily schedule). Read-only requests to allowlisted public hosts; no secrets; never calls paid AI/TMDB routes.

```bash
gh workflow run deploy-smoke.yml -f target=production
```

Commit-SHA verification against the live Worker is blocked on F-152 (AR-01) and is printed as a TODO until then.

## Follow-ups

- **AR-18** — Playwright matrix, browser-auth, concurrency, redacted traces.
- **AR-19** — single Vitest major + targeted coverage.
- **AR-20** — privacy-safe observability, error boundaries, readiness.
- **AR-07** — typed product manifest replacing catalogue regex parsing.
