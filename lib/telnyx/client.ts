import { getServerSecret } from "@/lib/secrets";

const TELNYX_API = "https://api.telnyx.com/v2";

export async function telnyxFetch(path: string, init?: RequestInit) {
  // API key from env or Supabase Vault (so it can be managed entirely in Supabase).
  const apiKey = (await getServerSecret("TELNYX_API_KEY")) ?? "";
  const res = await fetch(`${TELNYX_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx ${res.status}: ${text}`);
  }
  return res.json();
}
