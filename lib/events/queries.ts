import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Tables, Enums, Json } from "@/types/database";

export type Event = Tables<"events">;
export type EventType = Enums<"event_type">;
export type EventSource = Enums<"event_source">;
export type MsgDirection = Enums<"msg_direction">;

export type RecordEventParams = {
  orgId: string;
  type: EventType;
  source: EventSource;
  customerId?: string | null;
  jobId?: string | null;
  planId?: string | null;
  channel?: string | null;
  direction?: MsgDirection | null;
  body?: string | null;
  externalId?: string | null;
  walletTransactionId?: string | null;
  payload?: Json;
  /**
   * Use the service-role admin client (engine/webhook paths). Defaults to false
   * → the cookie-scoped server client, for in-app human-takeover sends.
   */
  serviceRole?: boolean;
};

export type ConversationMessage = {
  direction: MsgDirection | null;
  body: string | null;
  occurredAt: string;
};

/**
 * Append an event via the idempotent record_event RPC. Returns the event id
 * (existing id if (source, external_id) was already recorded).
 *
 * SEND INVARIANT: every SMS send writes BOTH a wallet_transactions debit
 * (Prompt 8, via chargeForSend) AND a 'message_sent' event here, linked by
 * walletTransactionId — so usage billing and analytics never drift apart.
 */
export async function recordEvent(params: RecordEventParams): Promise<string> {
  const supabase = params.serviceRole
    ? createAdminClient()
    : await createClient();

  const { data, error } = await supabase.rpc("record_event", {
    p_org_id: params.orgId,
    p_type: params.type,
    p_source: params.source,
    p_customer_id: params.customerId ?? undefined,
    p_job_id: params.jobId ?? undefined,
    p_plan_id: params.planId ?? undefined,
    p_channel: params.channel ?? undefined,
    p_direction: params.direction ?? undefined,
    p_body: params.body ?? undefined,
    p_external_id: params.externalId ?? undefined,
    p_wallet_txn_id: params.walletTransactionId ?? undefined,
    p_payload: params.payload ?? undefined,
  });

  if (error) {
    throw new Error(`Failed to record event: ${error.message}`);
  }

  return data as string;
}

/** Unified activity feed for a customer, newest first. */
export async function getCustomerTimeline(
  orgId: string,
  customerId: string,
  options: { limit?: number } = {}
): Promise<Event[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) {
    throw new Error(`Failed to load customer timeline: ${error.message}`);
  }

  return (data ?? []) as Event[];
}

/**
 * The SMS thread for a customer (message_sent + reply_received), oldest→newest.
 * This is what the agent passes as conversation context (Prompt 17).
 */
export async function getConversation(
  orgId: string,
  customerId: string,
  options: { limit?: number } = {}
): Promise<ConversationMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("direction, body, occurred_at")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .in("type", ["message_sent", "reply_received"])
    .order("occurred_at", { ascending: true })
    .limit(options.limit ?? 100);

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }

  const rows = (data ?? []) as Pick<
    Event,
    "direction" | "body" | "occurred_at"
  >[];

  return rows.map((row) => ({
    direction: row.direction,
    body: row.body,
    occurredAt: row.occurred_at,
  }));
}

/** Org-wide event query for dashboard/analytics reads. */
export async function listEvents(
  orgId: string,
  options: { type?: EventType; since?: string | Date; limit?: number } = {}
): Promise<Event[]> {
  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select("*")
    .eq("organization_id", orgId);

  if (options.type) query = query.eq("type", options.type);
  if (options.since) {
    const since =
      options.since instanceof Date ? options.since.toISOString() : options.since;
    query = query.gte("occurred_at", since);
  }

  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .limit(options.limit ?? 100);

  if (error) {
    throw new Error(`Failed to list events: ${error.message}`);
  }

  return (data ?? []) as Event[];
}
