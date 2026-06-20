import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { oauthClient } from "@/lib/calendar/google";
import { encryptToken } from "@/lib/crypto/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const settings = new URL(
    "/dashboard/settings/calendar",
    process.env.NEXT_PUBLIC_APP_URL
  );

  const active = await getActiveOrg();
  if (!active || !code || state !== active.org.id) {
    settings.searchParams.set("error", "calendar_failed");
    return NextResponse.redirect(settings);
  }

  try {
    const client = await oauthClient();
    const { tokens } = await client.getToken(code);
    const admin = createAdminClient();
    await admin.from("calendar_connections").upsert({
      organization_id: active.org.id,
      provider: "google",
      enabled: true,
      calendar_id: "primary",
      access_token_enc: encryptToken(tokens.access_token!),
      refresh_token_enc: tokens.refresh_token
        ? encryptToken(tokens.refresh_token)
        : undefined,
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    });
    settings.searchParams.set("connected", "1");
  } catch {
    settings.searchParams.set("error", "calendar_failed");
  }
  return NextResponse.redirect(settings);
}
