# Architecture Overview

## Runtime & Rendering
- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS with CSS variables (HSL tokens) in `app/globals.css`
- **Theme:** Dark by default (`<html data-theme="dark">`); light tokens defined but not default
- **Static sub-sites:** Served directly from `/public`, linked by Next.js pages

## Directory Responsibilities
```
app/
  layout.tsx         # Sets HTML, theme, global font
  loading.tsx        # Fullscreen animated progress bar during route transitions
  page.tsx           # Home hub with cards for Games, Tools, Trips
  games/page.tsx     # Reads a hardcoded list -> links to /public/games/**/index.html
  tools/page.tsx     # Lists React Trip Cost and /public/tools/* static tools
  trips/page.tsx     # Lists /public/trips/** itineraries
  style-guide/page.tsx # Shows tokens (colors, spacing) and base components
  tools/trip-cost/   # Firebase-backed app (Auth + Firestore + context + screens)
components/
  Button.tsx, Input.tsx, Select.tsx, Nav.tsx, ProjectCard.tsx
public/
  games/**            # Noir Detective Idea; Emeril: A World Divided
  tools/**            # Trip Cost link lives in /app; CalorieTracker; Social Security tools
  trips/**            # ChicagoTripItinerary
```

## UI System
- **Tokens:** Defined in `globals.css` as CSS variables: background/surfaces, border, text levels, accent scale, semantic colors (success, warning, error, info), radii, and shadows.
- **Utilities:** Custom utilities under `@layer utilities` (e.g., `.container-tight`, `.section`).
- **Components:** Button uses **class-variance-authority (CVA)** for size/variant; inputs and selects follow the same tokenized system.
- **Icons:** `lucide-react` throughout.

## Games, Tools, Trips
- **Games** (static):  
- **Noir Detective Idea** — An interactive detective story concept (Static HTML).  
  Path: `/games/noir_detective_idea/index.html`
- **Emeril: A World Divided** — An interactive lore page for a world of lost magic and warring factions.  
  Path: `/games/Emeril_A_World_Divided/index.html`

- **Tools**:  
- **Trip Cost Calculator** — Split expenses and calculate balances for a group trip.
  Path: `/tools/trip-cost`
- **Trip Planner** — React-based itinerary planner backed by Firebase Auth + Firestore with a timeline UI, idea library, and shared settings/map panels.
  Path: `/tools/trip-planner`
- **Calorie Tracker** — A simple tool to track daily calorie intake (Static HTML).
  Path: `/tools/CalorieTracker/index.html`
- **Social Security (interactive guide)** — Learn how benefits and earnings interact through simulations.  
  Path: `/tools/social-security/index.html`
- **Social Security (calculator)** — Visualize the financial impact of different claiming strategies.  
  Path: `/tools/social-security-calculator/index.html`

- **Trips** (static):  
- **Chicago Trip Itinerary** — An itinerary for a trip to Chicago (Static HTML).  
  Path: `/trips/ChicagoTripItinerary/index.html`

## Trip Cost & Trip Planner: Data & Modules
- **Config:** `app/tools/trip-cost/firebaseConfig.ts` (admin email `arkkahdarkkahd@gmail.com`).
- **DB helpers:** `app/tools/trip-cost/db.ts` set constants `APP_COLLECTION = 'artifacts'`, `APP_ID = 'trip-cost'` with helpers for `users`, `trips`, and `trips/<id>/audit`.
- **State:** `TripContext.tsx` subscribes to Firestore with `onSnapshot` to keep trip, expenses, payments, etc. in sync.
- **UI:** `components/AuthForm.tsx`, `TripList.tsx`, and `components/TripDetail/**` (Participants, ExpenseForm, ExpensesList, BalanceSummary, PaymentHistory, SettlementSuggestions, ConfirmDeleteModal, AuditLog).
- **Calculations:** `utils/calc.ts` contains pure helpers for totals, balances, and settlements.
- **Trip Planner:** `app/tools/trip-planner/page.tsx` composes the planner shell while `PlanContext.tsx` wires Firebase Auth + Firestore listeners. Supporting modules under `app/tools/trip-planner/lib/` initialize Firebase, expose typed DB helpers, and compress uploads for Storage. Timeline/ideas/settings/map components consume the context for realtime data and CRUD.

## Data Model (Firestore high-level)
Rooted at `artifacts/trip-cost/`:
```
users/{{uid}}
trips/{{tripId}}
trips/{{tripId}}/participants/{{participantId}}
trips/{{tripId}}/expenses/{{expenseId}}
trips/{{tripId}}/payments/{{paymentId}}
trips/{{tripId}}/audit/{{logId}}
```
Authority is enforced by Firestore Security Rules (see SECURITY.md).

## Build & Tooling
- **Scripts:** `dev`, `build`, `start`, `lint`
- **Tailwind:** plugins `@tailwindcss/forms` and `@tailwindcss/typography`
- **next.config.ts:** default (no custom server handlers)
- **tsconfig/eslint:** standard Next.js base with TypeScript 5

## Extending the Site
- Add static sub-sites under `/public` and link from the relevant page in `/app`.
- For React tools, colocate components under `app/tools/<name>/**`, use client components when interactive.
- Keep styles within the tokenized Tailwind system for consistency.
