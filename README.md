# Personal Website

This repository contains the static files for my personal site. The pages are plain HTML with inline CSS and a few external libraries.

## Local Setup

1. Clone the repository.
2. No build step is required. Serve the files directly with a static file server of your choice. For example, using Python:
   ```bash
   python3 -m http.server 8080
   ```
   Then open `http://localhost:8080` in your browser.

## Directory Overview

- `index.html` – Home page linking to all other sections.
- `games/` – Small experiments and demos.
  - `noir_detective_idea/` – Prototype for a noir adventure game.
- `tools/` – Utility pages.
  - `CalorieTracker/` – 3‑day rolling average nutrition tracker.
- `trips/` – Itineraries and travel notes.
  - `ChicagoTripItinerary/` – Example weekend plan for Chicago.

## Deployment on Cloudflare Pages

1. Log into Cloudflare and create a new Pages project.
2. Connect the project to this repository.
3. For build settings, leave the build command empty and set the root directory to `/`.
4. Cloudflare will serve the files from the main branch. Any new commit will trigger a deployment.

