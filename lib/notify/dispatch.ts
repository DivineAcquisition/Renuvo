import { createAdminClient } from "@/lib/supabase/admin";
import { sendOwnerEmail } from "@/lib/email/send";

export type NotifEvent =
  | "new_conversion"
  | "at_risk"
  | "failed_payment"
  | "reply_needs_human"
  | "approval_pending"
  | "wallet_low";

/** Fan out an org event to its members per their preferences (in-app + email). */
export async function notify(
  orgId: string,
  event: NotifEvent,
  payload: { title: string; body?: string; link?: string }
) {
  try {
    const admin = createAdminClient();
    const { data: members } = await admin
      .from("memberships")
      .select("profile_id, profiles(email)")
      .eq("organization_id", orgId);
    if (!members) return;

    for (const m of members) {
      const { data: pref } = await admin
        .from("notification_preferences")
        .select("email, in_app")
        .eq("organization_id", orgId)
        .eq("profile_id", m.profile_id)
        .eq("event", event)
        .maybeSingle();
      const inApp = pref?.in_app ?? true; // default on
      const email = pref?.email ?? true;

      if (inApp) {
        await admin.from("notifications").insert({
          organization_id: orgId,
          profile_id: m.profile_id,
          event,
          title: payload.title,
          body: payload.body ?? null,
          link: payload.link ?? null,
        });
      }
      const profileEmail = (
        m.profiles as unknown as { email: string | null } | null
      )?.email;
      if (email && profileEmail) {
        await sendOwnerEmail(
          profileEmail,
          payload.title,
          payload.body ?? "",
          payload.link
        );
      }
    }
  } catch (e) {
    // notifications are best-effort — never break the triggering action
    console.error("[notify] failed:", e);
  }
}
