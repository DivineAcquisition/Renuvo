/**
 * Live checks of Selestial's own Google setup on this deployment, run by an operator
 * (`npx convex run googleChecks:platform`). Each check makes one small, harmless request with controlled
 * data and reports what Google said, in words. It never returns a secret, never touches a company's
 * Google account, never sends anything and never spends ad money.
 */
import { internalAction } from "./_generated/server";
import { REGISTRY } from "./lib/ai/registry";
import { googleApp } from "./lib/google/oauth";
import { endpoints, mapsServerKey, platformStatus, pubsubTopic } from "./lib/google/platform";
import { matrix } from "./lib/google/routes";
import { serviceAccountToken } from "./lib/google/serviceAccount";

type Check = { check: string; result: "ok" | "blocked" | "failed" | "skipped"; detail: string };

async function oauthClient(): Promise<Check> {
  const app = googleApp();
  if (!app) return { check: "OAuth client", result: "skipped", detail: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set." };
  // A made-up code: a real client answers invalid_grant; a wrong id or secret answers invalid_client.
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code: "selestial-health-check", grant_type: "authorization_code", redirect_uri: endpoints().oauthCallback ?? "https://example.invalid/" }) });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (body.error === "invalid_grant") return { check: "OAuth client", result: "ok", detail: "Google recognises the client id and secret (a made-up code was refused as expected)." };
  if (body.error === "redirect_uri_mismatch") return { check: "OAuth client", result: "blocked", detail: `The redirect URI ${endpoints().oauthCallback} is not registered on the OAuth client.` };
  return { check: "OAuth client", result: "failed", detail: `Google answered ${response.status} ${body.error ?? ""}`.trim() };
}

async function gemini(): Promise<Check[]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return [{ check: "Gemini", result: "skipped", detail: "GEMINI_API_KEY is not set." }];
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } });
  if (!response.ok) return [{ check: "Gemini", result: "failed", detail: `Listing models answered ${response.status}.` }];
  const body = (await response.json().catch(() => ({}))) as { models?: { name?: string }[] };
  const available = new Set((body.models ?? []).map((m) => (m.name ?? "").replace(/^models\//, "")));
  const wanted = new Set<string>();
  for (const entry of Object.values(REGISTRY)) {
    for (const model of [entry.primary, ...(entry.fallbacks ?? [])]) if (model && model.provider === "google") wanted.add(model.model);
  }
  const out: Check[] = [{ check: "Gemini key", result: "ok", detail: `The key works; ${available.size} models are listed.` }];
  for (const model of wanted) out.push({ check: `Gemini model ${model}`, result: available.has(model) ? "ok" : "blocked", detail: available.has(model) ? "Listed for this key." : "Not listed for this key: the capability stays off until the model is available." });
  return out;
}

async function routes(): Promise<Check> {
  const key = mapsServerKey();
  if (!key) return { check: "Routes (drive times)", result: "skipped", detail: "GOOGLE_MAPS_SERVER_KEY is not set." };
  try {
    // Two fixed public points (Austin, TX downtown to the airport). Controlled data, no customer address.
    const [leg] = await matrix(key, [{ lat: 30.2672, lng: -97.7431 }], [{ lat: 30.1975, lng: -97.6664 }]);
    return leg?.ok ? { check: "Routes (drive times)", result: "ok", detail: `A test route answered ${Math.round((leg.seconds ?? 0) / 60)} minutes.` } : { check: "Routes (drive times)", result: "failed", detail: "Google returned no route for the test points." };
  } catch (error) {
    return { check: "Routes (drive times)", result: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Failed." };
  }
}

async function serviceAccount(): Promise<Check> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_CLOUD_PROJECT) return { check: "Route Optimization service account", result: "skipped", detail: "GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CLOUD_PROJECT are not set." };
  try {
    await serviceAccountToken();
    return { check: "Route Optimization service account", result: "ok", detail: "The service account can get an access token. (Optimization itself is checked on the first day plan.)" };
  } catch (error) {
    return { check: "Route Optimization service account", result: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Failed." };
  }
}

export const platform = internalAction({
  args: {},
  handler: async (): Promise<{ configured: { key: string; configured: boolean; where: string }[]; endpoints: ReturnType<typeof endpoints>; pubsubTopicSet: boolean; checks: Check[] }> => {
    const checks: Check[] = [];
    for (const run of [oauthClient, routes, serviceAccount]) {
      try {
        checks.push(await run());
      } catch (error) {
        checks.push({ check: run.name, result: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Failed." });
      }
    }
    try {
      checks.push(...(await gemini()));
    } catch (error) {
      checks.push({ check: "Gemini", result: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "Failed." });
    }
    return { configured: platformStatus().map((p) => ({ key: p.key, configured: p.configured, where: p.where })), endpoints: endpoints(), pubsubTopicSet: Boolean(pubsubTopic()), checks };
  },
});
