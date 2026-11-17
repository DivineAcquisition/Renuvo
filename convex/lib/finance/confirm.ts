/**
 * Confirming a money action against exactly what was shown.
 *
 * Before a refund, a void or another action that moves money or changes what a customer owes, the
 * person is shown a preview: the action, the amount, the customer and the records it touches. The
 * preview carries `bindsTo`, a fingerprint of those facts. The action sends it back and the server
 * works it out again from the record at that moment; if anything material changed (an amount, a
 * payment settling, a credit added), the fingerprints differ and nothing runs. The person reviews again.
 */
import { userError } from "../errors";

export type Material = Record<string, string | number | boolean | null | undefined>;

export async function bindsTo(action: string, facts: Material): Promise<string> {
  const canonical = `${action}|${Object.keys(facts)
    .sort()
    .map((key) => `${key}=${facts[key] ?? ""}`)
    .join("|")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireSame(given: string, action: string, facts: Material): Promise<void> {
  if (given !== (await bindsTo(action, facts))) {
    throw userError("Something changed since you reviewed this, so nothing was done. Review it again.", "invalid");
  }
}
