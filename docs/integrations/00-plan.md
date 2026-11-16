# Integrations

What Selestial connects to, why, and the order it is built in. The list itself is defined once in
`src/lib/app/integrations.ts`; the page at Company → Integrations (`/app/integrations`) is drawn from it.

## The owner's decisions (November 16, 2026)

| Question | Decision |
|---|---|
| Who connects or disconnects an integration | **The Owner only.** Everyone in the company can see what is connected. |
| Stripe | **Both directions.** Each company connects its own Stripe account (Stripe Connect) to charge its customers, and Selestial bills companies for Selestial through Stripe. |
| Other ways for a company to get paid | **All three:** Square, QuickBooks Payments, PayPal and Venmo. |
| Google Drive | **All of it:** agents read the company's documents (price sheets, SOPs, policies, scripts) from a chosen folder, and file what they make: job photos and checklists, signed contracts and agreements, applicant resumes, and new documents and assets the agents create. |
| Address search | **On every address field, US addresses only.** Each picked address also saves its map location. |
| Other Google connections | Calendar (both ways), Business Profile reviews, Gmail (send as the company), Maps travel times for Dispatch. |
| Other integrations | Imports from current software (Jobber, Housecall Pro, ZenMaid, Launch27), accounting (QuickBooks Online, Xero), hiring (Indeed, Checkr). |
| Texting | **Selestial provides each company a local number** through Twilio and handles the carrier registration (A2P 10DLC). The Owner picks an area code. |
| Microsoft 365 | **Added** (same day): Outlook email and calendar, and OneDrive, for companies that are not on Google. Same jobs as Gmail, Calendar and Drive. |
| Review sites | **Added:** Yelp and Facebook recommendations, beside Google Business Profile. Yelp forbids asking for reviews, so on Yelp Retention only shows reviews and drafts replies. |
| Lead sources | **Added:** Google Local Services Ads, Google Ads lead forms and Meta (Facebook and Instagram) lead ads. New leads reach Sales at once; booked jobs are reported back to Google Ads and Meta as conversions. |
| Not chosen for now | Payroll (Gusto) and team chat (Slack). |

## Rules every connection follows

- **Owner only.** Connect and disconnect are checked in Convex against the Owner role, not just hidden.
- **Tokens are encrypted at rest** with a key held in the Convex environment, never in the database in
  clear, and never sent to the browser. Vistrial's token encryption (`TOKEN_ENCRYPTION_KEY`, its
  `secretsMigration`) is the pattern to copy.
- **Least access.** Each connection asks only for the scopes its listed jobs need. Drive uses the
  `drive.file` scope plus a folder the Owner picks, not the whole Drive.
- **Agents act through permissions.** An integration gives an agent a capability; whether it may use it
  without approval is still set per action in Settings → Agent permissions.
- **The page never pretends.** A planned integration says when it comes; there is no button that does
  nothing. A broken connection says what broke and how to fix it.
- **Disconnecting stops use at once** and says what stops working.

## The page

- **Agents first.** The top of the page is a tool belt: each agent with its face, how many tools it works
  with and their logos. Picking an agent filters the page to its tools. A search box finds a tool by name
  or by what it does.
- **Each card** shows the logo, where it stands (a dot and words, like an agent's state), what it does, the
  tools it gives agents as short commands (`src/lib/app/integrations.ts`, `can`), and the agents that use it.
- **Logos** are the brands' own marks in their own colours, one file each in `public/integrations/`, drawn
  on a white tile so the colours read the same in light and dark. Which file each integration uses, and
  how it sits on the tile, is the table in `src/components/app/integration-mark.tsx`; to use a different
  version of a logo, replace its file. Where they came from:
  - Google (G, Ads, Maps, Drive, Calendar, Gmail), Meta, Facebook, PayPal, Square, Xero and OneDrive: the
    SVG Logos collection (gilbarbara/logos, CC0), the current versions.
  - Outlook: the VS Code Icons set (MIT). It is Outlook's flat 2013-style mark, not today's icon.
  - Stripe, QuickBooks, Yelp and Indeed: Simple Icons (CC0), each in the brand's colour. These are the
    symbols only, because the wordmarks are too wide for a tile.
  - Jobber, Checkr, Housecall Pro, ZenMaid and Launch27: the app icon each company publishes on its own
    website (Launch27's is a wordmark).
  - The texting number is Selestial's own feature and uses a chat glyph.
  - Logos belong to their owners and are shown only to say which service a card is about.

## Phases

| Phase | What | Needs from the owner |
|---|---|---|
| 1 | The Integrations page under Company, with every integration, what it does and which agents use it. | Nothing. **Done.** |
| 2 | Google address search, US only, on the property address (new customer) and the company address (Trust & Compliance). A picked property address also saves its place id and map location (`placeId`, `lat`, `lng` on the address). Without the key every field is a plain field. **Built.** | A Google Maps Platform API key with **Places API (New)** enabled, restricted by HTTP referrer to `https://app.selestial.io/*` (and `http://localhost:3000/*` for development) and by API to Places API (New), set on Vercel as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, then a redeploy. |
| 3 | One Google connection per company: Drive, Calendar, Gmail, Business Profile. Maps travel times for Dispatch. The same jobs through Microsoft 365: Outlook email and calendar, OneDrive. | A Google Cloud OAuth client for Selestial (a separate project from Vistrial's, so the consent screen says Selestial), its verification for the Drive, Calendar and Gmail scopes, and Business Profile API access. A Microsoft Entra app registration for Selestial (multi-tenant) with Mail.Send, Calendars.ReadWrite and Files.ReadWrite delegated permissions, and publisher verification. |
| 4 | Payments: Stripe Connect for companies, Stripe Billing for Selestial's own subscription, then Square, QuickBooks Payments, PayPal and Venmo. | A Stripe platform account for Selestial with Connect enabled; Square, Intuit and PayPal developer apps. |
| 5 | Texting numbers through Twilio with A2P registration; QuickBooks Online and Xero; Indeed and Checkr; imports from Jobber, Housecall Pro, ZenMaid and Launch27. | A Twilio account for Selestial (ISV), Intuit and Xero apps, Indeed and Checkr partner access. Imports read each tool's export files or API, depending on what each offers. |
| 6 | Lead sources: Google Local Services Ads, Google Ads lead forms with conversions sent back, Meta lead ads with conversions sent back (Conversions API). Review sites: Yelp and Facebook recommendations. | A Google Ads developer token (Basic access) and Local Services API access; a Meta app with Lead Ads and Pages permissions through App Review; Yelp Fusion API access (review reading is limited to partners, so this may be read-only or partner-gated). Vistrial's Google Ads and Meta work is the pattern to reuse. |
