import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage() {
  const active = await getActiveOrg();
  if (!active) return null;
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, timezone, quiet_hours_start, quiet_hours_end")
    .eq("id", active.org.id)
    .single();

  if (!org) return null;
  return <ProfileForm org={org} isOwner={active.role === "owner"} />;
}
