import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { decide, hostMap } from "@/lib/hosts";

const isApp = createRouteMatcher(["/app(.*)"]);

/** Everything under /app needs a signed-in person. Convex checks again on every read and write. */
const withClerk = clerkMiddleware(
  async (auth, request) => {
    if (isApp(request)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

const NOINDEX = "noindex, nofollow";

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // First, which host is this and does the page belong on it (src/lib/hosts.ts). With no host
  // settings, and on any host no setting names, this lets everything through.
  const decision = decide(
    { host: request.headers.get("host") ?? request.nextUrl.host, pathname: request.nextUrl.pathname, search: request.nextUrl.search, method: request.method },
    hostMap(process.env),
  );
  if (decision.kind === "redirect") return NextResponse.redirect(decision.to, 307);
  if (decision.kind === "not_found") {
    return new NextResponse(decision.message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": NOINDEX } });
  }

  // Until Clerk's keys are set, sign-in is not available and /app says so on the page.
  const clerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const response = (clerk ? await withClerk(request, event) : null) ?? NextResponse.next();
  // Only the public site is for search engines.
  if (decision.noindex) response.headers.set("x-robots-tag", NOINDEX);
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
