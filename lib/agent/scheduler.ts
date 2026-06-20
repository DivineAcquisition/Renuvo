import { createAdminClient } from "@/lib/supabase/admin";
import { generateMessage, mapEventKeyToEventType } from "./generate";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { canSendNow } from "./guardrails";
import { log } from "@/lib/log";
import type { Database } from "@/types/database";

type EventKey = Database["public"]["Enums"]["template_event_key"];

const MAX_ATTEMPTS = 3;

export type SchedulerSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
  recovered: number;
};

type ClaimedRow = {
  id: string;
  organization_id: string;
  customer_id: string;
  job_id: string | null;
  recurring_plan_id: string | null;
  event_key: EventKey;
  attempts: number;
};

// mapEventKeyToEventType returns the full event_type union; sendGuardedSms only
// accepts the send-related subset.
type SendEventType = "message_sent" | "activation_sent" | "conversion_offer_sent";

async function setStatus(
  id: string,
  status: string,
  patch: Record<string, unknown> = {}
) {
  const admin = createAdminClient();
  await admin
    .from("scheduled_messages")
    .update({ status, ...patch })
    .eq("id", id);
}

async function requeue(
  id: string,
  minutes: number,
  attempts: number,
  error?: string
) {
  const admin = createAdminClient();
  await admin
    .from("scheduled_messages")
    .update({
      status: "pending",
      send_at: new Date(Date.now() + minutes * 60_000).toISOString(),
      attempts: attempts + 1,
      last_error: error ?? null,
    })
    .eq("id", id);
}

export async function runScheduler(batch = 100): Promise<SchedulerSummary> {
  const admin = createAdminClient();

  // 0) recover crashed-mid-run rows
  const { data: recovered } = await admin.rpc("recover_stale_processing", {
    p_older_minutes: 10,
  });

  // 1) claim a batch atomically (FOR UPDATE SKIP LOCKED — no double-send)
  const { data: claimed } = await admin.rpc("claim_due_messages", {
    p_limit: batch,
  });
  const rows = (claimed ?? []) as ClaimedRow[];

  let sent = 0,
    skipped = 0,
    failed = 0,
    deferred = 0;

  for (const row of rows) {
    try {
      // send-time policy (quiet hours / rate limit — Prompt 22)
      const gate = await canSendNow(row.organization_id, row.customer_id);
      if (!gate.allowed) {
        if (gate.deferMinutes) {
          // quiet-hours / min-gap defer — no attempt consumed
          await requeue(row.id, gate.deferMinutes, row.attempts - 1);
          deferred++;
        } else {
          // hard block (e.g. weekly cap) — skip, don't retry
          await setStatus(row.id, "skipped", {
            cancel_reason: gate.reason ?? "blocked",
          });
          skipped++;
        }
        continue;
      }

      // load phone + consent
      const { data: customer } = await admin
        .from("customers")
        .select("phone, sms_sendable")
        .eq("id", row.customer_id)
        .single();

      if (!customer?.sms_sendable || !customer.phone) {
        await setStatus(row.id, "skipped", { cancel_reason: "not_sendable" });
        skipped++;
        continue;
      }

      // generate copy (always returns a sendable string or empty)
      const gen = await generateMessage({
        orgId: row.organization_id,
        customerId: row.customer_id,
        eventKey: row.event_key,
        jobId: row.job_id ?? undefined,
        planId: row.recurring_plan_id ?? undefined,
      });
      if (!gen.text) {
        await setStatus(row.id, "skipped", { cancel_reason: "no_template" });
        skipped++;
        continue;
      }

      // guarded send (consent + deliverability + funds)
      const res = await sendGuardedSms({
        orgId: row.organization_id,
        customerId: row.customer_id,
        toPhone: customer.phone,
        body: gen.text,
        eventType: mapEventKeyToEventType(row.event_key) as SendEventType,
        meta: { scheduled_message_id: row.id, fallback_used: gen.fallbackUsed },
      });

      if (res.ok) {
        await setStatus(row.id, "sent");
        sent++;
      } else if (res.reason === "insufficient_funds") {
        // auto-reload already fired inside guarded send; retry shortly
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await setStatus(row.id, "skipped", {
            cancel_reason: "insufficient_funds",
          });
          skipped++;
        } else {
          await requeue(row.id, 30, row.attempts, "insufficient_funds");
          deferred++;
        }
      } else if (
        res.reason === "not_sendable" ||
        res.reason === "no_number" ||
        res.reason === "a2p_not_ready"
      ) {
        await setStatus(row.id, "skipped", { cancel_reason: res.reason });
        skipped++;
      } else {
        // transient send failure → backoff retry
        if (row.attempts + 1 >= MAX_ATTEMPTS) {
          await setStatus(row.id, "failed", { last_error: res.reason });
          failed++;
        } else {
          await requeue(row.id, 15, row.attempts, res.reason);
          deferred++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (row.attempts + 1 >= MAX_ATTEMPTS) {
        await setStatus(row.id, "failed", { last_error: msg });
        failed++;
      } else {
        await requeue(row.id, 15, row.attempts, msg);
        deferred++;
      }
    }
  }

  const summary = {
    claimed: rows.length,
    sent,
    skipped,
    failed,
    deferred,
    recovered: recovered ?? 0,
  };
  log.info("scheduler.run", summary);
  return summary;
}
