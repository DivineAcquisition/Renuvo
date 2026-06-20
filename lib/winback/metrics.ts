import { createAdminClient } from "@/lib/supabase/admin";

export type WinbackKindStat = {
  attempted: number;
  recovered: number;
  ratePct: number;
};

export type WinbackMetrics = {
  byKind: Record<"voluntary" | "involuntary" | "lapse", WinbackKindStat>;
  recoveredThisMonth: number;
  recoveredPlanValueCents: number; // per-visit value of plans recovered (honest LTV signal)
};

const KINDS = ["voluntary", "involuntary", "lapse"] as const;

/** Win-back effectiveness for an org: rate by kind + recovered value. */
export async function getWinbackMetrics(orgId: string): Promise<WinbackMetrics> {
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("winback_campaigns")
    .select("customer_id, kind, status, attempt_count, recovered_at")
    .eq("organization_id", orgId);

  const byKind = {
    voluntary: { attempted: 0, recovered: 0, ratePct: 0 },
    involuntary: { attempted: 0, recovered: 0, ratePct: 0 },
    lapse: { attempted: 0, recovered: 0, ratePct: 0 },
  } as WinbackMetrics["byKind"];

  const monthAgo = Date.now() - 30 * 86_400_000;
  let recoveredThisMonth = 0;
  const recoveredCustomers = new Set<string>();

  for (const c of (campaigns ?? []) as {
    customer_id: string;
    kind: keyof WinbackMetrics["byKind"];
    status: string;
    attempt_count: number;
    recovered_at: string | null;
  }[]) {
    if (!KINDS.includes(c.kind)) continue;
    if (c.attempt_count > 0 || c.status === "recovered")
      byKind[c.kind].attempted++;
    if (c.status === "recovered") {
      byKind[c.kind].recovered++;
      recoveredCustomers.add(c.customer_id);
      if (c.recovered_at && new Date(c.recovered_at).getTime() >= monthAgo)
        recoveredThisMonth++;
    }
  }
  for (const k of KINDS) {
    const s = byKind[k];
    s.ratePct = s.attempted > 0 ? Math.round((s.recovered / s.attempted) * 100) : 0;
  }

  let recoveredPlanValueCents = 0;
  if (recoveredCustomers.size) {
    const { data: plans } = await admin
      .from("recurring_plans")
      .select("price_cents")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .in("customer_id", Array.from(recoveredCustomers));
    for (const p of (plans ?? []) as { price_cents?: number }[])
      recoveredPlanValueCents += p.price_cents ?? 0;
  }

  return { byKind, recoveredThisMonth, recoveredPlanValueCents };
}
