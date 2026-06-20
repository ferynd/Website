# Contributing

Thanks for improving **James Berto • Projects & Games**. This guide covers local setup, conventions, and how to add new content.

## Prereqs
- **Node.js 18+** (Next.js 15)
- NPM

## Setup
```bash
npm install
npm run dev    # http://localhost:3000
```
Other scripts:
```bash
npm run build
npm start
npm run lint
```

## Project layout (quick)
- Next.js pages under `/app/**` (App Router)
- Static HTML/CSS/JS sub-sites under `/public/games|tools|trips/**`
- Shared UI in `/components/**`
- Tailwind and tokens in `app/globals.css` and `tailwind.config.ts`

## Conventions
- **Conventional Commits:** `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- **Branch names:** `feature/<short-name>` or `fix/<short-name>`
- Keep diffs focused. Prefer small PRs.

## Adding content

### Static game/tool/trip
1. Create `/public/(games|tools|trips)/<Name>/index.html` (+ assets).
2. Add a card to `app/(games|tools|trips)/page.tsx` with `name`, `description`, `href`.
3. Include a back link in the static page to `/` or its section.
4. Run locally and verify.

### React tool
1. Create `app/tools/<name>/page.tsx` (+ local components).
2. Follow existing patterns (client components, Tailwind utilities).
3. Add an entry in `app/tools/page.tsx`.

## Firebase-backed tools

Several tools use Firebase Auth + Firestore. See `SECURITY.md` for auth flows and data model, and `ARCHITECTURE.md` for the full list and per-tool details.

- Firebase web config keys are **public identifiers**, not secrets. Access is enforced through **Firestore Security Rules** (`firestore.rules` at repo root).
- Do **not** commit private server keys, service account JSON, or API tokens.

## PR checklist
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] UI changes include screenshots
- [ ] Updated docs if fundamentals changed (README, AGENTS, ARCHITECTURE, SECURITY, BACKLOG)
- [ ] Doc update confirmed: any structural, routing, auth, data model, or backlog change has matching doc updates in the same PR
- [ ] Manual test: home page and affected pages work

## Definition of Done
- Functionality is discoverable from home or section pages.
- Navigation back to the site exists in every static sub-site.
- Docs are in sync with the code changes.
