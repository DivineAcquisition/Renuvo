import { randomBytes, createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const PORTAL_COOKIE = "renuvo_portal";

function secret(): string {
  return (
    process.env.PORTAL_TOKEN_SECRET ??
    process.env.CONSENT_HMAC_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "renuvo-portal-fallback"
  );
}
const hash = (t: string) => createHmac("sha256", secret()).update(t).digest("hex");

function portalBase(): string {
  return (
    process.env.NEXT_PUBLIC_PORTAL_URL ??
    `https://account.${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "renuvo.io"}`
  );
}

/** Create a single-use magic link for a customer; returns the raw URL to deliver. */
export async function issuePortalLink(
  orgId: string,
  customerId: string,
  purpose: "manage" | "payment_update" = "manage"
): Promise<string> {
  const admin = createAdminClient();
  const token = randomBytes(32).toString("hex"); // 256-bit
  await admin.from("portal_links").insert({
    organization_id: orgId,
    customer_id: customerId,
    purpose,
    token_hash: hash(token),
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), // 30 min
  });
  const next = purpose === "payment_update" ? "?next=/payment" : "";
  return `${portalBase()}/access/${token}${next}`;
}

export type ConsumeResult =
  | { error: string }
  | { ok: true; sessionToken: string; purpose: string };

/** Consume a magic link → mint a session token (caller sets the cookie). */
export async function consumePortalLink(token: string): Promise<ConsumeResult> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("*")
    .eq("token_hash", hash(token))
    .is("consumed_at", null)
    .maybeSingle();
  if (!link) return { error: "invalid_or_used" };
  if (new Date(link.expires_at) < new Date()) return { error: "expired" };

  await admin
    .from("portal_links")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", link.id);

  const sessionToken = randomBytes(32).toString("hex");
  await admin.from("portal_sessions").insert({
    organization_id: link.organization_id,
    customer_id: link.customer_id,
    session_token_hash: hash(sessionToken),
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), // 60 min
  });
  return { ok: true, sessionToken, purpose: link.purpose };
}

export type PortalSession = { orgId: string; customerId: string };

/** Resolve the current portal session from the cookie. The ONLY identity source. */
export async function getPortalSession(
  sessionToken: string | undefined
): Promise<PortalSession | null> {
  if (!sessionToken) return null;
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("portal_sessions")
    .select("organization_id, customer_id, expires_at, revoked_at")
    .eq("session_token_hash", hash(sessionToken))
    .maybeSingle();
  if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return null;
  return { orgId: s.organization_id, customerId: s.customer_id };
}
