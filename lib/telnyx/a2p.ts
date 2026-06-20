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
  if (MOCK) return { data: { brandId, identityStatus: "VERIFIED" } };
  return telnyxFetch(`/10dlc/brand/${brandId}`);
}

// ---- CAMPAIGN -------------------------------------------------------------
export async function createCampaign(input: {
  brandId: string;
  vertical: string;
  usecase: string;
  description: string;
  messageFlow: string;
  sample1: string;
  sample2: string;
  helpMessage: string;
  helpKeywords: string;
  optinKeywords?: string;
  optinMessage: string;
  optoutKeywords: string;
  optoutMessage: string;
  embeddedLink: boolean;
  embeddedPhone: boolean;
}) {
  if (MOCK)
    return { data: { campaignId: rand("mockcampaign"), status: "PENDING" } };
  const body = {
    brandId: input.brandId,
    vertical: input.vertical,
    usecase: input.usecase,
    description: input.description,
    messageFlow: input.messageFlow,
    sample1: input.sample1,
    sample2: input.sample2,
    helpMessage: input.helpMessage,
    helpKeywords: input.helpKeywords,
    optinKeywords: input.optinKeywords ?? "",
    optinMessage: input.optinMessage,
    optoutKeywords: input.optoutKeywords,
    optoutMessage: input.optoutMessage,
    embeddedLink: input.embeddedLink,
    embeddedPhone: input.embeddedPhone,
    subscriberOptin: true,
    subscriberOptout: true,
    subscriberHelp: true,
  };
  // endpoint name varies (campaignBuilder); confirm in current docs
  return telnyxFetch("/10dlc/campaignBuilder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getCampaign(campaignId: string) {
  if (MOCK) return { data: { campaignId, status: "APPROVED" } };
  return telnyxFetch(`/10dlc/campaign/${campaignId}`);
}

// ---- NUMBER ASSIGNMENT ----------------------------------------------------
/** Assign the tenant's number to the approved campaign so sends inherit it. */
export async function assignNumberToCampaign(
  phoneNumber: string,
  campaignId: string
) {
  if (MOCK) return { data: { ok: true, phoneNumber, campaignId } };
  // Confirm the exact endpoint in current docs (bulk phone number campaign).
  return telnyxFetch(`/10dlc/phoneNumberCampaign`, {
    method: "POST",
    body: JSON.stringify({ phoneNumber, campaignId }),
  });
}
