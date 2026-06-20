import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runChurnScoring } from "@/lib/intelligence/churn-score";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "churn-scoring",
    status: "in_progress",
  });
  try {
    const summary = await runChurnScoring();
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "churn-scoring",
      status: "ok",
    });
    await writeHeartbeat("churn_scoring", "ok", summary);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    Sentry.captureCheckIn({
      checkInId,
      monitorSlug: "churn-scoring",
      status: "error",
    });
    captureError(e, { event: "cron_churn_scoring_failed" });
    await writeHeartbeat("churn_scoring", "error");
    return NextResponse.json({ error: "churn_scoring_failed" }, { status: 500 });
  }
}
