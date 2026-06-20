import { NextRequest, NextResponse } from "next/server";
import { consumePortalLink, PORTAL_COOKIE } from "@/lib/portal/auth";

export const dynamic = "force-dynamic";

/** Exchange a single-use magic link for a scoped session cookie. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const res = await consumePortalLink(token);
  if ("error" in res) {
    return NextResponse.redirect(new URL("/access-expired", req.url));
  }
  const next = req.nextUrl.searchParams.get("next") || "/";
  const redirect = NextResponse.redirect(new URL(next, req.url));
  redirect.cookies.set(PORTAL_COOKIE, res.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 60 min
  });
  return redirect;
}
