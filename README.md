# Selestial

The AI operating platform for cleaning companies. Four agents — Sales,
Recruiter, Dispatch and Retention — work inside one shared operating system.
The owner sets the standards. Selestial carries the work forward.

The source of truth is
[`docs/foundation/00-product-brief.md`](docs/foundation/00-product-brief.md).

This repository and its Vercel project are still named Renuvo, which was the
working name.

## What is here

Only the public landing page. The signed-in product is not built yet.

## Setup

1. `npm install`
2. `cp .env.local.example .env.local`
3. `npm run dev` → http://localhost:3000

`EARLY_ACCESS_WEBHOOK_URL` is where an early-access request is sent. Until it
is set, the form tells the visitor that requests are not open. It never
reports a request it did not send.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · coss UI on Base UI ·
Vercel. Convex and Clerk arrive with the signed-in product.

## Where things are

| Where | What |
|---|---|
| `src/lib/marketing/content.ts` | Every word on the public site |
| `src/components/marketing` | The page's sections and pictures |
| `src/app/globals.css` | Tokens. Brand teal `#2CC5A8`, light only on the public site |
| `src/components/ui` | Shared components |
| `docs/screenshots/landing` | The page at 1280 and 390 pixels wide |

The earlier build (Next.js 14 and Supabase) was removed on November 15, 2026
and is in git history before that date.
