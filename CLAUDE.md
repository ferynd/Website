# Context for Claude

This repository is **James Berto • Projects & Games**, a personal site built with Next.js (App Router), React, TypeScript, and Tailwind CSS. 
It showcases three hubs: **Games**, **Tools**, and **Trips**. Static sub-sites live under `/public`, while React pages live under `/app`.

> Start by reading: **[@README.md](@README.md)** and **[@AI_AGENTS.md](@AI_AGENTS.md)**.

## Quick Orientation
- **Next.js pages**: `/app/**` with `layout.tsx`, `page.tsx`, and client components where needed.
- **Shared UI**: `/components/**` (Button with CVA variants, Input, Select, Nav, ProjectCard).
- **Styling**: Tailwind + CSS variables in `app/globals.css`. Default theme is dark (`<html data-theme="dark">`).
- **Static apps**: `/public/games|tools|trips/<Name>/index.html`.
- **Firebase**: Trip Cost, Trip Planner, and Conflict Tracker share the Firebase Auth + Firestore project (config at `app/tools/trip-cost/firebaseConfig.ts`). Trip Planner persists under `artifacts/trip-planner/**`; Conflict Tracker persists under `artifacts/conflict-tracker/**`.

## Commands
```bash
npm i           # install
npm run dev     # local dev (http://localhost:3000)
npm run lint    # eslint
npm run build   # production build
npm start       # run built app
```

## Editing Rules (read these before changing anything)
- Prefer **minimal, focused diffs**. Do not move code between `/app` and `/public` without a clear reason.
- **Static additions**: put new games/tools/trips under `/public/<section>/<Folder>/index.html`, then add a card in `app/<section>/page.tsx`.
- **React additions**: scaffold under `/app/tools/<name>/page.tsx` with local components. Follow the Trip Cost structure when state or data is involved.
- Keep styling consistent with Tailwind tokens in `globals.css`. Reuse utility classes and components.
- **Never commit secrets**. Firebase *web* keys are public by design; access is enforced by Firestore Rules.
- After **fundamental changes**, update **README.md** and **AI_AGENTS.md** in the same PR.

## File Map (abbreviated)
```
app/
  layout.tsx         # global html/body + theme
  page.tsx           # home hub
  loading.tsx        # loading overlay
  games/page.tsx     # lists static games in /public/games
  tools/page.tsx     # lists tools (Trip Planner + Trip Cost + Date Night + static tools)
  trips/page.tsx     # lists static trip itineraries
  style-guide/page.tsx
  tools/trip-cost/** # Firebase-backed React app (Auth + Firestore)
  tools/trip-planner/** # Planner scaffold (Auth + UI, data layer pending)
  tools/date-night/** # Date Night Roulette (Auth + weighted roller + reviews + history, split math libs + Vitest tests)
  tools/cifi-research-estimator/page.tsx # CIFI local research payout estimator
  tools/conflict-tracker/** # Conflict Tracker (Auth + Firestore, two-person reflections + trend dashboard)

components/          # Reusable UI: Button, Input, Select, Nav, ProjectCard
public/
  games/**           # Static games (HTML/CSS/JS)
  tools/**           # Static tools (CalorieTracker, Social Security...)
  trips/**           # Static itineraries (ChicagoTripItinerary)
```

## Pointers for Trip Cost, Trip Planner & Conflict Tracker
- Firebase config: `app/tools/trip-cost/firebaseConfig.ts` (admin email: `arkkahdarkkahd@gmail.com`)
- Firestore pathing: `artifacts/trip-cost/**` (see `app/tools/trip-cost/db.ts`)
- Context/state: `app/tools/trip-cost/TripContext.tsx`
- UI modules: `app/tools/trip-cost/components/**`
- Trip Planner: `app/tools/trip-planner/page.tsx`, `PlanContext.tsx`, and `components/**` wire Firebase Auth, Firestore listeners, and the timeline/ideas/settings/map UI. Shared config + typed helpers live in `app/tools/trip-planner/lib/` alongside client image compression.
- Conflict Tracker: `app/tools/conflict-tracker/page.tsx`, `ConflictContext.tsx`, and `components/**` implement two-person conflict logging with independent reflections, a shared section that unlocks once both submit, and a trend dashboard. Data lives under `artifacts/conflict-tracker/trackers/{trackerId}/conflicts/{conflictId}/reflections/{personA|personB}`. Typed helpers in `app/tools/conflict-tracker/lib/`.

## CalorieTracker backlog workflow
- Ongoing CalorieTracker work is tracked in [`public/tools/CalorieTracker/BACKLOG.md`](public/tools/CalorieTracker/BACKLOG.md). That file is the single source of truth — protocol, branch/PR strategy, status model, and the prioritized item list all live there.
- **Trigger (auto-fires the protocol):** any of _"start working on the backlog"_, _"continue working on the CalorieTracker backlog"_, _"work on the calorie tracker backlog"_, _"pick up the backlog"_, or a close paraphrase. On recognizing one, do this without being asked: (1) read `BACKLOG.md` end-to-end; (2) run its reconcile step — for each `[p]` item with a recorded commit SHA, mark it `[x]` if that commit has merged to `main`; (3) work the highest-priority `[ ]` items in section order (CRITICAL → HIGH → MEDIUM → LOW), one small batch; (4) mark each touched item `[p]` and record the commit SHA on push.
- **Working branch:** `working/calorie-tracker-backlog` (long-lived, one open PR targeting `main`). Switch to it when the environment allows; in web/remote sessions the harness may pin a `claude/*` branch — that is fine, since completion keys off commits merged to `main`, not the branch name.
- **Status model:** `[ ]` not started · `[p]` in progress / pushed / awaiting merge · `[x]` complete. Completion is **hands-off but merge-gated**: a session flips `[p]`→`[x]` automatically once the item's commit is merged to `main` (i.e. the user accepted the PR). Never mark `[x]` for code that is only pushed.
- **Descriptive artifacts:** Commit messages, PR titles, and PR bodies must clearly state which part of the site changed (scope), which backlog items were addressed (item numbers), and what the change does (plain-English summary). See `BACKLOG.md` steps 9 and 12 for format details.

---

**Update this file** whenever structure, commands, or conventions change. Also update **README.md** and **AI_AGENTS.md**.


> Firestore Security Rules source of truth: `firestore.rules` (repo root). Keep docs referencing this file rather than embedding duplicate rule blocks.
