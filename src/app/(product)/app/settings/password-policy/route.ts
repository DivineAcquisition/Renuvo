import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * The password rules, in the sign-in service's own form, for the Security settings page.
 * The proxy already keeps signed-out requests away from /app. This checks again here, because a
 * route must not rely on the proxy alone.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401, headers: { "cache-control": "private, no-store" } });
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  const encoded = key?.split("_")[2];
  if (!encoded) return NextResponse.json(null, { headers: { "cache-control": "private, no-store" } });
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    if (!/^[a-z0-9.-]+$/i.test(host)) return NextResponse.json(null);
    const response = await fetch(`https://${host}/v1/environment`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    const body = response.ok ? ((await response.json()) as { user_settings?: { password_settings?: unknown } }) : null;
    return NextResponse.json(body?.user_settings?.password_settings ?? null, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json(null, { headers: { "cache-control": "private, no-store" } });
  }
}
