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

The links and categories on the landing page are configured in `app/page.tsx`. Edit the `categories` array to add new resources.
