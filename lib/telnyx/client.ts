const TELNYX_API = "https://api.telnyx.com/v2";

export async function telnyxFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${TELNYX_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY!}`,
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
