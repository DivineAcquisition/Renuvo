# Verification and go-live steps

Phase 6 of the email build. This page says what was checked, and how. Passing tests is not the same as
production-ready: the go-live steps below still have to happen.

## Checked in automated tests (convex-test, edge runtime)

| Area | Where | What it proves |
|---|---|---|
| Tenant isolation | `notifications`, `inboxes`, `emailVerification` | A notice never reaches another company's member, even when named. Another company can't read, change or disconnect an inbox, and can't read notices. |
| Permissions | `notifications`, `inboxes` | Only the Owner connects, changes or disconnects inboxes. Each person changes only their own settings. Security notices are always on; account notices are always on for the Owner. |
| Opt-outs | `notifications`, `emailVerification` | Category off → no notice. Unsubscribe turns off one category for one person, only on a POST or a button press. Security and account notices refuse it and carry no unsubscribe link or header. |
| Rendering | `templates`, gallery screenshots | Every template stays inside a 600px table layout. No scripts. Only http(s) links, and each link also appears in the plain text. At most one button. Missing values are left out. Values from records are escaped. Each email is under 40 KB (Gmail clips at 102 KB). |
| Threading | `inboxes` | A reply joins the applicant's own thread, with threadId, In-Reply-To, References and a `Re:` subject. A job board's thread is never joined. Header values can't add lines. |
| Duplicates | `notifications`, `emailVerification` | One notice per event, record and person. A webhook report delivered twice is recorded once. Approval reminders and the digest go once per hour window. |
| Retries | `emailVerification`, `inboxes` | A refused notice is retried and goes exactly once. A Gmail 5xx is never resent; the message is marked unconfirmed. A Gmail 429 is retried. |
| Disconnected inboxes | `inboxes` | A message for a broken inbox waits and goes nowhere else. It goes once the inbox is reconnected. A refusal mid-send waits too. Disconnect revokes the grant, or keeps it when it's shared. |
| Expired and tampered links | `notifications` | A forged or altered unsubscribe token answers nothing. An approval decided or expired before its notice went sends nothing, with the reason recorded. |
| Webhook authenticity | `emailVerification`, `recruiterProviders` | On the real HTTP route, a forged signature gets 401 and changes nothing. Complaints stay distinct from bounces, are accepted after delivery, and block the address. |
| Sender rules | `notifications` | Every From is built from configured, verified addresses. An unverified From, or a header that adds a line, is refused before Resend is called. A company name is only a display name. |
| Recruiter preserved | `recruiterGmail`, `recruiterInvite`, … | All existing Recruiter mailbox tests pass unchanged. |

Other checks:
- Full suite: 1160 passed.
- `tsc` passes for the app and for Convex.
- eslint shows no errors.
- `next build` succeeds.

## Checked by eye

- **All 12 emails** were rendered with Playwright in light and dark, at 720 and 390 px. Dark-mode
  contrast was fixed for secondary text and tones.
- **Settings › Notifications:** settings, recent notices, the blocked-address banner, and the email
  preview gallery (desktop, phone, dark, plain text). Checked for console errors and horizontal
  overflow at 390 px.
- **Connected apps › Gmail:** the inbox list, a broken inbox, the findings from the first read, the
  connect form, and the Outlook "Coming soon" card.

## Not verified here

- **No live send through Resend.** Rendered templates were not sent to `delivered@resend.dev`,
  `bounced@resend.dev` or `complained@resend.dev`. The Resend tool needs the From address chosen by a
  person.
- **No real Google sign-in.** The OAuth round trip, Gmail sending, threading and revocation ran against
  a faithful fake of Google's endpoints. No Google account can sign in from this environment.
- **Outlook / Microsoft 365** is not built.

## Go-live steps

1. **DNS at GoDaddy.** Replace the two `_dmarc` TXT records with one:
   `v=DMARC1; p=none; rua=mailto:<a mailbox you read>; adkim=r; aspf=r`. With two records, DMARC
   isn't applied at all. Every Resend sending subdomain is already verified.
2. **Convex settings on the live backend (terrific-avocet-835), before merging:**
   - `APP_ORIGIN=https://app.selestial.io`. Without it, notices go without buttons or images, and
     member invitations aren't emailed.
   - `LINK_ORIGIN=https://link.selestial.io`.
   - `NOTIFY_EMAIL_FROM=Selestial <notify@notify.selestial.io>`.
   - `COMPANY_EMAIL_FROM=<chosen address>@mail.selestial.io`. Optional: otherwise
     `RECRUITER_EMAIL_FROM` is used.
   - `PLATFORM_REPLY_TO=<a monitored Selestial inbox>`. Optional.
   - `SALES_REPLY_DOMAIN=reply.selestial.io`.
3. **Resend webhook for the live backend.** Add an endpoint
   `https://terrific-avocet-835.convex.site/webhooks/resend` with these events: delivered, bounced,
   complained, failed, suppressed, delivery_delayed, received. Put its signing secret in
   `RESEND_WEBHOOK_SECRET` on that deployment. Today the only endpoint points at stoic-gazelle-731.
4. **Google Cloud (Gmail).**
   - The OAuth consent screen lists `gmail.readonly`, `gmail.send`, `openid` and `email`.
   - Authorized redirect URI: `https://terrific-avocet-835.convex.site/oauth/google/callback`.
   - Until verification, add test users.
   - Submit for verification. `gmail.readonly` is restricted and needs a CASA assessment.
   - Pub/Sub topic `GOOGLE_PUBSUB_TOPIC`: give `gmail-api-push@system.gserviceaccount.com` the
     Publisher role. Push subscription to `https://terrific-avocet-835.convex.site/webhooks/google/pubsub`,
     authenticated as `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`.
5. **Deploy.** Merge PR #111. Since #114, the live backend changes only through a merge to main.
6. **After deploy,** send one controlled test of each email to `delivered@resend.dev`, then one to
   `bounced@resend.dev` and one to `complained@resend.dev`. Confirm each message's status on its row.
