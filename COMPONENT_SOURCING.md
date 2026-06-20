# Renuvo — Premium Component Sourcing Map

The map of **free, premium-quality** component sources to pull from, per sector —
all copy-paste, MIT/Apache, Tailwind + React, shadcn-compatible. Premium feel
without premium cost and without Frankenstein UI.

> **The governing rule:** these libraries are *sources*, not the design system.
> `P28B` (the design primitives) + `PAGE_SYSTEM.md` (Prompt 51) are the law. Every
> pulled component is **adopted, not adapted**: copy it in, strip its default theme,
> re-skin to Renuvo tokens, and make it pass the §9 checklist. A component that
> still looks like its library is a bug.

## 0. The locked stack

| Layer | Source | Use for |
|------|--------|---------|
| **Foundation** | shadcn/ui (Radix) | forms, tables, dialogs, nav, primitives |
| **Animation** | Magic UI | count-up, marquee, kinetic text, animated lists |
| **High-impact** | Aceternity UI | animated hero/landing sections (sparingly) |
| **Data/viz** | Tremor (free, Vercel) | KPI cards, charts, sparklines, bar lists |
| **Charts core** | Recharts v3 *(installed: `^3.8.1`)* | the chart engine under Tremor/shadcn charts |
| **Tables** | TanStack Table | headless sort/filter/paginate/virtualize |
| **Primitives+** | Origin UI / ReUI | advanced inputs, timelines, OTP, date/time |
| **Icons** | Lucide *(installed)* | the shadcn default set |
| **Motion** | framer-motion *(installed: `^12.40.0`)* | all animation |

All free, MIT/Apache, copy-paste (you own the code). **No paid tiers.**

Why not a big template (TailAdmin, etc.): templates lock you into *their* look.
Renuvo already has a distinctive system — pull *components* to re-skin, not a *theme*
to inherit.

## 1. Foundation & primitives (every sector)
- **Source:** shadcn/ui (+ Origin UI / ReUI for what shadcn lacks — rich/segmented
  inputs, timelines, OTP for A2P/auth, date/time pickers, tag inputs).
- **Re-skin:** the brand tokens already live in `app/globals.css` (the purple ramp
  `#4F38FF/#6A57FF/#9A8CFF`, neutrals, semantic colors, radii, glass shadows, the
  three fonts). New shadcn/Origin/ReUI components inherit them automatically.
- **Covers:** settings (25/33/35), auth (10/36), all forms, accounts (45), command
  bar, dialogs/confirms.

## 2. Dashboard, analytics & intelligence (data sectors)
- **Source:** Tremor + Recharts v3 underneath.
- **Use for:** KPI/stat cards, Area/Bar/Line/Donut charts, BarList, sparklines,
  progress, metric deltas — the P23 dashboard, P32 home, P48 intelligence
  benchmarks, P49 financial book-health.
- **Keep our signature:** the existing self-drawing `AreaChart` + `CountUp`
  (`components/ui/`) stay for hero metric moments. Use Tremor for *dense* charts
  (breakdowns, benchmark bars, financial trends) — but always **our palette + mono
  tabular numerals**, never Tremor defaults.
- **Tables:** TanStack Table for the accounts hub (45), customers/plans (34), admin
  directory (37) — skinned with shadcn Table + our tokens.
- **Covers:** 23, 24, 32, 37, 45, 48, 49.

## 3. Capture page & customer-facing (conversion + portal)
- **Source:** Aceternity UI + Magic UI — **disciplined**. Pull specific effects (a
  tasteful gradient backdrop, a smooth reveal, the success draw) — not a kitchen
  sink. **One signature motion per surface.**
- **Tenant branding:** customer surfaces carry the *business* brand (42/46) — these
  components must accept a **dynamic accent**, never hardcode purple.
- **Covers:** 18, 40, 46. (Email stays React Email — see `emails/`, Prompt 52.)

## 4. App shell, navigation & marketing
- Keep the existing glass sidebar/topbar shell. Pull shadcn's Sidebar primitive only
  if you want its collapsible/mobile-drawer behavior (re-skinned).
- **Command bar (⌘K):** shadcn `Command` — premium feel, low effort, skinned to
  glass. (Currently a placeholder in the topbar — this is the source to finish it.)

## 5. Per-sector quick map

| Sector | Primary source | Skin to |
|--------|----------------|---------|
| Auth / onboarding (10,26,36) | shadcn + Origin UI inputs | brand tokens |
| Dashboard / analytics (23,32) | Tremor + Recharts | purple ramp + mono + glass |
| Intelligence (48) / Finance (49) | Tremor (charts, bar lists) | purple ramp + mono |
| Inbox (34) | shadcn (list, scroll, input) | glass thread bubbles |
| Customers / Plans / Accounts (34,45) | TanStack Table + shadcn | table tokens |
| Capture page (18) | Aceternity/Magic UI (subtle) | tenant accent (dynamic) |
| Customer portal (46) | shadcn + light Magic UI | tenant brand |
| Settings / Controls (25,33,35) | shadcn forms + Origin UI | brand tokens |
| Admin (37) | Tremor + TanStack Table | distinct admin accent |
| Command bar (32) | shadcn Command (⌘K) | glass |
| Email (52) | React Email (`emails/`) | the P52 kit |

## 6. Re-tokenization (do once, centrally)
1. **Theme source of truth:** `app/globals.css` holds the Renuvo tokens (mirror them
   everywhere).
2. **shadcn:** init with these vars as the base — components inherit the brand.
3. **Tremor:** override its palette + typography to the tokens; force mono tabular
   numerals on all axes/labels/values.
4. **Aceternity/Magic UI:** find-and-replace hardcoded colors/gradients to token vars
   on copy-in; accept a dynamic `accent` prop on customer-facing ones.
5. **Motion:** standardize on framer-motion; align durations/easings to the existing
   .15–.4s set; honor `prefers-reduced-motion` (already global).
6. Run every pulled component through the §9 checklist.

## 7. What NOT to pull
- No **second foundation** (MUI/Ant/Chakra) — shadcn is THE foundation.
- Not Tremor's whole template — only the chart/card components needed.
- Not Aceternity/Magic UI "everything" — over-use = AI-slop.
- Not Nivo (500kB+) unless Recharts genuinely can't do it.
- No paid tiers (Aceternity Pro, ReUI Pro, Tailwind Plus) — free tiers cover it all.
- Don't let any library's default theme survive — un-skinned = rejected.

## 8. Folder organization (own, re-skinned)
```
components/
  ui/      → foundation (shadcn/Origin/ReUI) + our P28B primitives  (exists)
  fx/      → animated (Magic UI / Aceternity), re-tokenized
  charts/  → Tremor wrappers, themed to tokens
  data/    → one reusable <DataTable> (TanStack + shadcn Table) per P51:
             sort/filter/paginate/virtualize + loading/empty/error states
```
Build the `<DataTable>` once and reuse for ALL tables (accounts, customers, plans,
admin). CSV export where useful.

## 9. Adoption checklist (every pulled component passes)
- [ ] Re-skinned to Renuvo tokens — no trace of the source's default theme/colors/radius
- [ ] Numerals mono/tabular; money via `<Money/>`; fonts Bricolage/Inter/JetBrains
- [ ] Glass/shadow matches the system; one signature glass + one ambient wash per view max
- [ ] Motion = framer-motion at the standard durations/easings; reduced-motion honored
- [ ] Passes `PAGE_SYSTEM.md` rules (states, server/client split, a11y, 360px)
- [ ] Customer-facing ones accept a dynamic tenant accent (not hardcoded purple)
- [ ] No second foundation; bundle impact checked; no paid-tier dependency
- [ ] Lives in the right `components/` folder; source owned (no runtime lock-in)

## Sources (free, MIT/Apache, mid-2026)
shadcn/ui · Magic UI · Aceternity UI · Tremor · Recharts v3 · TanStack Table ·
Origin UI / ReUI · Lucide. All copy-paste, Tailwind, React/Next App Router,
you-own-the-code.

## Current state in this repo
- **Installed & in use:** the shadcn-style primitive set (`components/ui/`),
  Recharts v3, framer-motion, Lucide, sonner, the bespoke `AreaChart`/`Sparkline`/
  `CountUp` signatures, and the Prompt 51 page primitives (`PageHeader`, `Section`,
  `EmptyState`, `Skeleton`, `ErrorCard`).
- **Not yet pulled (pull on demand, per this map):** Tremor, TanStack Table,
  Magic UI / Aceternity effects, Origin UI / ReUI inputs, the shadcn `Command`
  palette (the ⌘K placeholder in the topbar is where it lands).
