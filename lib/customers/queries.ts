import { createClient } from "@/lib/supabase/server";

export async function getCustomerDetail(orgId: string, customerId: string) {
  const supabase = await createClient();
  const [{ data: customer }, { data: plans }, { data: events }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("organization_id", orgId)
        .eq("id", customerId)
        .maybeSingle(),
      supabase
        .from("recurring_plans")
        .select(
          "id, status, price_cents, currency, risk_level, next_service_at, cadence_profiles(label)"
        )
        .eq("organization_id", orgId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false }),
      supabase
        .from("retention_events")
        .select("id, type, occurred_at")
        .eq("organization_id", orgId)
        .eq("customer_id", customerId)
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);
  return { customer, plans: plans ?? [], events: events ?? [] };
}
