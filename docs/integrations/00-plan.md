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

## Phases

| Phase | What | Needs from the owner |
|---|---|---|
| 1 | The Integrations page under Company, with every integration, what it does and which agents use it. | Nothing. **Done.** |
| 2 | Google address search, US only, on the property address (new customer) and the company address (Trust & Compliance). A picked property address also saves its place id and map location (`placeId`, `lat`, `lng` on the address). Without the key every field is a plain field. **Built.** | A Google Maps Platform API key with **Places API (New)** enabled, restricted by HTTP referrer to `https://app.selestial.io/*` (and `http://localhost:3000/*` for development) and by API to Places API (New), set on Vercel as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, then a redeploy. |
| 3 | One Google connection per company: Drive, Calendar, Gmail, Business Profile. Maps travel times for Dispatch. | A Google Cloud OAuth client for Selestial (a separate project from Vistrial's, so the consent screen says Selestial), its verification for the Drive, Calendar and Gmail scopes, and Business Profile API access. |
| 4 | Payments: Stripe Connect for companies, Stripe Billing for Selestial's own subscription, then Square, QuickBooks Payments, PayPal and Venmo. | A Stripe platform account for Selestial with Connect enabled; Square, Intuit and PayPal developer apps. |
| 5 | Texting numbers through Twilio with A2P registration; QuickBooks Online and Xero; Indeed and Checkr; imports from Jobber, Housecall Pro, ZenMaid and Launch27. | A Twilio account for Selestial (ISV), Intuit and Xero apps, Indeed and Checkr partner access. Imports read each tool's export files or API, depending on what each offers. |
