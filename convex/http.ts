/**
 * The deployment's HTTP endpoints. Only provider webhooks live here, each verified before it is read
 * (convex/lib/builders.ts `providerWebhook`).
 *
 * POST /webhooks/resend         delivery reports, bounces and complaints for email, and email that arrived for the Sales agent. Needs RESEND_WEBHOOK_SECRET.
 * POST /webhooks/telnyx         delivery reports for texts, and texts coming in. Needs TELNYX_PUBLIC_KEY.
 * POST /webhooks/autumn         plan, purchase and balance changes from Autumn. Needs AUTUMN_WEBHOOK_SECRET.
 * GET  /oauth/google/callback   where Google sends an Owner back after they allowed access: the company's
 *                               Google connection (convex/google.ts) or a Gmail hiring inbox, told apart by the state.
 * POST /webhooks/google/calendar  Calendar push notifications, checked against each channel's own secret token.
 * POST /webhooks/google/pubsub    Gmail and Business Profile notifications through Pub/Sub, with Google's signed OIDC token.
 * POST /webhooks/google/leads     Google Ads lead form leads, with the company's lead key.
 */
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { oauthCallback, providerWebhook, signedFileRoute } from "./lib/builders";
import { exchangeCode, googleApp } from "./lib/recruiter/gmail";
import { hashToken, seal } from "./lib/recruiter/secrets";
import { afterConnect, googleRedirectUri } from "./recruiterMailbox";
import { afterGoogle } from "./google";
import { exchange as googleExchange, googleApp as googleConnectApp, identityFrom, redirectUri as googleConnectRedirect } from "./lib/google/oauth";
import { endpoints as googleEndpoints } from "./lib/google/platform";
import { googleKeys, pushData, verifyOidc } from "./lib/google/pubsub";
import { receivedEmailId, verifyWebhook, webhookOutcome } from "./lib/messaging/resend";
import { parseEvent, signingProvider, verifyBody } from "./lib/agreements/signing";
import { photoRequestValid } from "./lib/dispatch/photoLinks";
import { telnyxEvent, verifyTelnyx } from "./lib/messaging/telnyx";
import { parseEvent as parseStripeEvent, verifyStripeSignature } from "./lib/finance/stripe";

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
      // An email that arrived for the Sales agent: the notice has no body, so the message is fetched and filed in the background.
      const received = receivedEmailId(body);
      if (received) {
        await ctx.scheduler.runAfter(0, internal.salesInbound.fetch, { emailId: received });
        return;
      }
      const outcome = webhookOutcome(body);
      if (!outcome) return;
      // The same report delivered twice is recognised by its event id and changes nothing the second time.
      await ctx.runMutation(internal.messaging.receipt, { provider: "resend", eventId: request.headers.get("svix-id")!, providerMessageId: outcome.providerMessageId, outcome: outcome.outcome });
    },
  }),
});

/**
 * Autumn tells Selestial something changed for a customer. The body only says who; the record itself is
 * read back from Autumn, so a webhook can never grant anything by what it claims.
 */
http.route({
  path: "/webhooks/autumn",
  method: "POST",
  handler: providerWebhook({
    verify: async (request, body) => {
      const secret = process.env.AUTUMN_WEBHOOK_SECRET?.trim();
      if (!secret) return false;
      return verifyWebhook({ secret, id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature"), body, now: Date.now() });
    },
    handler: async (ctx, body, request) => {
      let parsed: { type?: unknown; data?: { customer_id?: unknown } } = {};
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        return;
      }
      const customerId = typeof parsed.data?.customer_id === "string" ? parsed.data.customer_id : undefined;
      await ctx.runMutation(internal.billing.webhookReceived, { deliveryId: request.headers.get("svix-id")!, type: typeof parsed.type === "string" ? parsed.type : "unknown", customerId });
    },
  }),
});

/**
 * Stripe Connect: events from the cleaning companies' own Stripe accounts (Finance). The event only says
 * which object changed; financeStripe reads the object back from Stripe, so an event can never set a
 * payment's state by what it claims, and the same event delivered twice changes nothing.
 */
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: providerWebhook({
    verify: async (request, body) => {
      const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
      if (!secret) return false;
      return verifyStripeSignature({ secret, header: request.headers.get("stripe-signature"), body, now: Date.now() });
    },
    handler: async (ctx, body) => {
      const event = parseStripeEvent(body);
      if (!event) return;
      await ctx.runMutation(internal.financeStripe.webhookReceived, { event });
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

http.route({
  path: "/oauth/google/callback",
  method: "GET",
  handler: oauthCallback({
    handler: async (ctx, params) => {
      const state = params.get("state");
      const code = params.get("code");
      // The Owner said no at Google, or the address was not one Google sent: nothing is stored.
      if (!state || state.length > 200) return afterConnect("failed");
      const stateHash = await hashToken(state);
      // The company's Google connection first; a state it does not know belongs to the Gmail inbox flow.
      const google = await ctx.runMutation(internal.google.takeState, { stateHash });
      if (google.kind === "expired") return afterGoogle("expired", google.returnOrigin, google.feature);
      if (google.kind === "ok") {
        const app = googleConnectApp();
        const redirect = googleConnectRedirect();
        if (!code || params.get("error") || !app || !redirect) return afterGoogle(params.get("error") === "access_denied" ? "declined" : "failed", google.returnOrigin, google.features[0]);
        let tokens;
        try {
          tokens = await googleExchange(app, code, redirect);
        } catch {
          return afterGoogle("failed", google.returnOrigin, google.features[0]);
        }
        const who = identityFrom(tokens.idToken);
        if (!who?.email) return afterGoogle("failed", google.returnOrigin, google.features[0]);
        const done = await ctx.runMutation(internal.google.completeConnect, { companyId: google.companyId, memberId: google.memberId, feature: google.features[0], connectionId: google.connectionId, googleSub: who.sub, email: who.email, scopes: tokens.scopes, hasRefreshToken: Boolean(tokens.refreshToken) });
        if (!done.ok) return afterGoogle(done.reason, google.returnOrigin, google.features[0]);
        if (tokens.refreshToken) {
          const sealed = await seal(tokens.refreshToken, done.connectionId);
          if (!sealed) return afterGoogle("failed", google.returnOrigin, google.features[0]);
          await ctx.runMutation(internal.google.storeCredential, { connectionId: done.connectionId, sealedRefreshToken: sealed });
        }
        // Partial consent is kept as it is: only what Google actually granted is switched on.
        const missing = google.features.filter((f) => !done.enabled.includes(f));
        return afterGoogle(missing.length ? `partial:${missing.join(",")}` : "connected", google.returnOrigin, google.features[0]);
      }
      const taken = await ctx.runMutation(internal.recruiterMailbox.takeState, { stateHash });
      if (!taken) return afterConnect("expired");
      const app = googleApp();
      const redirectUri = googleRedirectUri();
      if (!code || params.get("error") || !app || !redirectUri) return afterConnect("failed", taken.returnOrigin);
      const tokens = await exchangeCode(app, code, redirectUri);
      if (!tokens) return afterConnect("failed", taken.returnOrigin);
      const scopes = tokens.scope.split(" ").filter(Boolean);
      if (!scopes.includes("https://www.googleapis.com/auth/gmail.readonly")) return afterConnect("failed", taken.returnOrigin);
      // The mailbox is whichever address the Owner signed in with at Google, read from Gmail itself.
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
        .then((response) => (response.ok ? (response.json() as Promise<{ emailAddress?: string }>) : null))
        .catch(() => null);
      if (!profile?.emailAddress) return afterConnect("failed", taken.returnOrigin);
      const connectionId = await ctx.runMutation(internal.recruiterMailbox.completeConnect, { companyId: taken.companyId, memberId: taken.memberId, address: profile.emailAddress, folder: taken.folder, sources: taken.sources, processFrom: taken.processFrom, canSend: taken.canSend, scopes });
      const sealed = await seal(tokens.refreshToken, connectionId);
      if (!sealed) return afterConnect("failed", taken.returnOrigin);
      await ctx.runMutation(internal.recruiterMailbox.storeCredential, { companyId: taken.companyId, connectionId, sealedRefreshToken: sealed, scopes });
      return afterConnect("connected", taken.returnOrigin);
    },
  }),
});

/** Calendar push: the channel id and token are checked against the stored channel; anything else is ignored. */
http.route({
  path: "/webhooks/google/calendar",
  method: "POST",
  handler: providerWebhook({
    verify: async (request) => /^selestial-[0-9a-f-]{36}$/.test(request.headers.get("x-goog-channel-id") ?? "") && (request.headers.get("x-goog-channel-token") ?? "").length >= 20,
    handler: async (ctx, _body, request) => {
      await ctx.runMutation(internal.googleCalendar.notified, {
        channelId: request.headers.get("x-goog-channel-id")!,
        tokenHash: await hashToken(request.headers.get("x-goog-channel-token")!),
        state: request.headers.get("x-goog-resource-state") ?? "",
        resourceId: request.headers.get("x-goog-resource-id") ?? undefined,
      });
    },
  }),
});

/**
 * Pub/Sub push for Gmail and Business Profile. Only a request carrying Google's signed token for this
 * address and Selestial's push service account is read. A notification only starts a read; the timers
 * catch anything missed.
 */
http.route({
  path: "/webhooks/google/pubsub",
  method: "POST",
  handler: providerWebhook({
    verify: async (request) => {
      const audience = googleEndpoints().pubsubPush;
      const email = process.env.GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT?.trim();
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!audience || !email || !token) return false;
      return (await verifyOidc(token, await googleKeys(), { audience, email })) !== null;
    },
    handler: async (ctx, body) => {
      const message = pushData(body);
      if (!message) return 400;
      const data = message.data as { emailAddress?: unknown; location?: unknown; review?: unknown };
      if (typeof data.emailAddress === "string") await ctx.runMutation(internal.recruiterGmailWatch.notified, { emailAddress: data.emailAddress });
      else if (typeof data.location === "string") await ctx.runMutation(internal.googleBusiness.notified, { location: data.location });
      else if (typeof data.review === "string") await ctx.runMutation(internal.googleBusiness.notified, { location: data.review.replace(/\/reviews\/.*$/, "") });
      // Anything else is acknowledged so Pub/Sub does not redeliver it forever.
    },
  }),
});

/** Google Ads lead forms. The key Google sends must be the company's current key (403 otherwise). */
http.route({
  path: "/webhooks/google/leads",
  method: "POST",
  handler: providerWebhook({
    verify: async (_request, body) => body.length > 0 && body.length < 64 * 1024,
    handler: async (ctx, body) => (await ctx.runMutation(internal.googleAds.leadFormWebhook, { body })).status,
  }),
});

/**
 * POST /webhooks/signature  reports from the e-signature provider. The body must carry a valid
 * `x-selestial-signature` (HMAC-SHA256 of the body with SIGNATURE_WEBHOOK_SECRET). With no secret, or no
 * provider connected, nothing is believed. A report delivered twice is recognised by its event id.
 */
http.route({
  path: "/webhooks/signature",
  method: "POST",
  handler: providerWebhook({
    verify: (request, body) => verifyBody(process.env.SIGNATURE_WEBHOOK_SECRET, request.headers.get("x-selestial-signature"), body),
    handler: async (ctx, body) => {
      const provider = signingProvider();
      const event = parseEvent(body);
      if (!provider || !event) return;
      await ctx.runMutation(internal.agreementSigning.receipt, { provider: provider.name, event });
    },
  }),
});

export default http;
