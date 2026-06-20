import { createClient } from "@/lib/supabase/server";

type CustomerRef = { full_name: string | null; phone: string } | null;

export type AttentionPlan = {
  id: string;
  customer_id: string | null;
  risk_level?: string;
  customers: CustomerRef;
};
export type AttentionReply = {
  id: string;
  full_name: string | null;
  phone: string;
};

export type AttentionItems = {
  atRisk: AttentionPlan[];
  replies: AttentionReply[];
  failedPayments: AttentionPlan[];
};

/** The actionable items — what the owner needs to resolve. */
export async function getAttentionItems(orgId: string): Promise<AttentionItems> {
  try {
    const supabase = await createClient();
    const [atRisk, replies, failed] = await Promise.all([
      supabase
        .from("recurring_plans")
        .select("id, customer_id, risk_level, customers(full_name, phone)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("risk_level", "medium")
        .limit(5),
      supabase
        .from("customers")
        .select("id, full_name, phone")
        .eq("organization_id", orgId)
        .eq("agent_paused", true)
        .limit(5),
      supabase
        .from("recurring_plans")
        .select("id, customer_id, risk_level, customers(full_name, phone)")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .eq("risk_level", "high")
        .limit(5),
    ]);
    return {
      atRisk: (atRisk.data ?? []) as unknown as AttentionPlan[],
      replies: (replies.data ?? []) as unknown as AttentionReply[],
      failedPayments: (failed.data ?? []) as unknown as AttentionPlan[],
    };
  } catch {
    return { atRisk: [], replies: [], failedPayments: [] };
  }
}

export type ActivityEvent = {
  id: string;
  type: string;
  occurred_at: string;
};

/** Recent retention-lifecycle events for the activity feed. */
export async function getRecentActivity(
  orgId: string
): Promise<ActivityEvent[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("retention_events")
      .select("id, type, occurred_at")
      .eq("organization_id", orgId)
      .order("occurred_at", { ascending: false })
      .limit(12);
    return (data ?? []) as unknown as ActivityEvent[];
  } catch {
    return [];
  }
}
