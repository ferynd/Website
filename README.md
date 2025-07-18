# Personal Website

This repository contains the static HTML pages for my website. There is no build step or framework; the site is served directly from these files.

## Local Setup

1. Clone the repository.
2. Start a simple static server from the project root. For example:
   ```bash
   python3 -m http.server 8080
   ```
   Then open `http://localhost:8080` in your browser.

## Directory Overview

- `index.html` – Landing page linking to everything else.
- `games/` – Small demos and experiments.
  - `noir_detective_idea/` – Prototype noir adventure.
- `tools/` – Utility pages.
  - `CalorieTracker/` – Three‑day rolling average nutrition tracker.
- `trips/` – Travel notes and itineraries.
  - `ChicagoTripItinerary/` – Example weekend plan for Chicago.

## Deployment on Cloudflare Pages

1. Create a new Pages project and connect it to this repository.
2. Leave the build command blank and set the root directory to `/`.
3. Cloudflare will deploy on every commit to the main branch.
