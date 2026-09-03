# Renuvo

Forward the complaints, reviews, and texts you already get. Renuvo shows you
the patterns before they cost you customers.

Landing: [renuvo.io](https://renuvo.io)

## Stack

Next.js 15 · TypeScript · Tailwind · Supabase Auth · Vistrial color system on a
white Novara-style marketing surface.

## Setup

1. `npm install`
2. `cp .env.local.example .env.local`
3. Create a Supabase project named **Renuvo** (the DA org is at the free-plan
   2-project limit — pause or upgrade one of DivineACQ / Vistrial, then create
   it). Apply `supabase/migrations`.
4. Fill `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. In Supabase Auth, set the site URL to `https://renuvo.io` and add
   `http://localhost:3000/**` plus `https://renuvo.io/**` to redirect URLs.
6. `npm run dev` → http://localhost:3000

The former conversion-engine product is documented in
[`WHAT_RENUVO_ONCE_WAS.md`](./WHAT_RENUVO_ONCE_WAS.md).
