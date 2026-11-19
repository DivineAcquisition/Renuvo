import type { AuthConfig } from "convex/server";

/**
 * Sign-in is Clerk. CLERK_JWT_ISSUER_DOMAIN must be set on every deployment: to the Clerk instance's
 * issuer (https://<name>.clerk.accounts.dev in development, the production domain in production), or to
 * "none" while Clerk is not connected. With "none" there is no provider, so nobody can sign in and every
 * company function answers "Not found.". The session token's audience is "convex".
 *
 * While sign-in moves from one Clerk instance to another it may name both, separated by a comma (new one
 * first), so people signed in on either are accepted until the move is done. A person's company follows
 * them to the new instance by verified email (convex/lib/reconnect.ts).
 */
const issuers = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter((value) => value && value !== "none");
for (const issuer of issuers) {
  if (!/^https:\/\/[a-z0-9.-]+$/.test(issuer)) throw new Error("CLERK_JWT_ISSUER_DOMAIN must be https addresses without a path, separated by commas, or none.");
}

const authConfig = {
  providers: issuers.map((domain) => ({ domain, applicationID: "convex" })),
} satisfies AuthConfig;

export default authConfig;
