import crypto from "crypto";

function key(): string {
  return (
    process.env.CONSENT_HMAC_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "renuvo-unsub-fallback"
  );
}

/** Signed, unforgeable unsubscribe token for {customer,org}. */
export function signUnsub(customerId: string, orgId: string): string {
  return crypto
    .createHmac("sha256", key())
    .update(`${customerId}:${orgId}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsub(
  customerId: string,
  orgId: string,
  token: string
): boolean {
  const expected = signUnsub(customerId, orgId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
