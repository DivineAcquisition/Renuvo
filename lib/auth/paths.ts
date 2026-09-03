/** Relative in-app paths only. Rejects protocol-relative and off-site URLs. */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = "/app",
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("://")) return fallback;
  return value;
}

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export function authCallbackUrl(next?: string, origin = siteUrl()): string {
  const url = new URL("/auth/callback", `${origin.replace(/\/$/, "")}/`);
  if (next && next !== "/app") {
    url.searchParams.set("next", next);
  }
  return url.toString();
}
