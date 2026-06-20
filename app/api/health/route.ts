import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** Shallow dependency probe for uptime monitoring. Status booleans only — never
 *  secrets or PII. 503 if a CRITICAL dependency (the database) is down. */
export async function GET() {
  const checks = { db: false, stripe: false, telnyx: false };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("verticals").select("id").limit(1);
    checks.db = !error;
  } catch {
    checks.db = false;
  }

  // reachability-lite: the integration is "up" if its key is configured (a live
  // probe would add latency + flakiness to a health endpoint).
  checks.stripe = !!(await getServerSecret("STRIPE_SECRET_KEY"));
  checks.telnyx = !!(await getServerSecret("TELNYX_API_KEY"));

  const ok = checks.db; // db is the only hard-critical dependency
  return NextResponse.json(
    { ok, checks, ts: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  );
}
