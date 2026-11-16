/**
 * Selestial's own Google credentials: Maps and Places in the browser, Routes and Route Optimization on the
 * server, Gemini in the AI layer, Picker in the browser, the Ads developer token, and Pub/Sub. They are
 * the platform's, never a company's, and are kept apart from every company's OAuth grant.
 *
 * Each answer here is only "configured" or not. A key being present is not proof it works; the live
 * checks in googleChecks.ts are what prove that.
 */
export type PlatformItem = { key: string; label: string; where: "convex" | "vercel"; configured: boolean; unlocks: string };

const has = (name: string) => Boolean(process.env[name]?.trim());

/** Names only. Values are never returned. Browser keys live on Vercel, so the server reports them as unknown. */
export function platformStatus(): PlatformItem[] {
  return [
    { key: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", label: "Google OAuth client", where: "convex", configured: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"), unlocks: "Connecting a company's Google account" },
    { key: "MAILBOX_TOKEN_KEY", label: "Token encryption key", where: "convex", configured: has("MAILBOX_TOKEN_KEY"), unlocks: "Storing any Google authorization (it is never stored unencrypted)" },
    { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Google Ads developer token", where: "convex", configured: has("GOOGLE_ADS_DEVELOPER_TOKEN"), unlocks: "Ad accounts, results, campaign drafts and Local Services leads" },
    { key: "GOOGLE_MAPS_SERVER_KEY", label: "Routes API key (server)", where: "convex", configured: has("GOOGLE_MAPS_SERVER_KEY"), unlocks: "Drive-time estimates for Dispatch" },
    { key: "GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CLOUD_PROJECT", label: "Route Optimization service account", where: "convex", configured: has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("GOOGLE_CLOUD_PROJECT"), unlocks: "Optimized day plans (proposals only)" },
    { key: "GEMINI_API_KEY", label: "Gemini API key", where: "convex", configured: has("GEMINI_API_KEY"), unlocks: "Gemini models in Chat analysis and Creative Studio" },
    { key: "GOOGLE_PUBSUB_TOPIC / GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT", label: "Pub/Sub push", where: "convex", configured: has("GOOGLE_PUBSUB_TOPIC") && has("GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT"), unlocks: "Instant Gmail and Business Profile notifications (without it, Selestial checks on a timer)" },
  ];
}

export const pubsubTopic = () => process.env.GOOGLE_PUBSUB_TOPIC?.trim() || null;
export const adsDeveloperToken = () => process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || null;
export const mapsServerKey = () => process.env.GOOGLE_MAPS_SERVER_KEY?.trim() || null;

/** Where Google sends people and notifications. Built from the deployment's own site address, never invented. */
export function endpoints(): { oauthCallback: string | null; calendarWebhook: string | null; pubsubPush: string | null; leadFormWebhook: string | null } {
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "") || null;
  return {
    oauthCallback: site && `${site}/oauth/google/callback`,
    calendarWebhook: site && `${site}/webhooks/google/calendar`,
    pubsubPush: site && `${site}/webhooks/google/pubsub`,
    leadFormWebhook: site && `${site}/webhooks/google/leads`,
  };
}
