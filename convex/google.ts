/**
 * Settings › Integrations › Your Google account: connecting a company's Google account, choosing what Selestial may use,
 * and disconnecting. Only the Owner connects, adds permissions, chooses resources or disconnects; anyone
 * in the company can see what is connected.
 *
 * Connecting:
 *  1. `startConnect` makes a one-time state (only its hash is kept, for ten minutes) and returns Google's
 *     consent address for just the features asked for. Google adds them to what was granted before.
 *  2. Google returns to /oauth/google/callback (shared with the Gmail inbox). `completeConnect` checks the
 *     state, that the person is still the Owner, and, when adding to an existing connection, that it is
 *     the same Google account. The refresh token is sealed before it is stored.
 *  3. Only features whose scopes Google actually granted are turned on. Partial consent is recorded as
 *     partial.
 *
 * Disconnecting stops every Google step at once (each one checks the connection first), cancels queued
 * work, deletes the stored token and asks Google to revoke the grant.
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
import { endpoints, platformStatus } from "./lib/google/platform";
import { featureValidator, resourceKindValidator } from "./lib/google/schema";
import { appOrigin } from "./lib/invitations";
import { hashToken, randomToken, secretsConfigured, unseal } from "./lib/recruiter/secrets";

const STATE_LIFE = 10 * 60 * 1000;

export function afterGoogle(outcome: string): string {
  return `${appOrigin() ?? ""}/app/settings/integrations?google=1&result=${encodeURIComponent(outcome)}#google`;
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const connection = await activeConnection(ctx, ctx.companyId);
    const resources = connection ? await ctx.db.query("googleResources").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).take(200) : [];
    const enabled = connection ? enabledFeatures(connection.grantedScopes) : [];
    const jobs = await ctx.db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "failed")).order("desc").take(5);
    const uncertain = await ctx.db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "uncertain")).order("desc").take(5);
    return {
      canManage: ctx.role === "owner",
      ready: googleApp() !== null && redirectUri() !== null && (await secretsConfigured()),
      connection: connection
        ? { id: connection._id, email: connection.email, status: connection.status, problem: connection.problem ?? null, connectedAt: connection.connectedAt, lastRefreshAt: connection.lastRefreshAt ?? null }
        : null,
      features: FEATURES.map((feature) => ({
        feature,
        label: FEATURE_INFO[feature].label,
        does: FEATURE_INFO[feature].does,
        granted: enabled.includes(feature),
        missing: connection ? missingScopes(feature, connection.grantedScopes) : [...FEATURE_INFO[feature].scopes],
        needsPlatform: FEATURE_INFO[feature].needsPlatform ?? [],
      })),
      resources: resources.map((r) => ({ id: r._id, kind: r.kind, externalId: r.externalId, label: r.label, purpose: r.purpose ?? null, detail: r.detail ?? null, access: r.access, accessNote: r.accessNote ?? null, verifiedAt: r.verifiedAt ?? null })),
      // Only the Owner sees which platform settings are missing; it is setup information, not company data.
      platform: ctx.role === "owner" ? platformStatus() : [],
      endpoints: ctx.role === "owner" ? endpoints() : null,
      problems: [...jobs, ...uncertain].map((job) => ({ kind: job.kind, status: job.status, error: job.lastError ?? null, at: job.updatedAt })),
    };
  },
});

// ── Connecting ──────────────────────────────────────────────────────────────────────────────────

export const startConnect = ownerMutation({
  args: { features: v.array(featureValidator), differentAccount: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const app = googleApp();
    const redirect = redirectUri();
    if (!app || !redirect) throw userError("Connecting Google is not set up on this deployment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and the site address are needed.");
    if (!(await secretsConfigured())) throw userError("Connecting Google is not set up on this deployment: MAILBOX_TOKEN_KEY, the key that protects stored authorizations, is missing.");
    const features = [...new Set(args.features)];
    if (features.length === 0) throw userError("Choose at least one thing to connect.");
    const existing = await activeConnection(ctx, ctx.companyId);
    const adding = existing && !args.differentAccount ? existing : null;
    // Ask only for what is not granted yet; Google keeps the rest (include_granted_scopes).
    const wanted = adding ? features.filter((f) => missingScopes(f, adding.grantedScopes).length > 0) : features;
    if (adding && wanted.length === 0 && adding.status === "connected") throw userError("Those are already connected.");
    const state = await randomToken();
    await ctx.db.insert("googleOAuthStates", { companyId: ctx.companyId, memberId: ctx.member._id, stateHash: await hashToken(state), features: adding && wanted.length ? wanted : features, connectionId: adding?._id, expiresAt: Date.now() + STATE_LIFE });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.connect_started", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { features: features.join(","), differentAccount: Boolean(args.differentAccount) } });
    return { url: consentUrl(app, { redirectUri: redirect, state, scopes: scopesFor(adding && wanted.length ? wanted : features), loginHint: adding?.email, selectAccount: Boolean(args.differentAccount) || !adding }) };
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
      return { kind: "expired" as const };
    }
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    const member = await ctx.db.get(row.memberId);
    if (!member || member.companyId !== row.companyId || member.status !== "active" || member.role !== "owner") return { kind: "expired" as const };
    return { kind: "ok" as const, companyId: row.companyId, memberId: row.memberId, features: row.features, connectionId: row.connectionId ?? null };
  },
});

/**
 * Records what Google granted. Adding to a connection must be the same Google account; a different
 * account replaces the old connection only when the Owner chose "use a different account" (no
 * connectionId on the state), and the old one's resources and work stop.
 */
export const completeConnect = internalMutation({
  args: { companyId: v.id("companies"), memberId: v.id("members"), connectionId: v.union(v.id("googleConnections"), v.null()), googleSub: v.string(), email: v.string(), scopes: v.array(v.string()), hasRefreshToken: v.boolean() },
  handler: async (ctx, args): Promise<{ ok: true; connectionId: Id<"googleConnections">; enabled: Feature[] } | { ok: false; reason: string }> => {
    const now = Date.now();
    const current = await activeConnection(ctx, args.companyId);
    if (args.connectionId) {
      const target = await ctx.db.get(args.connectionId);
      if (!target || target.companyId !== args.companyId || target.status === "disconnected") return { ok: false, reason: "expired" };
      if (target.googleSub !== args.googleSub) return { ok: false, reason: "different_account" };
      const granted = [...new Set([...target.grantedScopes, ...args.scopes])];
      await ctx.db.patch(target._id, { grantedScopes: granted, status: "connected", problem: undefined, lastRefreshAt: now });
      await recordEvent(ctx, { companyId: args.companyId, type: "google.permissions_added", actor: { kind: "member", memberId: args.memberId }, subject: { table: "companies", id: args.companyId }, data: { enabled: enabledFeatures(granted).join(",") } });
      return { ok: true, connectionId: target._id, enabled: enabledFeatures(granted) };
    }
    if (!args.hasRefreshToken) return { ok: false, reason: "no_refresh_token" };
    if (current) await stopConnection(ctx, current, "Replaced by a connection to a different Google account.");
    const connectionId = await ctx.db.insert("googleConnections", { companyId: args.companyId, googleSub: args.googleSub, email: args.email.toLowerCase(), status: "connected", grantedScopes: args.scopes, connectedBy: args.memberId, connectedAt: now, lastRefreshAt: now });
    await recordEvent(ctx, { companyId: args.companyId, type: "google.connected", actor: { kind: "member", memberId: args.memberId }, subject: { table: "companies", id: args.companyId }, data: { enabled: enabledFeatures(args.scopes).join(","), partial: enabledFeatures(args.scopes).length === 0 } });
    return { ok: true, connectionId, enabled: enabledFeatures(args.scopes) };
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
  args: {},
  handler: async (ctx) => {
    const connection = await activeConnection(ctx, ctx.companyId);
    if (!connection) throw userError("Google is not connected.");
    await stopConnection(ctx, connection, "Disconnected by the Owner.");
    const credential = await ctx.db.query("googleCredentials").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).first();
    // The sealed token is handed to the revoke step and deleted here, so nothing else can use it.
    if (credential) {
      await ctx.scheduler.runAfter(0, internal.google.revokeGrant, { connectionId: connection._id, sealedRefreshToken: credential.sealedRefreshToken });
      await ctx.db.delete(credential._id);
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.disconnected", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return { stopped: true };
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
  if (!app) return { ok: false, why: "Google is not set up on this deployment.", kind: "not_configured" };
  const credential = await ctx.runQuery(internal.google.credentialFor, { connectionId });
  if (!credential) return { ok: false, why: "Google is not connected.", kind: "not_connected" };
  const refreshToken = await unseal(credential.sealedRefreshToken, connectionId);
  if (!refreshToken) return { ok: false, why: "The stored authorization cannot be read on this deployment (the encryption key changed). Reconnect Google.", kind: "not_configured" };
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
    const connection = await activeConnection(ctx, ctx.companyId);
    if (!connection || connection.status !== "connected") throw userError("Connect Google first.");
    const feature = RESOURCE_FEATURE[args.kind];
    if (!enabledFeatures(connection.grantedScopes).includes(feature)) throw userError(`${FEATURE_INFO[feature].label} is not granted yet. Add it first.`);
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

const choiceKind = v.union(v.literal("calendars"), v.literal("locations"), v.literal("ads_accounts"), v.literal("folder_contents"));

/** Asks Google, as the company, what can be chosen. The answer lands in `choices`. */
export const refreshChoices = ownerMutation({
  args: { kind: choiceKind, scope: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const connection = await activeConnection(ctx, ctx.companyId);
    if (!connection || connection.status !== "connected") throw userError("Connect Google first.");
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
