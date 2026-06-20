import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { googleConsentUrl } from "@/lib/calendar/google";

export async function GET() {
  const active = await getActiveOrg();
  if (!active)
    return NextResponse.redirect(
      new URL("/login", process.env.NEXT_PUBLIC_APP_URL)
    );
  return NextResponse.redirect(await googleConsentUrl(active.org.id));
}
