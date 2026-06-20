import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { runWinback } from "@/lib/winback/runner";
import { sweepLapsedCustomers } from "@/lib/winback/lapse";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Win-back tick: enqueue due win-back steps (which then ride the normal scheduler
 * + guarded send) and run the opt-in lapse sweep. Ships behind WINBACK_ENABLED.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn({
    monitorSlug: "winback",
    status: "in_progress",
  });

  try {
    const lapse = await sweepLapsedCustomers();
    const summary = await runWinback();
    Sentry.captureCheckIn({ checkInId, monitorSlug: "winback", status: "ok" });
    await writeHeartbeat("winback", "ok", { ...summary, lapseEnrolled: lapse.enrolled });
    return NextResponse.json({ ok: true, ...summary, lapseEnrolled: lapse.enrolled });
  } catch (e) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: "winback", status: "error" });
    captureError(e, { event: "cron_winback_failed" });
    await writeHeartbeat("winback", "error");
    return NextResponse.json({ error: "winback_failed" }, { status: 500 });
  }
}
