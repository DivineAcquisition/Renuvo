/**
 * The Telnyx account calls behind getting a cleaning company a texting number and registering it with the
 * carriers (A2P 10DLC): search, buy, file the company's own brand and campaign, verify a sole proprietor,
 * and put the number on the campaign. Every call is made only from an internal action, after Selestial
 * review approved the request (convex/texting.ts). Each answer is either the data needed or words for staff.
 *
 * Contracts checked against Telnyx's API reference on 2026-11-19 (docs/texting/00-audit.md §3): 10DLC
 * responses are not wrapped in `data`; lists come as `{ records, page, totalRecords }`. No idempotency header
 * is declared on these endpoints, so a call whose outcome is unknown is never simply repeated: the caller
 * looks for what it may have created first (by customer reference, campaign reference or brand name).
 */
const API = "https://api.telnyx.com/v2";

type Fetcher = typeof fetch;
export type Answer<T> = { ok: true; value: T } | { ok: false; problem: string; retryable: boolean; status?: number };

async function call<T>(fetcher: Fetcher, method: "GET" | "POST" | "PUT", path: string, body: unknown, read: (json: unknown) => T | null): Promise<Answer<T>> {
  const key = process.env.TELNYX_API_KEY?.trim();
  if (!key) return { ok: false, problem: "Telnyx's API key is not set on the deployment.", retryable: false };
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, problem: "Telnyx could not be reached.", retryable: true };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    const errors = (json as { errors?: { code?: unknown; title?: unknown; detail?: unknown }[] } | null)?.errors ?? [];
    const first = errors[0];
    const words = [first?.title, first?.detail].filter((part): part is string => typeof part === "string" && part.length > 0).join(": ");
    const retryable = response.status === 429 || response.status >= 500;
    return { ok: false, problem: `Telnyx refused (${typeof first?.code === "string" ? `code ${first.code}` : `status ${response.status}`})${words ? `: ${words.slice(0, 300)}` : "."}`, retryable, status: response.status };
  }
  const value = read(json);
  return value === null ? { ok: false, problem: "Telnyx answered in a shape Selestial did not expect.", retryable: false } : { ok: true, value };
}

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const cents = (value: unknown): number | null => {
  const amount = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};
/** A 10DLC object, whether Telnyx sent it bare (as documented) or wrapped in `data`. */
const unwrap = (json: unknown): Record<string, unknown> | null => {
  const row = json as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return null;
  return row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : row;
};
const records = (json: unknown): Record<string, unknown>[] => {
  const row = json as { records?: unknown; data?: unknown } | null;
  const list = Array.isArray(row?.records) ? row.records : Array.isArray(row?.data) ? row.data : [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
};

/** Failure reasons as words, and the brand fields they name (for example "ein"). */
export function reasons(value: unknown): { words: string | null; fields: string[] } {
  if (typeof value === "string") return { words: value || null, fields: [] };
  if (!Array.isArray(value)) return { words: null, fields: [] };
  const fields: string[] = [];
  const words = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const e = entry as { description?: unknown; fields?: unknown };
      if (Array.isArray(e.fields)) for (const field of e.fields) if (typeof field === "string") fields.push(field);
      return str(e.description) ?? JSON.stringify(entry);
    })
    .join("; ")
    .slice(0, 1000);
  return { words: words || null, fields };
}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────

export type AvailableNumber = { phoneNumber: string; locality: string | null; region: string | null; upfrontCents: number | null; monthlyCents: number | null; features: string[] };

/**
 * Local US numbers that can text, in an area code or, when `state` is given instead, anywhere in that state.
 * Nothing is held or bought by searching.
 */
export function searchNumbers(fetcher: Fetcher, input: { areaCode?: string; state?: string; endsWith?: string; limit: number }): Promise<Answer<AvailableNumber[]>> {
  const query = new URLSearchParams({ "filter[country_code]": "US", "filter[features][]": "sms", "filter[phone_number_type]": "local", "filter[limit]": String(input.limit) });
  if (input.areaCode) query.set("filter[national_destination_code]", input.areaCode);
  if (input.state) query.set("filter[administrative_area]", input.state);
  if (input.endsWith) query.set("filter[phone_number][ends_with]", input.endsWith);
  return call(fetcher, "GET", `/available_phone_numbers?${query}`, null, (json) => {
    const rows = (json as { data?: unknown[] } | null)?.data;
    if (!Array.isArray(rows)) return null;
    return rows.flatMap((row) => {
      const r = row as { phone_number?: unknown; region_information?: { region_type?: unknown; region_name?: unknown }[]; cost_information?: { upfront_cost?: unknown; monthly_cost?: unknown }; features?: { name?: unknown }[] };
      const phoneNumber = str(r.phone_number);
      if (!phoneNumber) return [];
      const region = (type: string) => str(r.region_information?.find((entry) => entry.region_type === type)?.region_name);
      const features = (Array.isArray(r.features) ? r.features : []).map((feature) => str(feature?.name)).filter((name): name is string => !!name);
      return [{ phoneNumber, locality: region("location") ?? region("rate_center"), region: region("state"), upfrontCents: cents(r.cost_information?.upfront_cost), monthlyCents: cents(r.cost_information?.monthly_cost), features }];
    });
  });
}

/** Whether this exact number can still be bought right now. A search never holds it. */
export async function stillAvailable(fetcher: Fetcher, phoneNumber: string): Promise<Answer<boolean>> {
  const digits = phoneNumber.replace(/\D/g, "");
  const found = await searchNumbers(fetcher, { areaCode: digits.slice(-10, -7), endsWith: digits.slice(-4), limit: 100 });
  return found.ok ? { ok: true, value: found.value.some((row) => row.phoneNumber === phoneNumber) } : found;
}

export type NumberOrder = { orderId: string; status: "pending" | "success" | "failure" | "cancelled" | "deleted" };

/** Buys one number onto the messaging profile, tagged with a reference the order can be found by afterwards. */
export function orderNumber(fetcher: Fetcher, input: { phoneNumber: string; messagingProfileId: string | null; reference: string }): Promise<Answer<NumberOrder>> {
  return call(fetcher, "POST", "/number_orders", { phone_numbers: [{ phone_number: input.phoneNumber }], ...(input.messagingProfileId ? { messaging_profile_id: input.messagingProfileId } : {}), customer_reference: input.reference }, (json) => readOrder((json as { data?: unknown })?.data));
}

export function getNumberOrder(fetcher: Fetcher, orderId: string): Promise<Answer<NumberOrder>> {
  return call(fetcher, "GET", `/number_orders/${encodeURIComponent(orderId)}`, null, (json) => readOrder((json as { data?: unknown })?.data));
}

/** The orders made with this reference. Used when an order call's outcome is unknown. */
export function findOrders(fetcher: Fetcher, reference: string): Promise<Answer<NumberOrder[]>> {
  const query = new URLSearchParams({ "filter[customer_reference]": reference });
  return call(fetcher, "GET", `/number_orders?${query}`, null, (json) => {
    const rows = (json as { data?: unknown[] } | null)?.data;
    if (!Array.isArray(rows)) return null;
    return rows.map(readOrder).filter((row): row is NumberOrder => row !== null);
  });
}

const ORDER_STATUSES = ["pending", "success", "failure", "cancelled", "deleted"] as const;
function readOrder(data: unknown): NumberOrder | null {
  const row = data as { id?: unknown; status?: unknown } | null;
  const orderId = str(row?.id);
  const status = row?.status;
  if (!orderId || !ORDER_STATUSES.includes(status as NumberOrder["status"])) return null;
  return { orderId, status: status as NumberOrder["status"] };
}

// ── Brand ────────────────────────────────────────────────────────────────────────────────────────

export type BrandInput = {
  entityType: string;
  displayName: string;
  companyName?: string;
  ein?: string;
  firstName?: string;
  lastName?: string;
  mobilePhone?: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  email: string;
  website?: string;
  vertical: string;
  stockSymbol?: string;
  stockExchange?: string;
  businessContactEmail?: string;
  webhookURL?: string;
};

export type BrandState = { brandId: string; identityStatus: string | null; status: string | null; failure: string | null; fields: string[]; displayName: string | null; email: string | null };

function brandBody(input: BrandInput) {
  const sole = input.entityType === "SOLE_PROPRIETOR";
  const body: Record<string, unknown> = { entityType: input.entityType, displayName: input.displayName, country: "US", email: input.email, vertical: input.vertical, phone: input.phone, street: input.street, city: input.city, state: input.state, postalCode: input.postalCode };
  if (input.website) body.website = input.website;
  if (sole) Object.assign(body, { firstName: input.firstName, lastName: input.lastName, mobilePhone: input.mobilePhone });
  else Object.assign(body, { companyName: input.companyName, ...(input.ein ? { ein: `${input.ein.slice(0, 2)}-${input.ein.slice(2)}` } : {}) });
  if (input.entityType === "PUBLIC_PROFIT") Object.assign(body, { stockSymbol: input.stockSymbol, stockExchange: input.stockExchange, businessContactEmail: input.businessContactEmail });
  if (input.webhookURL) body.webhookURL = input.webhookURL;
  return body;
}

export function createBrand(fetcher: Fetcher, input: BrandInput): Promise<Answer<BrandState>> {
  return call(fetcher, "POST", "/10dlc/brand", brandBody(input), readBrand);
}

/** Corrects a brand's details. A corrected brand is then revetted. */
export function updateBrand(fetcher: Fetcher, brandId: string, input: BrandInput): Promise<Answer<BrandState>> {
  return call(fetcher, "PUT", `/10dlc/brand/${encodeURIComponent(brandId)}`, brandBody(input), readBrand);
}

export function revetBrand(fetcher: Fetcher, brandId: string): Promise<Answer<BrandState>> {
  return call(fetcher, "PUT", `/10dlc/brand/${encodeURIComponent(brandId)}/revet`, null, readBrand);
}

export function getBrand(fetcher: Fetcher, brandId: string): Promise<Answer<BrandState>> {
  return call(fetcher, "GET", `/10dlc/brand/${encodeURIComponent(brandId)}`, null, readBrand);
}

/** Brands with this display name, to find one a lost answer may have created. */
export function findBrands(fetcher: Fetcher, displayName: string): Promise<Answer<BrandState[]>> {
  const query = new URLSearchParams({ displayName, recordsPerPage: "50" });
  return call(fetcher, "GET", `/10dlc/brand?${query}`, null, (json) => records(json).map((row) => readBrand(row)).filter((row): row is BrandState => row !== null));
}

function readBrand(json: unknown): BrandState | null {
  const brand = unwrap(json);
  const brandId = str(brand?.brandId);
  if (!brandId) return null;
  const why = reasons(brand?.failureReasons);
  return { brandId, identityStatus: str(brand?.identityStatus), status: str(brand?.status), failure: why.words, fields: why.fields, displayName: str(brand?.displayName), email: str(brand?.email) };
}

/** Sends a sole proprietor the carriers' one-time code. `pinSms` must contain @OTP_PIN@. */
export function sendBrandCode(fetcher: Fetcher, brandId: string, input: { pinSms: string; successSms: string }): Promise<Answer<{ referenceId: string | null }>> {
  return call(fetcher, "POST", `/10dlc/brand/${encodeURIComponent(brandId)}/smsOtp`, input, (json) => ({ referenceId: str(unwrap(json)?.referenceId) }));
}

export function verifyBrandCode(fetcher: Fetcher, brandId: string, otpPin: string): Promise<Answer<true>> {
  return call(fetcher, "PUT", `/10dlc/brand/${encodeURIComponent(brandId)}/smsOtp`, { otpPin }, () => true);
}

// ── Campaign ─────────────────────────────────────────────────────────────────────────────────────

export type CampaignInput = {
  brandId: string;
  usecase: string;
  subUsecases?: string[];
  description: string;
  messageFlow: string;
  sample1: string;
  sample2?: string;
  sample3?: string;
  sample4?: string;
  sample5?: string;
  helpMessage: string;
  optinMessage: string;
  optoutMessage: string;
  helpKeywords: string;
  optinKeywords: string;
  optoutKeywords: string;
  subscriberOptin: boolean;
  subscriberOptout: boolean;
  subscriberHelp: boolean;
  embeddedLink: boolean;
  embeddedLinkSample?: string;
  embeddedPhone: boolean;
  numberPool: boolean;
  ageGated: boolean;
  directLending: boolean;
  termsAndConditions: boolean;
  privacyPolicyLink: string;
  termsAndConditionsLink: string;
  referenceId: string;
  webhookURL?: string;
};

export type CampaignState = { campaignId: string; campaignStatus: string | null; status: string | null; failure: string | null; referenceId: string | null };

export function createCampaign(fetcher: Fetcher, input: CampaignInput): Promise<Answer<CampaignState>> {
  return call(fetcher, "POST", "/10dlc/campaignBuilder", input, readCampaign);
}

/** Corrects what Telnyx allows changing on a filed campaign: samples, message flow and HELP reply. */
export function updateCampaign(fetcher: Fetcher, campaignId: string, input: Pick<CampaignInput, "sample1" | "sample2" | "sample3" | "sample4" | "sample5" | "messageFlow" | "helpMessage" | "webhookURL">): Promise<Answer<CampaignState>> {
  return call(fetcher, "PUT", `/10dlc/campaign/${encodeURIComponent(campaignId)}`, input, readCampaign);
}

/** Asks for a campaign the carriers turned down to be reviewed again, after it was corrected. */
export function appealCampaign(fetcher: Fetcher, campaignId: string, reason: string): Promise<Answer<true>> {
  return call(fetcher, "POST", `/10dlc/campaign/${encodeURIComponent(campaignId)}/appeal`, { appeal_reason: reason.slice(0, 1000) }, () => true);
}

export function getCampaign(fetcher: Fetcher, campaignId: string): Promise<Answer<CampaignState>> {
  return call(fetcher, "GET", `/10dlc/campaign/${encodeURIComponent(campaignId)}`, null, readCampaign);
}

/** The brand's campaigns, to find one a lost answer may have created (matched by reference). */
export function findCampaigns(fetcher: Fetcher, brandId: string): Promise<Answer<CampaignState[]>> {
  const query = new URLSearchParams({ brandId, recordsPerPage: "50" });
  return call(fetcher, "GET", `/10dlc/campaign?${query}`, null, (json) => records(json).map((row) => readCampaign(row)).filter((row): row is CampaignState => row !== null));
}

function readCampaign(json: unknown): CampaignState | null {
  const campaign = unwrap(json);
  const campaignId = str(campaign?.campaignId);
  return campaignId ? { campaignId, campaignStatus: str(campaign?.campaignStatus), status: str(campaign?.status), failure: reasons(campaign?.failureReasons).words, referenceId: str(campaign?.referenceId) } : null;
}

// ── Assignment ───────────────────────────────────────────────────────────────────────────────────

export type Assignment = { assignmentStatus: string | null; failure: string | null };

export function assignNumber(fetcher: Fetcher, input: { phoneNumber: string; campaignId: string }): Promise<Answer<Assignment>> {
  return call(fetcher, "POST", "/10dlc/phone_number_campaigns", { phoneNumber: input.phoneNumber, campaignId: input.campaignId }, readAssignment);
}

export function getAssignment(fetcher: Fetcher, phoneNumber: string): Promise<Answer<Assignment>> {
  return call(fetcher, "GET", `/10dlc/phone_number_campaigns/${encodeURIComponent(phoneNumber)}`, null, readAssignment);
}

function readAssignment(json: unknown): Assignment | null {
  const row = unwrap(json);
  if (!row || (row.assignmentStatus === undefined && row.phoneNumber === undefined)) return null;
  return { assignmentStatus: str(row.assignmentStatus), failure: reasons(row.failureReasons).words };
}

// ── What statuses mean ───────────────────────────────────────────────────────────────────────────

export const BRAND_READY = new Set(["VERIFIED", "VETTED_VERIFIED"]);
/** Verification failed: the details need correcting. SELF_DECLARED is not here: a sole proprietor is SELF_DECLARED until its one-time code is confirmed. */
export const brandFailed = (brand: Pick<BrandState, "identityStatus" | "status">) => brand.identityStatus === "UNVERIFIED" || brand.status === "REGISTRATION_FAILED";
export const CAMPAIGN_READY = new Set(["MNO_PROVISIONED"]);
/** Turned down: the owner can correct it and it is filed again. */
export const CAMPAIGN_REJECTED = new Set(["TCR_FAILED", "TELNYX_FAILED", "MNO_REJECTED", "MNO_PROVISIONING_FAILED"]);
/** Telnyx accepts an appeal only from these. */
export const CAMPAIGN_APPEALABLE = new Set(["TELNYX_FAILED", "MNO_REJECTED"]);
/** Approved once, then stopped by the carriers. */
export const CAMPAIGN_INTERRUPTED = new Set(["TCR_SUSPENDED", "TCR_EXPIRED", "MNO_SUSPENDED", "TELNYX_SUSPENDED"]);
export const ASSIGNED = "ASSIGNED";
export const ASSIGNMENT_FAILED = new Set(["FAILED", "FAILED_ASSIGNMENT"]);
