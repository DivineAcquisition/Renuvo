# Google integrations

One connection **per Google tool** — Drive (with Docs and Sheets), Calendar, Business Profile, Google Ads, and conversion reporting — each made by the Owner under **Settings › Integrations**, in the "Google tools" panel (`/app/settings/integrations#google`). Each tool has its own sign-in, Google account (they may differ), grant (`include_granted_scopes=false`), sealed token, chosen resources and disconnect. Disconnecting a tool revokes at Google only when no other connected tool uses the same Google account, because Google revokes per account, not per tool. Rows from before this change are moved with `npx convex run google:migrateToPerTool`.
It is separate from signing in to Selestial with Google (Clerk). Platform credentials (Maps, Routes,
Gemini, Pub/Sub, the Ads developer token) are Selestial's and never mix with a company's OAuth grant.

## How it works

| Piece | Where |
| --- | --- |
| Connect, incremental consent, partial consent, reconnect, different account, disconnect | `convex/google.ts`, callback in `convex/http.ts` |
| Scopes per feature | `convex/lib/google/features.ts` |
| Token sealing (AES-GCM, bound to the connection) | `convex/lib/recruiter/secrets.ts` (key: `MAILBOX_TOKEN_KEY`) |
| Authorized resources (files, folders, calendars, locations, ad accounts, conversion action), checked with Google | `googleResources`, `convex/googleWork.ts` `verifyResource` |
| Durable jobs: keys, retries with backoff, rate limits, stuck sweep, reconcile-before-retry | `convex/googleWork.ts`, `convex/googleExecutors.ts`, `convex/lib/google/jobs.ts` |
| Drive / Docs / Sheets | `convex/googleDrive.ts` |
| Calendar sync, busy times, watch channels, external-change tasks | `convex/googleCalendar.ts` |
| Business Profile reviews, approved replies, neutral review-request rule | `convex/googleBusiness.ts` |
| Lead forms, Local Services, campaign drafts, conversions (Data Manager) | `convex/googleAds.ts` |
| Drive times and day-plan proposals | `convex/googleRoutes.ts` |
| Gmail push for hiring inboxes; read and send are separate permissions | `convex/recruiterGmailWatch.ts`, `convex/lib/recruiter/gmail.ts` |
| Chat tools | `convex/lib/chat/googleTools.ts` |
| Operator live checks (no secrets printed) | `npx convex run googleChecks:platform` |

Rules that hold everywhere:

- Only the Owner connects, disconnects and chooses resources. Disconnecting cancels queued work, deletes resources and the stored authorization at once, and revokes the grant at Google.
- A feature is on only when all its scopes were granted. Choosing a folder does not share the files in it (drive.file); the page says so.
- Exporting an agreement to Google Docs is a copy and never changes its status.
- Visits are never moved by a Google Calendar change: a task asks a person.
- Review replies are posted only after an Owner or Manager approves the exact text. Drafts from Chat stay drafts.
- Campaign drafts cost nothing. The Owner approves a draft and budget (created **paused**), and turning it on is a second Owner decision.
- Conversions are sent only with a click id, the Owner's recorded consent basis and a chosen conversion action, once per visit (transaction id = visit id).

## Configuration

Convex (per deployment, `npx convex env set NAME value`; never commit values):

| Variable | Unlocks |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Connecting Google (and Gmail hiring inboxes) |
| `MAILBOX_TOKEN_KEY` | Storing any Google authorization (32 random bytes, base64) |
| `GOOGLE_ADS_DEVELOPER_TOKEN` (optional `GOOGLE_ADS_API_VERSION`, default `v21`) | Ads accounts, results, Local Services leads, campaign drafts |
| `GOOGLE_MAPS_SERVER_KEY` | Drive times (Routes API). Restrict to the Routes API |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLOUD_PROJECT` | Day-plan proposals (Route Optimization API) |
| `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT` | Push notifications for Gmail and Business Profile (timers work without them) |
| `GEMINI_API_KEY` | Gemini through the shared AI layer |

Vercel (public, browser):

| Variable | Unlocks |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Address autocomplete (restrict to Places API (New) and your domains) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` | Google's file chooser (Picker). Without them, Owners paste Drive links |

Addresses the deployment computes from `CONVEX_SITE_URL` (shown to the Owner under Settings › Integrations › Google tools › Setup):

- OAuth redirect URI: `<CONVEX_SITE_URL>/oauth/google/callback` — register on the OAuth client.
- Calendar push: `<CONVEX_SITE_URL>/webhooks/google/calendar` — the domain must be verified for the project.
- Pub/Sub push subscription endpoint: `<CONVEX_SITE_URL>/webhooks/google/pubsub` — push with OIDC auth as `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, audience = that URL. Grant `gmail-api-push@system.gserviceaccount.com` and `mybusiness-api-pubsub@system.gserviceaccount.com` publish rights on the topic.
- Lead form webhook: `<CONVEX_SITE_URL>/webhooks/google/leads`, with the key the Owner makes on the page.

Approvals Google requires before these work for customers: OAuth consent screen verification for
sensitive scopes (Calendar, Gmail) and restricted scope review / security assessment for `gmail.readonly`;
Business Profile API access approval; a Google Ads developer token with Basic or Standard access;
Local Services Ads API access for the account; Data Manager API access.
