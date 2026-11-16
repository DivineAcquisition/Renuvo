/**
 * Google for a company, one tool at a time. Drive (with Docs and Sheets), Calendar, Business Profile,
 * Google Ads and Conversions each have their own connection: their own sign-in, Google account, grant,
 * stored token, chosen resources and disconnect. Only the Owner connects, chooses resources or
 * disconnects; anyone in the company can see what is connected.
 *
 * Connecting a tool:
 *  1. `startConnect` makes a one-time state (only its hash is kept, for ten minutes) and returns Google's
 *     consent address for that tool's scopes only.
 *  2. Google returns to /oauth/google/callback (shared with the Gmail inbox). `completeConnect` checks the
 *     state, that the person is still the Owner, and, when reconnecting, that it is the same Google account
 *     unless the Owner chose a different one. The refresh token is sealed before it is stored.
 *  3. The tool is on only if Google granted all of its scopes. Partial consent is recorded as partial.
 *
 * Disconnecting a tool stops that tool's Google steps at once, cancels its queued work, removes what was
 * chosen for it and deletes its token. Google's grant is revoked only when no other connected tool uses
 * the same Google account, because Google revokes per account, not per tool.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { companyQuery, ownerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { activeConnection } from "./lib/google/connection";
import { enabledFeatures, FEATURE_INFO, FEATURES, missingScopes, scopesFor, type Feature } from "./lib/google/features";
import { GoogleError } from "./lib/google/http";
import { consentUrl, googleApp, redirectUri, refresh, revoke } from "./lib/google/oauth";
import { featureValidator, resourceKindValidator } from "./lib/google/schema";
import { appOrigin, returnOrigin } from "./lib/invitations";
import { hashToken, randomToken, secretsConfigured, unseal } from "./lib/recruiter/secrets";

const STATE_LIFE = 10 * 60 * 1000;

export function afterGoogle(outcome: string, origin?: string | null, feature?: string | null): string {
  return `${returnOrigin(origin) ?? appOrigin() ?? ""}/app/settings/integrations?${feature ? `tool=${encodeURIComponent(feature)}&` : ""}result=${encodeURIComponent(outcome)}`;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const tools = [];
    const allResources = [];
    for (const feature of FEATURES) {
      const connection = await activeConnection(ctx, ctx.companyId, feature);
      const resources = connection ? await ctx.db.query("googleResources").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).take(200) : [];
      const shaped = resources.map((r) => ({ id: r._id, kind: r.kind, externalId: r.externalId, label: r.label, purpose: r.purpose ?? null, detail: r.detail ?? null, access: r.access, accessNote: r.accessNote ?? null, verifiedAt: r.verifiedAt ?? null }));
      allResources.push(...shaped);
      tools.push({
        feature,
        label: FEATURE_INFO[feature].label,
        does: FEATURE_INFO[feature].does,
        connection: connection ? { id: connection._id, email: connection.email, status: connection.status, problem: connection.problem ?? null, connectedAt: connection.connectedAt, lastRefreshAt: connection.lastRefreshAt ?? null } : null,
        granted: connection?.status === "connected" && enabledFeatures(connection.grantedScopes).includes(feature),
        missing: connection ? missingScopes(feature, connection.grantedScopes) : [...FEATURE_INFO[feature].scopes],
        resources: shaped,
      });
    }
    return {
      canManage: ctx.role === "owner",
      ready: googleApp() !== null && redirectUri() !== null && (await secretsConfigured()),
      tools,
      resources: allResources,
    };
  },
});

// ── Connecting ──────────────────────────────────────────────────────────────────────────────────

export const startConnect = ownerMutation({
  args: { feature: featureValidator, differentAccount: v.optional(v.boolean()), returnTo: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const app = googleApp();
    const redirect = redirectUri();
    if (!app || !redirect) throw userError("Connecting Google isn’t available yet. Please try again a little later.");
    if (!(await secretsConfigured())) throw userError("Connecting Google isn’t available yet. Please try again a little later.");
    const existing = await activeConnection(ctx, ctx.companyId, args.feature);
    // Reconnecting keeps the same Google account; "a different account" replaces it.
    const same = existing && !args.differentAccount ? existing : null;
    const state = await randomToken();
    await ctx.db.insert("googleOAuthStates", { companyId: ctx.companyId, memberId: ctx.member._id, stateHash: await hashToken(state), features: [args.feature], connectionId: same?._id, returnOrigin: returnOrigin(args.returnTo) ?? undefined, expiresAt: Date.now() + STATE_LIFE });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.connect_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { feature: args.feature, differentAccount: Boolean(args.differentAccount) } });
    return { url: consentUrl(app, { redirectUri: redirect, state, scopes: scopesFor([args.feature]), loginHint: same?.email, selectAccount: !same }) };
  },
});

/** Uses a state once. `unknown` lets the shared callback hand it to the Gmail inbox flow instead. */
export const takeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("googleOAuthStates").withIndex("by_stateHash", (q) => q.eq("stateHash", args.stateHash)).unique();
    if (!row) return { kind: "unknown" as const };
    if (row.usedAt !== undefined || row.expiresAt <= Date.now()) {
      await ctx.db.patch(row._id, { usedAt: row.usedAt ?? Date.now() });
      return { kind: "expired" as const, returnOrigin: row.returnOrigin ?? null, feature: row.features[0] ?? null };
    }
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    const member = await ctx.db.get(row.memberId);
    if (!member || member.companyId !== row.companyId || member.status !== "active" || member.role !== "owner") return { kind: "expired" as const, returnOrigin: row.returnOrigin ?? null, feature: row.features[0] ?? null };
    return { kind: "ok" as const, companyId: row.companyId, memberId: row.memberId, features: row.features, connectionId: row.connectionId ?? null, returnOrigin: row.returnOrigin ?? null };
  },
});

/**
 * Records what Google granted for one tool. Reconnecting must be the same Google account; a different
 * account replaces the tool's connection only when the Owner chose "use a different account", and the old
 * connection's resources and work stop. Other tools are not touched.
 */
export const completeConnect = internalMutation({
  args: { companyId: v.id("companies"), memberId: v.id("members"), feature: featureValidator, connectionId: v.union(v.id("googleConnections"), v.null()), googleSub: v.string(), email: v.string(), scopes: v.array(v.string()), hasRefreshToken: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: true; connectionId: Id<"googleConnections">; enabled: Feature[] } | { ok: false; reason: string }> => {
    const now = Date.now();
    const enabled = missingScopes(args.feature, args.scopes).length === 0 ? [args.feature] : [];
    const current = await activeConnection(ctx, args.companyId, args.feature);
    if (args.connectionId) {
      const target = await ctx.db.get(args.connectionId);
      if (!target || target.companyId !== args.companyId || target.status === "disconnected" || target.feature !== args.feature) return { ok: false, reason: "expired" };
      if (target.googleSub !== args.googleSub) return { ok: false, reason: "different_account" };
      if (!args.hasRefreshToken) return { ok: false, reason: "no_refresh_token" };
      await ctx.db.patch(target._id, { grantedScopes: args.scopes, status: "connected", problem: undefined, lastRefreshAt: now });
      await recordEvent(ctx, { companyId: args.companyId, type: "google.reconnected", actor: { kind: "member", memberId: args.memberId }, subject: { table: "companies", id: args.companyId }, data: { feature: args.feature, granted: enabled.length > 0 } });
      return { ok: true, connectionId: target._id, enabled };
    }
    if (!args.hasRefreshToken) return { ok: false, reason: "no_refresh_token" };
    if (current) await stopConnection(ctx, current, "Replaced by a connection to a different Google account.");
    const connectionId = await ctx.db.insert("googleConnections", { companyId: args.companyId, feature: args.feature, googleSub: args.googleSub, email: args.email.toLowerCase(), status: "connected", grantedScopes: args.scopes, connectedBy: args.memberId, connectedAt: now, lastRefreshAt: now });
    await recordEvent(ctx, { companyId: args.companyId, type: "google.connected", actor: { kind: "member", memberId: args.memberId }, subject: { table: "companies", id: args.companyId }, data: { feature: args.feature, partial: enabled.length === 0 } });
    return { ok: true, connectionId, enabled };
  },
});

export const storeCredential = internalMutation({
  args: { connectionId: v.id("googleConnections"), sealedRefreshToken: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === "disconnected") return null;
    for (const row of await ctx.db.query("googleCredentials").withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId)).take(10)) await ctx.db.delete(row._id);
    await ctx.db.insert("googleCredentials", { companyId: connection.companyId, connectionId: connection._id, sealedRefreshToken: args.sealedRefreshToken, createdAt: Date.now() });
    return null;
  },
});

// ── Disconnecting ───────────────────────────────────────────────────────────────────────────────

async function stopConnection(ctx: MutationCtx, connection: Doc<"googleConnections">, why: string) {
  const db = ctx.db;
  await db.patch(connection._id, { status: "disconnected", disconnectedAt: Date.now(), problem: why });
  // Queued and waiting work for this connection is cancelled, so nothing reaches Google after this.
  for (const status of ["queued", "uncertain"] as const) {
    const rows = await db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", connection.companyId).eq("status", status)).take(500);
    for (const job of rows) if (job.connectionId === connection._id) await db.patch(job._id, { status: "cancelled", lastError: "Google was disconnected.", updatedAt: Date.now() });
  }
  for (const watch of await db.query("googleWatches").withIndex("by_company", (q) => q.eq("companyId", connection.companyId)).take(100)) if (watch.connectionId === connection._id) await db.delete(watch._id);
  for (const resource of await db.query("googleResources").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).take(500)) await db.delete(resource._id);
}

export const disconnect = ownerMutation({
  args: { feature: featureValidator },
  handler: async (ctx, args) => {
    const connection = await activeConnection(ctx, ctx.companyId, args.feature);
    if (!connection) throw userError(`${FEATURE_INFO[args.feature].label} is not connected.`);
    await stopConnection(ctx, connection, "Disconnected by the Owner.");
    const credential = await ctx.db.query("googleCredentials").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).first();
    // Google revokes a whole account's grant to Selestial, not one tool's. While another connected tool uses
    // the same account, only this tool's token is deleted; the last one to go also revokes at Google.
    const shared = (await ctx.db.query("googleConnections").withIndex("by_sub", (q) => q.eq("googleSub", connection.googleSub)).take(100)).some((row) => row._id !== connection._id && row.status !== "disconnected");
    if (credential) {
      if (!shared) await ctx.scheduler.runAfter(0, internal.google.revokeGrant, { connectionId: connection._id, sealedRefreshToken: credential.sealedRefreshToken });
      await ctx.db.delete(credential._id);
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.disconnected", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { feature: args.feature, revokedAtGoogle: !shared } });
    return { stopped: true, revokedAtGoogle: !shared };
  },
});

export const revokeGrant = internalAction({
  args: { connectionId: v.id("googleConnections"), sealedRefreshToken: v.string() },
  handler: async (_ctx, args) => {
    const token = await unseal(args.sealedRefreshToken, args.connectionId);
    if (token) await revoke(token);
    return null;
  },
});

// ── Tokens, for Google steps only ───────────────────────────────────────────────────────────────

export const credentialFor = internalQuery({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "connected") return null;
    const row = await ctx.db.query("googleCredentials").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).first();
    return row ? { sealedRefreshToken: row.sealedRefreshToken, companyId: connection.companyId, grantedScopes: connection.grantedScopes } : null;
  },
});

export const markRefreshed = internalMutation({
  args: { connectionId: v.id("googleConnections"), scopes: v.array(v.string()) },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "connected") return null;
    // Google returns the scopes still granted. A scope the account removed in its Google settings is removed here too.
    await ctx.db.patch(connection._id, { lastRefreshAt: Date.now(), ...(args.scopes.length ? { grantedScopes: args.scopes } : {}) });
    return null;
  },
});

export const markExpired = internalMutation({
  args: { connectionId: v.id("googleConnections"), why: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "connected") return null;
    await ctx.db.patch(connection._id, { status: "expired", problem: args.why.slice(0, 300) });
    await recordEvent(ctx, { companyId: connection.companyId, type: "google.expired", actor: { kind: "system" }, subject: { table: "companies", id: connection.companyId } });
    return null;
  },
});

/** An access token for one connection, or why there is none. For use inside actions only. */
export async function accessTokenFor(ctx: ActionCtx, connectionId: Id<"googleConnections">): Promise<{ ok: true; token: string; companyId: Id<"companies">; scopes: string[] } | { ok: false; why: string; kind: "not_connected" | "auth" | "not_configured" | "server" }> {
  const app = googleApp();
  if (!app) return { ok: false, why: "Google isn’t available right now.", kind: "not_configured" };
  const credential = await ctx.runQuery(internal.google.credentialFor, { connectionId });
  if (!credential) return { ok: false, why: "Google is not connected.", kind: "not_connected" };
  const refreshToken = await unseal(credential.sealedRefreshToken, connectionId);
  if (!refreshToken) return { ok: false, why: "Google needs to be reconnected.", kind: "not_configured" };
  try {
    const fresh = await refresh(app, refreshToken);
    await ctx.runMutation(internal.google.markRefreshed, { connectionId, scopes: fresh.scopes });
    return { ok: true, token: fresh.accessToken, companyId: credential.companyId, scopes: fresh.scopes.length ? fresh.scopes : credential.grantedScopes };
  } catch (error) {
    if (error instanceof GoogleError && error.kind === "auth") {
      await ctx.runMutation(internal.google.markExpired, { connectionId, why: error.message });
      return { ok: false, why: error.message, kind: "auth" };
    }
    return { ok: false, why: error instanceof Error ? error.message : "Google did not answer.", kind: "server" };
  }
}

// ── Resources the Owner authorizes ──────────────────────────────────────────────────────────────

const RESOURCE_FEATURE: Record<Doc<"googleResources">["kind"], Feature> = {
  drive_source: "drive",
  drive_output: "drive",
  calendar_sync: "calendar",
  calendar_busy: "calendar",
  business_location: "business_profile",
  ads_account: "ads",
  conversion_destination: "conversions",
};

export const addResource = ownerMutation({
  args: { kind: resourceKindValidator, externalId: v.string(), label: v.string(), purpose: v.optional(v.string()), detail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const feature = RESOURCE_FEATURE[args.kind];
    const connection = await activeConnection(ctx, ctx.companyId, feature);
    if (!connection || connection.status !== "connected") throw userError(`Connect ${FEATURE_INFO[feature].label} first.`);
    if (!enabledFeatures(connection.grantedScopes).includes(feature)) throw userError(`${FEATURE_INFO[feature].label} is not granted yet. Reconnect it and allow everything Google asks for.`);
    const externalId = args.externalId.trim();
    if (!externalId || externalId.length > 300 || !/^[\w@.:/\-+=#%]+$/.test(externalId)) throw userError("That is not a Google id Selestial can use.");
    if (args.kind === "calendar_sync") {
      // One calendar receives visits and interviews; choosing another replaces it.
      for (const old of await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", "calendar_sync")).take(10)) await ctx.db.delete(old._id);
    }
    const existing = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", args.kind)).take(200)).find((r) => r.externalId === externalId && (r.purpose ?? "") === (args.purpose ?? ""));
    if (existing) return existing._id;
    const id = await ctx.db.insert("googleResources", { companyId: ctx.companyId, connectionId: connection._id, kind: args.kind, externalId, label: args.label.trim().slice(0, 200) || externalId, purpose: args.purpose?.trim().slice(0, 60) || undefined, detail: args.detail?.trim().slice(0, 200) || undefined, access: "unverified", addedBy: ctx.member._id, createdAt: Date.now() });
    // Choosing something is not proof Selestial can reach it: it is checked against Google straight away.
    await ctx.scheduler.runAfter(0, internal.googleWork.verifyResource, { resourceId: id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.resource_added", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { kind: args.kind } });
    return id;
  },
});

export const removeResource = ownerMutation({
  args: { resourceId: v.id("googleResources") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.resourceId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    await ctx.db.delete(row._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.resource_removed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { kind: row.kind } });
    return null;
  },
});

export const resourceFor = internalQuery({
  args: { resourceId: v.id("googleResources") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.resourceId);
    if (!row) return null;
    const connection = await ctx.db.get(row.connectionId);
    return connection && connection.status === "connected" ? row : null;
  },
});

export const setResourceAccess = internalMutation({
  args: { resourceId: v.id("googleResources"), access: v.union(v.literal("verified"), v.literal("lost")), note: v.optional(v.string()), detail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.resourceId);
    if (!row) return null;
    await ctx.db.patch(row._id, { access: args.access, accessNote: args.note?.slice(0, 300), verifiedAt: Date.now(), ...(args.detail ? { detail: args.detail.slice(0, 200) } : {}) });
    return null;
  },
});


// ── What the Owner can choose from ──────────────────────────────────────────────────────────────

const choiceKind = v.union(v.literal("calendars"), v.literal("locations"), v.literal("ads_accounts"), v.literal("folder_contents"), v.literal("conversion_actions"));

/** Asks Google, as the company, what can be chosen. The answer lands in `choices`. */
const CHOICE_FEATURE = { calendars: "calendar", locations: "business_profile", ads_accounts: "ads", folder_contents: "drive", conversion_actions: "ads" } as const;

export const refreshChoices = ownerMutation({
  args: { kind: choiceKind, scope: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const feature = CHOICE_FEATURE[args.kind];
    const connection = await activeConnection(ctx, ctx.companyId, feature);
    if (!connection || connection.status !== "connected") throw userError(`Connect ${FEATURE_INFO[feature].label} first.`);
    await ctx.scheduler.runAfter(0, internal.googleWork.listChoices, { connectionId: connection._id, kind: args.kind, scope: args.scope });
    return null;
  },
});

export const choices = companyQuery({
  args: { kind: choiceKind },
  handler: async (ctx, args) => {
    if (ctx.role !== "owner") return null;
    const row = await ctx.db.query("googleChoices").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", args.kind)).first();
    return row ? { items: row.items, problem: row.problem ?? null, fetchedAt: row.fetchedAt, scope: row.scope ?? null } : null;
  },
});

/**
 * One-time move from the single shared connection to one per tool: a row made before then becomes the
 * connection of the first tool it fully granted (its token and resources stay with it). Other tools are
 * connected again on their own. Safe to run more than once.
 */
export const migrateToPerTool = internalMutation({
  args: {},
  handler: async (ctx) => {
    let moved = 0;
    for (const row of await ctx.db.query("googleConnections").take(1000)) {
      if (row.feature) continue;
      const feature = enabledFeatures(row.grantedScopes)[0];
      if (feature && !(await activeConnection(ctx, row.companyId, feature))) await ctx.db.patch(row._id, { feature });
      else {
        await stopConnection(ctx, row, "Google is now connected tool by tool. Connect this tool again.");
        for (const credential of await ctx.db.query("googleCredentials").withIndex("by_connection", (q) => q.eq("connectionId", row._id)).take(5)) await ctx.db.delete(credential._id);
      }
      moved += 1;
    }
    return moved;
  },
});
