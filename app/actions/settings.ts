"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { Database } from "@/types/database";
import {
  orgSettingsSchema,
  ORG_SETTING_ROUTES,
  type OrgSettings,
} from "@/lib/settings/schema";
import { getOrgSettings } from "@/lib/settings/resolve";

type EventKey = Database["public"]["Enums"]["template_event_key"];

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * The ONE consolidated org-settings save path (Prompt 35): validates the full
 * merged object (cross-field rules), routes each changed key to its real table,
 * and writes an audit row per change. Owner-gated.
 */
export async function updateOrgSettings(patch: Partial<OrgSettings>) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can change business settings." };
  const admin = createAdminClient();

  const current = await getOrgSettings(active.org.id);
  const merged = { ...current, ...patch };

  const parsed = orgSettingsSchema.safeParse(merged);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };

  const byTable: Record<string, Record<string, unknown>> = {};
  const audits: { key: string; oldV: unknown; newV: unknown }[] = [];
  for (const key of Object.keys(patch) as (keyof OrgSettings)[]) {
    if (
      JSON.stringify(merged[key]) === JSON.stringify(current[key])
    )
      continue;
    const route = ORG_SETTING_ROUTES[key];
    (byTable[route.table] ??= {})[route.column] = merged[key];
    audits.push({ key, oldV: current[key], newV: merged[key] });
  }

  for (const [table, cols] of Object.entries(byTable)) {
    if (table === "organizations") {
      await admin.from("organizations").update(cols).eq("id", active.org.id);
    } else {
      await admin
        .from(table)
        .upsert(
          { organization_id: active.org.id, ...cols },
          { onConflict: "organization_id" }
        );
    }
  }

  if (audits.length) {
    const uid = await currentUserId();
    if (uid) {
      await admin.from("settings_audit").insert(
        audits.map((a) => ({
          organization_id: active.org.id,
          profile_id: uid,
          scope: "org",
          setting_key: a.key,
          old_value: a.oldV,
          new_value: a.newV,
        }))
      );
    }
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateUserSettings(patch: { displayName?: string }) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const uid = await currentUserId();
  if (!uid) return { error: "Not authenticated." };
  const admin = createAdminClient();
  if (patch.displayName !== undefined) {
    await admin
      .from("profiles")
      .update({ full_name: patch.displayName })
      .eq("id", uid);
    await admin.from("settings_audit").insert({
      organization_id: active.org.id,
      profile_id: uid,
      scope: "user",
      setting_key: "displayName",
      new_value: patch.displayName,
    });
  }
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

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
