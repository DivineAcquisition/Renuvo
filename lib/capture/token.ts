import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url"); // ~43 chars, unguessable
}

export type ResolvedOffer = {
  linkId: string;
  orgId: string;
  customerId: string;
  jobId: string | null;
  cadenceProfileId: string;
  priceCents: number;
  currency: string;
  businessName: string;
  firstName: string;
  verticalId: string | null;
};

/** Resolve a token to its offer, or null if missing/used/expired. Service-role. */
export async function resolveSignupToken(
  token: string
): Promise<ResolvedOffer | null> {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("signup_links")
    .select(
      "id, organization_id, customer_id, job_id, cadence_profile_id, price_cents, currency, status, expires_at"
    )
    .eq("token", token)
    .maybeSingle();

  if (!link || link.status !== "active") return null;
  if (new Date(link.expires_at).getTime() < Date.now()) {
    await admin
      .from("signup_links")
      .update({ status: "expired" })
      .eq("id", link.id);
    return null;
  }

  const [{ data: org }, { data: customer }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, vertical_id")
      .eq("id", link.organization_id)
      .single(),
    admin
      .from("customers")
      .select("full_name")
      .eq("id", link.customer_id)
      .single(),
  ]);

  return {
    linkId: link.id,
    orgId: link.organization_id,
    customerId: link.customer_id,
    jobId: link.job_id,
    cadenceProfileId: link.cadence_profile_id,
    priceCents: link.price_cents,
    currency: link.currency,
    businessName: org?.name ?? "your provider",
    firstName: (customer?.full_name ?? "").trim().split(/\s+/)[0] || "there",
    verticalId: org?.vertical_id ?? null,
  };
}

/** Mark a token used (single-use). Service-role. */
export async function consumeSignupToken(linkId: string) {
  const admin = createAdminClient();
  await admin
    .from("signup_links")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("status", "active");
}
