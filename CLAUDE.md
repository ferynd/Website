# Context for Claude

This repository is **James Berto • Projects & Games**, a personal site built with Next.js (App Router), React, TypeScript, and Tailwind CSS. 
It showcases three hubs: **Games**, **Tools**, and **Trips**. Static sub-sites live under `/public`, while React pages live under `/app`.

> Start by reading: **[@README.md](@README.md)** and **[@AI_AGENTS.md](@AI_AGENTS.md)**.

## Quick Orientation
- **Next.js pages**: `/app/**` with `layout.tsx`, `page.tsx`, and client components where needed.
- **Shared UI**: `/components/**` (Button with CVA variants, Input, Select, Nav, ProjectCard).
- **Styling**: Tailwind + CSS variables in `app/globals.css`. Default theme is dark (`<html data-theme="dark">`).
- **Static apps**: `/public/games|tools|trips/<Name>/index.html`.
- **Firebase**: Trip Cost and Trip Planner share the Firebase Auth + Firestore project (config at `app/tools/trip-cost/firebaseConfig.ts`). Trip Planner now persists planners/events/ideas under `artifacts/trip-planner/**` with helpers in `app/tools/trip-planner/lib/`.

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
  tools/page.tsx     # lists tools (Trip Planner + Trip Cost React + static tools)
  trips/page.tsx     # lists static trip itineraries
  style-guide/page.tsx
  tools/trip-cost/** # Firebase-backed React app (Auth + Firestore)
  tools/trip-planner/** # Planner scaffold (Auth + UI, data layer pending)

components/          # Reusable UI: Button, Input, Select, Nav, ProjectCard
public/
  games/**           # Static games (HTML/CSS/JS)
  tools/**           # Static tools (CalorieTracker, Social Security...)
  trips/**           # Static itineraries (ChicagoTripItinerary)
```

## Pointers for Trip Cost & Trip Planner
- Firebase config: `app/tools/trip-cost/firebaseConfig.ts` (admin email: `arkkahdarkkahd@gmail.com`)
- Firestore pathing: `artifacts/trip-cost/**` (see `app/tools/trip-cost/db.ts`)
- Context/state: `app/tools/trip-cost/TripContext.tsx`
- UI modules: `app/tools/trip-cost/components/**`
- Trip Planner: `app/tools/trip-planner/page.tsx`, `PlanContext.tsx`, and `components/**` wire Firebase Auth, Firestore listeners, and the timeline/ideas/settings/map UI. Shared config + typed helpers live in `app/tools/trip-planner/lib/` alongside client image compression.

---

**Update this file** whenever structure, commands, or conventions change. Also update **README.md** and **AI_AGENTS.md**.
