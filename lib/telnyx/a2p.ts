import { telnyxFetch } from "./client";

// Dev/staging: free mock brands/campaigns that auto-approve. NEVER in prod.
// Mock short-circuits the Telnyx calls entirely so the whole flow is testable
// offline with no fees and no API key.
const MOCK = process.env.A2P_MOCK_MODE === "true";

function rand(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---- BRAND ----------------------------------------------------------------
export async function createBrand(input: {
  entityType: string;
  displayName: string;
  companyName: string;
  ein?: string;
  phone: string;
  email: string;
  website?: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  vertical: string;
}) {
  if (MOCK) return { data: { brandId: rand("mockbrand"), status: "PENDING" } };
  const body: Record<string, unknown> = {
    entityType: input.entityType,
    displayName: input.displayName,
    companyName: input.companyName,
    phone: input.phone,
    email: input.email, // business contact email (triggers verification)
    website: input.website,
    street: input.street,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    vertical: input.vertical,
    ...(input.ein ? { ein: input.ein } : {}),
  };
  return telnyxFetch("/10dlc/brand", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getBrand(brandId: string) {
  if (MOCK)
    return { data: { brandId, identityStatus: "VERIFIED", vettingScore: 80 } };
  return telnyxFetch(`/10dlc/brand/${brandId}`);
}

// ---- BRAND VETTING (ISV: score > 75 unlocks usable throughput) -------------
export async function requestBrandVetting(brandId: string) {
  if (MOCK) return { data: { brandId, vettingStatus: "PENDING" } };
  return telnyxFetch(`/10dlc/brand/${brandId}/vetting`, {
    method: "POST",
    body: JSON.stringify({ vettingClass: "ENHANCED" }),
  });
}

// ---- CAMPAIGN -------------------------------------------------------------
export async function createCampaign(input: {
  brandId: string;
  usecase: string; // AGENTS_FRANCHISES for ISV
  description: string;
  messageFlow: string;
  sample1: string;
  sample2: string;
  helpMessage: string;
  helpKeywords: string;
  optinKeywords?: string;
  optoutKeywords: string;
  embeddedLink: boolean;
  embeddedPhone: boolean;
}) {
  if (MOCK)
    return { data: { campaignId: rand("mockcampaign"), status: "PENDING" } };
  const body = {
    brandId: input.brandId,
    usecase: input.usecase,
    description: input.description,
    messageFlow: input.messageFlow,
    sample1: input.sample1,
    sample2: input.sample2,
    helpMessage: input.helpMessage,
    helpKeywords: input.helpKeywords,
    optinKeywords: input.optinKeywords ?? "START,YES,SUBSCRIBE",
    optoutKeywords: input.optoutKeywords,
    numberPool: false,
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
    embeddedLink: input.embeddedLink,
    embeddedPhone: input.embeddedPhone,
  };
  return telnyxFetch("/10dlc/campaign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getCampaign(campaignId: string) {
  if (MOCK) return { data: { campaignId, status: "APPROVED" } };
  return telnyxFetch(`/10dlc/campaign/${campaignId}`);
}

// ---- NUMBER ASSIGNMENT (one number → one campaign) ------------------------
export async function assignNumberToCampaign(
  phoneNumber: string,
  campaignId: string
) {
  if (MOCK) return { data: { ok: true, phoneNumber, campaignId } };
  return telnyxFetch(`/10dlc/phone_number_campaigns`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber, campaignId }),
  });
}
