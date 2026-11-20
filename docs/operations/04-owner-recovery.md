# Owner recovery, notifications and support handoff

Code: `convex/lib/operations/owner.ts` (cards), `notify.ts` (who is told), `alerts.ts` (staff alerts),
`convex/operations.ts` (`issues`, `contactSupport`, `sendStaffAlerts`), and in the app
`src/components/app/issues/issue-cards.tsx`. Tests: `convex/recovery.test.ts`.

## Cards

An incident that affects the company's work has a card, worked out from the incident as it is now:

- a plain title ("Your hiring inbox needs reconnecting");
- what is affected, and what is safe ("Recruiter can't check new applications. Your existing applicants
  are saved.");
- what Selestial has already done, from the records (retries counted, "Selestial's team took over");
- one next step that does the real thing: open the exact page (Reconnect Gmail, Open texting setup,
  Check your email settings), run the existing retry (`activation.retry`, Owner only), or nothing when
  Selestial is handling it;
- Details: the timeline in the company's words, the reference (`INC-XXXXXX`), when it was last checked,
  and Contact support.

Cards appear on **Home** under the briefing ("Needs your attention", plus "Fixed recently" for three days)
and **beside the work they affect**: Connected apps (inboxes, Google, Jobber), Texting, Your first work and
Notifications. Owners and Managers see them; Office, other companies and anyone outside see nothing.
Provider codes, record ids, addresses and diagnostics never reach a card.

Billing settlements, balance attention and Selestial's platform checks have no card: the company's work
is not affected by them, or an existing notice already covers them.

| Kind | Card | Next step |
|---|---|---|
| Inbox expired | Your hiring inbox needs reconnecting | Reconnect Gmail |
| Inbox reads failing | We're having trouble reading your inbox | Review the inbox |
| Google expired / Google work failed | Google needs reconnecting / A Google task couldn't finish | Reconnect Google, or Selestial handles it |
| Google write uncertain | We're checking whether a Google change went through | — |
| Jobber / Housecall Pro expired | Jobber needs reconnecting | Reconnect |
| Delivery not confirmed | We're checking whether a message was sent | — (no second attempt until known) |
| Owner notices failing | Your notification emails aren't arriving | Check your email settings |
| Texting needs the owner / paused / stuck | Business texting needs your answer / The carriers paused your business texting / We're finishing your texting setup | Open texting setup / See what's happening |
| First work failed / stalled | A piece of your agents' first work couldn't finish / … is taking longer than expected | Try again / Review your agents' work |

## Who is told

Each incident remembers who was told during its open period (`notified`), so a check every five minutes
tells nobody twice. A reopened incident starts a new period.

| When | Company (Owner and Managers, in the app) | Owner by email | Selestial staff |
|---|---|---|---|
| It needs them (waiting for the owner) | Once | Once, unless the kind already sends its own email (inbox reconnect, texting) or email is the thing failing | — |
| A serious interruption begins (high or critical) | Once | Only when critical | When critical, or needing staff at high severity |
| Automatic recovery ran out (recovering → needs staff) | "Selestial's team has taken over", if they were told before | — | Once |
| The company clicks Contact support | — | — | Once a day per incident |
| It is fixed | "Fixed: …", if they were told | — | — |

The email is written when it goes, from the incident as it is then: if it was already fixed, nothing is
sent. Notices to a company's people never use its messaging balance (`member_notice` is an included
purpose).

### Staff alerts

Alerts wait in `staffAlerts` and go out every five minutes as **one message per person** (active admins
and support staff) listing everything waiting, with a link to Operations (`ADMIN_ORIGIN`). If a channel
cannot send, the batch waits and the next run sends the same batch with the same idempotency key, so
nobody gets it twice. Channels are one interface (`ALERT_CHANNELS`): email now, Discord later.

## Contact support

The card's Contact support records on the incident that the company asked, alerts staff, and opens an
email to support@selestial.io already filled in: reference, company, problem, what is affected, first
noticed, last checked, status, and what Selestial has done. It never includes secrets, addresses or
message content, so the owner does not have to describe what Selestial already knows.

## Not verified here

- Cards were reviewed in a browser with stub data, not against the live backend.
- Staff alert email needs `EMAIL_PROVIDER` and `RESEND_API_KEY` on the backend (as every email does) and
  `ADMIN_ORIGIN` on the Convex deployment for the Operations link; without `ADMIN_ORIGIN` it falls back to
  `APP_ORIGIN`, and without either the email has no link.
