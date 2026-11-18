# Notifications: how they work

This is Phase 3 of the email build. It sits on top of the shared outbox, `messages`. There is no second
messaging system: a notice to a member is a `messages` row with purpose `member_notice`. It is planned,
sent, retried, swept and tracked exactly like every other message.

## Pieces

| File | Does |
|---|---|
| `convex/lib/notify/catalog.ts` | The categories a person can turn on or off, and the events that send a notice. Each event has a category, priority, audience and owner. |
| `convex/lib/notify/schema.ts` | `notificationPreferences` (per member, per company) and `noticeSuppressions` (per address, across companies). |
| `convex/lib/notify/route.ts` | `notifyMembers`: who gets a notice, whether their settings allow it, one per event and person, and night hours. |
| `convex/lib/notify/compose.ts` | Writes the notice at the moment it goes, from the records as they are then. |
| `convex/lib/notify/delivery.ts` | What a bounce, a spam report or a provider block means for the address. |
| `convex/lib/notify/unsubscribe.ts` | Signed unsubscribe tokens, the footer link and the List-Unsubscribe headers. |
| `convex/lib/email/senders.ts` | The sender registry: every From is built here, and only from configured, verified addresses. |
| `convex/lib/messaging/companyMail.ts` | A company's email through the shared sender: "{Company} via Selestial", set in the company's frame. |
| `convex/notifications.ts` | Settings (`mine`, `setEmail`, `clearBlock`), the unsubscribe page (`unsubscribeInfo`, `unsubscribe`), `oneClick` and `notify`. |

## Rules it keeps

- **Who gets a notice.** Active members of the company, chosen by the event's audience:
  - `owner`: the Owner.
  - `managers`: the Owner and Managers.
  - `everyone`: all active members.
  - An event can also name people. A named person outside the company is never reached.
- **Settings.** Each person chooses their own. Security is always on for everyone. Account notices are
  always on for the Owner, because nobody else can fix them. A Manager may turn account notices off.
- **Once.** One notice per event, record, key and person (`dedupeKey`), however often the event is reported.
- **Night.** Between 21:00 and 07:00 company time only critical notices go. The rest are held and go at
  07:00.
- **Checked again when it goes.** At the moment of sending, the notice is dropped with the reason
  recorded on its row if any of these is now true:
  - the person is no longer a member;
  - they turned the category off;
  - their address changed;
  - their address is suppressed;
  - the thing it's about is no longer true (an approval was decided, an inbox was reconnected, a
    payment was settled).
- **Links never act.** Approval notices open `/app/approvals?open=<id>` behind sign-in. Unsubscribe pages
  ask before doing anything. Only a POST unsubscribes.
- **No AI.** Planning and writing a notice uses templates and records. It costs no credits.

## Senders

| Setting | Used for | Fallback |
|---|---|---|
| `NOTIFY_EMAIL_FROM` | Notices to members, as `"Selestial" <…>` | `EMAIL_FROM` |
| `COMPANY_EMAIL_FROM` | Company mail, as `"{Company} via Selestial" <…>` | `RECRUITER_EMAIL_FROM`, then `EMAIL_FROM` |
| `PLATFORM_REPLY_TO` | Optional Reply-To on notices | none |

- **Only verified domains.** A From goes out only if its domain belongs to one of these configured
  addresses. The shared provider checks this again before calling Resend.
- **Names can't add anything.** A company name becomes only the display name. Quotes, angle brackets
  and line breaks are removed.
- **Allowed headers only.** Callers may add List-Unsubscribe, List-Unsubscribe-Post, X-Entity-Ref-ID,
  In-Reply-To and References, and no others. A value with a line break is refused.
- **Nothing configured means not sent.** The message is marked not sent, with the reason. It is never
  sent from another identity instead.
- With `EMAIL_PROVIDER=mock` only, a reserved `messages@mail.selestial.test` stands in, so tests and
  local work don't need sender settings.

## Delivery outcomes

`POST /webhooks/resend` maps Resend events to separate outcomes.

| Event | Outcome | Effect |
|---|---|---|
| `email.delivered` | delivered | status delivered |
| `email.bounced` | bounced | status failed, `bouncedAt`. The address is suppressed. |
| `email.complained` | complained | `complainedAt`. A delivery stands, and complaints are accepted after delivery. The address is suppressed. |
| `email.suppressed` | suppressed | status failed. The address is suppressed with reason "provider". |
| `email.failed` | failed | status failed. Nothing is suppressed, because it says nothing about the address. |
| `email.delivery_delayed` | delayed | event only |

Where a suppression lands:
- **Member notices:** `noticeSuppressions`. The person can clear it from Settings › Notifications
  ("My address works again").
- **Company mail:** that company's `suppressions` list, scope all, reason bounce or complaint. A person
  can lift it there.

## Unsubscribing

- Notices in categories that allow it (approvals, escalations, activity, digest, product) carry two
  ways out:
  - a footer link to `/n/unsubscribe#<token>` on the link host;
  - the headers `List-Unsubscribe: <CONVEX_SITE_URL/notify/unsubscribe?t=<token>>` and
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **The token.** It is `<message id>.<HMAC>`, signed with `ACTION_LINK_SECRET` under its own words. It
  can only turn off that notice's category for that one person.
- **No unsubscribe on essential notices.** Security and account notices never carry the link or the
  headers, and the endpoint refuses them.

## Also fixed here

- A sign-in code is never held, or retried, without its code. It is marked not sent with a reason
  instead of going out as a literal `{code}`.
- A message's `provider` records the route that send really used, `gmail` or the shared provider, so
  delivery reports find it.
- Company mail through the shared sender is now framed:
  - it goes as "{Company} via Selestial", with the company's logo and colour from Booking's public profile;
  - the footer says why the person got it;
  - links are clickable;
  - the words are exactly as written.
- Applicant bounces still go through Recruiter's own follow-up. The suppression helper is idempotent,
  so nothing is added twice.

## Still to wire (Phase 5)

The notices below are built, tested and previewed. Nothing calls `notifyMembers` for them yet, except
where the tests do:

- welcome
- security changes
- approvals
- payment failure (plan)
- credits exhausted
- customer payment failed
- inbox reconnection

The Dispatch escalation and the weekly digest also need their composers.
