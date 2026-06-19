import { createAdminClient } from "@/lib/supabase/admin";
import { POST_PAYMENT_SEQUENCE } from "./sequence";

/**
 * Schedule the post-payment conversion sequence for a paid one-time job.
 * - Consent gate: if the customer isn't sms_sendable, schedule NOTHING and log.
 * - Idempotent: the unique (job_id, event_key) index makes re-runs no-ops.
 */
export async function scheduleConversionSequence(args: {
  orgId: string;
  customerId: string;
  jobId: string;
}) {
  const admin = createAdminClient();

  // consent gate
  const { data: customer } = await admin
    .from("customers")
    .select("sms_sendable")
    .eq("id", args.customerId)
    .single();

  if (!customer?.sms_sendable) {
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "agent_action",
      p_source: "agent",
      p_customer_id: args.customerId,
      p_job_id: args.jobId,
      p_payload: { action: "sequence_skipped", reason: "no_sms_consent" },
    });
    return { scheduled: 0, reason: "no_consent" as const };
  }

  const now = Date.now();
  const rows = POST_PAYMENT_SEQUENCE.map((step) => ({
    organization_id: args.orgId,
    customer_id: args.customerId,
    job_id: args.jobId,
    event_key: step.eventKey,
    send_at: new Date(now + step.offsetMinutes * 60_000).toISOString(),
    status: "pending" as const,
  }));

  // upsert with ignore-on-conflict (idempotent on job_id+event_key)
  const { data: inserted, error } = await admin
    .from("scheduled_messages")
    .upsert(rows, { onConflict: "job_id,event_key", ignoreDuplicates: true })
    .select("id, event_key");

  if (error) {
    console.error("[engine] schedule failed:", error);
    return { scheduled: 0, reason: "error" as const };
  }

  for (const r of inserted ?? []) {
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "scheduled_message_queued",
      p_source: "agent",
      p_customer_id: args.customerId,
      p_job_id: args.jobId,
      p_payload: { event_key: r.event_key, scheduled_message_id: r.id },
    });
  }

  return { scheduled: inserted?.length ?? 0, reason: "ok" as const };
}

/**
 * Cancel all PENDING queued messages for a customer. Called when they convert
 * (Prompt 20), reply meaningfully (Prompt 19), or opt out (Prompt 13).
 * Sent messages are untouched.
 */
export async function cancelPendingMessages(
  orgId: string,
  customerId: string,
  reason: string
) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("scheduled_messages")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .eq("status", "pending")
    .select("id");
  return { cancelled: data?.length ?? 0 };
}
