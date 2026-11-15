import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isApp = createRouteMatcher(["/app(.*)"]);

/** Everything under /app needs a signed-in person. Convex checks again on every read and write. */
const withClerk = clerkMiddleware(
  async (auth, request) => {
    if (isApp(request)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Until Clerk's keys are set, sign-in is not available and /app says so on the page.
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) return withClerk(request, event);
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
