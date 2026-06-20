import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import type { WinbackKind } from "./sequence";

/**
 * Enroll a churned customer into a win-back campaign. Guards at creation:
 *  - feature flag + per-org winback_enabled,
 *  - customer must have a consented channel (never win-back an opted-out person),
 *  - no duplicate live campaign of the same kind.
 * Involuntary (failed payment) is time-sensitive recovery → no cooldown.
 */
export async function enrollWinback(args: {
  orgId: string;
  customerId: string;
  planId?: string | null;
  kind: WinbackKind;
}): Promise<{ enrolled: boolean; reason?: string }> {
  if (process.env.WINBACK_ENABLED !== "true")
    return { enrolled: false, reason: "disabled" };
  const admin = createAdminClient();

  const { data: offer } = await admin
    .from("offer_configs")
    .select("winback_enabled, winback_cooldown_days")
    .eq("organization_id", args.orgId)
    .maybeSingle();
  if (!(offer as { winback_enabled?: boolean } | null)?.winback_enabled)
    return { enrolled: false, reason: "not_enabled" };

  // never win-back an opted-out customer (no channel of consent)
  const { data: c } = await admin
    .from("customers")
    .select("sms_sendable, email_sendable")
    .eq("id", args.customerId)
    .single();
  if (!c?.sms_sendable && !c?.email_sendable)
    return { enrolled: false, reason: "no_consent" };

  // skip if a live campaign of this kind already exists for the customer
  const { data: dupe } = await admin
    .from("winback_campaigns")
    .select("id")
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("kind", args.kind)
    .in("status", ["eligible", "in_progress"])
    .maybeSingle();
  if (dupe) return { enrolled: false, reason: "exists" };

  const cooldownDays =
    args.kind === "involuntary"
      ? 0
      : (offer as { winback_cooldown_days?: number } | null)
          ?.winback_cooldown_days ?? 14;

  const { error } = await admin.from("winback_campaigns").insert({
    organization_id: args.orgId,
    customer_id: args.customerId,
    recurring_plan_id: args.planId ?? null,
    kind: args.kind,
    status: "eligible",
    eligible_at: new Date(Date.now() + cooldownDays * 86_400_000).toISOString(),
  });
  if (error) {
    // unique violation = a campaign for this (customer, plan, kind) already exists
    if (error.code === "23505") return { enrolled: false, reason: "exists" };
    return { enrolled: false, reason: error.message };
  }

  log.info("winback.enrolled", {
    orgId: args.orgId,
    event: "winback_enrolled",
    kind: args.kind,
  });
  return { enrolled: true };
}
