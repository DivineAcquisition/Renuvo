/** Shared by the trust, request and data-rights tests: Selestial staff and a seeded trust record. */
import { api, internal } from "../convex/_generated/api";
import { start, type T } from "./harness";

export const ADMIN = { subject: "user_admin", email: "boss@selestial.example", emailVerified: true, name: "Boss" };
export const REVIEWER = { subject: "user_reviewer", email: "helper@selestial.example", emailVerified: true, name: "Helper" };
export const OUTSIDER = { subject: "user_other", email: "someone@example.com", emailVerified: true, name: "Someone" };

/**
 * A seeded record, a staff admin and a reviewer. The admin is the first admin named by
 * STAFF_BOOTSTRAP_EMAIL, which the caller sets to ADMIN.email.
 */
export async function staffSetup(t: T = start()) {
  await t.mutation(internal.trust.seed, {});
  const admin = t.withIdentity(ADMIN);
  await admin.mutation(api.staff.add, { email: REVIEWER.email, name: REVIEWER.name, role: "reviewer" });
  return { t, admin, reviewer: t.withIdentity(REVIEWER), outsider: t.withIdentity(OUTSIDER) };
}
