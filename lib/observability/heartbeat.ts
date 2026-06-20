import { createAdminClient } from "@/lib/supabase/admin";

/** Record a cron run so a separate check can alert if a job stops running. */
export async function writeHeartbeat(
  jobName: string,
  status: "ok" | "error" = "ok",
  meta: Record<string, unknown> = {}
) {
  try {
    const admin = createAdminClient();
    await admin.from("system_heartbeats").upsert(
      {
        job_name: jobName,
        last_run_at: new Date().toISOString(),
        last_status: status,
        meta,
      },
      { onConflict: "job_name" }
    );
  } catch {
    /* heartbeat is best-effort */
  }
}
