import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { CustomerForm } from "../CustomerForm";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveOrg();
  if (!active) return null;
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select(
      "id, full_name, phone, email, sms_consent, email_sendable, channel_preference"
    )
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .maybeSingle();
  if (!c) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <CustomerForm
        initial={{
          id: c.id,
          fullName: c.full_name ?? "",
          phone: c.phone,
          email: c.email ?? "",
          smsConsent: c.sms_consent,
          emailConsent: (c as { email_sendable?: boolean }).email_sendable ?? false,
          channelPreference:
            (c as { channel_preference?: "sms" | "email" | "any" })
              .channel_preference ?? "sms",
        }}
      />
    </div>
  );
}
