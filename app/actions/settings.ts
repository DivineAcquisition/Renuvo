"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";

type EventKey = Database["public"]["Enums"]["template_event_key"];

export async function updateBusinessProfile(input: {
  name: string;
  timezone: string;
  quietStart: number;
  quietEnd: number;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  if (input.quietStart >= input.quietEnd)
    return { error: "Quiet-hours start must be before end." };

  const supabase = await createClient(); // RLS: orgs_update_owner allows this
  const { error } = await supabase
    .from("organizations")
    .update({
      name: input.name,
      timezone: input.timezone,
      quiet_hours_start: input.quietStart,
      quiet_hours_end: input.quietEnd,
    })
    .eq("id", active.org.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/settings/profile");
  return { ok: true };
}

export async function updatePreferredCadence(cadenceId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const supabase = await createClient();
  await supabase
    .from("organizations")
    .update({ preferred_cadence_id: cadenceId })
    .eq("id", active.org.id);
  revalidatePath("/dashboard/settings/schedule");
  return { ok: true };
}

export async function updateWalletSettingsAction(input: {
  autoReloadEnabled: boolean;
  thresholdCents: number;
  amountCents: number;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin.rpc("update_wallet_settings", {
    p_org_id: active.org.id,
    p_auto_reload_enabled: input.autoReloadEnabled,
    p_reload_threshold: input.thresholdCents,
    p_reload_amount: input.amountCents,
  });
  revalidatePath("/dashboard/settings/payments");
  return { ok: true };
}

export async function saveTemplate(
  verticalId: string,
  eventKey: string,
  body: string
) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const supabase = await createClient(); // RLS: templates_insert/update_org

  // Upsert the ORG OVERRIDE by hand (the unique index is partial, so ON CONFLICT
  // can't infer it): update an existing override, else insert a new one.
  const { data: existing } = await supabase
    .from("message_templates")
    .select("id")
    .eq("organization_id", active.org.id)
    .eq("vertical_id", verticalId)
    .eq("event_key", eventKey as EventKey)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("message_templates")
      .update({ body })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("message_templates").insert({
      organization_id: active.org.id,
      vertical_id: verticalId,
      event_key: eventKey as EventKey,
      body,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/dashboard/settings/messaging");
  return { ok: true };
}
