import type { AuthConfig } from "convex/server";

/**
 * Sign-in is Clerk. CLERK_JWT_ISSUER_DOMAIN must be set on every deployment: to the Clerk instance's
 * issuer (https://<name>.clerk.accounts.dev in development, the production domain in production), or to
 * "none" while Clerk is not connected. With "none" there is no provider, so nobody can sign in and every
 * company function answers "Not found.". The session token's audience is "convex".
 */
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim().replace(/\/$/, "");
if (issuer && issuer !== "none" && !/^https:\/\/[a-z0-9.-]+$/.test(issuer)) {
  throw new Error("CLERK_JWT_ISSUER_DOMAIN must be an https address without a path, or none.");
}

const authConfig = {
  providers: issuer && issuer !== "none" ? [{ domain: issuer, applicationID: "convex" }] : [],
} satisfies AuthConfig;

export default authConfig;
