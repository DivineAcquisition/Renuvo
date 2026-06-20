import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ControlsView } from "./ControlsView";

const NOTIF_EVENTS = [
  "new_conversion",
  "at_risk",
  "failed_payment",
  "reply_needs_human",
  "approval_pending",
  "wallet_low",
];

export default async function ControlsPage() {
  const active = await getActiveOrg();
  if (!active) return null;

  const admin = createAdminClient();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: org }, { data: offer }, { data: steps }, { data: prefs }] =
    await Promise.all([
      admin
        .from("organizations")
        .select("agent_mode, max_follow_ups")
        .eq("id", active.org.id)
        .single(),
      admin
        .from("offer_configs")
        .select("*")
        .eq("organization_id", active.org.id)
        .maybeSingle(),
      admin
        .from("sequence_steps")
        .select("template_key, delay_minutes, enabled, step_order")
        .eq("organization_id", active.org.id)
        .eq("sequence_key", "post_payment")
        .order("step_order"),
      user
        ? admin
            .from("notification_preferences")
            .select("event, email, in_app")
            .eq("organization_id", active.org.id)
            .eq("profile_id", user.id)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const o = org as { agent_mode?: string; max_follow_ups?: number } | null;
  const offerCfg = (offer as Record<string, unknown> | null) ?? null;

  const prefMap: Record<string, { email: boolean; in_app: boolean }> = {};
  for (const e of NOTIF_EVENTS) prefMap[e] = { email: true, in_app: true };
  for (const p of (prefs ?? []) as {
    event: string;
    email: boolean;
    in_app: boolean;
  }[]) {
    prefMap[p.event] = { email: p.email, in_app: p.in_app };
  }

  return (
    <ControlsView
      isOwner={active.role === "owner"}
      agentMode={(o?.agent_mode as "auto" | "review") ?? "auto"}
      maxFollowUps={o?.max_follow_ups ?? 3}
      offer={{
        discountPct: Number(offerCfg?.recurring_discount_pct ?? 0),
        offeredCadences:
          (offerCfg?.offered_cadences as string[] | undefined) ?? [
            "weekly",
            "biweekly",
            "monthly",
          ],
        defaultCadence: (offerCfg?.default_cadence as string) ?? "biweekly",
        pitchStyle:
          (offerCfg?.pitch_style as "gentle" | "balanced" | "direct") ??
          "balanced",
      }}
      steps={
        (steps as
          | {
              template_key: string;
              delay_minutes: number;
              enabled: boolean;
            }[]
          | null) ?? []
      }
      notifEvents={NOTIF_EVENTS}
      prefMap={prefMap}
    />
  );
}
