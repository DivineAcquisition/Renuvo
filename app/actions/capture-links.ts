"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { newToken } from "@/lib/capture/token";
import { buildCaptureUrl } from "@/lib/urls";
import { resolveOfferDefaults } from "@/lib/capture/offer-defaults";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { revalidatePath } from "next/cache";

const DEFAULT_EXPIRY_DAYS = 30;

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function createCaptureLink(input: {
  linkType: "customer" | "generic";
  customerId?: string;
  label?: string;
  priceCents?: number; // generic: owner-set offer price
  expiresInDays?: number | null;
}) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  if (input.linkType === "customer" && !input.customerId)
    return { error: "A customer is required for a customer link." };

  const admin = createAdminClient();
  const defaults = await resolveOfferDefaults(
    active.org.id,
    input.customerId ?? null
  );
  if (!defaults.cadenceId)
    return { error: "Set your vertical/cadence before creating links." };

  const token = newToken();
  const days =
    input.expiresInDays === null
      ? null
      : input.expiresInDays ??
        (input.linkType === "customer" ? DEFAULT_EXPIRY_DAYS : null);
  const expires_at = days
    ? new Date(Date.now() + days * 86400_000).toISOString()
    : null;

  const { data, error } = await admin
    .from("signup_links")
    .insert({
      organization_id: active.org.id,
      link_type: input.linkType,
      customer_id: input.customerId ?? null,
      cadence_profile_id: defaults.cadenceId,
      price_cents:
        input.linkType === "generic"
          ? input.priceCents ?? 0
          : defaults.priceCents,
      currency: "usd",
      label: input.label ?? null,
      token,
      expires_at,
      created_by: await currentUserId(),
    })
    .select("id, token")
    .single();
  if (error) return { error: "Could not create the link." };

  revalidatePath("/dashboard/links");
  return {
    ok: true,
    id: data.id as string,
    token: data.token,
    url: buildCaptureUrl(data.token),
  };
}

export async function revokeCaptureLink(id: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("signup_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .is("revoked_at", null);
  revalidatePath("/dashboard/links");
  return { ok: true };
}

export async function regenerateCaptureLink(id: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  const { data: old } = await admin
    .from("signup_links")
    .select("link_type, customer_id, label, price_cents")
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .single();
  if (!old) return { error: "Link not found." };
  await revokeCaptureLink(id);
  return createCaptureLink({
    linkType: old.link_type as "customer" | "generic",
    customerId: old.customer_id ?? undefined,
    label: old.label ?? undefined,
    priceCents: old.price_cents ?? undefined,
  });
}

/** Send a capture link via SMS — still through the guarded (consent) path. */
export async function sendCaptureLinkSms(linkId: string, customerId: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  const [{ data: link }, { data: customer }] = await Promise.all([
    admin
      .from("signup_links")
      .select("token")
      .eq("id", linkId)
      .eq("organization_id", active.org.id)
      .single(),
    admin
      .from("customers")
      .select("phone, sms_sendable")
      .eq("id", customerId)
      .eq("organization_id", active.org.id)
      .single(),
  ]);
  if (!link) return { error: "Link not found." };
  if (!customer?.sms_sendable || !customer.phone)
    return { error: "This customer hasn't consented to texts." };

  const url = buildCaptureUrl(link.token);
  const res = await sendGuardedSms({
    orgId: active.org.id,
    customerId,
    toPhone: customer.phone,
    body: `Set up your recurring service here: ${url}`,
    eventType: "message_sent",
    meta: { kind: "capture_link", link_id: linkId },
  });
  if (!res.ok) return { error: res.reason ?? "Could not send." };
  return { ok: true };
}

/**
 * Generic-link enrollment: a visitor on a reusable link provides their details.
 * We create/look-up the customer and mint a fresh CUSTOMER link (carrying the
 * generic link's price/cadence) so the normal enroll flow takes over. Public.
 */
export async function startGenericEnrollment(
  token: string,
  input: { name: string; phone: string }
) {
  const admin = createAdminClient();
  const { toE164 } = await import("@/lib/phone");
  const phone = toE164(input.phone);
  if (!phone) return { error: "Enter a valid phone number." };

  const { data: link } = await admin
    .from("signup_links")
    .select(
      "id, organization_id, link_type, cadence_profile_id, price_cents, currency, expires_at, revoked_at"
    )
    .eq("token", token)
    .maybeSingle();
  if (!link || link.link_type !== "generic" || link.revoked_at)
    return { error: "This link is no longer available." };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now())
    return { error: "This link has expired." };

  // upsert the customer by phone (no consent yet — that's captured at enroll)
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", link.organization_id)
    .eq("phone", phone)
    .maybeSingle();
  let customerId = existing?.id ?? null;
  if (!customerId) {
    const { data: created } = await admin
      .from("customers")
      .insert({
        organization_id: link.organization_id,
        full_name: input.name.trim() || null,
        phone,
        source: "generic_link",
      })
      .select("id")
      .single();
    customerId = created?.id ?? null;
  }
  if (!customerId) return { error: "Could not start enrollment." };

  // mint a short-lived customer link carrying the generic offer terms
  const childToken = newToken();
  await admin.from("signup_links").insert({
    organization_id: link.organization_id,
    link_type: "customer",
    customer_id: customerId,
    cadence_profile_id: link.cadence_profile_id,
    price_cents: link.price_cents ?? 0,
    currency: link.currency,
    token: childToken,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
  });

  // count the generic link's engagement
  await admin
    .from("signup_links")
    .update({ converted_at: new Date().toISOString() })
    .eq("id", link.id);

  return { ok: true, token: childToken };
}
