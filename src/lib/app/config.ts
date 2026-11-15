/**
 * What the signed-in product needs before it can run. When something is missing, the app says which
 * piece is not set up instead of failing or pretending.
 */
export function clerkPublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || null;
}

export function convexUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  // A local backend on this machine is allowed over http, for development and the browser tests only.
  return url && (/^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) ? url : null;
}

export const SIGN_IN_PATH = "/sign-in";
export const SIGN_UP_PATH = "/sign-up";
export const APP_PATH = "/app";
