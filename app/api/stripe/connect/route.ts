import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getServerSecret } from "@/lib/secrets";

export async function GET() {
  const active = await getActiveOrg();
  if (!active)
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL)
    );

  const clientId = (await getServerSecret("STRIPE_CONNECT_CLIENT_ID")) ?? "";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/connect/callback`,
    state: active.org.id, // resolved + verified server-side in the callback
  });

  return NextResponse.redirect(
    `https://connect.stripe.com/oauth/authorize?${params.toString()}`
  );
}
