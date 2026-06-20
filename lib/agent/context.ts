import { createAdminClient } from "@/lib/supabase/admin";
import { getSignupLink } from "@/lib/capture/links";
import { resolveWinbackOffer, getCardUpdateUrl } from "@/lib/winback/links";

export type MergeVars = {
  first_name: string;
  business_name: string;
  cadence_label: string;
  price: string; // formatted currency
  booking_link: string;
};

// win-back event keys route to different links than the conversion flow
const WINBACK_OFFER_KEYS = new Set(["winback", "reactivation"]);
const CARD_UPDATE_KEYS = new Set(["payment_recovery"]);

function firstName(full?: string | null) {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n || "there";
}
function money(cents?: number | null, currency = "usd") {
  if (cents == null) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Assemble the merge vars for a given customer/job/plan. */
export async function buildMergeVars(args: {
  orgId: string;
  customerId: string;
  jobId?: string;
  planId?: string;
  eventKey?: string;
}): Promise<MergeVars> {
  const admin = createAdminClient();

  const [{ data: org }, { data: customer }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, vertical_id")
      .eq("id", args.orgId)
      .single(),
    admin
      .from("customers")
      .select("full_name")
      .eq("id", args.customerId)
      .single(),
  ]);

  // cadence label: plan's cadence if a plan exists, else the vertical default
  let cadenceLabel = "";
  if (args.planId) {
    const { data: plan } = await admin
      .from("recurring_plans")
      .select("cadence_profiles(label)")
      .eq("id", args.planId)
      .single();
    cadenceLabel =
      (plan?.cadence_profiles as { label?: string } | null)?.label ?? "";
  } else if (org?.vertical_id) {
    const { data: vertical } = await admin
      .from("verticals")
      .select("cadence_profiles!verticals_default_cadence_id_fkey(label)")
      .eq("id", org.vertical_id)
      .single();
    cadenceLabel =
      (vertical?.cadence_profiles as { label?: string } | null)?.label ??
      "on a regular schedule";
  }

  let price = "";
  if (args.jobId) {
    const { data: job } = await admin
      .from("jobs")
      .select("price_cents, currency")
      .eq("id", args.jobId)
      .single();
    price = money(job?.price_cents, job?.currency ?? "usd");
  }

  // Link selection:
  //  - payment_recovery (involuntary): a card-update link, NOT a sales capture page
  //  - winback / reactivation: a discounted win-back capture link
  //  - everything else: the standard conversion capture link
  let booking_link: string;
  if (args.eventKey && CARD_UPDATE_KEYS.has(args.eventKey) && args.planId) {
    booking_link = getCardUpdateUrl(args.planId);
  } else if (args.eventKey && WINBACK_OFFER_KEYS.has(args.eventKey)) {
    const offer = await resolveWinbackOffer({
      orgId: args.orgId,
      customerId: args.customerId,
      planId: args.planId,
    });
    booking_link = offer.url;
    if (!price && offer.priceCents) price = money(offer.priceCents);
  } else {
    booking_link = await getSignupLink({
      orgId: args.orgId,
      customerId: args.customerId,
      jobId: args.jobId,
    });
  }

  return {
    first_name: firstName(customer?.full_name),
    business_name: org?.name ?? "your cleaner",
    cadence_label: cadenceLabel || "on a regular schedule",
    price,
    booking_link,
  };
}
