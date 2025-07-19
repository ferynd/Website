# Hub

This directory contains the Next.js application that powers the main site. The app is exported as a set of static files for hosting on services like Cloudflare Pages.

## Development

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

The site will be available at `http://localhost:3000`.

## Building for Production

Generate the static export into the `out/` directory:

```bash
npm run build
```

## Directory Overview

- `app/` – App router files and components.
- `public/` – Static assets used by the hub.
- `out/` – Result of `npm run build`. Contents are ready to deploy.

## Customization

Hub data is normally assembled from markdown files under `../content/hub`. To load a static JSON file instead, set `useJsonHubData` in `next.config.ts` to `true`. The JSON configuration lives at `content/hubConfig.json` and uses the same `HubCategory[]` structure returned by `getHubData`.

### How to add animation layers

Animations use Framer Motion and Tailwind utilities. Add new layers by creating a client component that renders `OrbLayer` with your items and push its key onto the `layerStack` in `HubStage`. Each layer appears with the `popSpring` transition defined in `components/Orb.tsx`.

To enable particle ambience run:
```bash
npm install react-tsparticles tsparticles-engine
```
This repository already includes those packages.
