import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  orgSettingsSchema,
  userSettingsSchema,
  type OrgSettings,
  type UserSettings,
} from "./schema";

/**
 * The ONE way the app reads org settings. Assembles from the existing tables,
 * applies defaults via the schema, and caches per request. Consumers (scheduler,
 * capture, engine, generation, wallet) read from THIS, not raw columns.
 */
export const getOrgSettings = cache(
  async (orgId: string): Promise<OrgSettings> => {
    const admin = createAdminClient();
    const [{ data: org }, { data: offer }, { data: wallet }] =
      await Promise.all([
        admin
          .from("organizations")
          .select(
            "timezone, quiet_hours_start, quiet_hours_end, agent_mode, max_follow_ups"
          )
          .eq("id", orgId)
          .single(),
        admin
          .from("offer_configs")
          .select(
            "recurring_discount_pct, offered_cadences, default_cadence, pitch_style"
          )
          .eq("organization_id", orgId)
          .maybeSingle(),
        admin
          .from("wallets")
          .select(
            "auto_reload_enabled, reload_threshold_cents, reload_amount_cents"
          )
          .eq("organization_id", orgId)
          .maybeSingle(),
      ]);

    const o = (org ?? {}) as Record<string, unknown>;
    const f = (offer ?? {}) as Record<string, unknown>;
    const w = (wallet ?? {}) as Record<string, unknown>;

    return orgSettingsSchema.parse({
      timezone: o.timezone ?? undefined,
      quietHoursStart: o.quiet_hours_start ?? undefined,
      quietHoursEnd: o.quiet_hours_end ?? undefined,
      agentMode: o.agent_mode ?? undefined,
      maxFollowUps: o.max_follow_ups ?? undefined,
      recurringDiscountPct:
        f.recurring_discount_pct != null
          ? Number(f.recurring_discount_pct)
          : undefined,
      offeredCadences: f.offered_cadences ?? undefined,
      defaultCadence: f.default_cadence ?? undefined,
      pitchStyle: f.pitch_style ?? undefined,
      autoReloadEnabled: w.auto_reload_enabled ?? undefined,
      autoReloadThresholdCents: w.reload_threshold_cents ?? undefined,
      autoReloadAmountCents: w.reload_amount_cents ?? undefined,
    });
  }
);

export const getUserSettings = cache(
  async (profileId: string): Promise<UserSettings> => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", profileId)
      .single();
    return userSettingsSchema.parse({ displayName: data?.full_name ?? undefined });
  }
);
