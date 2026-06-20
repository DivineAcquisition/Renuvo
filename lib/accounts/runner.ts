import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { captureError } from "@/lib/observability/logger";
import { runBulkItem } from "./bulk-exec";

const CONCURRENCY = 5;
const CHUNK_DELAY_MS = 250; // gentle on Stripe rate limits

export type BulkRunSummary = { processed: number; ops: number };

/** Drain queued bulk_operations with a concurrency cap. Partial failure is normal. */
export async function processBulkOperations(): Promise<BulkRunSummary> {
  const admin = createAdminClient();
  const summary: BulkRunSummary = { processed: 0, ops: 0 };

  // claim a small number of queued ops per tick
  const { data: ops } = await admin
    .from("bulk_operations")
    .select("id, organization_id, actor_id, action, params, target_ids")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);

  for (const op of ops ?? []) {
    summary.ops++;
    await admin
      .from("bulk_operations")
      .update({ status: "running" })
      .eq("id", op.id);

    const targets = (op.target_ids ?? []) as string[];
    const params = (op.params ?? {}) as Record<string, unknown>;
    let succeeded = 0;
    let failed = 0;
    const errors: { id: string; reason: string }[] = [];

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const chunk = targets.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((planId) =>
          runBulkItem(
            op.organization_id,
            op.action,
            planId,
            params,
            op.actor_id ?? null
          )
        )
      );
      results.forEach((r, j) => {
        const planId = chunk[j];
        if (r.status === "fulfilled") {
          if (r.value.status === "ok") succeeded++;
          else {
            // a skip is not a failure — record it as a soft error for visibility
            errors.push({ id: planId, reason: `skipped:${r.value.reason}` });
            succeeded++;
          }
        } else {
          failed++;
          errors.push({
            id: planId,
            reason:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
      summary.processed += chunk.length;
      if (i + CONCURRENCY < targets.length)
        await new Promise((res) => setTimeout(res, CHUNK_DELAY_MS));
    }

    const status = failed === 0 ? "completed" : "completed_with_errors";
    await admin
      .from("bulk_operations")
      .update({
        status,
        succeeded,
        failed,
        errors,
        completed_at: new Date().toISOString(),
      })
      .eq("id", op.id);

    // audit summary (Prompt 35)
    if (op.actor_id) {
      await admin.from("settings_audit").insert({
        organization_id: op.organization_id,
        profile_id: op.actor_id,
        scope: "org",
        setting_key: "bulk_accounts_op",
        new_value: {
          action: op.action,
          total: targets.length,
          succeeded,
          failed,
        },
      });
    }

    log.info("bulk.op_done", {
      orgId: op.organization_id,
      event: "bulk_op_done",
      action: op.action,
      succeeded,
      failed,
    });
  }

  return summary;
}

/** Wrapped entry for the cron route. */
export async function runBulkWorker(): Promise<BulkRunSummary> {
  try {
    return await processBulkOperations();
  } catch (e) {
    captureError(e, { event: "bulk_worker_failed" });
    throw e;
  }
}
