import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Verify Svix-style signature used by Resend webhooks. */
function verify(
  body: string,
  headers: { id: string; ts: string; sig: string },
  secret: string
): boolean {
  try {
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const signed = `${headers.id}.${headers.ts}.${body}`;
    const expected = crypto
      .createHmac("sha256", secretBytes)
      .update(signed)
      .digest("base64");
    return headers.sig
      .split(" ")
      .some((p) => p.split(",")[1] === expected);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const ok = verify(
      body,
      {
        id: req.headers.get("svix-id") ?? "",
        ts: req.headers.get("svix-timestamp") ?? "",
        sig: req.headers.get("svix-signature") ?? "",
      },
      secret
    );
    if (!ok) {
      log.error("webhook.resend.bad_signature");
      return NextResponse.json({ error: "bad signature" }, { status: 401 });
    }
  }

  const evt = JSON.parse(body) as {
    type?: string;
    data?: { email_id?: string; to?: string | string[] };
  };
  const type = evt.type ?? "";
  const providerId = evt.data?.email_id;
  log.info("webhook.resend.received", { type });

  const admin = createAdminClient();

  // resolve the original send by provider id (events.external_id = email_<id>)
  let orgId: string | null = null;
  let customerId: string | null = null;
  if (providerId) {
    const { data: orig } = await admin
      .from("events")
      .select("organization_id, customer_id")
      .eq("external_id", `email_${providerId}`)
      .maybeSingle();
    orgId = orig?.organization_id ?? null;
    customerId = orig?.customer_id ?? null;
  }
  const recipient = Array.isArray(evt.data?.to)
    ? evt.data?.to[0]
    : evt.data?.to;

  async function suppress(reason: string) {
    if (recipient)
      await admin
        .from("email_suppressions")
        .upsert(
          { organization_id: orgId, email: recipient, reason },
          { onConflict: "email,reason" }
        );
    if (customerId) {
      const patch: Record<string, unknown> = { email_sendable: false };
      if (reason === "complaint")
        patch.email_unsubscribed_at = new Date().toISOString();
      await admin.from("customers").update(patch).eq("id", customerId);
    }
  }

  if (type.includes("bounced")) await suppress("bounce");
  else if (type.includes("complained")) await suppress("complaint");

  return NextResponse.json({ received: true });
}
