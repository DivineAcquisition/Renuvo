"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const CONTROLS_PATH = "/dashboard/settings/controls";

// ---- Automation -----------------------------------------------------------
export async function saveAutomation(input: {
  agentMode: "auto" | "review";
  maxFollowUps: number;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const max = Math.max(0, Math.min(10, Math.round(input.maxFollowUps)));
  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({ agent_mode: input.agentMode, max_follow_ups: max })
    .eq("id", active.org.id);
  revalidatePath(CONTROLS_PATH);
  return { ok: true };
}

// ---- Offer ----------------------------------------------------------------
export async function saveOfferConfig(input: {
  recurringDiscountPct: number;
  offeredCadences: string[];
  defaultCadence: string;
  pitchStyle: "gentle" | "balanced" | "direct";
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  if (!input.offeredCadences.includes(input.defaultCadence))
    return { error: "Default cadence must be one of the offered cadences." };
  const pct = Math.max(0, Math.min(90, input.recurringDiscountPct));
  const admin = createAdminClient();
  await admin.from("offer_configs").upsert(
    {
      organization_id: active.org.id,
      recurring_discount_pct: pct,
      offered_cadences: input.offeredCadences,
      default_cadence: input.defaultCadence,
      pitch_style: input.pitchStyle,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
  revalidatePath(CONTROLS_PATH);
  return { ok: true };
}

// ---- Sequence -------------------------------------------------------------
export type SequenceStepInput = {
  template_key: string;
  delay_minutes: number;
  enabled: boolean;
};

export async function saveSequence(steps: SequenceStepInput[]) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  // replace the org's post_payment steps wholesale (simple + predictable)
  await admin
    .from("sequence_steps")
    .delete()
    .eq("organization_id", active.org.id)
    .eq("sequence_key", "post_payment");
  const rows = steps.slice(0, 10).map((s, i) => ({
    organization_id: active.org.id,
    sequence_key: "post_payment",
    step_order: i + 1,
    template_key: s.template_key,
    delay_minutes: Math.max(0, Math.min(43200, Math.round(s.delay_minutes))),
    enabled: s.enabled,
  }));
  if (rows.length) await admin.from("sequence_steps").insert(rows);
  revalidatePath(CONTROLS_PATH);
  return { ok: true };
}

export async function resetSequence() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin
    .from("sequence_steps")
    .delete()
    .eq("organization_id", active.org.id)
    .eq("sequence_key", "post_payment");
  await admin.rpc("seed_org_controls", { p_org_id: active.org.id });
  revalidatePath(CONTROLS_PATH);
  return { ok: true };
}

// ---- Notification preferences (per-user) ----------------------------------
export async function saveNotificationPref(input: {
  event: string;
  email: boolean;
  inApp: boolean;
}) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin.from("notification_preferences").upsert(
    {
      organization_id: active.org.id,
      profile_id: user.id,
      event: input.event,
      email: input.email,
      in_app: input.inApp,
    },
    { onConflict: "organization_id,profile_id,event" }
  );
  revalidatePath(CONTROLS_PATH);
  return { ok: true };
}

// ---- Notifications (bell) --------------------------------------------------
export async function markNotificationsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", user.id)
    .is("read_at", null);
  revalidatePath("/dashboard");
  return { ok: true };
}
