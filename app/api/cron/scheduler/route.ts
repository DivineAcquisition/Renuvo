import { NextRequest, NextResponse } from "next/server";
import { runScheduler } from "@/lib/agent/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel cron sends: Authorization: Bearer ${CRON_SECRET}
  if (
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runScheduler();
  return NextResponse.json({ ok: true, ...summary });
}
