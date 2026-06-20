import type { Database } from "@/types/database";

export type SequenceStep = {
  eventKey: Database["public"]["Enums"]["template_event_key"];
  offsetMinutes: number; // from payment time
};

/**
 * Default post-payment conversion sequence. Offsets are from the payment moment.
 * (Made configurable per org later; constant for now.) Winback/save_offer are
 * NOT here — they're triggered by retention signals, not a fresh payment.
 *
 * Quiet-hours/rate-limit shifting is applied at SEND time by the scheduler +
 * guardrails (Prompt 22), so a 2am send_at is automatically deferred — we don't
 * pre-adjust here.
 */
export const POST_PAYMENT_SEQUENCE: SequenceStep[] = [
  { eventKey: "post_payment_activation", offsetMinutes: 0 }, // immediate
  { eventKey: "conversion_offer", offsetMinutes: 60 }, // +1h
  { eventKey: "reminder", offsetMinutes: 60 * 24 }, // +1d
  { eventKey: "objection_followup", offsetMinutes: 60 * 72 }, // +3d
];

// The activation message isn't a "follow-up" and never counts against the cap.
export const ACTIVATION_KEY = "post_payment_activation";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolve an org's editable sequence (Prompt 33). Falls back to the built-in
 * default if none configured. Only enabled steps, ordered.
 */
export async function getSequence(
  orgId: string,
  sequenceKey = "post_payment"
): Promise<SequenceStep[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("sequence_steps")
      .select("template_key, delay_minutes, enabled, step_order")
      .eq("organization_id", orgId)
      .eq("sequence_key", sequenceKey)
      .eq("enabled", true)
      .order("step_order");
    if (data && data.length) {
      return data.map((s) => ({
        eventKey: s.template_key as SequenceStep["eventKey"],
        offsetMinutes: s.delay_minutes,
      }));
    }
  } catch {
    /* fall through to default */
  }
  return POST_PAYMENT_SEQUENCE;
}
