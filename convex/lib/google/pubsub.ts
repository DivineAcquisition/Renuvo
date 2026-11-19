/**
 * Verifying a Pub/Sub push. Google signs each push with an OIDC token for the service account set on the
 * subscription. The token's signature (Google's published keys), issuer, audience, expiry and account are
 * all checked; a push without a valid token is not read.
 */
type Jwk = { kid: string; n: string; e: string; kty: string; alg?: string };

const b64urlBytes = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export type PushClaims = { iss: string; aud: string; email?: string; email_verified?: boolean; exp: number; iat?: number };

/** Checks a token against keys. Pure, so tests can give it their own keys. */
export async function verifyOidc(token: string, keys: Jwk[], expected: { audience: string; email: string }, now = Date.now()): Promise<PushClaims | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header: { kid?: string; alg?: string };
  let claims: PushClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlBytes(h)));
    claims = JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
  if (claims.aud !== expected.audience) return null;
  if (claims.email !== expected.email || claims.email_verified !== true) return null;
  if (claims.exp * 1000 < now - 60_000) return null;
  return claims;
}

let cached: { keys: Jwk[]; until: number } | null = null;

/**
 * Google's current signing keys. Kept for as long as Google says they may be (Cache-Control max-age, at
 * most a day), so a burst of notifications doesn't fetch them each time. A token signed with a key not in
 * the cached set fetches them again once, since Google rotates keys.
 */
export async function googleKeys(kid?: string, now = Date.now()): Promise<Jwk[]> {
  if (cached && cached.until > now && (!kid || cached.keys.some((key) => key.kid === kid))) return cached.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs").catch(() => null);
  if (!response?.ok) return cached?.keys ?? [];
  const keys = ((await response.json()) as { keys?: Jwk[] }).keys ?? [];
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  cached = { keys, until: now + Math.min(Math.max(maxAge, 60), 86_400) * 1000 };
  return keys;
}

/** The key id a token names, so the cache can tell when it needs fresh keys. */
export function tokenKid(token: string): string | undefined {
  try {
    return (JSON.parse(new TextDecoder().decode(b64urlBytes(token.split(".")[0] ?? ""))) as { kid?: string }).kid;
  } catch {
    return undefined;
  }
}

/** For tests: forget the cached keys. */
export function forgetGoogleKeys() {
  cached = null;
}

/** The decoded message of a push: Gmail's {emailAddress, historyId} or Business Profile's notification. */
export function pushData(body: string): { data: Record<string, unknown>; messageId: string; subscription: string } | null {
  try {
    const parsed = JSON.parse(body) as { message?: { data?: string; messageId?: string; message_id?: string }; subscription?: string };
    const raw = parsed.message?.data;
    const messageId = parsed.message?.messageId ?? parsed.message?.message_id;
    if (!raw || !messageId) return null;
    return { data: JSON.parse(new TextDecoder().decode(b64urlBytes(raw))) as Record<string, unknown>, messageId, subscription: parsed.subscription ?? "" };
  } catch {
    return null;
  }
}
