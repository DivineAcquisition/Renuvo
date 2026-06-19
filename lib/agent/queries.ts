import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type ScheduledMessage = Tables<"scheduled_messages">;

/** A customer's queue (pending + history), newest send_at first. */
export async function getScheduledForCustomer(
  orgId: string,
  customerId: string
): Promise<ScheduledMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .order("send_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load scheduled messages: ${error.message}`);
  }
  return (data ?? []) as ScheduledMessage[];
}

/**
 * Pending rows that are due (send_at <= now), oldest first. The Prompt 21
 * scheduler uses the service-role variant of this to drain the queue.
 */
export async function getPendingDue(
  orgId?: string,
  limit = 100
): Promise<ScheduledMessage[]> {
  const supabase = await createClient();
  let query = supabase
    .from("scheduled_messages")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString());

  if (orgId) query = query.eq("organization_id", orgId);

  const { data, error } = await query
    .order("send_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load due messages: ${error.message}`);
  }
  return (data ?? []) as ScheduledMessage[];
}

/** Which steps are pending/sent/cancelled for a job. */
export async function getSequenceStatus(
  jobId: string
): Promise<ScheduledMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("*")
    .eq("job_id", jobId)
    .order("send_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load sequence status: ${error.message}`);
  }
  return (data ?? []) as ScheduledMessage[];
}
