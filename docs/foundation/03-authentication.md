# Signing in

How people get into Selestial, what is built, and what still has to be set outside this repository.

The sign-in service is Clerk. It is used without any of its own screens: every page a person sees is
Selestial's (`src/components/auth`), and Clerk's name appears nowhere in them or in the emails.
Companies, roles and invitations live in the record (Convex), not in the sign-in service.

## Who gets in, and how

| Person | How | What they get |
|---|---|---|
| A business owner | Creates an account, confirms their email, names a company | Owner of that one company |
| Invited staff | Opens an invitation link, signs in or creates an account with the invited email, accepts | The role on the invitation, in that company only |
| An existing user | Signs in | Their companies; a switcher if they have several |
| A cleaner, applicant or customer | Opens a task link sent to them (`/c/...`) | That one task. Never a session, never the workspace |

A task link is not a sign-in. The proxy does not put `/c` behind a session, and signing in or
resetting a password never turns task-link access into membership.

## Pages

| Page | Address |
|---|---|
| Sign in (and the second step, when the service asks for one) | `/login` |
| Create account | `/signup` |
| Check your email (enter the code, send a new one) | `/auth/check-email` |
| Email confirmed, or a confirmation link's result | `/auth/verify` |
| After any sign-in: confirm the session, then go on | `/auth/callback` |
| Forgot password | `/forgot-password` |
| Enter the reset code, then set a new password | `/reset-password` |
| Password updated | `/auth/password-updated` |
| Accept an invitation | `/invite/[token]` |
| A link or session that cannot be used | `/auth/error` |
| Workspace setup (name the company, or join one you were invited to) | `/app`, when the person has no company |
| Security: email, password, sessions | `/app/settings#security` |
| People and invitations (Owner) | `/app/settings` |

`/sign-in` and `/sign-up` redirect to `/login` and `/signup`. Paths are in `src/lib/auth/routes.ts`.

## How it works

- **Codes, not links.** The service confirms an email, and authorizes a password reset, with a
  six-digit code sent by email. A code works only in the browser where it was asked for. The pages say
  so, and offer a new code after a 30-second wait; the service applies its own limits on top.
- **Nothing moves on until the session is real.** Every sign-in ends at `/auth/callback`, which waits
  for a confirmed session before sending the person anywhere.
- **Return addresses are checked.** `?next=` is used only when it is a plain path under `/app` or
  `/invite/` (`safeNext`). Anything else, including another site, is dropped.
- **The session is checked on the server.** `src/proxy.ts` sends a signed-out request for `/app` to
  sign-in, and sends a signed-in person away from the sign-in pages. The one route handler under
  `/app` checks the session itself as well. The record checks every read and write again, from the
  token alone, and treats another company's record as not found.
- **No stale pages.** `/app` and the sign-in pages are sent `Cache-Control: private, no-store`.
  Signing out replaces the page and ends the session; the workspace unmounts when the session ends.
- **The record gets the full token.** The app always asks the service for the `convex` token, which
  carries the email and whether it is confirmed. The service's plain session token has no email in
  it, so it is never used (`src/components/app/providers.tsx`).
- **Password reset is neutral.** An email with no account gets the same screen and the same sentence
  as one with an account, and no code ever works for it. Only a real failure of the request is shown
  as a failure. Saving a new password signs out every other session, and the page says so only after
  the service has done it.
- **Password rules are the service's.** The forms read the rules in force and tick them off. A
  password is never trimmed or changed.
- **Sensitive changes ask again.** When the service wants the password again before a change (it
  decides when), Settings asks for it and then carries on with the change.
- **Invitations** are made by the Owner, for one email and one role, and last
  `INVITATION_DAYS` (7) days. The link is `<id>.<signature>`; the signature is made with
  `ACTION_LINK_SECRET` and the link is never stored. Accepting needs a session whose confirmed email
  is the invited one. It is idempotent, cannot grant a different role or company, and a new link
  replaces the old one. The Owner can copy the link, send a new one or withdraw it.
- **Company setup is idempotent.** The setup screen sends one key with its request; sending it twice
  makes one company.
- **Two-step sign-in** is not offered from Settings. Sign-in does handle a second step when the
  service asks for one (a code by email on a new device, an authenticator code, a backup code).

## Emails

| Email | Sent by | Template |
|---|---|---|
| Confirmation code (sign-up, email change, new device) | The sign-in service | `scripts/auth-emails.mjs` |
| Password reset code | The sign-in service | `scripts/auth-emails.mjs` |
| Password changed, sign-in email changed, new device, account locked | The sign-in service | `scripts/auth-emails.mjs` |
| Invitation to a company | The record, through Resend | `convex/lib/email/invitation.ts` |

All use one frame (`convex/lib/email/layout.ts`). `node scripts/auth-emails.mjs --apply --app-origin
<workspace address>` installs the first three rows on the sign-in instance; `--check` compares;
`--preview <directory>` writes them to files. No email states how long a code lasts. The invitation
email states the date its link stops working.

## Settings

| Where | Name | What |
|---|---|---|
| Vercel | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | The sign-in instance. The secret key is server-only. |
| Vercel | `NEXT_PUBLIC_CONVEX_URL` | The record. |
| Vercel | `APP_ORIGIN`, and the other host settings | See `02-hosts.md`. The sign-in pages belong to the workspace host. |
| Convex | `CLERK_JWT_ISSUER_DOMAIN` | The sign-in instance's address, so the record trusts its tokens. |
| Convex | `ACTION_LINK_SECRET` | Signs invitation links (and Dispatch's task links). Without it nobody can be invited. |
| Convex | `APP_ORIGIN` | The workspace's address, for the link in the invitation email. |
| Convex | `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Invitation email. Unset: the invitation is made and the Owner copies the link. |

## Setting up a sign-in instance

`node scripts/auth-doctor.mjs` checks an instance and prints what is missing. `--fix` does the two
things the service's API allows. The rest is in its dashboard.

In the dashboard (cannot be done from here):

1. **User & authentication.** Email: on, required, verified at sign-up by code. Password: on.
   **Phone number: off. Username: off.** The sign-up form asks for name, email and password only; if
   the service asks for more, the form says setup is unfinished and creates nothing.
   **Legal consent: on**, with Terms at `https://www.selestial.io/terms` and Privacy at
   `https://www.selestial.io/privacy`. The sign-up form has an unticked consent box; Create account
   stays disabled until it is ticked, and the form sends `legalAccepted: true` with the account.
2. **Paths.** Sign-in `/login`, sign-up `/signup`, on the application's own domain.
3. **Production only.** Add the domain and its DNS records, and set the production keys on Vercel.
   Custom email templates and removing the service's branding may need a paid plan.

With the API (`--fix`, or by hand):

4. **Organizations: off**, or membership optional. With membership required, every session waits on
   a step Selestial does not use, and the app shows "Sign-in is not finished being set up".
5. **A token template named `convex`** with `aud`, `name`, `email` and `email_verified`.

Then: set the Convex and Vercel settings above, run `auth-emails.mjs --apply`, and run the doctor again.

## State of the two instances (November 16)

- **Development** (`first-opossum-325`): every step done. Phone number and username are off and legal
  consent is on, the same as production, so sign-up only works with the consent box. Emails are
  installed, and the dev Convex deployment trusts it. The doctor reports it ready.
- **Production** (`clerk.selestial.io`): phone number and username off, legal consent on with the
  Terms and Privacy addresses above (checked from its public settings). **It has no `convex` token
  template yet** (reported when it was set up; needs its secret to check from here): create it in the
  dashboard (step 5) before the production record can trust a sign-in. The production Convex
  deployment is not set up yet either.

## Tests

- `npm test`: redirects, error wording, password rules, the emails, hosts, and the record's
  invitation and setup rules (accept, wrong email, unconfirmed email, expired, revoked, reissued,
  used, no role escalation, other companies, duplicate memberships, idempotent setup, delivery).
- `tests/e2e/auth.mjs`: a real browser against the running app, a development sign-in instance and
  the dev record. Test people use `+clerk_test@example.com` addresses, which receive no email and
  accept the code 424242; the service's testing token gets the scripted browser past its bot check.
  It removes the people it makes. The companies it makes stay in the dev record.

      NODE_USE_ENV_PROXY=1 CLERK_SECRET_KEY=... node tests/e2e/auth.mjs [screenshot directory]

## Not built

- Turning two-step sign-in on or off from Settings.
- Confirmation by link instead of code. `/auth/verify` shows a link's result if the service is ever
  set to send links, but that path has not been run.
- Selestial staff access (`admin.`), and its second factor.
- A member whose access is removed while they have the workspace open is moved to their other
  company or to setup by the record's own refusal; there is no dedicated "access removed" screen.
