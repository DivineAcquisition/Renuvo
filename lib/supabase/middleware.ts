import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "renuvo.io";

export async function updateSession(request: NextRequest) {
  const url = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];

  // Which surface is this? (localhost → treat as app; use /r/* path for capture in dev)
  const isLocal = host === "localhost" || host.endsWith(".local");
  const isCaptureHost = host === `r.${ROOT}`;
  const isPortalHost = host === `account.${ROOT}`;

  // ---- PORTAL host (account.renuvo.io): passwordless homeowner self-service ----
  // Rewrite everything under "/portal/*"; gate non-/access pages on a session
  // cookie (full validation happens in the page via getPortalSession).
  if (isPortalHost) {
    const p = url.pathname;
    if (p.startsWith("/api") || p.startsWith("/portal"))
      return NextResponse.next({ request });
    const isAccess = p.startsWith("/access");
    const hasSession = !!request.cookies.get("renuvo_portal");
    const rewrite = url.clone();
    if (!isAccess && !hasSession) {
      rewrite.pathname = "/portal/access-expired";
    } else {
      rewrite.pathname = `/portal${p === "/" ? "" : p}`;
    }
    return NextResponse.rewrite(rewrite);
  }

  // ---- CAPTURE host: public, rewrite "/{token}" → "/r/{token}", no auth ----
  if (isCaptureHost) {
    // already-prefixed assets/api pass through
    if (
      !url.pathname.startsWith("/r/") &&
      !url.pathname.startsWith("/api") &&
      url.pathname !== "/"
    ) {
      const rewrite = url.clone();
      rewrite.pathname = `/r${url.pathname}`;
      return NextResponse.rewrite(rewrite);
    }
    return NextResponse.next({ request });
  }

  // ---- APP host (or local): run the auth session + route guards ----
  let res = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          toSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          res = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = url.pathname;
  const isAuthPage = path.startsWith("/login") || path.startsWith("/signup");
  const isProtected =
    path.startsWith("/dashboard") ||
    path.startsWith("/onboarding") ||
    path.startsWith("/admin");

  // Defense-in-depth for the platform admin console: require an auth session in
  // middleware (the layout additionally verifies is_platform_admin).
  if (path.startsWith("/admin") && !user) {
    const u = url.clone();
    u.pathname = "/login";
    u.searchParams.set("next", "/admin");
    return NextResponse.redirect(u);
  }

  // ROOT on the APP host: the product lives here, not the marketing site. Only
  // the apex/root domain (renuvo.io / www) bounces to the Framer marketing page;
  // app.renuvo.io (and the *.vercel.app deploy host) goes straight into the app.
  if (path === "/") {
    const isApex = host === ROOT || host === `www.${ROOT}`;
    if (isApex) {
      const marketing =
        process.env.NEXT_PUBLIC_MARKETING_URL ?? `https://${ROOT}`;
      // avoid redirecting the marketing host to itself (loop guard)
      if (!marketing.includes(host)) {
        return NextResponse.redirect(marketing);
      }
    }
    const u = url.clone();
    u.pathname = user ? "/dashboard" : "/login";
    return NextResponse.redirect(u);
  }

  if (!user && isProtected) {
    const u = url.clone();
    u.pathname = "/login";
    return NextResponse.redirect(u);
  }
  if (user && isAuthPage) {
    const u = url.clone();
    u.pathname = "/dashboard";
    return NextResponse.redirect(u);
  }
  return res;
}
