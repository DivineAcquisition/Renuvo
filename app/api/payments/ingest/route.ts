import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment } from "@/lib/payments/record";

// POST with header: x-renuvo-ingest-secret: <org.ingest_secret>
// Body: { source, externalId, amountCents, phone, email?, fullName?, smsConsent?, consentSource? }
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-renuvo-ingest-secret");
  if (!secret)
    return NextResponse.json({ error: "missing secret" }, { status: 401 });

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("ingest_secret", secret)
    .maybeSingle();
  if (!org)
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });

  const b = await req.json().catch(() => null);
  if (!b?.externalId || !b?.amountCents) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const res = await recordPayment({
    orgId: org.id,
    source: String(b.source ?? "external"),
    externalId: String(b.externalId),
    amountCents: Number(b.amountCents),
    currency: b.currency ?? "usd",
    customer: {
      phone: b.phone ?? null,
      email: b.email ?? null,
      fullName: b.fullName ?? null,
      smsConsent: b.smsConsent === true,
      consentSource:
        b.smsConsent === true ? b.consentSource ?? "external" : undefined,
    },
  });

  return NextResponse.json({ ok: true, isNew: res.isNew });
}
