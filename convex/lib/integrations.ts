/**
 * The integrations the Integrations page lists (src/lib/app/integrations.ts), by id, so the server can
 * check a request names one of them. A test keeps the two lists the same.
 *
 * `setUp` names the integrations that are built and where each is set up: the page sends people there
 * rather than repeating the setup. Everything else is planned: an Owner can ask for it, which records the
 * company's interest for Selestial and promises no date.
 */
export const INTEGRATION_IDS = [
  "stripe", "square", "quickbooks-payments", "paypal",
  "google-local-services-ads", "google-ads", "meta-lead-ads",
  "google-address", "google-maps-travel", "google-drive", "google-calendar", "gmail", "google-business-profile",
  "outlook", "onedrive",
  "yelp", "facebook-reviews",
  "texting-number",
  "quickbooks-online", "xero",
  "indeed", "checkr",
  "jobber", "housecall-pro", "zenmaid", "launch27",
] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

/** Built integrations: no request needed, the page links to where they are set up. */
export const BUILT: readonly IntegrationId[] = ["gmail", "texting-number", "google-address", "google-drive", "google-calendar", "google-business-profile", "google-ads", "google-local-services-ads", "google-maps-travel"];

export function isIntegrationId(value: string): value is IntegrationId {
  return (INTEGRATION_IDS as readonly string[]).includes(value);
}
