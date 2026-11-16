/**
 * The deployment's HTTP endpoints. Only provider webhooks live here, each verified before it is read
 * (convex/lib/builders.ts `providerWebhook`).
 *
 * POST /webhooks/resend  delivery reports, bounces and complaints for email. Needs RESEND_WEBHOOK_SECRET.
 * POST /webhooks/telnyx  delivery reports for texts, and texts coming in. Needs TELNYX_PUBLIC_KEY.
 */
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { providerWebhook, signedFileRoute } from "./lib/builders";
import { verifyWebhook, webhookOutcome } from "./lib/messaging/resend";
import { photoRequestValid } from "./lib/dispatch/photoLinks";
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

/**
 * GET /photos/<evidence id>?exp=…&sig=…  one crew photo, for an address signed by the deployment that
 * has not expired. Anything else is a plain 404, whatever was wrong with it.
 */
http.route({
  pathPrefix: "/photos/",
  method: "GET",
  handler: signedFileRoute({
    verify: async (request, now) => {
      const url = new URL(request.url);
      const evidenceId = url.pathname.slice("/photos/".length);
      return /^[a-z0-9]{10,64}$/i.test(evidenceId) && photoRequestValid(evidenceId, url.searchParams.get("exp"), url.searchParams.get("sig"), now);
    },
    handler: async (ctx, request, now) => {
      const url = new URL(request.url);
      const storageId = await ctx.runQuery(internal.dispatchViews.photoFile, { evidenceId: url.pathname.slice("/photos/".length) });
      const file = storageId ? await ctx.storage.get(storageId) : null;
      if (!file) return null;
      const seconds = Math.max(0, Math.floor((Number(url.searchParams.get("exp")) - now) / 1000));
      return new Response(file, { status: 200, headers: { "content-type": file.type || "application/octet-stream", "cache-control": `private, max-age=${seconds}`, "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
    },
  }),
});

export default http;
