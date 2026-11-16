/**
 * The deployment's HTTP endpoints. Only provider webhooks live here, each verified before it is read
 * (convex/lib/builders.ts `providerWebhook`).
 *
 * POST /webhooks/resend  delivery reports, bounces and complaints for email. Needs RESEND_WEBHOOK_SECRET.
 * POST /webhooks/telnyx  delivery reports for texts, and texts coming in. Needs TELNYX_PUBLIC_KEY.
 */
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { providerWebhook } from "./lib/builders";
import { verifyWebhook, webhookOutcome } from "./lib/messaging/resend";
import { telnyxEvent, verifyTelnyx } from "./lib/messaging/telnyx";

const http = httpRouter();

http.route({
  path: "/webhooks/resend",
  method: "POST",
  handler: providerWebhook({
    verify: async (request, body) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) return false;
      return verifyWebhook({ secret, id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature"), body, now: Date.now() });
    },
    handler: async (ctx, body, request) => {
      const outcome = webhookOutcome(body);
      if (!outcome) return;
      // The same report delivered twice is recognised by its event id and changes nothing the second time.
      await ctx.runMutation(internal.messaging.receipt, { provider: "resend", eventId: request.headers.get("svix-id")!, providerMessageId: outcome.providerMessageId, outcome: outcome.outcome });
    },
  }),
});

http.route({
  path: "/webhooks/telnyx",
  method: "POST",
  handler: providerWebhook({
    verify: async (request, body) => {
      const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
      if (!publicKey) return false;
      return verifyTelnyx({ publicKey, signature: request.headers.get("telnyx-signature-ed25519"), timestamp: request.headers.get("telnyx-timestamp"), body, now: Date.now() });
    },
    handler: async (ctx, body) => {
      const event = telnyxEvent(body);
      if (event.kind === "receipt") {
        await ctx.runMutation(internal.messaging.receipt, { provider: "telnyx", eventId: event.eventId, providerMessageId: event.providerMessageId, outcome: event.outcome, problem: event.problem ?? undefined });
      } else if (event.kind === "inbound") {
        await ctx.runMutation(internal.inbound.telnyx, { eventId: event.eventId, to: event.to, from: event.from, body: event.text, receivedAt: event.receivedAt });
      }
    },
  }),
});

export default http;
