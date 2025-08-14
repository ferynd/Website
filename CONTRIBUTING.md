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

## Firebase (Trip Cost + Calorie Tracker)
- **Trip Cost React app** uses Firebase Auth + Firestore. Config in `app/tools/trip-cost/firebaseConfig.ts` with admin `arkkahdarkkahd@gmail.com`. 
- Firestore helpers in `app/tools/trip-cost/db.ts` target `artifacts/trip-cost/**` (trips, participants, expenses, payments, audit).
- **Calorie Tracker static app** (`/public/tools/CalorieTracker/**`) also uses Firebase via web SDKs. Its config lives in that folder.

**Important:** Web Firebase keys are public identifiers. Enforce access through **Firestore Security Rules**. Do **not** commit private server keys.

## PR checklist
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] UI changes include screenshots
- [ ] Updated docs if fundamentals changed (README, AI_AGENTS, ARCHITECTURE, SECURITY)
- [ ] Manual test: home page and affected pages work

## Definition of Done
- Functionality is discoverable from home or section pages.
- Navigation back to the site exists in every static sub-site.
- Docs are in sync with the code changes.
