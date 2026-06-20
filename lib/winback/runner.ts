import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { getWinbackSteps, type WinbackKind } from "./sequence";

export type WinbackSummary = {
  scanned: number;
  enqueued: number;
  exhausted: number;
  suppressed: number;
  recovered: number;
  skipped: number;
};

/**
 * Win-back runner — rides the SAME scheduled_messages + guarded send path as the
 * conversion engine, so consent, quiet hours, suspension, funds and the
 * kill-switch all apply automatically. We only decide WHO gets the next step and
 * WHEN; the scheduler does the sending.
 */
export async function runWinback(batch = 200): Promise<WinbackSummary> {
  const summary: WinbackSummary = {
    scanned: 0,
    enqueued: 0,
    exhausted: 0,
    suppressed: 0,
    recovered: 0,
    skipped: 0,
  };
  if (process.env.WINBACK_ENABLED !== "true") return summary;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await admin
    .from("winback_campaigns")
    .select(
      "id, organization_id, customer_id, recurring_plan_id, kind, status, attempt_count"
    )
    .in("status", ["eligible", "in_progress"])
    .lte("eligible_at", nowIso)
    .order("eligible_at", { ascending: true })
    .limit(batch);

  summary.scanned = due?.length ?? 0;

  for (const cmp of due ?? []) {
    try {
      const kind = cmp.kind as WinbackKind;

      // per-org tuning + autonomy
      const [{ data: offer }, { data: org }] = await Promise.all([
        admin
          .from("offer_configs")
          .select("winback_enabled, winback_max_attempts, winback_retry_gap_days")
          .eq("organization_id", cmp.organization_id)
          .maybeSingle(),
        admin
          .from("organizations")
          .select("agent_mode")
          .eq("id", cmp.organization_id)
          .single(),
      ]);
      if (!(offer as { winback_enabled?: boolean } | null)?.winback_enabled) {
        summary.skipped++;
        continue;
      }
      const maxAttempts =
        (offer as { winback_max_attempts?: number } | null)
          ?.winback_max_attempts ?? 2;
      const retryGapDays =
        (offer as { winback_retry_gap_days?: number } | null)
          ?.winback_retry_gap_days ?? 21;
      const reviewMode =
        (org as { agent_mode?: string } | null)?.agent_mode === "review";

      // CAP: hard attempt limit (anti-spam)
      if (cmp.attempt_count >= maxAttempts) {
        await setStatus(admin, cmp.id, "exhausted");
        summary.exhausted++;
        continue;
      }

      // consent may have changed since enrollment (STOP) → suppress
      const { data: c } = await admin
        .from("customers")
        .select("sms_sendable, email_sendable, phone")
        .eq("id", cmp.customer_id)
        .single();
      if (!c?.sms_sendable && !c?.email_sendable) {
        await setStatus(admin, cmp.id, "suppressed");
        summary.suppressed++;
        continue;
      }

      // involuntary: if the plan already went active again, it's recovered
      if (kind === "involuntary" && cmp.recurring_plan_id) {
        const { data: plan } = await admin
          .from("recurring_plans")
          .select("status")
          .eq("id", cmp.recurring_plan_id)
          .maybeSingle();
        if ((plan as { status?: string } | null)?.status === "active") {
          await admin
            .from("winback_campaigns")
            .update({ status: "recovered", recovered_at: nowIso })
            .eq("id", cmp.id);
          summary.recovered++;
          continue;
        }
      }

      // pick the step for this attempt; no steps left → exhausted
      const steps = await getWinbackSteps(cmp.organization_id, kind);
      const step = steps[cmp.attempt_count];
      if (!step) {
        await setStatus(admin, cmp.id, "exhausted");
        summary.exhausted++;
        continue;
      }

      // enqueue ONE message via the shared guarded scheduled-messages path
      const { error: insErr } = await admin.from("scheduled_messages").insert({
        organization_id: cmp.organization_id,
        customer_id: cmp.customer_id,
        recurring_plan_id: cmp.recurring_plan_id,
        event_key: step,
        send_at: nowIso,
        status: "pending",
        requires_approval: reviewMode,
      });
      if (insErr) {
        summary.skipped++;
        continue;
      }

      // advance the campaign; space the next attempt by retry_gap_days
      await admin
        .from("winback_campaigns")
        .update({
          status: "in_progress",
          attempt_count: cmp.attempt_count + 1,
          last_attempt_at: nowIso,
          eligible_at: new Date(
            Date.now() + retryGapDays * 86_400_000
          ).toISOString(),
        })
        .eq("id", cmp.id);

      // metrics signal (attempt)
      await admin.from("retention_events").insert({
        organization_id: cmp.organization_id,
        recurring_plan_id: cmp.recurring_plan_id,
        customer_id: cmp.customer_id,
        type: "winback_sent",
      });

      summary.enqueued++;
    } catch {
      summary.skipped++;
    }
  }

  log.info("winback.run", { event: "winback_run", ...summary });
  return summary;
}

async function setStatus(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  status: string
) {
  await admin.from("winback_campaigns").update({ status }).eq("id", id);
}
