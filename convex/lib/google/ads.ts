/**
 * Google Ads API: accounts the authorized user can reach, results by campaign, Local Services leads, and
 * paused campaign creation from an approved draft. Nothing here enables a campaign or changes a budget by
 * itself; those calls are made only by steps that check a recorded approval first.
 *
 * The API version is a deployment setting (GOOGLE_ADS_API_VERSION). NOT VERIFIED against the live API in
 * this build: no developer token was available.
 */
import { GoogleError, googleCall, type Fetch } from "./http";

export const adsVersion = () => process.env.GOOGLE_ADS_API_VERSION?.trim() || "v21";
const base = () => `https://googleads.googleapis.com/${adsVersion()}`;

function headers(developerToken: string, loginCustomerId?: string): Record<string, string> {
  return { "developer-token": developerToken, ...(loginCustomerId ? { "login-customer-id": loginCustomerId.replace(/-/g, "") } : {}) };
}

export const customerId = (value: string) => {
  const id = value.replace(/^customers\//, "").replace(/-/g, "");
  if (!/^\d{10}$/.test(id)) throw new GoogleError("invalid", "That is not a Google Ads account id.");
  return id;
};

export async function accessibleCustomers(token: string, developerToken: string, fetcher?: Fetch): Promise<string[]> {
  const body = await googleCall<{ resourceNames?: string[] }>(`${base()}/customers:listAccessibleCustomers`, token, { headers: headers(developerToken), fetcher });
  return (body.resourceNames ?? []).map((name) => name.replace("customers/", ""));
}

export async function search<T = Record<string, unknown>>(token: string, developerToken: string, account: string, query: string, loginCustomerId?: string, fetcher?: Fetch): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const body = await googleCall<{ results?: T[]; nextPageToken?: string }>(`${base()}/customers/${customerId(account)}/googleAds:search`, token, { method: "POST", body: { query, ...(pageToken ? { pageToken } : {}) }, headers: headers(developerToken, loginCustomerId), fetcher });
    out.push(...(body.results ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return out;
}

export type CampaignResult = { campaign: string; status: string; impressions: number; clicks: number; costMicros: number; conversions: number };

export async function performance(token: string, developerToken: string, account: string, loginCustomerId?: string, fetcher?: Fetch): Promise<CampaignResult[]> {
  const rows = await search<{ campaign?: { name?: string; status?: string }; metrics?: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number } }>(
    token,
    developerToken,
    account,
    "SELECT campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS",
    loginCustomerId,
    fetcher,
  );
  return rows.map((row) => ({ campaign: row.campaign?.name ?? "", status: row.campaign?.status ?? "", impressions: Number(row.metrics?.impressions ?? 0), clicks: Number(row.metrics?.clicks ?? 0), costMicros: Number(row.metrics?.costMicros ?? 0), conversions: Number(row.metrics?.conversions ?? 0) }));
}

export type LsaLead = { id: string; type: string; status: string; createdAt: string; name?: string; phone?: string; email?: string };

/** Local Services leads since a time, from the Ads API's local_services_lead resource. */
export async function localServicesLeads(token: string, developerToken: string, account: string, since: string, loginCustomerId?: string, fetcher?: Fetch): Promise<LsaLead[]> {
  const rows = await search<{ localServicesLead?: { id?: string; leadType?: string; leadStatus?: string; creationDateTime?: string; contactDetails?: { consumerName?: string; phoneNumber?: string; email?: string } } }>(
    token,
    developerToken,
    account,
    `SELECT local_services_lead.id, local_services_lead.lead_type, local_services_lead.lead_status, local_services_lead.creation_date_time, local_services_lead.contact_details FROM local_services_lead WHERE local_services_lead.creation_date_time > '${since.replace(/'/g, "")}'`,
    loginCustomerId,
    fetcher,
  );
  return rows.filter((row) => row.localServicesLead?.id).map((row) => ({ id: String(row.localServicesLead!.id), type: row.localServicesLead!.leadType ?? "", status: row.localServicesLead!.leadStatus ?? "", createdAt: row.localServicesLead!.creationDateTime ?? "", name: row.localServicesLead!.contactDetails?.consumerName, phone: row.localServicesLead!.contactDetails?.phoneNumber, email: row.localServicesLead!.contactDetails?.email }));
}

/** Finds a campaign Selestial created, by its exact name (which carries the draft id). */
export async function campaignByName(token: string, developerToken: string, account: string, name: string, loginCustomerId?: string, fetcher?: Fetch): Promise<{ resourceName: string; status: string } | null> {
  const rows = await search<{ campaign?: { resourceName?: string; status?: string } }>(token, developerToken, account, `SELECT campaign.resource_name, campaign.status FROM campaign WHERE campaign.name = '${name.replace(/'/g, "")}'`, loginCustomerId, fetcher);
  const row = rows[0]?.campaign;
  return row?.resourceName ? { resourceName: row.resourceName, status: row.status ?? "" } : null;
}

/** A budget and a PAUSED search campaign. It does not run until a separate, approved activation. */
export async function createPausedCampaign(token: string, developerToken: string, account: string, input: { name: string; dailyBudgetMicros: number }, loginCustomerId?: string, fetcher?: Fetch): Promise<string> {
  const id = customerId(account);
  const budget = await googleCall<{ results?: { resourceName?: string }[] }>(`${base()}/customers/${id}/campaignBudgets:mutate`, token, {
    method: "POST",
    headers: headers(developerToken, loginCustomerId),
    body: { operations: [{ create: { name: `${input.name} budget`, amountMicros: String(input.dailyBudgetMicros), deliveryMethod: "STANDARD", explicitlyShared: false } }] },
    fetcher,
  });
  const budgetName = budget.results?.[0]?.resourceName;
  if (!budgetName) throw new GoogleError("invalid", "Google Ads did not create the budget.");
  const campaign = await googleCall<{ results?: { resourceName?: string }[] }>(`${base()}/customers/${id}/campaigns:mutate`, token, {
    method: "POST",
    headers: headers(developerToken, loginCustomerId),
    body: { operations: [{ create: { name: input.name, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: budgetName, manualCpc: {}, networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false } } }] },
    fetcher,
  });
  const name = campaign.results?.[0]?.resourceName;
  if (!name) throw new GoogleError("invalid", "Google Ads did not create the campaign.");
  return name;
}

export async function setCampaignStatus(token: string, developerToken: string, account: string, resourceName: string, status: "ENABLED" | "PAUSED", loginCustomerId?: string, fetcher?: Fetch): Promise<void> {
  await googleCall(`${base()}/customers/${customerId(account)}/campaigns:mutate`, token, { method: "POST", headers: headers(developerToken, loginCustomerId), body: { operations: [{ update: { resourceName, status }, updateMask: "status" }] }, fetcher });
}
