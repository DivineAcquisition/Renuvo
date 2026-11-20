/**
 * Which backend this is, and what a backend that is not production may do (docs/foundation/06-deployments.md).
 *
 * Production is decided by the deployment's own name, which Convex sets in CONVEX_CLOUD_URL, against
 * the list below. Every other deployment (the test backend, a restored copy, a developer's own) is not
 * production, without anyone having to remember a setting: it is safe by default.
 *
 * A backend that is not production:
 *  - sends email and texts only to the addresses in TEST_RECIPIENTS (comma-separated), never to a real
 *    customer, cleaner, applicant or owner;
 *  - refuses Telnyx calls that buy or change anything (numbers, brands, campaigns);
 *  - ignores live Stripe and Autumn keys, so nothing it does can charge a real card.
 *
 * Code run with no deployment at all (the test harness) has no name and is left as it is.
 */

/** The live backend. Keep scripts/build.mjs's copy the same (convex/environment.test.ts checks). */
export const PRODUCTION_DEPLOYMENTS: readonly string[] = ["terrific-avocet-835"];

export type Environment = "production" | "non_production" | "unknown";

/** The deployment's name, from https://<name>.convex.cloud, or null outside a deployment. */
export function deploymentName(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.CONVEX_CLOUD_URL?.trim();
  if (!url) return null;
  const match = /^https?:\/\/([a-z0-9-]+)\.convex\.cloud\/?$/i.exec(url);
  return match ? match[1].toLowerCase() : url;
}

export function environment(env: Record<string, string | undefined> = process.env): Environment {
  const name = deploymentName(env);
  if (name === null) return "unknown";
  return PRODUCTION_DEPLOYMENTS.includes(name) ? "production" : "non_production";
}

/** True only on a deployment known not to be production. */
export function isNonProduction(): boolean {
  return environment() === "non_production";
}

const phoneDigits = (value: string) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** Whether a non-production backend may send to this address. */
export function testRecipientAllowed(to: string): boolean {
  const allowed = (process.env.TEST_RECIPIENTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const address = to.trim().toLowerCase();
  if (address.includes("@")) return allowed.includes(address);
  const digits = phoneDigits(address);
  return digits.length >= 10 && allowed.some((item) => !item.includes("@") && phoneDigits(item) === digits);
}

export const NOT_SENT_ON_TEST = "Not sent: this is not the production backend, and the address is not on its TEST_RECIPIENTS list.";

/** Null when this send may go; otherwise why it may not. */
export function sendBlocked(to: string): string | null {
  if (!isNonProduction()) return null;
  return testRecipientAllowed(to) ? null : NOT_SENT_ON_TEST;
}
