import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTelnyxSignature } from "@/lib/telnyx/verify";
import { onInboundMessage } from "@/lib/agent/hooks"; // real in Prompt 18
import { log } from "@/lib/log";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("telnyx-signature-ed25519") ?? "";
  const ts = req.headers.get("telnyx-timestamp") ?? "";

  if (!verifyTelnyxSignature(raw, sig, ts)) {
    log.error("webhook.telnyx.bad_signature");
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  const evt = JSON.parse(raw);
  const type = evt?.data?.event_type as string;
  log.info("webhook.telnyx.received", { type });
  const payload = evt?.data?.payload ?? {};
  const admin = createAdminClient();

  // ---- inbound message (a reply) -------------------------------------------
  if (type === "message.received") {
    const fromPhone = payload?.from?.phone_number as string;
    const toPhone = (payload?.to?.[0]?.phone_number ??
      payload?.to?.phone_number) as string;
    const text = (payload?.text ?? "").trim();

    // resolve tenant by the receiving number, then the customer by sender
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("telnyx_phone_number", toPhone)
      .maybeSingle();
    if (!org) return NextResponse.json({ received: true });

    const { data: customer } = await admin
      .from("customers")
      .select("id, opted_out")
      .eq("organization_id", org.id)
      .eq("phone", fromPhone)
      .maybeSingle();

    // STOP handling (carrier also auto-stops, but mirror it in our data)
    const isStop = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i.test(text);
    if (customer && isStop) {
      await admin.rpc("mark_opted_out", { p_customer_id: customer.id });
      await admin.rpc("record_event", {
        p_org_id: org.id,
        p_type: "opted_out",
        p_source: "telnyx",
        p_customer_id: customer.id,
        p_external_id: payload?.id ?? undefined,
      });
      return NextResponse.json({ received: true });
    }

    if (customer) {
      await admin.rpc("record_event", {
        p_org_id: org.id,
        p_type: "reply_received",
        p_source: "telnyx",
        p_customer_id: customer.id,
        p_channel: "sms",
        p_direction: "inbound",
        p_body: text,
        p_external_id: payload?.id ?? undefined,
      });
      // hand to the agent (intent classification + reply, Prompt 19)
      await onInboundMessage({
        orgId: org.id,
        customerId: customer.id,
        text,
        externalId: payload?.id ?? undefined,
      });
    }
    return NextResponse.json({ received: true });
  }

  // ---- delivery receipts ----------------------------------------------------
  if (type === "message.finalized" || type === "message.sent") {
    const status = payload?.to?.[0]?.status ?? payload?.status;
    const messageId = payload?.id;
    const delivered = status === "delivered";
    // best-effort soft log. The org is resolved from the original send + a
    // failed-but-charged reconciliation is added in Prompt 20.
    try {
      await admin.rpc("record_event", {
        p_org_id: null as unknown as string,
        p_type: delivered ? "message_delivered" : "message_failed",
        p_source: "telnyx",
        p_external_id: `dlr_${messageId}`,
        p_payload: { status, message_id: messageId },
      });
    } catch {
      /* soft log only — reconciled in Prompt 20 */
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
