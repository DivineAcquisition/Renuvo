/**
 * The Telnyx account calls behind getting a cleaning company a texting number and registering it with
 * the carriers (A2P 10DLC): search, buy, file the company's own brand and campaign, and put the number
 * on the campaign. Every call is made only from an internal action, after Selestial staff approved the
 * request (convex/texting.ts). Each answer is either the data needed or words for a person.
 */
const API = "https://api.telnyx.com/v2";

type Fetcher = typeof fetch;
export type Answer<T> = { ok: true; value: T } | { ok: false; problem: string; retryable: boolean };

async function call<T>(fetcher: Fetcher, method: "GET" | "POST" | "PATCH", path: string, body: unknown, read: (json: unknown) => T | null, idempotencyKey?: string): Promise<Answer<T>> {
  const key = process.env.TELNYX_API_KEY?.trim();
  if (!key) return { ok: false, problem: "Telnyx's API key is not set on the deployment.", retryable: false };
  let response: Response;
  try {
    response = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
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
    return { ok: false, problem: `Telnyx refused (${typeof first?.code === "string" ? `code ${first.code}` : `status ${response.status}`})${words ? `: ${words.slice(0, 300)}` : "."}`, retryable };
  }
  const value = read(json);
  return value === null ? { ok: false, problem: "Telnyx answered in a shape Selestial did not expect.", retryable: false } : { ok: true, value };
}

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const cents = (value: unknown): number | null => {
  const amount = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
};

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────

export type AvailableNumber = { phoneNumber: string; locality: string | null; region: string | null; upfrontCents: number | null; monthlyCents: number | null };

/** Local US numbers that can text, in an area code. Nothing is held or bought by searching. */
export function searchNumbers(fetcher: Fetcher, input: { areaCode: string; limit: number }): Promise<Answer<AvailableNumber[]>> {
  const query = new URLSearchParams({ "filter[country_code]": "US", "filter[national_destination_code]": input.areaCode, "filter[features][]": "sms", "filter[phone_number_type]": "local", "filter[limit]": String(input.limit) });
  return call(fetcher, "GET", `/available_phone_numbers?${query}`, null, (json) => {
    const rows = (json as { data?: unknown[] } | null)?.data;
    if (!Array.isArray(rows)) return null;
    return rows.flatMap((row) => {
      const r = row as { phone_number?: unknown; region_information?: { region_type?: unknown; region_name?: unknown }[]; cost_information?: { upfront_cost?: unknown; monthly_cost?: unknown } };
      const phoneNumber = str(r.phone_number);
      if (!phoneNumber) return [];
      const region = (type: string) => str(r.region_information?.find((entry) => entry.region_type === type)?.region_name);
      return [{ phoneNumber, locality: region("location") ?? region("rate_center"), region: region("state"), upfrontCents: cents(r.cost_information?.upfront_cost), monthlyCents: cents(r.cost_information?.monthly_cost) }];
    });
  });
}

export type NumberOrder = { orderId: string; status: "pending" | "success" | "failure" };

/** Buys one number onto the platform's messaging profile. The same key makes a retry the same order. */
export function orderNumber(fetcher: Fetcher, input: { phoneNumber: string; messagingProfileId: string | null; idempotencyKey: string }): Promise<Answer<NumberOrder>> {
  return call(
    fetcher,
    "POST",
    "/number_orders",
    { phone_numbers: [{ phone_number: input.phoneNumber }], ...(input.messagingProfileId ? { messaging_profile_id: input.messagingProfileId } : {}), customer_reference: input.idempotencyKey },
    readOrder,
    input.idempotencyKey,
  );
}

export function getNumberOrder(fetcher: Fetcher, orderId: string): Promise<Answer<NumberOrder>> {
  return call(fetcher, "GET", `/number_orders/${encodeURIComponent(orderId)}`, null, readOrder);
}

function readOrder(json: unknown): NumberOrder | null {
  const data = (json as { data?: { id?: unknown; status?: unknown } } | null)?.data;
  const orderId = str(data?.id);
  const status = data?.status;
  if (!orderId || (status !== "pending" && status !== "success" && status !== "failure")) return null;
  return { orderId, status };
}

// ── Carrier registration ─────────────────────────────────────────────────────────────────────────

export type BrandInput = {
  displayName: string;
  companyName: string;
  ein: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  email: string;
  website: string;
  vertical: string;
};

export type BrandState = { brandId: string; identityStatus: string | null; failureReasons: string | null };

export function createBrand(fetcher: Fetcher, input: BrandInput & { webhookURL: string | null }): Promise<Answer<BrandState>> {
  const { webhookURL, ...brand } = input;
  return call(fetcher, "POST", "/10dlc/brand", { entityType: "PRIVATE_PROFIT", country: "US", ...brand, ...(webhookURL ? { webhookURL } : {}) }, readBrand);
}

export function getBrand(fetcher: Fetcher, brandId: string): Promise<Answer<BrandState>> {
  return call(fetcher, "GET", `/10dlc/brand/${encodeURIComponent(brandId)}`, null, readBrand);
}

function failures(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === "string" ? entry : str((entry as { description?: unknown })?.description) ?? JSON.stringify(entry))).join("; ").slice(0, 1000) || null;
  return null;
}

function readBrand(json: unknown): BrandState | null {
  const brand = json as { brandId?: unknown; identityStatus?: unknown; failureReasons?: unknown } | null;
  const brandId = str(brand?.brandId);
  return brandId ? { brandId, identityStatus: str(brand?.identityStatus), failureReasons: failures(brand?.failureReasons) } : null;
}

export type CampaignInput = {
  brandId: string;
  usecase: "ACCOUNT_NOTIFICATION";
  description: string;
  messageFlow: string;
  sample1: string;
  sample2: string;
  sample3: string;
  sample4: string;
  helpMessage: string;
  optinMessage: string;
  optoutMessage: string;
  helpKeywords: string;
  optinKeywords: string;
  optoutKeywords: string;
  subscriberOptin: true;
  subscriberOptout: true;
  subscriberHelp: true;
  embeddedLink: true;
  embeddedPhone: false;
  numberPool: false;
  ageGated: false;
  directLending: false;
  termsAndConditions: true;
  privacyPolicyLink: string;
  termsAndConditionsLink: string;
  webhookURL?: string;
};

export type CampaignState = { campaignId: string; campaignStatus: string | null; failureReasons: string | null };

export function createCampaign(fetcher: Fetcher, input: CampaignInput): Promise<Answer<CampaignState>> {
  return call(fetcher, "POST", "/10dlc/campaignBuilder", input, readCampaign);
}

export function getCampaign(fetcher: Fetcher, campaignId: string): Promise<Answer<CampaignState>> {
  return call(fetcher, "GET", `/10dlc/campaign/${encodeURIComponent(campaignId)}`, null, readCampaign);
}

function readCampaign(json: unknown): CampaignState | null {
  const campaign = json as { campaignId?: unknown; campaignStatus?: unknown; failureReasons?: unknown } | null;
  const campaignId = str(campaign?.campaignId);
  return campaignId ? { campaignId, campaignStatus: str(campaign?.campaignStatus), failureReasons: failures(campaign?.failureReasons) } : null;
}

export type Assignment = { assignmentStatus: string | null; failureReasons: string | null };

export function assignNumber(fetcher: Fetcher, input: { phoneNumber: string; campaignId: string }): Promise<Answer<Assignment>> {
  return call(fetcher, "POST", "/10dlc/phone_number_campaigns", { phoneNumber: input.phoneNumber, campaignId: input.campaignId }, readAssignment);
}

export function getAssignment(fetcher: Fetcher, phoneNumber: string): Promise<Answer<Assignment>> {
  return call(fetcher, "GET", `/10dlc/phone_number_campaigns/${encodeURIComponent(phoneNumber)}`, null, readAssignment);
}

function readAssignment(json: unknown): Assignment | null {
  const row = json as { assignmentStatus?: unknown; failureReasons?: unknown; phoneNumber?: unknown } | null;
  if (!row || (row.assignmentStatus === undefined && row.phoneNumber === undefined)) return null;
  return { assignmentStatus: str(row.assignmentStatus), failureReasons: failures(row.failureReasons) };
}

/** What carriers' statuses mean for the next step. */
export const BRAND_READY = new Set(["VERIFIED", "VETTED_VERIFIED"]);
export const BRAND_FAILED = new Set(["UNVERIFIED", "SELF_DECLARED"]);
export const CAMPAIGN_READY = new Set(["MNO_PROVISIONED"]);
export const CAMPAIGN_FAILED = new Set(["TCR_FAILED", "TELNYX_FAILED", "MNO_REJECTED", "TCR_SUSPENDED", "TCR_EXPIRED", "MNO_SUSPENDED", "TELNYX_SUSPENDED"]);
export const ASSIGNED = "ASSIGNED";
export const ASSIGNMENT_FAILED = new Set(["FAILED", "FAILED_ASSIGNMENT"]);
