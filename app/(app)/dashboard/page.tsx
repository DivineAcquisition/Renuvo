import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { getHomeSummary } from "@/lib/home/queries";
import { getAttentionItems, getRecentActivity } from "@/lib/home/feed";
import { HomeView } from "./HomeView";

export default async function HomePage() {
  const active = await getActiveOrg();
  if (!active) return null;

  // greet by first name (profiles.full_name) — best-effort
  let userName = "there";
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const full = profile?.full_name?.trim();
      if (full) userName = full.split(/\s+/)[0];
    }
  } catch {
    /* greeting falls back to "there" */
  }

  const summary = await getHomeSummary(active.org.id);
  const [attention, activity] = await Promise.all([
    getAttentionItems(active.org.id),
    getRecentActivity(active.org.id),
  ]);

  return (
    <HomeView
      orgName={active.org.name}
      userName={userName}
      summary={summary}
      attention={attention}
      activity={activity}
      isOwner={active.role === "owner"}
    />
  );
}
