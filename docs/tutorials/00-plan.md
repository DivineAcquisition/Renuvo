# Migration tutorials and contextual help

**"An owner can open relevant help without leaving their migration, follow a verified narrated walkthrough,
obtain the correct file, and return directly to the next step in Selestial."**

Status: product, importers, staff controls and production pipeline built November 20, 2026. No tutorial is
published yet: footage needs the demo accounts (below). Owners see honest written fallbacks until then.

## Decisions made by the Owner (November 20)

| Area | Decision |
|---|---|
| Platforms | Jobber, Housecall Pro and BookingKoala demo accounts are available; recorded on the Owner's computer through Remote Control. |
| Voice | ElevenLabs stock voice **Eric** (warm, neutral US), chosen from four samples. Key saved as a network secret on the development environment, never in the app. |
| Unsupported records | Build the importers: appointments, recurring service and history, same flow as clients. |
| Hosting | Vercel Blob, store `selestial-tutorials` (public, iad1), connected to the `selestial-ai` project. |
| Staff tools | A Tutorials page in the existing staff console. |

## What was there before

- Client import from CSV recognizing Jobber, Housecall Pro and BookingKoala exports, plus Jobber OAuth and
  Housecall Pro API reads (`setup/import.tsx`, `setup/connectors.tsx`). Cleaner CSV import.
- No appointment, recurring-service or history import; no video player; no help directory; support is
  `support@selestial.io`. Analytics are Convex tables (setup funnel), not a third-party tool.
- Shared Base UI dialog (focus trap, focus return), design tokens, staff console.

## What is built

| Part | Where |
|---|---|
| Catalog: ids, platform, task, steps, role, plan, format, limits, sources, check dates, placements, action, transcript, media, default state | `convex/lib/tutorials/catalog.ts` |
| Publication state, media version override, outdated reports, events | `convex/lib/tutorials/schema.ts`, `convex/tutorials.ts` |
| Dialog and player (keyboard controls, captions, speed, volume, full screen, no autoplay, pause on close, focus return, retry and written fallback) | `src/components/app/tutorials/host.tsx`, `player.tsx` |
| Placements: source card (dismissible), "Where do I find this file?", empty-upload preview, unsupported file, missing columns (written fix first), missing properties, records imports, cleaner import, migration review, help directory | `offer.tsx`, `setup/migration.tsx`, `setup/import.tsx`, `/app/help` |
| Appointments, recurring and history import: matched to existing clients by email, phone or exact name, held for review, nothing booked or billed | `convex/migrationImports.ts`, `setup/records-import.tsx` |
| Templates | `public/templates/*.csv` |
| Staff: state, media version, reports, use counts and a non-causal comparison | `/staff/tutorials` |
| Production: storyboards, narration with timings, capture, assembly, upload | `tutorials/` (see `tutorials/README.md`) |

## Verification record

Help articles read November 20, 2026. "Interface" means followed in a real demo account.

| Tutorial | Source (updated) | Role / plan | Docs | Interface | State |
|---|---|---|---|---|---|
| jobber-export-clients | Export client information (Oct 29, 2026) | Admin; "select plans"; 1,500 rows per file | ✓ | — | Ready for review |
| jobber-export-visits | Visits report (Oct 29, 2026) | Admin or listed permissions; reports on select plans | ✓ | — | Ready for review |
| jobber-export-recurring | Recurring Jobs Report (Nov 12, 2026) | Admin or listed permissions | ✓ | — | Ready for review |
| jobber-export-invoices | Invoice and payment reports (Oct 29, 2026) | Admin or Reports permission | ✓ | — | Ready for review |
| Jobber team | No team export in Jobber's help center | — | — | — | Not offered; cleaner template instead |
| hcp-export-customers | How to Import & Export Jobs and Customers (Jul 21, 2026) | Admins only | ✓ | — | Ready for review |
| hcp-export-jobs | Job & Estimate List Reporting (Jul 16, 2026) | Admins only | ✓ | — | Ready for review |
| hcp-export-recurring | Job list "Recurring" column; frequency not documented | Admins only | partial | — | Draft |
| hcp-export-invoices | Jobs export includes invoices | Admins only | ✓ | — | Ready for review |
| HCP team | No employee export in Housecall Pro's help center | — | — | — | Not offered |
| bk-export-customers / providers / bookings | help.bookingkoala.com blocks automated reading (Cloudflare); changelog read | Unknown | — | — | Draft |
| spreadsheet-prepare-clients (reference) | Selestial itself | Owner or Manager | ✓ | ✓ (code) | Ready for review; narration generated |
| spreadsheet-prepare-team / records, fix errors, review | Selestial itself | Owner or Manager | ✓ | — | Draft |

## Still needed

1. **Recording access.** Share a folder through Remote Control (Claude desktop app › Settings › Claude Code ›
   Remote Control) so the demo accounts can be recorded in your signed-in browser. Needed for every platform
   tutorial and for the Selestial scenes of the reference tutorial (a running Selestial with a demo owner).
2. **BookingKoala steps.** Its help center must be read and the exports followed in the demo account.
3. **Narration review.** Listen to the reference narration; approve or edit the lines.
4. **Each video's review** against the checklist in `tutorials/README.md`, then publish from /staff/tutorials.
5. **Deploy** the Convex schema and functions (`npx convex deploy`): codegen could not reach Convex from the
   build session, so `convex/_generated/api.d.ts` was updated by hand and should be regenerated.
