import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { A2pWizard, type A2pReg } from "./A2pWizard";

export default async function A2pPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  const admin = createAdminClient();
  const [{ data: reg }, { data: org }] = await Promise.all([
    admin
      .from("a2p_registrations")
      .select("*")
      .eq("organization_id", active.org.id)
      .maybeSingle(),
    admin
      .from("organizations")
      .select("name, a2p_status, telnyx_phone_number")
      .eq("id", active.org.id)
      .single(),
  ]);

  return (
    <A2pWizard
      reg={(reg ?? null) as A2pReg | null}
      isOwner={active.role === "owner"}
      businessName={org?.name ?? ""}
      a2pStatus={org?.a2p_status ?? "not_started"}
      hasNumber={!!org?.telnyx_phone_number}
    />
  );
}
