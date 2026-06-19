import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken, decryptToken } from "@/lib/crypto/tokens";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function googleConsentUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

/** Returns an authorized client for an org, refreshing the access token if needed. */
export async function authorizedClientForOrg(orgId: string) {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("calendar_connections")
    .select("access_token_enc, refresh_token_enc, token_expiry, enabled")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!conn?.enabled || !conn.access_token_enc || !conn.refresh_token_enc)
    return null;

  const client = oauthClient();
  client.setCredentials({
    access_token: decryptToken(conn.access_token_enc),
    refresh_token: decryptToken(conn.refresh_token_enc),
    expiry_date: conn.token_expiry
      ? new Date(conn.token_expiry).getTime()
      : undefined,
  });

  // refresh if expiring within 60s
  if (
    !conn.token_expiry ||
    new Date(conn.token_expiry).getTime() - Date.now() < 60_000
  ) {
    const { credentials } = await client.refreshAccessToken();
    await admin
      .from("calendar_connections")
      .update({
        access_token_enc: encryptToken(credentials.access_token!),
        token_expiry: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
      })
      .eq("organization_id", orgId);
    client.setCredentials(credentials);
  }
  return client;
}
