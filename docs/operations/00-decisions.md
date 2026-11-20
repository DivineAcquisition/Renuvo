# Operations, recovery and support access: decisions

Decided by the Owner on November 20, 2026, before the build started. Every phase builds on these. Change
them here first if they change.

## Delivery

Phased pull requests, each reviewable and mergeable on its own:

1. Audit of what exists, incident records, detection and deduplication.
2. Staff Operations workspace and Admin Support Sessions.
3. Owner recovery cards and notifications.
4. Retry, pause, takeover and reconciliation controls; deployment isolation; backup and restore runbook.

## Customer access policy: hybrid

- **View** access is standing, disclosed under Account & privacy, and recorded in Support access history.
- **Manage** needs either a grant from the owner (time-limited) or an open incident on that company.
- The owner is told when a Manage session starts (in-app) and gets one grouped email summary when a Manage
  session ends with changes.
- The permission mechanism does not depend on this policy: the policy is one check, kept in one place.

## Staff permissions: roles plus capability grants

- Keep `admin` and `reviewer`, and add `support`.
- Each role carries a base set of capabilities. Sensitive capabilities (communication actions, billing
  adjustments, destructive actions) are granted to each staff member individually by a staff admin, on top
  of their role, and every grant is audited.
- Catalog areas: workspace viewing, record editing, agent recovery, communication actions, billing
  adjustments, destructive actions.

## Owner approvals

Staff **never** approve on the owner's behalf. Staff can prepare a change and send it to the owner for
approval. Only the owner or members with authority can approve.

## Support session security

- Starting a session and switching to Manage both require Clerk two-factor turned on **and** a verification
  in the last 10 minutes. Sensitive actions re-verify.
- Sessions last **60 minutes** and can be extended with re-verification.
- Every request is bound to the explicit session on the server, never to a company id chosen in the
  browser alone. Each browser tab keeps its own session.

## Customer message content

Hidden by default inside support sessions: staff see metadata (time, status, masked recipient). "Reveal
content" needs a reason, is audited, and shows up in the owner's Support access history.

## Owner recovery experience

A calm "Needs your attention" section on Home with the consolidated list, plus the same card inline on the
affected page (for example the Recruiter inbox or Texting).

## Staff alerts

- Staff console (Operations workspace) and grouped, deduplicated email to staff.
- Discord later: alert delivery goes through one sender interface so a Discord channel can be added
  without touching detection.

## Deployment isolation

- Pull-request previews will point at the **test** Convex backend (Vercel › Preview ›
  `NEXT_PUBLIC_CONVEX_URL`). The Owner makes that dashboard change; the steps go in
  `docs/foundation/06-deployments.md`.
- The backend gets an explicit environment flag. A non-production backend refuses real sends (except to an
  allowlist of test recipients) and live charges, whatever keys it holds.

## Backups

The live Convex backend is on the **Pro** plan, so scheduled backups are available in the dashboard. The
runbook uses them, restores into an isolated deployment with outbound sends, payments and autonomous jobs
turned off, and reconciles provider state before anything runs again.
