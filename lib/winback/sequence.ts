import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

type EventKey = Database["public"]["Enums"]["template_event_key"];

export type WinbackKind = "voluntary" | "involuntary" | "lapse";

export const SEQUENCE_KEY: Record<WinbackKind, string> = {
  voluntary: "winback_voluntary",
  involuntary: "winback_involuntary",
  lapse: "winback_lapse",
};

/**
 * The ordered win-back steps for a kind. Unlike the conversion sequence there is
 * NO fallback — if an org has no steps, win-back simply does nothing (never sends
 * a post-payment message by accident).
 */
export async function getWinbackSteps(
  orgId: string,
  kind: WinbackKind
): Promise<EventKey[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sequence_steps")
    .select("template_key, step_order, enabled")
    .eq("organization_id", orgId)
    .eq("sequence_key", SEQUENCE_KEY[kind])
    .eq("enabled", true)
    .order("step_order");
  return (data ?? []).map((s) => s.template_key as EventKey);
}
