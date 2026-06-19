import { telnyxFetch } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Order a local number and attach it to the tenant. A2P brand/campaign
 * registration is a SEPARATE onboarding step (Telnyx portal/API) — after which
 * set organizations.a2p_status='approved'. Call during onboarding (Prompt 25).
 */
export async function provisionNumber(orgId: string, areaCode?: string) {
  const admin = createAdminClient();

  const search = await telnyxFetch(
    `/available_phone_numbers?filter[country_code]=US&filter[features][]=sms` +
      (areaCode ? `&filter[national_destination_code]=${areaCode}` : "") +
      `&filter[limit]=1`
  );
  const number = search?.data?.[0]?.phone_number;
  if (!number) throw new Error("No numbers available");

  await telnyxFetch("/number_orders", {
    method: "POST",
    body: JSON.stringify({
      phone_numbers: [{ phone_number: number }],
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  });

  await admin
    .from("organizations")
    .update({
      telnyx_phone_number: number,
      telnyx_messaging_profile_id:
        process.env.TELNYX_MESSAGING_PROFILE_ID ?? null,
      a2p_status: "pending",
    })
    .eq("id", orgId);

  return number;
}
