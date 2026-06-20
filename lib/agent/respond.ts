import { createAdminClient } from "@/lib/supabase/admin";
import { getConversation } from "@/lib/events/queries";
import { classifyIntent } from "./classify";
import { generateMessage } from "./generate";
import { generateContextualReply } from "./contextual-reply";
import { cancelPendingMessages } from "./engine";
import { getSignupLink } from "@/lib/capture/links";
import { dispatchMessage } from "@/lib/messaging/dispatch";
import { notify } from "@/lib/notify/dispatch";
import { emitOutcome } from "@/lib/intelligence/emit";

// LOOP GUARD: this is the ONLY entry point for agent replies and it runs solely
// from the Telnyx inbound webhook (human → agent). NEVER call it from an
// outbound/send path, or the agent could text itself into an infinite loop.

const REPLY_THROTTLE_PER_HOUR = 5;

export async function handleInboundMessage(args: {
  orgId: string;
  customerId: string;
  text: string;
  /** Telnyx inbound message id, for de-dupe across webhook retries. */
  externalId?: string;
}) {
  const admin = createAdminClient();

  // load the customer (phone + sendable + takeover flag)
  const { data: customer } = await admin
    .from("customers")
    .select("phone, sms_sendable, agent_paused")
    .eq("id", args.customerId)
    .single();
  if (!customer?.sms_sendable) return; // opted out / no consent → don't reply

  // HUMAN TAKEOVER: a person is handling this thread — log it, don't auto-reply.
  // (The reply_received event is already written by the inbound webhook.)
  if (customer.agent_paused) {
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "agent_action",
      p_source: "agent",
      p_customer_id: args.customerId,
      p_payload: { action: "skipped_paused", inbound: args.text },
    });
    return;
  }

  // DE-DUPE: if we already handled this exact inbound (webhook redelivery), stop.
  const marker = args.externalId
    ? `agent_handled_${args.externalId}`
    : null;
  if (marker) {
    const { data: already } = await admin
      .from("events")
      .select("id")
      .eq("organization_id", args.orgId)
      .eq("source", "agent")
      .eq("external_id", marker)
      .maybeSingle();
    if (already) return;
    // record the processed marker (idempotent on source+external_id)
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "agent_action",
      p_source: "agent",
      p_customer_id: args.customerId,
      p_external_id: marker,
      p_payload: { action: "inbound_handling_started" },
    });
  }

  // THROTTLE: if we've already auto-replied a lot in the last hour, hand to a
  // human instead of risking an SMS ping-pong loop.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentReplies } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("type", "message_sent")
    .eq("direction", "outbound")
    .gte("occurred_at", oneHourAgo);
  if ((recentReplies ?? 0) >= REPLY_THROTTLE_PER_HOUR) {
    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "agent_action",
      p_source: "agent",
      p_customer_id: args.customerId,
      p_payload: { action: "handoff_needed", reason: "reply_throttle" },
    });
    void notify(args.orgId, "reply_needs_human", {
      title: "A conversation needs a human",
      body: "A customer is replying a lot — take over to keep it on track.",
      link: `/dashboard/customers/${args.customerId}`,
    });
    return;
  }

  // COST GUARD: exactly ONE classify call + ONE generate/reply call below.
  const rawConvo = await getConversation(args.orgId, args.customerId, {
    limit: 12,
  });
  // normalize: drop rows with null direction/body so downstream types are clean
  const convo: { direction: "outbound" | "inbound"; body: string }[] = rawConvo
    .filter(
      (m) =>
        (m.direction === "outbound" || m.direction === "inbound") &&
        m.body != null
    )
    .map((m) => ({
      direction: m.direction as "outbound" | "inbound",
      body: m.body as string,
    }));
  const intent = await classifyIntent(args.text, convo);

  // intelligence spine: inbound intent (Prompt 48)
  void emitOutcome({
    orgId: args.orgId,
    type: "reply_classified",
    customerId: args.customerId,
    meta: { intent },
  });

  // a live conversation has started → stop the canned sequence
  await cancelPendingMessages(args.orgId, args.customerId, `inbound_${intent}`);

  await admin.rpc("record_event", {
    p_org_id: args.orgId,
    p_type: "agent_action",
    p_source: "agent",
    p_customer_id: args.customerId,
    p_payload: { action: "intent_classified", intent, inbound: args.text },
  });

  // org + latest job (for price/link context)
  const { data: org } = await admin
    .from("organizations")
    .select("name, vertical_id")
    .eq("id", args.orgId)
    .single();
  const { data: latestJob } = await admin
    .from("jobs")
    .select("id")
    .eq("organization_id", args.orgId)
    .eq("customer_id", args.customerId)
    .eq("kind", "one_time")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let body: string;

  if (intent === "interested") {
    // send the offer/link via the template generator (conversion_offer carries the link)
    const gen = await generateMessage({
      orgId: args.orgId,
      customerId: args.customerId,
      eventKey: "conversion_offer",
      jobId: latestJob?.id,
      contextMessages: convo,
    });
    body = gen.text;
  } else if (intent === "objection") {
    const gen = await generateMessage({
      orgId: args.orgId,
      customerId: args.customerId,
      eventKey: "objection_followup",
      jobId: latestJob?.id,
      contextMessages: convo,
    });
    body = gen.text;
  } else if (intent === "question") {
    const link = await getSignupLink({
      orgId: args.orgId,
      customerId: args.customerId,
      jobId: latestJob?.id,
    });
    body = await generateContextualReply({
      task: "Answer their question briefly and helpfully. If it makes sense, invite them to start.",
      context: [...convo, { direction: "inbound", body: args.text }],
      businessName: org?.name ?? "us",
      bookingLink: link,
    });
  } else if (intent === "not_interested") {
    body = await generateContextualReply({
      task: "Warmly acknowledge they're not interested right now. No pressure. Leave the door open. Do NOT include a link.",
      context: [...convo, { direction: "inbound", body: args.text }],
      businessName: org?.name ?? "us",
    });
  } else {
    // unclear → gentle clarifier
    body = await generateContextualReply({
      task: "You're not sure what they meant. Ask one friendly clarifying question about whether they'd like recurring service.",
      context: [...convo, { direction: "inbound", body: args.text }],
      businessName: org?.name ?? "us",
    });
  }

  if (!body) return;

  // inbound is an SMS conversation, so 'auto' resolves to SMS here; the dispatcher
  // keeps the door open for email-preference customers without changing SMS replies.
  await dispatchMessage({
    orgId: args.orgId,
    customerId: args.customerId,
    toPhone: customer.phone,
    body,
    eventType: "message_sent",
    meta: { reply_to_intent: intent },
  });
}
