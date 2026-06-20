import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runScheduler } from "@/lib/agent/scheduler";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel cron sends: Authorization: Bearer ${CRON_SECRET}
  if (
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sentry cron monitor: alerts natively if check-ins stop arriving.
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "scheduler",
    status: "in_progress",
  });

  try {
    const summary = await runScheduler();
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "scheduler",
      status: "ok",
    });
    await writeHeartbeat("scheduler", "ok", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "scheduler",
      status: "error",
    });
    captureError(e, { event: "cron_scheduler_failed" });
    await writeHeartbeat("scheduler", "error");
    return NextResponse.json({ error: "scheduler_failed" }, { status: 500 });
  }
}
