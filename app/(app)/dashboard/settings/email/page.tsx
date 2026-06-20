import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmailSettings } from "./EmailSettings";

export default async function EmailSettingsPage() {
  if (process.env.EMAIL_CHANNEL_ENABLED !== "true")
    return (
      <p className="text-sm text-muted-foreground">
        The email channel isn&apos;t enabled for this environment yet.
      </p>
    );

  const active = await getActiveOrg();
  if (!active) return null;
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("email_from_name, email_local_part, email_reply_to, postal_address")
    .eq("id", active.org.id)
    .single();

  const o = org as {
    email_from_name?: string | null;
    email_local_part?: string | null;
    email_reply_to?: string | null;
    postal_address?: string | null;
  } | null;

  return (
    <EmailSettings
      domain={process.env.EMAIL_FROM_DOMAIN ?? "mail.renuvo.io"}
      isOwner={active.role === "owner"}
      initial={{
        fromName: o?.email_from_name ?? active.org.name,
        localPart: o?.email_local_part ?? "",
        replyTo: o?.email_reply_to ?? "",
        postalAddress: o?.postal_address ?? "",
      }}
    />
  );
}
