# What sends a notice

Phase 5 of the email build.

**How the notices are wired.** Notices are wired in one place: `recordEvent`, which is the only code
that writes events. When it writes one of the event types below, `convex/lib/notify/fromEvents.ts` plans
the notice. So every product path that records something sends its notice, and none of them has to
remember to.

**What planning does.** Planning goes through `notifyMembers`. That step decides:
- who gets the notice;
- whether their notification settings allow it;
- that it goes only once;
- when it goes.

What the notice says is written when it goes, from the records at that moment.

**A notice can't break the action that caused it.** The event is recorded either way. A notice that
can't be planned is skipped.

## Wired

| Recorded event | Notice | Who | Category | Notes |
|---|---|---|---|---|
| `company.created` | Welcome | The Owner who created it | Account | Setup steps are read from the records: services, cleaners, texting number, agent permissions. |
| `member.role_changed` | Security | Owner and the person | Security | The event records only the new role, so the notice doesn't name the old one. |
| `member.removed` | Security | Owner | Security | |
| `company.deletion_requested` | Security | Owner | Security | Says the deletion date (90 days, as the Privacy notice promises). |
| `export.ready` | Security | Owner and whoever asked for it | Security | |
| `mailbox.connected` / disconnect | Security | Owner | Security | Planned directly by the inbox code. |
| `approval.requested` | Agent approval | Owner, Managers | Approvals | Created only when the agent is set to Ask me first. The link opens the approval in the app's detail panel. |
| hourly sweep | Approval reminder | Owner, Managers | Approvals | Sent once, 1–2 hours before the deadline, if the approval is still undecided. |
| `dispatch.reported`, `sales.reported` | Agent acted | Owner, Managers | What your agents did | Agents record these when set to Act and notify me. The notice uses the permission's own words and links to the record and to Agent controls. |
| `assignment.no_check_in_alerted`, `assignment.no_show_suspected` | Dispatch escalation | Everyone | Urgent operations | Critical, so it goes at any hour. Not sent if the cleaner has checked in, the assignment ended or the visit was cancelled. Lists the texts Dispatch recorded. |
| hourly sweep, Monday 7 AM company time | Weekly summary | Everyone (Office doesn't see the approval list) | Weekly summary | Built from counts in the records. An empty week says so. |
| `billing.past_due` | Payment failure | Owner | Account | Once per month. Not sent if the payment was settled before the notice went. |
| `billing.zero_balance` | Credits ran out | Owner | Account | Once per day. |
| `payment.failed` | Customer payment failed | Owner, Managers | What your agents did | Not sent if a later try went through. |
| inbox stops working | Gmail reconnection | Owner and whoever connected it | Account | Once per day while it stays broken. Counts the messages waiting. |

Notices stay out of the company's activity log. Each one is recorded on its own `messages` row and in
the person's Recent notices.

In mock mode (`EMAIL_PROVIDER=mock`), tests read notices from `mockNotices`, kept apart from mail to
customers, applicants and cleaners. Production behaviour is the same either way.

## Not wired, and what each needs

| Notice | Needs |
|---|---|
| Payout account changed | Stripe Connect sends no event that says the bank account changed. `stripe.updated` covers every account update. |
| Booking request needs a person | The booking code records no event for "a person must confirm" that is separate from the customer's own email. |
| Proposal accepted, declined or changes requested; agreement signed; applicant passed screening | Each has an event. Each needs its own template wording and a product decision on who gets it. Left for later rather than guessed. |
| Product news (`updates.selestial.io`) | A broadcast tool and opt-in collection. The category exists and is off by default. |
| A "via Selestial" From with each company's own address | One configured address serves every company. A per-company local part, or a company's own domain, is later work. |

## Company mail, sent for a company

These messages already existed and keep the same owners. What changed:
- **Through Selestial's shared sender:** they go from "{Company} via Selestial", in the company's frame,
  with a footer that says why the person got them. The words are exactly as written.
- **Through a connected inbox:** they go plain and threaded, from the company's own address, when an
  inbox is connected for that purpose.
- **Bounces and complaints** now suppress the address on that company's list, for every kind of mail.
