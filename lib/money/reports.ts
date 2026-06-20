import { createClient } from "@/lib/supabase/server";

export type TenantSpend = {
  wallet_topups_micro: number;
  sms_spend_micro: number;
  refunds_micro: number;
};

export type PlatformRevenue = {
  sms_margin_micro: number;
  subscription_fees_micro: number;
  sms_cost_micro: number;
  net_revenue_micro: number;
};

/** Tenant's spend with Renuvo (top-ups, SMS spend, refunds) in µ$. */
export async function getTenantSpend(
  orgId: string,
  sinceISO?: string
): Promise<TenantSpend> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("fin_tenant_spend", {
    p_org_id: orgId,
    ...(sinceISO ? { p_since: sinceISO } : {}),
  });
  return (data as unknown as TenantSpend) ?? {
    wallet_topups_micro: 0,
    sms_spend_micro: 0,
    refunds_micro: 0,
  };
}

/** Renuvo's platform revenue (SMS margin + sub fees − cost). Admin only. */
export async function getPlatformRevenue(
  sinceISO?: string
): Promise<PlatformRevenue | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fin_platform_revenue", {
    ...(sinceISO ? { p_since: sinceISO } : {}),
  });
  if (error) return null;
  return (data as unknown as PlatformRevenue) ?? null;
}
