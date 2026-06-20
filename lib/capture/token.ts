import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // ~43 chars, unguessable
}

export type ResolvedOffer = {
  linkId: string;
  linkType: "customer" | "generic";
  orgId: string;
  customerId: string | null;
  jobId: string | null;
  cadenceProfileId: string | null;
  priceCents: number;
  currency: string;
  businessName: string;
  firstName: string;
  verticalId: string | null;
  winbackDiscountPct: number;
};

/** Resolve a token to its offer, or null if missing/revoked/expired/converted. */
export async function resolveSignupToken(
  token: string
): Promise<ResolvedOffer | null> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("signup_links")
    .select(
      "id, organization_id, link_type, customer_id, job_id, cadence_profile_id, price_cents, currency, status, expires_at, opened_at, open_count, converted_at, revoked_at, winback_discount_pct"
    )
    .eq("token", token)
    .maybeSingle();

  if (!link) return null;
  if (link.revoked_at) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now())
    return null;
  // customer links are single-use: once converted, refuse re-use
  if (link.link_type === "customer" && (link.converted_at || link.status === "used"))
    return null;

  // track the open (best-effort)
  await admin
    .from("signup_links")
    .update({
      opened_at: link.opened_at ?? new Date().toISOString(),
      open_count: (link.open_count ?? 0) + 1,
    })
    .eq("id", link.id);

  const [{ data: org }, customerRes] = await Promise.all([
    admin
      .from("organizations")
      .select("name, vertical_id")
      .eq("id", link.organization_id)
      .single(),
    link.customer_id
      ? admin
          .from("customers")
          .select("full_name")
          .eq("id", link.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    linkId: link.id,
    linkType: (link.link_type as "customer" | "generic") ?? "customer",
    orgId: link.organization_id,
    customerId: link.customer_id,
    jobId: link.job_id,
    cadenceProfileId: link.cadence_profile_id,
    priceCents: link.price_cents ?? 0,
    currency: link.currency,
    businessName: org?.name ?? "your provider",
    firstName:
      (customerRes.data?.full_name ?? "").trim().split(/\s+/)[0] || "there",
    verticalId: org?.vertical_id ?? null,
    winbackDiscountPct: Number(
      (link as { winback_discount_pct?: number }).winback_discount_pct ?? 0
    ),
  };
}

/** Mark a customer token converted + used (single-use). Service-role. */
export async function consumeSignupToken(linkId: string) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin
    .from("signup_links")
    .update({ status: "used", used_at: now, converted_at: now })
    .eq("id", linkId);
}
