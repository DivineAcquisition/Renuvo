# Admin Support Sessions

Selestial staff opening a company's workspace to help, without the owner's password and without becoming
the owner. Decisions: [00-decisions.md](00-decisions.md).

Code: `convex/lib/support/` (catalog, access, schema), `convex/support.ts`, the company builders in
`convex/lib/builders.ts`, and in the app `src/components/app/support/` and the support branch of
`src/components/app/gate.tsx`. Tests: `convex/support.test.ts`.

## Turning it on

Support sessions are **off** until the backend has `SUPPORT_ACCESS=on`. Before setting it:

1. **Update the privacy notice.** It says Selestial uses data "to give support when you ask for it".
   Standing View access goes further, so the notice must describe it (View with a reason, content hidden,
   Manage only with permission or during an incident, every access listed in Settings › Support access).
   That is legal text and a decision for the Owner; it has not been changed.
2. **Check the sign-in token carries `fva`.** The server reads when the staff member last confirmed their
   second factor from the token's `fva` claim (`[first factor minutes, second factor minutes]`). Clerk
   puts `fva` in its session tokens; whether the custom `convex` JWT template carries it is not
   documented. In the Clerk dashboard, sign in as staff, decode a `convex` template token and look for
   `fva`. If it is missing, add it to the template if Clerk offers it there, or tell the developers:
   without it every session start is refused with a message pointing here.
3. **Staff need two-step verification on** in their own account security settings.

## How it works

| Step | Who | What the server checks |
|---|---|---|
| Open company workspace (Operations incident panel, or Staff › Companies) | Staff with `workspace.view` (admin, support) | Support on; second factor in the last 10 minutes; reason of at least 10 characters; incident (if given) belongs to the company |
| Every read in the session | The staff member who started it | Their staff row is active; the session is theirs, for this company, not ended or expired; reads use the session's preview role, with customer message content hidden |
| Switch to Manage | Same | Second factor again; a reason; the owner's grant in force, or an open incident for this company. The owner gets an in-app notice at once |
| Every write in the session | Same | Manage mode; the function is opened to support sessions (`support:` on its definition); the staff member holds its capability; the Manage basis still holds. The write runs as the company's **Selestial Support** member, with role Manager, never Owner |
| Reveal content | Same | Second factor; a reason. Content shows for 15 minutes and the reason is in the owner's history |
| Extend | Same | Second factor. Another hour from now |
| Exit, expiry, staff removed | — | Session ends; a Manage session that changed something sends the owner one summary, in the app and by email |

Sessions last an hour. Expiry is enforced on every request (`expiresAt`), and a cron ends expired sessions
each minute so their summaries go out.

### Two identities, kept apart

- **The company sees Selestial Support.** Each company gets one hidden member row (`status: "support"`,
  name "Selestial Support", no sign-in, never a notice recipient, not on the team list). Every record and
  event a support write makes names it, so activity reads "Selestial Support paused agents", never the
  owner.
- **Selestial keeps the staff member.** `supportSessions` and `supportEvents` record which staff member
  did each thing, in which session, for what reason. The Operations › Activity view lists them.

### Every request is bound to the session

Every company function takes an optional `supportSessionId`. The support tab's record client adds it to
every call that names a company (`src/components/app/support/client.ts`). The session lives in that
tab's session storage, so other tabs, including the staff console and other support tabs, keep their own
company. Changing a company id in the browser does nothing: the server refuses a session used for any
company but its own, and staff outside a session are not members of any company.

### Closed by default

A support session can change only what a function explicitly opens to it. Opened today:

| Function | Capability | The owner is told |
|---|---|---|
| `companies.setPausedAgents` (pause only; only the company resumes) | agents.recover | paused agents |
| `activation.retry` | agents.recover | tried failed first agent work again |
| `recruiter.readInboxNow` | agents.recover | read the hiring inbox again |
| `textingSetup.checkNow` | agents.recover | checked your texting pages again |
| `settings.saveBusiness` | records.edit | updated your business settings |
| `textingSetup.save` | records.edit | corrected your texting registration details |
| `services.startDraft`, `saveDraft` | records.edit | started / edited a service draft for you to review |
| `services.submit` | records.edit | sent a service change to you for approval |
| `tasks.setNextAction`, `wait`, `escalate`, `complete`, `cancel` | records.edit | updated / completed / cancelled a task |

Everything else is refused in a support session, including approving anything (staff never approve for
the owner), sending messages, publishing prices, changing agent authority, buying numbers, billing,
exports and deletion. The sensitive capabilities (`communications.send`, `billing.adjust`,
`records.destroy`) exist so they can be granted to a person, with a reason, but no support action uses
them yet. Each future one needs its own explicit path.

Business rules still apply to opened functions: they run their own checks (pause state, spending limits,
consent, registration requirements, record ownership) exactly as for a member. Work a support write queues
(for example a retry) runs later under the company's own rules, not the session's, and keeps no support
privilege after the session ends.

### What staff never see

- Customer, cleaner and applicant message content: query results replace the body and subject fields of
  `messages`, `inboundMessages`, `financeMessages`, `salesMessages`, `salesActions`, `salesFollowUps`,
  `sourceMessages`, `replyReadings`, `retentionEntries` and `chatMessages`, and mask addresses, unless
  content was revealed with a reason. Mutations always see stored values, so nothing redacted is written back.
- Private chats: they belong to the member who wrote them; the support member has none.
- Passwords, OAuth tokens, API keys and full tax ids: none of them is ever returned by a company query.

## Staff roles and capabilities

| Role | Base capabilities |
|---|---|
| admin | workspace.view, records.edit, agents.recover; manages staff, roles and grants |
| support | workspace.view, records.edit, agents.recover |
| reviewer | none: request queues only, opens no workspace |

Admins grant sensitive capabilities per person, with a reason (Staff page). Grants, role changes and
removals are recorded in `staffAudit`. Removing a staff member ends their open sessions.

## The owner's side

Settings › Support access (Owner only): what Support can and can't do, the Manage permission (4 hours,
24 hours or 3 days; ending it drops any Manage session back to View at once), and the history of every
session: when, why, View or Manage, each change, and each reveal. Sessions, grants and session events are
in the company's data export.

## Not verified here

- The second-factor step in the browser (`src/components/app/support/verify.tsx`) and the token refresh
  after it were built against Clerk's documented headless API but not run against a real Clerk instance.
- The support tab and banner were reviewed in a browser with a stub record client, not against a live
  backend.
