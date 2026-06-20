import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type TenantRow = {
  id: string;
  name: string;
  created_at: string;
  subscription_status: string;
  a2p_status: string;
  messaging_suspended: boolean;
  active_plans: number;
  mrr_microdollars: number;
  wallet_balance_cents: number;
};

/** Tenant directory via the self-checking security-definer RPC (user session). */
export async function getTenantDirectory(): Promise<TenantRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_tenant_directory");
  if (error || !data) return [];
  return data as unknown as TenantRow[];
}

export type TenantDetail = {
  id: string;
  name: string;
  created_at: string;
  subscription_status: string;
  current_period_end: string | null;
  a2p_status: string;
  messaging_suspended: boolean;
  messaging_suspended_reason: string | null;
  messagingProvisioned: boolean;
  ownerEmail: string | null;
  wallet: {
    balance_cents: number;
    auto_reload_enabled: boolean;
  } | null;
  a2p: {
    step: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    vetting_score: number | null;
  } | null;
  activePlans: number;
  economics: {
    smsMarginMicro: number;
    subscriptionFeesMicro: number;
    saasFeesMicro: number;
  };
  email: {
    bounces: number;
    complaints: number;
    unsubscribes: number;
  };
};

/**
 * One tenant's operational snapshot for admins. Cross-tenant read via the
 * service-role client (the whole /admin area is gated by is_platform_admin at
 * the layout + middleware). NO customer-level data is read.
 */
export async function getTenantDetail(
  orgId: string
): Promise<TenantDetail | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select(
      "id, name, created_at, subscription_status, current_period_end, a2p_status, messaging_suspended, messaging_suspended_reason, telnyx_messaging_profile_id, telnyx_phone_number"
    )
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return null;

  const [
    { data: wallet },
    { data: a2p },
    { data: owner },
    { data: fin },
    planAgg,
    { data: suppressions },
  ] = await Promise.all([
      admin
        .from("wallets")
        .select("balance_cents, auto_reload_enabled")
        .eq("organization_id", orgId)
        .maybeSingle(),
      admin
        .from("a2p_registrations")
        .select("step, brand_status, campaign_status, vetting_score")
        .eq("organization_id", orgId)
        .maybeSingle(),
      admin
        .from("memberships")
        .select("role, profiles(email)")
        .eq("organization_id", orgId)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle(),
      admin
        .from("financial_entries")
        .select("category, amount_microdollars")
        .eq("organization_id", orgId)
        .limit(2000),
      admin
        .from("recurring_plans")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "active"),
      admin
        .from("email_suppressions")
        .select("reason")
        .eq("organization_id", orgId)
        .limit(5000),
    ]);

  // shared-domain reputation: spot a tenant generating bounces/complaints so an
  // admin can use the kill-switch before it hurts everyone.
  const emailRep = { bounces: 0, complaints: 0, unsubscribes: 0 };
  for (const s of (suppressions ?? []) as { reason: string }[]) {
    if (s.reason === "bounce") emailRep.bounces++;
    else if (s.reason === "complaint") emailRep.complaints++;
    else if (s.reason === "unsubscribe") emailRep.unsubscribes++;
  }

  const economics = { smsMarginMicro: 0, subscriptionFeesMicro: 0, saasFeesMicro: 0 };
  for (const e of (fin ?? []) as {
    category: string;
    amount_microdollars: number;
  }[]) {
    const v = Number(e.amount_microdollars);
    if (e.category === "sms_margin") economics.smsMarginMicro += v;
    else if (e.category === "subscription_fee")
      economics.subscriptionFeesMicro += v;
    else if (e.category === "saas_fee") economics.saasFeesMicro += v;
  }

  return {
    id: org.id,
    name: org.name,
    created_at: org.created_at,
    subscription_status:
      (org as { subscription_status?: string }).subscription_status ?? "none",
    current_period_end:
      (org as { current_period_end?: string | null }).current_period_end ??
      null,
    a2p_status: org.a2p_status ?? "not_started",
    messaging_suspended:
      (org as { messaging_suspended?: boolean }).messaging_suspended ?? false,
    messaging_suspended_reason:
      (org as { messaging_suspended_reason?: string | null })
        .messaging_suspended_reason ?? null,
    messagingProvisioned: !!(
      (org as { telnyx_messaging_profile_id?: string | null })
        .telnyx_messaging_profile_id &&
      (org as { telnyx_phone_number?: string | null }).telnyx_phone_number
    ),
    ownerEmail:
      (owner?.profiles as unknown as { email: string | null } | null)?.email ??
      null,
    wallet: wallet
      ? {
          balance_cents: wallet.balance_cents,
          auto_reload_enabled: wallet.auto_reload_enabled,
        }
      : null,
    a2p: (a2p as TenantDetail["a2p"]) ?? null,
    activePlans: planAgg.count ?? 0,
    economics,
    email: emailRep,
  };
}

export type A2pAttentionRow = {
  orgId: string;
  orgName: string;
  step: string | null;
  brandStatus: string | null;
  campaignStatus: string | null;
  vettingScore: number | null;
  daysInState: number;
};

export async function getA2pOversight() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("a2p_registrations")
    .select(
      "organization_id, step, brand_status, campaign_status, vetting_score, updated_at, organizations(name)"
    )
    .limit(500);

  const rows = (data ?? []) as unknown as {
    organization_id: string;
    step: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    vetting_score: number | null;
    updated_at: string;
    organizations: { name: string } | null;
  }[];

  let approved = 0,
    pending = 0,
    failed = 0;
  const attention: A2pAttentionRow[] = [];
  for (const r of rows) {
    const isFailed =
      r.brand_status === "FAILED" || r.campaign_status === "FAILED";
    const isApproved = r.campaign_status === "APPROVED";
    if (isApproved) approved++;
    else if (isFailed) failed++;
    else pending++;

    const days = Math.floor(
      (Date.now() - new Date(r.updated_at).getTime()) / 86400000
    );
    const lowScore = r.vetting_score != null && r.vetting_score < 75;
    const stuck = !isApproved && days > 10;
    if (isFailed || lowScore || stuck) {
      attention.push({
        orgId: r.organization_id,
        orgName: r.organizations?.name ?? "Org",
        step: r.step,
        brandStatus: r.brand_status,
        campaignStatus: r.campaign_status,
        vettingScore: r.vetting_score,
        daysInState: days,
      });
    }
  }
  return { approved, pending, failed, attention };
}

/** Net platform revenue per week for the trend chart. */
export async function getRevenueTrend(): Promise<
  { label: string; value: number }[]
> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 84 * 86400000).toISOString();
  const { data } = await admin
    .from("financial_entries")
    .select("occurred_at, amount_microdollars, bucket")
    .in("bucket", ["platform_revenue", "platform_cost"])
    .gte("occurred_at", since)
    .limit(5000);

  const weeks: { label: string; start: number; value: number }[] = [];
  const now = Date.now();
  for (let i = 11; i >= 0; i--) {
    const start = now - i * 7 * 86400000;
    weeks.push({
      label: new Date(start).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      start,
      value: 0,
    });
  }
  for (const e of (data ?? []) as {
    occurred_at: string;
    amount_microdollars: number;
    bucket: string;
  }[]) {
    const t = new Date(e.occurred_at).getTime();
    const idx = weeks.findIndex(
      (w, i) =>
        t >= w.start && (i === weeks.length - 1 || t < weeks[i + 1].start)
    );
    if (idx >= 0) {
      const v = Number(e.amount_microdollars);
      weeks[idx].value += e.bucket === "platform_revenue" ? v : -v;
    }
  }
  return weeks.map((w) => ({ label: w.label, value: Math.max(0, w.value) }));
}
