# Renuvo

AI recurring-conversion engine for home service businesses. Converts one-time
jobs into recurring, monthly-billed clients — layered on top of the booking
tools owners already use.

## Setup
1. `npm install`
2. `cp .env.local.example .env.local` and fill in Supabase keys (Stripe/Telnyx/
   Anthropic can stay blank until their prompts).
3. `npm run dev` → http://localhost:3000

## Stack
Next.js 14 (App Router) · TypeScript · Tailwind + shadcn/ui · Supabase (RLS,
multi-tenant) · Stripe Connect · Telnyx · Anthropic. Deploy on Vercel.
