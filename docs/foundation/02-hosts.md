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
| `admin.selestial.io` | `ADMIN_ORIGIN` | Not built. Answers "Not found." |
| `docs.selestial.io` | `DOCS_ORIGIN` | Not built. Answers "Not available yet." |
| `status.selestial.io` | `STATUS_ORIGIN` | Not built. Answers "Not available yet." |

Each setting holds an origin, such as `https://app.selestial.io`. Host names are never written in the
code.

## Rules

1. **A page is served on one host.** On another configured host it redirects to the right one, or is
   not found. The link host and the unbuilt hosts never redirect into the workspace.
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
- Staff access on the admin host, and its second factor, are not built.
- Redirects can become permanent (308) once the map has run in production without changes.
