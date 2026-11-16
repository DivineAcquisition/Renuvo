/**
 * The deployment's HTTP endpoints. Only provider webhooks live here, each verified before it is read
 * (convex/lib/builders.ts `providerWebhook`).
 *
 * POST /webhooks/resend         delivery reports, bounces and complaints for email. Needs RESEND_WEBHOOK_SECRET.
 * GET  /oauth/google/callback   where Google sends an Owner back after they allowed Gmail access.
 */
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { oauthCallback, providerWebhook } from "./lib/builders";
import { exchangeCode, googleApp } from "./lib/recruiter/gmail";
import { hashToken, seal } from "./lib/recruiter/secrets";
import { afterConnect, googleRedirectUri } from "./recruiterMailbox";
import { verifyWebhook, webhookOutcome } from "./lib/messaging/resend";

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
  path: "/oauth/google/callback",
  method: "GET",
  handler: oauthCallback({
    handler: async (ctx, params) => {
      const state = params.get("state");
      const code = params.get("code");
      // The Owner said no at Google, or the address was not one Google sent: nothing is stored.
      if (!state || state.length > 200) return afterConnect("failed");
      const taken = await ctx.runMutation(internal.recruiterMailbox.takeState, { stateHash: await hashToken(state) });
      if (!taken) return afterConnect("expired");
      const app = googleApp();
      const redirectUri = googleRedirectUri();
      if (!code || params.get("error") || !app || !redirectUri) return afterConnect("failed");
      const tokens = await exchangeCode(app, code, redirectUri);
      if (!tokens) return afterConnect("failed");
      const scopes = tokens.scope.split(" ").filter(Boolean);
      if (!scopes.includes("https://www.googleapis.com/auth/gmail.readonly")) return afterConnect("failed");
      // The mailbox is whichever address the Owner signed in with at Google, read from Gmail itself.
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.accessToken}` } })
        .then((response) => (response.ok ? (response.json() as Promise<{ emailAddress?: string }>) : null))
        .catch(() => null);
      if (!profile?.emailAddress) return afterConnect("failed");
      const connectionId = await ctx.runMutation(internal.recruiterMailbox.completeConnect, { companyId: taken.companyId, memberId: taken.memberId, address: profile.emailAddress, folder: taken.folder, sources: taken.sources, processFrom: taken.processFrom, canSend: taken.canSend, scopes });
      const sealed = await seal(tokens.refreshToken, connectionId);
      if (!sealed) return afterConnect("failed");
      await ctx.runMutation(internal.recruiterMailbox.storeCredential, { companyId: taken.companyId, connectionId, sealedRefreshToken: sealed, scopes });
      return afterConnect("connected");
    },
  }),
});

export default http;
