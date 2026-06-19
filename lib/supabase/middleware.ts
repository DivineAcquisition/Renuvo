import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "renuvo.io";

export async function updateSession(request: NextRequest) {
  const url = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];

  // Which surface is this? (localhost → treat as app; use /r/* path for capture in dev)
  const isLocal = host === "localhost" || host.endsWith(".local");
  const isCaptureHost = host === `r.${ROOT}`;

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
    path.startsWith("/dashboard") || path.startsWith("/onboarding");

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
