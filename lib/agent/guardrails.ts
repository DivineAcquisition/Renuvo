import { createAdminClient } from "@/lib/supabase/admin";

const MIN_GAP_MINUTES = 50; // min spacing between auto-messages (lets the +1h offer through)
const MAX_PER_7_DAYS = 6; // weekly cap per customer (loop protection)

/** Current hour + minute in a timezone. */
function localHM(tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hour =
    Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

export type SendVerdict = {
  allowed: boolean;
  deferMinutes?: number; // present → requeue this far out
  reason?: string; // present with allowed:false and no deferMinutes → skip
};

/**
 * Send-time policy: quiet hours (defer) + rate limits (defer or block).
 * Hard opt-out (sms_sendable) is checked separately by the scheduler/guarded send.
 */
export async function canSendNow(
  orgId: string,
  customerId: string
): Promise<SendVerdict> {
  const admin = createAdminClient();

  // ---- quiet hours (org timezone) ----
  const { data: org } = await admin
    .from("organizations")
    .select("timezone, quiet_hours_start, quiet_hours_end")
    .eq("id", orgId)
    .single();

  const tz = org?.timezone ?? "America/New_York";
  const start = org?.quiet_hours_start ?? 8;
  const end = org?.quiet_hours_end ?? 21;
  const { hour, minute } = localHM(tz);

  if (hour < start) {
    return { allowed: false, deferMinutes: (start - hour) * 60 - minute + 1 };
  }
  if (hour >= end) {
    // defer to tomorrow's start
    const minutesUntilMidnight = (24 - hour) * 60 - minute;
    return {
      allowed: false,
      deferMinutes: minutesUntilMidnight + start * 60 + 1,
    };
  }

  // ---- rate limits (per customer, outbound message events) ----
  const sinceWeek = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: recent } = await admin
    .from("events")
    .select("occurred_at")
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .eq("direction", "outbound")
    .gte("occurred_at", sinceWeek)
    .order("occurred_at", { ascending: false });

  const outbound = (recent ?? []) as { occurred_at: string }[];

  // weekly cap → block + handoff
  if (outbound.length >= MAX_PER_7_DAYS) {
    await admin.rpc("record_event", {
      p_org_id: orgId,
      p_type: "agent_action",
      p_source: "agent",
      p_customer_id: customerId,
      p_payload: { action: "handoff_needed", reason: "weekly_cap" },
    });
    return { allowed: false, reason: "weekly_cap" };
  }

  // min gap → defer
  if (outbound[0]) {
    const sinceLast = Date.now() - new Date(outbound[0].occurred_at).getTime();
    const gapMin = sinceLast / 60_000;
    if (gapMin < MIN_GAP_MINUTES) {
      return { allowed: false, deferMinutes: Math.ceil(MIN_GAP_MINUTES - gapMin) };
    }
  }

  return { allowed: true };
}

/** Ensure the FIRST outbound to a customer carries opt-out language. */
export async function ensureFirstMessageOptOut(
  orgId: string,
  customerId: string,
  body: string
): Promise<string> {
  if (/\bstop\b/i.test(body)) return body;

  const admin = createAdminClient();
  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .eq("direction", "outbound");

  if ((count ?? 0) === 0) {
    return `${body} Reply STOP to opt out.`;
  }
  return body;
}

/** Refund a charged send that hard-failed (never billed for an undelivered SMS). */
export async function reconcileSendFailure(
  orgId: string,
  chargeCents: number,
  reference: string
) {
  if (chargeCents <= 0) return;
  const admin = createAdminClient();
  await admin.rpc("credit_wallet", {
    p_org_id: orgId,
    p_amount_cents: chargeCents,
    p_type: "credit_refund",
    p_reference: `refund_${reference}`,
    p_meta: { reason: "send_failed" },
  });
}
