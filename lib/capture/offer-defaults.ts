import { createAdminClient } from "@/lib/supabase/admin";

/** Resolve the cadence + price an offer should use for an org (and optionally a
 *  customer). Cadence: org preferred → vertical default. Price: the customer's
 *  most recent paid one-time job, else 0 (owner can set it on generic links). */
export async function resolveOfferDefaults(
  orgId: string,
  customerId?: string | null
): Promise<{ cadenceId: string | null; priceCents: number }> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("vertical_id, preferred_cadence_id")
    .eq("id", orgId)
    .single();

  let cadenceId =
    (org as { preferred_cadence_id?: string | null } | null)
      ?.preferred_cadence_id ?? null;
  if (!cadenceId && org?.vertical_id) {
    const { data: vertical } = await admin
      .from("verticals")
      .select("default_cadence_id")
      .eq("id", org.vertical_id)
      .maybeSingle();
    cadenceId = vertical?.default_cadence_id ?? null;
  }

  let priceCents = 0;
  if (customerId) {
    const { data: job } = await admin
      .from("jobs")
      .select("price_cents")
      .eq("organization_id", orgId)
      .eq("customer_id", customerId)
      .eq("kind", "one_time")
      .not("paid_at", "is", null)
      .order("paid_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    priceCents = job?.price_cents ?? 0;
  }

  return { cadenceId, priceCents };
}
