# Dispatch: the cleaner's texts and pages

A cleaner does a job's tasks from their phone, from links in texts, without an account.

## The link

- **Scope.** One company, one cleaner, one assignment, a named list of actions, an expiry, a revocation.
- **Token.** `<public id>.<signature>`. The id is 128 random bits; the signature is HMAC-SHA-256 of it
  with `ACTION_LINK_SECRET`, set on the Convex deployment. **The token is never stored**: not on the link,
  not in the message (the body is kept with `{link}` in its place), not in an event. With no secret set,
  no link can be issued or opened. No cleaner id, job id or other record id authorizes anything.
- **Two kinds, two lives.** An *offer* link may `accept` and `decline` and ends at the response deadline.
  A *job* link is issued when the cleaner accepts, may `check_in`, `report_delay`, `cannot_attend`,
  `checklist`, `photos`, `report`, `complete`, and lasts until the job's end plus `jobAccessGraceHours`.
  The offer's deadline never touches the job link.
- **Revocation.** Any end of the assignment closes its links in the same step (`endAssignment`): declined,
  expired, withdrawn, released, dropped, no-show, job cancelled. A manager can also revoke one, or issue a
  fresh one, which closes the old.
- **Reads change nothing.** `linkQuery` cannot write. Opening or previewing a link accepts nothing.
- **Every action is re-checked.** `linkMutation` requires the link to be active and to list the action;
  the handler then checks the assignment and the job as they are now.
- **History.** `link.issued`, `link.action` (with the action), `link.revoked`, `link.revealed` events.
  Page visits are not recorded, so nothing claims a link was "opened".
- **Host.** Every texted link is built from one setting, `LINK_ORIGIN` on the Convex deployment (planned:
  `https://link.selestial.io`; a local or preview address works the same way). The pages live under `/c`,
  outside the signed-in app, and load no sign-in code.
- **Headers on `/c/*`.** `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.

A manager can show a live link's address to pass on by hand (`revealActionLink`). That is recorded, and
the address is returned to that caller only.

## Texts

Every text names the company, has one purpose and at most one link (`convex/lib/dispatch/sms.ts`).

| Text | When | Link |
|---|---|---|
| Job offer | An offer is made | Offer page. Says service, day and arrival window, city and postal code, role, estimated pay, deadline |
| Cover needed | A backup offer | Offer page, same contents |
| Confirmed | The cleaner accepted | Job page |
| Reminder | `reminderLeadMinutes` before the start, if `dispatch.send_reminder` allows | Job page. Says when the job is. It never says the cleaner is on the way |
| Before photos | After check-in, if `sendBeforePhotoLink` | Job page, photos |
| No check-in yet | First step of the no-check-in ladder | Job page, delay |
| Offer no longer open | Someone else took the last place | none |
| No longer assigned | After a declared no-show | none |

All texts go through one interface (`convex/lib/messaging/provider.ts`). **Only a mock provider exists.**
Telnyx is the planned provider and is a stub that refuses; nothing in this code can reach a real phone.
`MESSAGING_PROVIDER` unset means "not connected": the message is recorded as `not_sent`, the offer still
exists, and the owner sees that no text went.

A failed send is retried up to three times when the provider says it may work. A text that fails for
good, or whose fate is unknown, ends the offer as **undelivered**, sends the cleaner's contact details to
a person to check, and moves on. It is never recorded as the cleaner not answering. A cleaner with no
phone on file is not texted; the office contacts them and records the answer (`assignments.recordAnswer`).

## Pages (`src/app/c`, `src/components/cleaner`)

| Address | Page |
|---|---|
| `/c/offer/<token>` | The offer: scope, requirements, duration, role, estimated pay, deadline, Accept and Decline. Area only |
| `/c/job/<token>` | The assigned job: window, address, access instructions, scope, instructions, role, pay, crew, check-in, photos, checklist, reports and add-on requests, completion |
| `/c/job/<token>/delay` | Send an ETA, or say you cannot attend, with the reason |
| `/c/job/<token>/photos` | Before and after photos only |

States each page shows in its own words: loading; link not valid; offer expired, declined, withdrawn,
already filled, job cancelled, already accepted (with the way into the job); job no longer yours, link run
out, job closed, submitted for review.

Behaviour worth knowing:

- **The address and access instructions** are returned only by the job query, only while the cleaner is
  the accepted cleaner and the link is live. A revoked or expired link gets the state and nothing else.
- **Check-in** asks the phone for its position and goes ahead without it. A second check-in changes
  nothing and sends nothing.
- **Photos** upload to Convex storage through a one-time address. Each photo carries a key from the file,
  so a retry is kept once; photos already recorded come back from the server, so an interrupted upload
  resumes. Images only, 15 MB each, 30 per kind.
- **Checklist** items are done, or skipped with a reason of at least three characters; an item that needs
  a photo cannot be done without it. Each item records who marked it.
- **An add-on request** goes to Customer Care's queue for a person. It changes no scope, no price and no
  charge, and the cleaner sees the decision on the page.
- **Completion** is refused until the checklist and required photos are in, with the list of what is
  missing, unless it is submitted as incomplete with what could not be finished. The answer is "Submitted
  for review". The page says it is not an approval and does not mean payment was made.
- **Drafts** (delay reason, report text, incomplete note) are kept on the phone until sent.
- **Double taps** are one request: a button is disabled while its action runs, and the server treats a
  repeated check-in or submission as the first.

Not built: extra verification for sensitive actions (for example a code texted before dropping a job),
and a separate urgent-hire page for applicants who are not cleaners yet (that is Recruiter's).
