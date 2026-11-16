/**
 * An access token for Selestial's own service account (Route Optimization), from the JSON key in
 * GOOGLE_SERVICE_ACCOUNT_JSON. The key is used only on the server and only for Selestial's own project.
 */
import { GoogleError, googleCall, type Fetch } from "./http";

type Key = { client_email: string; private_key: string; token_uri?: string };

function readKey(): Key | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const key = JSON.parse(raw) as Key;
    return key.client_email && key.private_key ? key : null;
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textB64 = (value: string) => b64url(new TextEncoder().encode(value));

async function signingKey(pem: string): Promise<CryptoKey> {
  const der = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i += 1) bytes[i] = der.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function serviceAccountToken(scope = "https://www.googleapis.com/auth/cloud-platform", fetcher?: Fetch): Promise<string> {
  const key = readKey();
  if (!key) throw new GoogleError("not_configured", "Route Optimization is not set up: GOOGLE_SERVICE_ACCOUNT_JSON is missing or not a service-account key.");
  const now = Math.floor(Date.now() / 1000);
  const header = textB64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textB64(JSON.stringify({ iss: key.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(key.private_key), new TextEncoder().encode(`${header}.${claims}`)));
  const body = await googleCall<{ access_token?: string }>("https://oauth2.googleapis.com/token", null, {
    method: "POST",
    rawBody: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signature)}` }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    fetcher,
  });
  if (!body.access_token) throw new GoogleError("auth", "Google did not accept the service account.");
  return body.access_token;
}
