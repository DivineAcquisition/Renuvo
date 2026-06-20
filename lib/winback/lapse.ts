import { createAdminClient } from "@/lib/supabase/admin";
import { enrollWinback } from "./enroll";

/**
 * Opt-in lapse sweep: enroll still-consented one-time customers who haven't been
 * back in a while. Bounded by the RPC's day window so we never retroactively
 * enroll an org's entire historical churn list on launch.
 */
export async function sweepLapsedCustomers(): Promise<{ enrolled: number }> {
  if (process.env.WINBACK_ENABLED !== "true") return { enrolled: 0 };
  const admin = createAdminClient();

  const { data: orgs } = await admin
    .from("offer_configs")
    .select("organization_id")
    .eq("winback_enabled", true);

  let enrolled = 0;
  for (const o of orgs ?? []) {
    const orgId = (o as { organization_id: string }).organization_id;
    const { data: candidates } = await admin.rpc("winback_lapse_candidates", {
      p_org: orgId,
    });
    for (const row of (candidates ?? []) as { customer_id: string }[]) {
      const res = await enrollWinback({
        orgId,
        customerId: row.customer_id,
        kind: "lapse",
      });
      if (res.enrolled) enrolled++;
    }
  }
  return { enrolled };
}
