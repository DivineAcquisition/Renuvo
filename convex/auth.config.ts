import type { AuthConfig } from "convex/server";

/**
 * Clerk is the planned sign-in provider and is not set up yet, so there is no provider: nobody can sign
 * in, and every company function answers "Not found.". When Clerk exists, add
 * `{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }` here and set that variable
 * on the deployment. Reading the variable before it is set makes every push fail, so it is not read yet.
 */
const authConfig = {
  providers: [],
} satisfies AuthConfig;

export default authConfig;
