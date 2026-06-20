import { z } from "zod";

// ---- ORG SETTINGS (business config; owner-gated) ----------------------------
// NOTE: quietHoursStart/End represent the ALLOWED sending window in the org's
// local time (matching Prompt 22's guardrails), not a "quiet" window.
export const orgSettingsSchema = z
  .object({
    // profile (organizations)
    timezone: z.string().default("America/New_York"),
    quietHoursStart: z.number().int().min(0).max(23).default(8),
    quietHoursEnd: z.number().int().min(1).max(24).default(21),
    // agent autonomy (organizations)
    agentMode: z.enum(["auto", "review"]).default("auto"),
    maxFollowUps: z.number().int().min(0).max(10).default(3),
    // offer (offer_configs)
    recurringDiscountPct: z.number().min(0).max(90).default(0),
    offeredCadences: z
      .array(z.string())
      .min(1)
      .default(["weekly", "biweekly", "monthly"]),
    defaultCadence: z.string().default("biweekly"),
    pitchStyle: z.enum(["gentle", "balanced", "direct"]).default("balanced"),
    // wallet auto-reload (wallets)
    autoReloadEnabled: z.boolean().default(false),
    autoReloadThresholdCents: z.number().int().min(100).default(500),
    autoReloadAmountCents: z.number().int().min(1000).default(2000),
  })
  .refine((s) => s.quietHoursStart < s.quietHoursEnd, {
    message: "Quiet-hours start must be before end.",
    path: ["quietHoursStart"],
  })
  .refine((s) => s.offeredCadences.includes(s.defaultCadence), {
    message: "Default cadence must be one of the offered cadences.",
    path: ["defaultCadence"],
  });
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

// ---- USER SETTINGS (per-user) ----------------------------------------------
export const userSettingsSchema = z.object({
  displayName: z.string().default(""),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

// ---- ROUTING: which table/column each org key lives in ----------------------
// Mapped to Renuvo's ACTUAL columns (wallets uses reload_threshold/amount_cents).
export const ORG_SETTING_ROUTES: Record<
  keyof OrgSettings,
  { table: string; column: string }
> = {
  timezone: { table: "organizations", column: "timezone" },
  quietHoursStart: { table: "organizations", column: "quiet_hours_start" },
  quietHoursEnd: { table: "organizations", column: "quiet_hours_end" },
  agentMode: { table: "organizations", column: "agent_mode" },
  maxFollowUps: { table: "organizations", column: "max_follow_ups" },
  recurringDiscountPct: {
    table: "offer_configs",
    column: "recurring_discount_pct",
  },
  offeredCadences: { table: "offer_configs", column: "offered_cadences" },
  defaultCadence: { table: "offer_configs", column: "default_cadence" },
  pitchStyle: { table: "offer_configs", column: "pitch_style" },
  autoReloadEnabled: { table: "wallets", column: "auto_reload_enabled" },
  autoReloadThresholdCents: {
    table: "wallets",
    column: "reload_threshold_cents",
  },
  autoReloadAmountCents: { table: "wallets", column: "reload_amount_cents" },
};
