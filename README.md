# Renuvo

The agentic platform for cleaning companies. Four agents run the daily work
inside one shared record: Vera (Sales), Atlas (Dispatch), Scout (Recruiter)
and Loop (Retention). The owner sets the rules and approves what matters.

The source of truth is
[`docs/foundation/00-product-brief.md`](docs/foundation/00-product-brief.md).

## What is here

Only the public landing page. The signed-in product is not built yet.

## Setup

1. `npm install`
2. `cp .env.local.example .env.local`
3. `npm run dev` → http://localhost:3000

`NEXT_PUBLIC_BOOKING_URL` is the scheduling link behind "Book a call". Until
it is set, that button goes to the waitlist form. `WAITLIST_WEBHOOK_URL` is
where a waitlist entry is sent. Until it is set, the form tells the visitor
the waitlist is not open. It never reports an entry it did not send.

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
