import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runBulkWorker } from "@/lib/accounts/runner";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "bulk-operations",
    status: "in_progress",
  });

  try {
    const summary = await runBulkWorker();
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "bulk-operations",
      status: "ok",
    });
    await writeHeartbeat("bulk_operations", "ok", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "bulk-operations",
      status: "error",
    });
    captureError(e, { event: "cron_bulk_operations_failed" });
    await writeHeartbeat("bulk_operations", "error");
    return NextResponse.json({ error: "bulk_failed" }, { status: 500 });
  }
}
