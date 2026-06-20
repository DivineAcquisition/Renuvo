import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { DataSettings } from "./DataSettings";

export default async function DataSettingsPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("deletion_scheduled_for")
    .eq("id", active.org.id)
    .maybeSingle();

  return (
    <DataSettings
      orgName={active.org.name}
      isOwner={active.role === "owner"}
      deletionScheduledFor={
        (org as { deletion_scheduled_for?: string | null })
          ?.deletion_scheduled_for ?? null
      }
    />
  );
}
