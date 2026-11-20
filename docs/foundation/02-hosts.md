# Hosts

One Vercel project answers on several hosts. The app decides what each host shows, in
`src/lib/hosts.ts`, applied by `src/proxy.ts`. This is routing, not access control: sign-in and every
read and write are checked elsewhere.

## The map

| Host | Setting | Shows |
|---|---|---|
| `www.selestial.io` | `NEXT_PUBLIC_SITE_ORIGIN` | The public site. The only host search engines may index. `selestial.io` redirects here in Vercel. |
| `app.selestial.io` | `APP_ORIGIN` | The signed-in workspace (`/app`), the sign-in pages (`/login`, `/signup`, `/auth/...`, `/forgot-password`, `/reset-password`) and invitations (`/invite/...`). Its root opens `/app`. |
| `link.selestial.io` | `LINK_ORIGIN` | The link pages sent in texts (`/c`). Nothing else. |
| `admin.selestial.io` | `ADMIN_ORIGIN` | The Selestial staff console (`/staff`): Operations, requests, trust records, companies, staff. Its root opens `/staff/operations`. |
| `docs.selestial.io` | `DOCS_ORIGIN` | Not built. Answers "Not available yet." |
| `status.selestial.io` | `STATUS_ORIGIN` | Not built. Answers "Not available yet." |

Each setting holds an origin, such as `https://app.selestial.io`. Host names are never written in the
code.

## Rules

1. **A page is served on one host.** On another configured host it redirects to the right one, or is
   not found. The link host and the unbuilt hosts never redirect into the workspace.
   - **The staff host** serves only `/staff`. Sign-in stays on the workspace host: a signed-out staff
     member is sent to `app.selestial.io/login?next=/staff/...` and comes back after signing in. A company
     workspace opened in an Admin Support Session (`/app?support=...`) opens on the workspace host, with
     the session kept in the query and then in that tab only (docs/operations/03-support-sessions.md).
2. **Nothing is enforced for a host until its setting exists.** With no settings, no response
   changes. With only some set, a page whose own host is not set yet is served where it is.
3. **A host no setting names can reach every route.** That covers localhost, preview deployments
   and old domains such as `app.renuvo.io` and `renuvo.vercel.app`.
4. **Only page loads are redirected.** A form post to the wrong host is refused, not replayed.
   Redirects are temporary (307) so a mistake in a setting is not remembered by browsers.
5. **Search engines:** `robots.txt` allows the public host and disallows every other host. Other
   configured hosts also send `X-Robots-Tag: noindex`. The canonical link and `sitemap.xml` use the
   public origin.
6. **Served on every host:** `robots.txt`, the icon, `/.well-known`, and Clerk's proxy path.

## To turn it on

Add the settings in Vercel for the Production environment, then redeploy. `LINK_ORIGIN` must have the
same value on the Convex deployment, where texted links are built.

## Not settled

- `accounts.selestial.io`, `auth.selestial.io` and `mail.selestial.io` are attached to the Vercel
  project but are expected to belong to Clerk and the email provider. Nothing here names them, so
  today they show the whole app like any unnamed host.
- Whether the old `renuvo` domains stay attached.
- Coming back to the staff host after signing in on the workspace host relies on the sign-in service
  sharing a session across `selestial.io` subdomains. Not yet checked in production.
- `CLERK_SECRET_KEY` is not in the Vercel project's settings, so the proxy's server-side session check
  does not run there; the staff console and the workspace send signed-out people to sign-in from the
  browser instead. Every read and write is still checked by Convex.
- Redirects can become permanent (308) once the map has run in production without changes.
