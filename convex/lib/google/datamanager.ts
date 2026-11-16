/**
 * Reporting booked jobs to Google Ads through the Data Manager API. Only a job that came from a Google ad
 * (a lead with a click id) is reported, once, under its own transaction id, with the consent the Owner
 * recorded. Google's answer is kept as diagnostics.
 *
 * NOT VERIFIED against the live API in this build: no authorized Ads account was available.
 */
import { googleCall, type Fetch } from "./http";

const API = "https://datamanager.googleapis.com/v1";

export type ConversionEvent = { transactionId: string; at: number; valueCents: number; currency: string; gclid: string; consent: { adUserData: boolean; adPersonalization: boolean } };

export function ingestBody(destination: { accountId: string; conversionActionId: string; loginAccountId?: string }, events: ConversionEvent[], validateOnly = false) {
  return {
    destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: destination.accountId.replace(/-/g, "") }, ...(destination.loginAccountId ? { loginAccount: { accountType: "GOOGLE_ADS", accountId: destination.loginAccountId.replace(/-/g, "") } } : {}), productDestinationId: destination.conversionActionId }],
    events: events.map((event) => ({
      transactionId: event.transactionId,
      eventTimestamp: new Date(event.at).toISOString(),
      conversionValue: event.valueCents / 100,
      currency: event.currency,
      adIdentifiers: { gclid: event.gclid },
      consent: { adUserData: event.consent.adUserData ? "CONSENT_GRANTED" : "CONSENT_DENIED", adPersonalization: event.consent.adPersonalization ? "CONSENT_GRANTED" : "CONSENT_DENIED" },
    })),
    validateOnly,
    encoding: "HEX",
  };
}

export async function ingest(token: string, destination: Parameters<typeof ingestBody>[0], events: ConversionEvent[], options: { validateOnly?: boolean; fetcher?: Fetch } = {}): Promise<{ requestId: string | null }> {
  const body = await googleCall<{ requestId?: string }>(`${API}/events:ingest`, token, { method: "POST", body: ingestBody(destination, events, options.validateOnly), fetcher: options.fetcher });
  return { requestId: body.requestId ?? null };
}

/** What Google later said about a request: processed, partly processed, or failed, with its reasons. */
export async function requestStatus(token: string, requestId: string, fetcher?: Fetch): Promise<Record<string, unknown>> {
  return googleCall<Record<string, unknown>>(`${API}/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`, token, { fetcher });
}
