import { createAdminClient } from "@/lib/supabase/admin";
import { buildCaptureUrl } from "@/lib/urls";
import { newToken } from "./token";

/**
 * Get (or create) the recurring-signup link for a customer+job. Reuses an active
 * link so the offer and reminder texts point to the same page. Offer defaults:
 * the org's default cadence for its vertical, priced at the one-time job amount.
 */
export async function getSignupLink(args: {
  orgId: string;
  customerId: string;
  jobId?: string;
}): Promise<string> {
  const admin = createAdminClient();

  // reuse an active link for this customer/job
  const { data: existing } = await admin
    .from("signup_links")
    .select("token")
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("status", "active")
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();
  if (existing?.token) return buildCaptureUrl(existing.token);

  // resolve offered cadence + price.
  // Cadence preference: org's preferred_cadence_id → the vertical default.
  const { data: org } = await admin
    .from("organizations")
    .select("vertical_id, preferred_cadence_id")
    .eq("id", args.orgId)
    .single();
  const { data: vertical } = await admin
    .from("verticals")
    .select("default_cadence_id")
    .eq("id", org?.vertical_id ?? "")
    .maybeSingle();

  const cadenceId = org?.preferred_cadence_id ?? vertical?.default_cadence_id;

  let priceCents = 0;
  if (args.jobId) {
    const { data: job } = await admin
      .from("jobs")
      .select("price_cents")
      .eq("id", args.jobId)
      .single();
    priceCents = job?.price_cents ?? 0;
  }
  if (!cadenceId) return buildCaptureUrl("invalid");

  const token = newToken();
  await admin.from("signup_links").insert({
    organization_id: args.orgId,
    customer_id: args.customerId,
    job_id: args.jobId ?? null,
    cadence_profile_id: cadenceId,
    price_cents: priceCents,
    token,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
  });

  return buildCaptureUrl(token);
}
