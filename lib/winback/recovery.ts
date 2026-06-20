import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import type { WinbackKind } from "./sequence";

const WINBACK_EVENT_KEYS = ["winback", "payment_recovery", "reactivation"];

/**
 * Mark a customer's live win-back campaigns as recovered and cancel any pending
 * win-back messages — stop pestering someone who already came back. Called when a
 * returnee re-enrolls (voluntary/lapse) or an involuntary plan goes active again.
 */
export async function markWinbackRecovered(args: {
  orgId: string;
  customerId: string;
  kind?: WinbackKind;
}): Promise<{ recovered: number }> {
  const admin = createAdminClient();

  let q = admin
    .from("winback_campaigns")
    .update({ status: "recovered", recovered_at: new Date().toISOString() })
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .in("status", ["eligible", "in_progress"]);
  if (args.kind) q = q.eq("kind", args.kind);
  const { data: recovered } = await q.select("id, recurring_plan_id");

  if (!recovered?.length) return { recovered: 0 };

  // cancel pending win-back sends for this customer
  await admin
    .from("scheduled_messages")
    .update({ status: "cancelled", cancel_reason: "winback_recovered" })
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("status", "pending")
    .in("event_key", WINBACK_EVENT_KEYS);

  // platform + org metrics signal
  for (const r of recovered) {
    await admin.from("retention_events").insert({
      organization_id: args.orgId,
      recurring_plan_id: (r as { recurring_plan_id?: string }).recurring_plan_id ?? null,
      customer_id: args.customerId,
      type: "winback_recovered",
    });
  }

  log.info("winback.recovered", {
    orgId: args.orgId,
    event: "winback_recovered",
    count: recovered.length,
  });
  return { recovered: recovered.length };
}
