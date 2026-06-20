import { createClient } from "@/lib/supabase/server";

export type ConversationRow = {
  customerId: string;
  name: string;
  phone: string;
  lastBody: string;
  lastAt: string;
  lastDirection: "inbound" | "outbound";
  agentPaused: boolean;
  sendable: boolean;
};

/**
 * Threads are derived from the events spine (Prompt 9): one "conversation" per
 * customer, keyed by customer id. No separate conversations table exists.
 */
export async function listConversations(
  orgId: string,
  filter: "all" | "needs_human" = "all"
): Promise<ConversationRow[]> {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("customer_id, body, direction, occurred_at")
    .eq("organization_id", orgId)
    .in("direction", ["inbound", "outbound"])
    .not("body", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(400);

  const order: string[] = [];
  const last: Record<
    string,
    { body: string; direction: string; occurred_at: string }
  > = {};
  for (const e of events ?? []) {
    if (!e.customer_id) continue;
    if (!last[e.customer_id]) {
      order.push(e.customer_id);
      last[e.customer_id] = {
        body: e.body ?? "",
        direction: e.direction ?? "outbound",
        occurred_at: e.occurred_at,
      };
    }
  }
  if (order.length === 0) return [];

  const { data: customers } = await supabase
    .from("customers")
    .select("id, full_name, phone, agent_paused, sms_sendable")
    .in("id", order);
  const cmap = new Map((customers ?? []).map((c) => [c.id, c]));

  let rows: ConversationRow[] = order.map((id) => {
    const c = cmap.get(id);
    const l = last[id];
    return {
      customerId: id,
      name: c?.full_name ?? "Customer",
      phone: c?.phone ?? "",
      lastBody: l.body,
      lastAt: l.occurred_at,
      lastDirection: l.direction === "inbound" ? "inbound" : "outbound",
      agentPaused: !!c?.agent_paused,
      sendable: !!c?.sms_sendable,
    };
  });
  if (filter === "needs_human")
    rows = rows.filter((r) => r.agentPaused || r.lastDirection === "inbound");
  return rows;
}

export type ThreadMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  type: string;
  channel: string | null;
  occurred_at: string;
};

export async function getThread(orgId: string, customerId: string) {
  const supabase = await createClient();
  const [{ data: customer }, { data: messages }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, phone, sms_sendable, agent_paused")
      .eq("organization_id", orgId)
      .eq("id", customerId)
      .maybeSingle(),
    supabase
      .from("events")
      .select("id, direction, body, type, channel, occurred_at")
      .eq("organization_id", orgId)
      .eq("customer_id", customerId)
      .in("direction", ["inbound", "outbound"])
      .not("body", "is", null)
      .order("occurred_at", { ascending: true })
      .limit(500),
  ]);
  return {
    customer,
    messages: (messages ?? []) as unknown as ThreadMessage[],
  };
}
