import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSmsRaw } from "./send";
import { estimateSegments } from "@/lib/billing/wallet";
import { chargeForSend } from "@/lib/billing/charge";
import { triggerAutoReload } from "@/lib/stripe/wallet-reload";
import {
  ensureFirstMessageOptOut,
  reconcileSendFailure,
} from "@/lib/agent/guardrails";

export type GuardedSendResult =
  | { ok: true; messageId: string; segments: number }
  | {
      ok: false;
      reason:
        | "not_sendable"
        | "no_number"
        | "a2p_not_ready"
        | "insufficient_funds"
        | "send_failed";
    };

/**
 * The ONLY send path the engine uses. Enforces, in order:
 *   1) customer.sms_sendable = true          (consent gate, Prompt 4)
 *   2) org has a number + A2P approved        (deliverability gate)
 *   3) chargeForSend debits the wallet ok     (funds gate, Prompt 8)
 * then sends and writes a message_sent event linked to the debit.
 * Quiet-hours / rate-limit / first-message opt-out are layered in Prompt 20.
 */
export async function sendGuardedSms(args: {
  orgId: string;
  customerId: string;
  toPhone: string;
  body: string;
  eventType?: "message_sent" | "activation_sent" | "conversion_offer_sent";
  meta?: Record<string, unknown>;
}): Promise<GuardedSendResult> {
  const admin = createAdminClient();

  // 1) consent gate
  const { data: customer } = await admin
    .from("customers")
    .select("sms_sendable")
    .eq("id", args.customerId)
    .single();
  if (!customer?.sms_sendable) return { ok: false, reason: "not_sendable" };

  // 2) deliverability gate
  const { data: org } = await admin
    .from("organizations")
    .select("telnyx_phone_number, telnyx_messaging_profile_id, a2p_status")
    .eq("id", args.orgId)
    .single();
  if (!org?.telnyx_phone_number) return { ok: false, reason: "no_number" };
  // Until Renuvo's A2P 10DLC campaigns are registered/approved, allow sending on
  // the available (verified) Telnyx numbers by setting TELNYX_ALLOW_UNREGISTERED
  // = "true". Default is strict: production sends require a2p_status='approved'.
  const allowPreA2p = process.env.TELNYX_ALLOW_UNREGISTERED === "true";
  if (
    process.env.NODE_ENV === "production" &&
    org.a2p_status !== "approved" &&
    !allowPreA2p
  ) {
    return { ok: false, reason: "a2p_not_ready" };
  }

  // 2.5) first-message opt-out guarantee — the very first outbound to a
  // customer always carries "Reply STOP," even if the template/AI dropped it.
  const body = await ensureFirstMessageOptOut(
    args.orgId,
    args.customerId,
    args.body
  );

  // 3) funds gate — charge against a unique sendRef so a hard failure can be
  // refunded exactly. Re-estimate segments on the possibly-lengthened body.
  const sendRef = randomUUID();
  const segments = estimateSegments(body);
  const debit = await chargeForSend(args.orgId, segments, sendRef, {
    customerId: args.customerId,
  });
  if (!debit.ok) {
    if (debit.reloadNeeded) await triggerAutoReload(args.orgId);
    return { ok: false, reason: "insufficient_funds" };
  }

  // send
  try {
    const sent = await sendSmsRaw(
      org.telnyx_phone_number,
      args.toPhone,
      body,
      org.telnyx_messaging_profile_id ?? undefined
    );

    // event linked to the wallet debit
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: args.eventType ?? "message_sent",
      p_source: "telnyx",
      p_customer_id: args.customerId,
      p_channel: "sms",
      p_direction: "outbound",
      p_body: body,
      p_external_id: sent.id,
      p_payload: { segments: sent.segments, send_ref: sendRef, ...args.meta },
    });

    return { ok: true, messageId: sent.id, segments: sent.segments };
  } catch {
    // hard send failure → refund the wallet so the owner is never billed for an
    // SMS that didn't go out, THEN log the failure (with the sendRef to trace it).
    await reconcileSendFailure(args.orgId, debit.chargeCents, sendRef);
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "message_failed",
      p_source: "telnyx",
      p_customer_id: args.customerId,
      p_channel: "sms",
      p_direction: "outbound",
      p_body: body,
      p_payload: { ...args.meta, send_ref: sendRef },
    });
    return { ok: false, reason: "send_failed" };
  }
}
