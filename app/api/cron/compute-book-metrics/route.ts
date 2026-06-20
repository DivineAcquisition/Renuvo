import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { computeAllBookMetrics } from "@/lib/finintel/compute";
import { withMonitoring } from "@/lib/observability/withMonitoring";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "compute-book-metrics",
    status: "in_progress",
  });
  try {
    // stale financial metrics that later feed underwriting are dangerous → monitor
    const summary = await withMonitoring("compute_book_metrics", {}, () =>
      computeAllBookMetrics()
    );
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "compute-book-metrics",
      status: "ok",
    });
    await writeHeartbeat("compute_book_metrics", "ok", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "compute-book-metrics",
      status: "error",
    });
    captureError(e, { event: "cron_book_metrics_failed" });
    await writeHeartbeat("compute_book_metrics", "error");
    return NextResponse.json({ error: "book_metrics_failed" }, { status: 500 });
  }
}
