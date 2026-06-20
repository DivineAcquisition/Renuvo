import { createClient } from "@/lib/supabase/server";
import { fromCents } from "@/lib/money";

export type AccountFilter = {
  status?: ("active" | "paused" | "pending" | "cancelled")[];
  cadence?: string[]; // cadence_profile keys
  risk?: ("high" | "medium" | "low")[];
  search?: string; // customer name
  sort?: "value_desc" | "next_charge_asc" | "created_desc" | "risk_desc";
};

export type AccountRow = {
  id: string;
  status: string;
  risk_level: string;
  price_cents: number;
  next_service_at: string | null;
  created_at: string;
  cadence_label: string | null;
  cadence_key: string | null;
  package_name: string | null;
  customer: { id: string; full_name: string | null; sms_sendable: boolean } | null;
};

/** All recurring accounts for the hub, with the fields the table + filters need. */
export async function listAccounts(
  orgId: string,
  f: AccountFilter = {}
): Promise<AccountRow[]> {
  const supabase = await createClient();
  let q = supabase
    .from("recurring_plans")
    .select(
      `id, status, risk_level, price_cents, next_service_at, created_at,
       customers!inner ( id, full_name, sms_sendable ),
       cadence_profiles!inner ( key, label, interval_days ),
       service_packages ( name )`
    )
    .eq("organization_id", orgId);

  if (f.status?.length) q = q.in("status", f.status);
  if (f.risk?.length) q = q.in("risk_level", f.risk);
  if (f.cadence?.length) q = q.in("cadence_profiles.key", f.cadence);
  if (f.search) q = q.ilike("customers.full_name", `%${f.search}%`);

  switch (f.sort) {
    case "next_charge_asc":
      q = q.order("next_service_at", { ascending: true, nullsFirst: false });
      break;
    case "created_desc":
      q = q.order("created_at", { ascending: false });
      break;
    case "risk_desc":
      q = q.order("risk_level", { ascending: false });
      break;
    default:
      q = q.order("price_cents", { ascending: false }); // value_desc
  }

  const { data } = await q.limit(500);
  return (data ?? []).map((r) => {
    const cad = r.cadence_profiles as unknown as {
      key: string;
      label: string;
    } | null;
    const cust = r.customers as unknown as {
      id: string;
      full_name: string | null;
      sms_sendable: boolean;
    } | null;
    const pkg = r.service_packages as unknown as { name?: string } | null;
    return {
      id: r.id,
      status: r.status,
      risk_level: r.risk_level,
      price_cents: r.price_cents,
      next_service_at: r.next_service_at,
      created_at: r.created_at,
      cadence_label: cad?.label ?? null,
      cadence_key: cad?.key ?? null,
      package_name: pkg?.name ?? null,
      customer: cust,
    };
  });
}

export type AccountsSummary = {
  active: number;
  paused: number;
  past_due: number;
  at_risk: number;
  mrr_microdollars: number;
};

/** Portfolio summary for the hub header. MRR normalizes each cadence to monthly. */
export async function getAccountsSummary(
  orgId: string
): Promise<AccountsSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recurring_plans")
    .select("status, risk_level, price_cents, cadence_profiles ( interval_days )")
    .eq("organization_id", orgId)
    .limit(2000);

  const s: AccountsSummary = {
    active: 0,
    paused: 0,
    past_due: 0,
    at_risk: 0,
    mrr_microdollars: 0,
  };
  for (const r of data ?? []) {
    if (r.status === "paused") s.paused++;
    if (r.status !== "active") continue;
    s.active++;
    if (r.risk_level === "high" || r.risk_level === "medium") s.at_risk++;
    if (r.risk_level === "high") s.past_due++; // payment-failing proxy
    const days =
      (r.cadence_profiles as unknown as { interval_days?: number } | null)
        ?.interval_days ?? 30;
    const visitsPerMonth = days > 0 ? 30 / days : 1;
    s.mrr_microdollars += Math.round(fromCents(r.price_cents) * visitsPerMonth);
  }
  return s;
}

export type TimelineEntry = {
  id: string;
  kind: "change" | "note" | "event";
  at: string;
  title: string;
  detail?: string;
  pinned?: boolean;
};

/** Merge plan_change_log + account_notes + retention_events into one timeline. */
export async function getPlanTimeline(
  orgId: string,
  planId: string
): Promise<TimelineEntry[]> {
  const supabase = await createClient();
  const [{ data: changes }, { data: notes }, { data: events }] =
    await Promise.all([
      supabase
        .from("plan_change_log")
        .select("id, change_type, old_value, new_value, actor_kind, created_at")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("account_notes")
        .select("id, body, pinned, created_at")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("retention_events")
        .select("id, type, reason, occurred_at")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("occurred_at", { ascending: false })
        .limit(100),
    ]);

  const out: TimelineEntry[] = [];
  for (const c of changes ?? []) {
    out.push({
      id: `c_${c.id}`,
      kind: "change",
      at: c.created_at,
      title: describeChange(c.change_type, c.old_value, c.new_value),
      detail: c.actor_kind === "owner" ? "you" : c.actor_kind,
    });
  }
  for (const n of notes ?? []) {
    out.push({
      id: `n_${n.id}`,
      kind: "note",
      at: n.created_at,
      title: `Note: ${n.body}`,
      pinned: n.pinned,
    });
  }
  for (const e of events ?? []) {
    out.push({
      id: `e_${e.id}`,
      kind: "event",
      at: e.occurred_at,
      title: EVENT_LABEL[e.type] ?? e.type,
      detail: e.reason ?? undefined,
    });
  }
  out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return out;
}

/** The vertical's cadence options for the cadence-change control. */
export async function getOfferedCadences(orgId: string) {
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("vertical_id")
    .eq("id", orgId)
    .single();
  if (!org?.vertical_id) return [];
  const { data } = await supabase
    .from("cadence_profiles")
    .select("id, key, label, interval_days")
    .eq("vertical_id", org.vertical_id)
    .order("interval_days");
  return data ?? [];
}

const EVENT_LABEL: Record<string, string> = {
  plan_created: "Plan created",
  activated: "Plan activated",
  paused: "Paused",
  resumed: "Resumed",
  cancelled: "Cancelled",
  churn_risk_flagged: "Flagged at risk",
  save_offer_sent: "Save offer sent",
  save_offer_accepted: "Save offer accepted",
  save_offer_declined: "Save offer declined",
  winback_sent: "Win-back sent",
  winback_recovered: "Win-back recovered",
  payment_failed: "Payment failed",
  payment_recovered: "Payment recovered",
};

function money(cents?: number | null) {
  if (cents == null) return "";
  return `$${(cents / 100).toFixed(0)}`;
}

function describeChange(
  type: string,
  oldV: unknown,
  newV: unknown
): string {
  const o = (oldV ?? {}) as Record<string, unknown>;
  const n = (newV ?? {}) as Record<string, unknown>;
  if (type === "price")
    return `Price changed ${money(o.price_cents as number)} → ${money(n.price_cents as number)}/visit`;
  if (type === "cadence")
    return `Cadence changed ${(o.cadence_label as string) ?? "?"} → ${(n.cadence_label as string) ?? "?"}`;
  if (type === "payment") return "Payment update requested";
  if (type === "status")
    return `Status changed ${(o.status as string) ?? "?"} → ${(n.status as string) ?? "?"}`;
  if (type === "created") return "Plan created";
  return type;
}
