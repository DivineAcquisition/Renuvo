import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RETENTION } from "@/lib/retention/config";
import { writeHeartbeat } from "@/lib/observability/heartbeat";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly retention sweep: scrub old message bodies (keep metadata). NEVER prunes
 * consent_records (A2P, 4yr) or financial_entries (tax) — those are excluded.
 */
export async function GET(req: NextRequest) {
  if (
    req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - RETENTION.messageBodyDays * 86400_000
  ).toISOString();

  const { data } = await admin
    .from("events")
    .update({ body: "[expired]" })
    .lt("occurred_at", cutoff)
    .not("body", "is", null)
    .neq("body", "[expired]")
    .in("direction", ["inbound", "outbound"])
    .select("id");

  const scrubbed = data?.length ?? 0;
  log.info("retention.sweep", { scrubbed, cutoff });
  await writeHeartbeat("retention", "ok", { scrubbed });
  return NextResponse.json({ ok: true, scrubbed });
}
