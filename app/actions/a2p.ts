"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createBrand,
  createCampaign,
  requestBrandVetting,
  getBrand,
  getCampaign,
  assignNumberToCampaign,
} from "@/lib/telnyx/a2p";
import { buildCampaignDefaults } from "@/lib/telnyx/campaign-defaults";
import { ensureRegistrationFunded } from "@/lib/billing/a2p-fees";
import { resolveTemplate } from "@/lib/templates/queries";
import { renderTemplate } from "@/lib/templates/render";
import { revalidatePath } from "next/cache";

const A2P_PATH = "/dashboard/settings/messaging/a2p";

type Reg = Record<string, unknown> & {
  telnyx_brand_id?: string | null;
  telnyx_campaign_id?: string | null;
  brand_status?: string | null;
  campaign_status?: string | null;
  step?: string | null;
};

export async function submitBrand(input: {
  entityType: string;
  legalName: string;
  displayName: string;
  ein?: string;
  phone: string;
  email: string;
  website?: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  vertical: string;
}) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();

  // FEE GATE: registration triggers real charges on Renuvo's Telnyx account.
  // Require funding (an active plan) before calling the API. Free in mock mode.
  const funded = await ensureRegistrationFunded(active.org.id);
  if (!funded.ok) return { error: funded.reason };

  try {
    const res = await createBrand({
      entityType: input.entityType,
      displayName: input.displayName,
      companyName: input.legalName,
      ein: input.ein,
      phone: input.phone,
      email: input.email,
      website: input.website,
      street: input.street,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: "US",
      vertical: input.vertical,
    });
    const brandId = res?.data?.brandId ?? res?.brandId;

    // ISV: request ENHANCED vetting immediately (throughput depends on score >75)
    let vettingRequested = false;
    try {
      await requestBrandVetting(brandId);
      vettingRequested = true;
    } catch {
      /* non-fatal — can retry vetting later */
    }

    await admin.from("a2p_registrations").upsert(
      {
        organization_id: active.org.id,
        entity_type: input.entityType,
        legal_name: input.legalName,
        display_name: input.displayName,
        ein: input.ein ?? null,
        business_phone: input.phone,
        business_email: input.email,
        website: input.website ?? null,
        street: input.street,
        city: input.city,
        state: input.state,
        postal_code: input.postalCode,
        vertical: input.vertical,
        telnyx_brand_id: brandId,
        brand_status: "PENDING",
        step: "brand_submitted",
        vetting_requested: vettingRequested,
        fees_paid_cents: funded.feeCents,
        fees_charged_at: new Date().toISOString(),
        is_mock: process.env.A2P_MOCK_MODE === "true",
      },
      { onConflict: "organization_id" }
    );

    await admin
      .from("organizations")
      .update({ a2p_brand_id: brandId, a2p_status: "pending" })
      .eq("id", active.org.id);
    revalidatePath(A2P_PATH);
    return { ok: true, brandId };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Brand submission failed.",
    };
  }
}

export async function submitCampaign() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();

  const { data: regRow } = await admin
    .from("a2p_registrations")
    .select("*")
    .eq("organization_id", active.org.id)
    .single();
  const reg = regRow as Reg | null;
  if (!reg?.telnyx_brand_id) return { error: "Register your brand first." };
  if (reg.brand_status !== "VERIFIED")
    return { error: "Brand not verified yet." };

  const { data: org } = await admin
    .from("organizations")
    .select("name, vertical_id")
    .eq("id", active.org.id)
    .single();
  const orgName = org?.name ?? "your business";
  const verticalId = org?.vertical_id ?? "";

  const sampleVars = {
    first_name: "Sarah",
    business_name: orgName,
    cadence_label: "every 2 weeks",
    price: "$180",
    booking_link: "r.renuvo.io/x",
  };
  const act = renderTemplate(
    (await resolveTemplate(active.org.id, verticalId, "post_payment_activation")) ??
      "",
    sampleVars
  );
  const off = renderTemplate(
    (await resolveTemplate(active.org.id, verticalId, "conversion_offer")) ?? "",
    sampleVars
  );

  const defaults = buildCampaignDefaults({
    businessName: orgName,
    sampleActivation: act,
    sampleOffer: off,
  });

  try {
    const res = await createCampaign({ brandId: reg.telnyx_brand_id, ...defaults });
    const campaignId = res?.data?.campaignId ?? res?.campaignId;
    await admin
      .from("a2p_registrations")
      .update({
        telnyx_campaign_id: campaignId,
        campaign_status: "PENDING",
        step: "campaign_submitted",
      })
      .eq("organization_id", active.org.id);
    await admin
      .from("organizations")
      .update({ a2p_campaign_id: campaignId })
      .eq("id", active.org.id);
    revalidatePath(A2P_PATH);
    return { ok: true, campaignId };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Campaign submission failed.",
    };
  }
}

/** Sync brand + campaign status from Telnyx; assign number + unlock when approved. */
export async function syncA2pStatus() {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  const { data: regRow } = await admin
    .from("a2p_registrations")
    .select("*")
    .eq("organization_id", active.org.id)
    .single();
  const reg = regRow as Reg | null;
  if (!reg) return { error: "No registration." };

  let step = reg.step ?? "not_started";
  let brandStatus = reg.brand_status ?? null;
  let campaignStatus = reg.campaign_status ?? null;
  let vettingScore = (reg.vetting_score as number | null | undefined) ?? null;

  if (reg.telnyx_brand_id && brandStatus !== "VERIFIED") {
    const b = await getBrand(reg.telnyx_brand_id);
    brandStatus = b?.data?.identityStatus ?? b?.data?.status ?? brandStatus;
    vettingScore = b?.data?.vettingScore ?? vettingScore;
    if (brandStatus === "VERIFIED") step = "brand_verified";
    if (brandStatus === "FAILED") step = "brand_failed";
  }
  if (reg.telnyx_campaign_id && campaignStatus !== "APPROVED") {
    const c = await getCampaign(reg.telnyx_campaign_id);
    campaignStatus = c?.data?.status ?? campaignStatus;
    if (campaignStatus === "APPROVED") step = "campaign_approved";
    if (campaignStatus === "FAILED") step = "campaign_failed";
  }

  if (step === "campaign_approved") {
    const { data: org } = await admin
      .from("organizations")
      .select("telnyx_phone_number")
      .eq("id", active.org.id)
      .single();
    if (org?.telnyx_phone_number && reg.telnyx_campaign_id) {
      try {
        await assignNumberToCampaign(
          org.telnyx_phone_number,
          reg.telnyx_campaign_id
        );
        step = "number_assigned";
        await admin
          .from("organizations")
          .update({ a2p_status: "approved" })
          .eq("id", active.org.id);
      } catch {
        /* leave for retry */
      }
    }
  }

  await admin
    .from("a2p_registrations")
    .update({
      brand_status: brandStatus,
      campaign_status: campaignStatus,
      vetting_score: vettingScore,
      step,
      last_synced_at: new Date().toISOString(),
    })
    .eq("organization_id", active.org.id);

  revalidatePath(A2P_PATH);
  return { ok: true, step };
}
