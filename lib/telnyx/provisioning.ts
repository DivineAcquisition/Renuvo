import { telnyxFetch } from "./client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stand up THIS tenant's messaging infrastructure with full isolation:
 *   1) a dedicated messaging profile (per-tenant A2P attribution)
 *   2) a US long-code number provisioned ONTO that profile
 *   3) both persisted on the org
 * Idempotent: reuses an existing profile/number. NEVER shares a profile.
 */
export async function provisionTenantMessaging(orgId: string, orgName: string) {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("telnyx_messaging_profile_id, telnyx_phone_number")
    .eq("id", orgId)
    .single();

  // 1) messaging profile (one per tenant)
  let profileId = org?.telnyx_messaging_profile_id ?? null;
  if (!profileId) {
    const profile = await telnyxFetch("/messaging_profiles", {
      method: "POST",
      body: JSON.stringify({
        name: `Renuvo — ${orgName} (${orgId.slice(0, 8)})`,
        enabled: true,
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx`,
        webhook_failover_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/telnyx`,
        whitelisted_destinations: ["US"],
      }),
    });
    profileId = profile?.data?.id;
    if (!profileId) throw new Error("messaging_profile_create_failed");
    await admin
      .from("organizations")
      .update({ telnyx_messaging_profile_id: profileId })
      .eq("id", orgId);
  }

  // 2) a number on THIS profile
  let number = org?.telnyx_phone_number ?? null;
  if (!number) {
    const search = await telnyxFetch(
      `/available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=1`
    );
    const candidate = search?.data?.[0]?.phone_number;
    if (!candidate) throw new Error("no_number_available");
    await telnyxFetch("/number_orders", {
      method: "POST",
      body: JSON.stringify({
        phone_numbers: [{ phone_number: candidate }],
        messaging_profile_id: profileId,
      }),
    });
    number = candidate;
    await admin
      .from("organizations")
      .update({ telnyx_phone_number: number, a2p_status: "pending" })
      .eq("id", orgId);
  } else {
    await assignNumberToProfile(number, profileId);
  }

  return { profileId, number };
}

/** Bind a number to the tenant's messaging profile (best-effort). */
export async function assignNumberToProfile(
  phoneNumber: string,
  profileId: string
) {
  const lookup = await telnyxFetch(
    `/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`
  );
  const id = lookup?.data?.[0]?.id;
  if (!id) throw new Error("number_not_found");
  await telnyxFetch(`/phone_numbers/${id}/messaging`, {
    method: "PATCH",
    body: JSON.stringify({ messaging_profile_id: profileId }),
  });
}

/** Delete the tenant's messaging profile (deletion teardown — no orphans). */
export async function deleteTenantMessagingProfile(profileId: string) {
  try {
    await telnyxFetch(`/messaging_profiles/${profileId}`, { method: "DELETE" });
  } catch {
    /* best-effort */
  }
}
