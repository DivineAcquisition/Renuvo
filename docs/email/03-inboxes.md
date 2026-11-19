# Connected inboxes

Phase 4 of the email build. A company connects its own Gmail once and chooses what it is for. Each
agent uses it for that purpose only. Recruiting settings keep their own way to connect a hiring inbox,
and it works exactly as before.

## Purposes and agents

| Purpose | Agent | What it does today |
|---|---|---|
| Sales | Sales | Sales mail (quotes, proposals, replies) goes from this address. |
| Hiring | Recruiter | Recruiter reads job-board and applicant mail here. Applicant mail goes from this address, in the applicant's own thread. |
| Care & Retention | Retention | Booking confirmations, invoices and payment reminders go from this address. |
| Operations | Dispatch | Nothing yet. Dispatch texts cleaners. Choosing it only records the intent. |

An inbox connected before purposes existed has no `purposes` field. It is read as Hiring, Sales and
Care, which is what it was already used for.

## Connecting

`inboxes.startConnect` is for the Owner only. The Owner chooses:
- purposes;
- an optional label;
- how far back the first read goes: from now, or the last 7, 30 or 90 days;
- whether agents may send as the address.

What Google is asked for:
- **Scopes:** `gmail.readonly`, plus `gmail.send` only when sending is allowed, plus `openid email`.
  Never `gmail.modify` or `gmail.compose`.
- **Consent:** `prompt=consent` and `access_type=offline`, so Google always shows what is being granted
  and returns a refresh token.

How the callback is protected:
- The state is random, single use and expires in 10 minutes. Only its hash is stored.
- Only an active Owner can finish connecting.
- The connected address is read from Gmail itself, not taken from the request.
- The refresh token is sealed with AES-256-GCM and bound to the connection.

After connecting:
- The Owner returns to Connected apps (`?tool=gmail&result=…`).
- The first read starts.
- Gmail push is started at once, rather than waiting for the daily renewal.
- The Owner gets a security notice.
- Messages waiting for the inbox are sent.

## Routing, one way only

`convex/lib/inbox/mailboxes.ts` is the single place that decides how a message goes. It replaces the
five copied lookups. The message's purpose comes from the record it is about:
- application → hiring;
- Sales record → sales;
- invoice or booking → care;
- anything else → Selestial's shared sender.

| Inbox for that purpose | What happens |
|---|---|
| Working and allowed to send | The message goes from it. A reply joins the person's own thread. |
| Allowed to send, but expired or not answering | The message waits (`held`, refusal `inbox_disconnected`) with the reason. Nothing is sent from another address. |
| None | "{Company} via Selestial" from the shared sender. |

The route actually used is recorded in `messages.provider`.

Messages that are waiting go out again when:
- the inbox is reconnected;
- the Owner disconnects it (they then go through the shared sender);
- the Owner changes its purposes.

If Google withdraws access while a message is being sent, the message waits too, because it never went.

## Threading

A reply joins a thread only when the applicant wrote to the inbox themself. A job board's notification
thread is never joined.

The send carries:
- Gmail's `threadId`;
- `In-Reply-To` and `References`, taken from the thread's last message;
- `Re: <subject>`, so Gmail keeps the reply in the thread.

A thread that can't be found means a new conversation.

## Hardening

- **401 and 403.** A 401, or a 403 without a rate-limit reason, means reconnect. A 403 for a rate or
  quota limit means try again later.
- **No resend after an unclear failure.** Gmail has no idempotency key. A 5xx or a dropped connection
  on send throws, the sweep marks the message `unconfirmed`, and it is never sent again by itself.
  429 is retried.
- **One read at a time.** `syncLeaseUntil` stops a push and the timer from reading the same inbox
  twice. A crashed run's lease lapses after 3 minutes.
- **Push lookup.** A push finds its inbox through the `by_address` index, not by scanning every
  connection.
- **Google's signing keys** are cached for their `max-age` (at most a day). A new key id fetches them
  again.
- **Breaks are reported.** When an inbox stops working, the Owner and the person who connected it get
  one `inbox_reconnect` email a day. It says how many messages are waiting.
- **The integrations card** shows "Reconnect needed" for an expired inbox, not "Not connected".

## Disconnecting

`inboxes.disconnect` is for the Owner only. It:
- stops reading and sending at once;
- deletes the sealed token;
- sends any waiting mail through the shared sender;
- sends a security notice.

Google's grant is revoked unless another connection uses the same Google account. Revoking one token
ends every token of the grant, because the Google connection and the inbox share one OAuth client. The
outcome is recorded as `revoked`, `kept_shared` or `revoke_failed`. The last tells the Owner to remove
Selestial in their Google Account.

## What the first read found

The inbox panel lists what Recruiter's first read found for hiring inboxes:
- applications;
- applicant replies;
- updates and repeats;
- how many messages were left alone (only the verdict is kept, not the sender, subject or words).

It is a review, not a gate: agents act only as their permissions allow.

## Not built yet

- **Reading for Sales and Care.** Sales replies come back through `reply.selestial.io`. Reading a Sales
  or Care inbox for new inquiries is not built.
- **Microsoft Outlook and 365.** The card says Coming soon and has no Connect button.
- **Google verification.** Before inboxes outside the test-user list can connect, Google must verify
  the app. `gmail.readonly` is a restricted scope and needs a security assessment; `gmail.send` is a
  sensitive scope.
