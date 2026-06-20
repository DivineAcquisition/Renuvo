import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamManager } from "./TeamManager";

export default async function TeamPage() {
  const active = await getActiveOrg();
  if (!active) return null;

  // owner-context read of co-members (profiles RLS is self-only, so use admin
  // scoped strictly to the active org)
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("memberships")
    .select("profile_id, role, created_at, profiles(email, full_name)")
    .eq("organization_id", active.org.id)
    .order("created_at", { ascending: true });

  const members = (rows ?? []).map((r) => {
    const profile = r.profiles as unknown as {
      email: string | null;
      full_name: string | null;
    } | null;
    return {
      profileId: r.profile_id,
      role: r.role as "owner" | "staff",
      email: profile?.email ?? "—",
      fullName: profile?.full_name ?? null,
    };
  });

  return <TeamManager members={members} isOwner={active.role === "owner"} />;
}
