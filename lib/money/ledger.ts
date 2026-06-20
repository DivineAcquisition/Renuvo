import { createAdminClient } from "@/lib/supabase/admin";
import type { Microdollars } from "@/lib/money";

export async function recordFinancialEntry(e: {
  orgId: string;
  category: "subscription_fee" | "saas_fee" | "adjustment";
  bucket: "platform_revenue" | "tenant_in" | "tenant_out" | "platform_cost";
  amountMicrodollars: Microdollars;
  source: string;
  reference?: string;
  recurringPlanId?: string;
  meta?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  // idempotency guard for external-sourced entries
  if (e.reference) {
    const { data: dup } = await admin
      .from("financial_entries")
      .select("id")
      .eq("organization_id", e.orgId)
      .eq("category", e.category)
      .eq("reference", e.reference)
      .maybeSingle();
    if (dup) return;
  }
  await admin.from("financial_entries").insert({
    organization_id: e.orgId,
    category: e.category,
    bucket: e.bucket,
    amount_microdollars: e.amountMicrodollars,
    source: e.source,
    reference: e.reference ?? null,
    recurring_plan_id: e.recurringPlanId ?? null,
    meta: e.meta ?? {},
  });
}
