import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsub } from "@/lib/email/unsub";

export const dynamic = "force-dynamic";

async function unsubscribe(customerId: string, token: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select("id, organization_id, email")
    .eq("id", customerId)
    .maybeSingle();
  if (!c) return false;
  if (!verifyUnsub(c.id, c.organization_id, token)) return false;

  const now = new Date().toISOString();
  await admin
    .from("customers")
    .update({ email_unsubscribed_at: now, email_sendable: false })
    .eq("id", c.id);
  if (c.email) {
    await admin
      .from("email_suppressions")
      .upsert(
        { organization_id: c.organization_id, email: c.email, reason: "unsubscribe" },
        { onConflict: "email,reason" }
      );
  }
  return true;
}

const PAGE = (msg: string) =>
  `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f5fb"><div style="text-align:center;padding:24px"><h1 style="font-size:18px;color:#141221">${msg}</h1></div></body></html>`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ customerId: string; token: string }> }
) {
  const { customerId, token } = await params;
  const ok = await unsubscribe(customerId, token);
  return new NextResponse(
    PAGE(ok ? "You've been unsubscribed." : "This link is no longer valid."),
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html" } }
  );
}

// List-Unsubscribe One-Click POST
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ customerId: string; token: string }> }
) {
  const { customerId, token } = await params;
  const ok = await unsubscribe(customerId, token);
  return NextResponse.json({ ok }, { status: ok ? 200 : 400 });
}
