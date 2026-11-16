import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { AFTER_SIGN_IN, AUTH, isAuthPath, NEXT_PARAM, safeNext, SIGNED_OUT_ONLY, withNext } from "@/lib/auth/routes";
import { decide, hostMap } from "@/lib/hosts";

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * The session check, on the server, before any page is sent.
 * - Everything under /app needs a signed-in person. Without one, the request goes to sign-in and
 *   remembers where it was headed. Convex checks every read and write again, whatever this allows.
 * - A signed-in person has no use for the sign-in, sign-up or forgot-password pages and is sent on.
 * The cleaner pages under /c are not touched here: a link authorizes one task, never a session.
 */
const withSession = clerkMiddleware(
  async (auth, request) => {
    const { pathname, search, searchParams } = request.nextUrl;
    const { userId } = await auth();
    if ((under(pathname, "/app") || under(pathname, "/staff")) && !userId) {
      return NextResponse.redirect(new URL(withNext(AUTH.login, `${pathname}${search}`), request.url));
    }
    if (userId && SIGNED_OUT_ONLY.includes(pathname)) {
      return NextResponse.redirect(new URL(safeNext(searchParams.get(NEXT_PARAM)) ?? AFTER_SIGN_IN, request.url));
    }
    return undefined;
  },
  { signInUrl: AUTH.login, signUpUrl: AUTH.signup },
);

const NOINDEX = "noindex, nofollow";

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // First, which host is this and does the page belong on it (src/lib/hosts.ts). With no host
  // settings, and on any host no setting names, this lets everything through.
  const { pathname } = request.nextUrl;
  const decision = decide({ host: request.headers.get("host") ?? request.nextUrl.host, pathname, search: request.nextUrl.search, method: request.method }, hostMap(process.env));
  if (decision.kind === "redirect") return NextResponse.redirect(decision.to, 307);
  if (decision.kind === "not_found") {
    return new NextResponse(decision.message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": NOINDEX } });
  }

  // Until sign-in is connected there is no session to check, and the pages say so themselves.
  const connected = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const response = (connected ? await withSession(request, event) : null) ?? NextResponse.next();
  // Only the public site is for search engines.
  if (decision.noindex) response.headers.set("x-robots-tag", NOINDEX);
  // Signed-in pages and sign-in pages are never kept by a shared cache or shown from history after sign-out.
  if (under(pathname, "/app") || under(pathname, "/staff") || isAuthPath(pathname)) {
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("referrer-policy", "same-origin");
  }
  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
