/**
 * The worker for Google jobs (googleJobs). A cron claims due jobs; each runs as its own action, checks the
 * connection is still connected before it touches Google, and settles with one honest status.
 *
 *  - Bounded retries with backoff for rate limits and Google outages (MAX_ATTEMPTS).
 *  - A write whose answer was lost is "uncertain": its next run first looks the effect up by its key
 *    (reconcile) and only then, if it really did not happen, tries again.
 *  - A job whose worker stopped reporting is swept: a read is queued again, a write becomes uncertain.
 *  - Disconnecting cancels queued jobs; a running job finds the connection gone and stops.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { accessTokenFor } from "./google";
import { recordEvent } from "./lib/events";
import { listCalendars } from "./lib/google/calendar";
import { accounts as businessAccounts, locations as businessLocations } from "./lib/google/business";
import { accessibleCustomers, search as adsSearch } from "./lib/google/ads";
import { FOLDER, getFile, listChildren } from "./lib/google/drive";
import { GoogleError, plainProblem } from "./lib/google/http";
import { backoff, MAX_ATTEMPTS } from "./lib/google/jobs";
import { adsDeveloperToken } from "./lib/google/platform";
import { allow } from "./lib/rateLimit";
import { EXECUTORS } from "./googleExecutors";

const STUCK_MS = 15 * 60 * 1000;
const READS: Doc<"googleJobs">["kind"][] = ["calendar_sync", "lsa_poll", "knowledge_import"];

export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let started = 0;
    for (const status of ["queued", "uncertain"] as const) {
      const due = await ctx.db.query("googleJobs").withIndex("by_status_next", (q) => q.eq("status", status).lte("nextAt", now)).take(25);
      for (const job of due) {
        // A company's Google work is paced, so one busy company cannot exhaust the shared quota.
        if (!(await allow(ctx, `google.jobs:${job.companyId}`, 30, 60_000))) {
          await ctx.db.patch(job._id, { nextAt: now + 60_000 });
          continue;
        }
        await ctx.db.patch(job._id, { status: "running", attempts: job.attempts + 1, checkpoint: status === "uncertain" ? "reconcile" : job.checkpoint, updatedAt: now });
        await ctx.scheduler.runAfter(0, internal.googleWork.run, { jobId: job._id });
        started += 1;
      }
    }
    const stuck = await ctx.db.query("googleJobs").withIndex("by_status_next", (q) => q.eq("status", "running")).take(100);
    for (const job of stuck) {
      if (job.updatedAt > now - STUCK_MS) continue;
      await ctx.db.patch(job._id, READS.includes(job.kind) ? { status: "queued", nextAt: now, lastError: "The worker stopped reporting; tried again.", updatedAt: now } : { status: "uncertain", nextAt: now + 60_000, lastError: "The worker stopped reporting, so it is not known whether this happened. It will be checked before anything is retried.", updatedAt: now });
    }
    return started;
  },
});

export const load = internalQuery({
  args: { jobId: v.id("googleJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null;
    const connection = job.connectionId ? await ctx.db.get(job.connectionId) : null;
    return { job, connected: !job.connectionId || connection?.status === "connected" };
  },
});

export const finish = internalMutation({
  args: { jobId: v.id("googleJobs"), outcome: v.union(v.literal("done"), v.literal("retry"), v.literal("uncertain"), v.literal("failed"), v.literal("cancelled")), result: v.optional(v.string()), providerRef: v.optional(v.string()), error: v.optional(v.string()), retryAfterMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null;
    const now = Date.now();
    const base = { updatedAt: now, ...(args.providerRef ? { providerRef: args.providerRef } : {}), ...(args.result ? { result: args.result.slice(0, 20_000) } : {}) };
    if (args.outcome === "done") await ctx.db.patch(job._id, { ...base, status: "done", checkpoint: undefined, lastError: undefined });
    else if (args.outcome === "cancelled") await ctx.db.patch(job._id, { ...base, status: "cancelled", lastError: args.error?.slice(0, 500) });
    else if (args.outcome === "failed" || job.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(job._id, { ...base, status: "failed", lastError: (args.outcome === "failed" ? args.error : `Gave up after ${job.attempts} attempts: ${args.error ?? ""}`)?.slice(0, 500) });
      await recordEvent(ctx, { companyId: job.companyId, type: "google.job_failed", actor: { kind: "system" }, subject: { table: "companies", id: job.companyId }, data: { kind: job.kind } });
    } else if (args.outcome === "uncertain") await ctx.db.patch(job._id, { ...base, status: "uncertain", nextAt: now + backoff(job.attempts, args.retryAfterMs), lastError: args.error?.slice(0, 500) });
    else await ctx.db.patch(job._id, { ...base, status: "queued", nextAt: now + backoff(job.attempts, args.retryAfterMs), lastError: args.error?.slice(0, 500) });
    return null;
  },
});

/** Kinds that use Selestial's own credentials, not the company's grant. */
const PLATFORM_KINDS: Doc<"googleJobs">["kind"][] = ["route_proposal", "travel_refresh"];

export const run = internalAction({
  args: { jobId: v.id("googleJobs") },
  handler: async (ctx, args): Promise<null> => {
    const loaded = await ctx.runQuery(internal.googleWork.load, args);
    if (!loaded) return null;
    const { job } = loaded;
    if (!loaded.connected) {
      await ctx.runMutation(internal.googleWork.finish, { jobId: job._id, outcome: "cancelled", error: "Google is no longer connected." });
      return null;
    }
    let token: string | null = null;
    if (job.connectionId && !PLATFORM_KINDS.includes(job.kind)) {
      const access = await accessTokenFor(ctx, job.connectionId);
      if (!access.ok) {
        await ctx.runMutation(internal.googleWork.finish, { jobId: job._id, outcome: access.kind === "server" ? "retry" : "cancelled", error: access.why });
        return null;
      }
      token = access.token;
    }
    const executor = EXECUTORS[job.kind];
    try {
      const out = await executor(ctx, { job, token, payload: JSON.parse(job.payload) as Record<string, unknown>, reconcile: job.checkpoint === "reconcile" });
      await ctx.runMutation(internal.googleWork.finish, { jobId: job._id, outcome: out.outcome ?? "done", result: out.result ? JSON.stringify(out.result) : undefined, providerRef: out.providerRef, error: out.error });
    } catch (error) {
      if (error instanceof GoogleError) {
        const outcome = error.kind === "uncertain" ? "uncertain" : error.retryable ? "retry" : "failed";
        await ctx.runMutation(internal.googleWork.finish, { jobId: job._id, outcome, error: error.message, retryAfterMs: error.retryAfterMs });
      } else {
        await ctx.runMutation(internal.googleWork.finish, { jobId: job._id, outcome: "retry", error: error instanceof Error ? error.message.slice(0, 300) : "Unexpected failure." });
      }
    }
    return null;
  },
});

// ── Checking a chosen resource, and listing what the Owner can choose ───────────────────────────

/** Choosing a resource is not proof of access: Selestial asks Google for it, as the company, and records what it found. */
export const verifyResource = internalAction({
  args: { resourceId: v.id("googleResources") },
  handler: async (ctx, args): Promise<null> => {
    const resource = await ctx.runQuery(internal.google.resourceFor, args);
    if (!resource) return null;
    const access = await accessTokenFor(ctx, resource.connectionId);
    if (!access.ok) {
      await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "lost", note: "Google access ended. Reconnect to continue." });
      return null;
    }
    try {
      if (resource.kind === "drive_source" || resource.kind === "drive_output") {
        const file = await getFile(access.token, resource.externalId);
        if (file.trashed) throw new GoogleError("not_found", "It’s in the trash.");
        if (resource.kind === "drive_output" && file.mimeType === FOLDER && file.capabilities?.canAddChildren === false) throw new GoogleError("forbidden", "Your Google account can’t add files to this folder.");
        if (file.mimeType === FOLDER) {
          const children = await listChildren(access.token, file.id);
          const note = resource.kind === "drive_source" ? (children.length ? `Ready. Selestial can read ${children.length} file${children.length === 1 ? "" : "s"} here.` : "Ready. To let Selestial read files already in this folder, pick them too.") : "Ready. Selestial can save files here.";
          await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "verified", note, detail: file.mimeType });
        } else await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "verified", note: file.capabilities?.canDownload === false ? "Its owner doesn’t allow downloads, so Selestial can’t read it." : "Ready.", detail: file.mimeType });
      } else if (resource.kind === "calendar_sync" || resource.kind === "calendar_busy") {
        const calendars = await listCalendars(access.token);
        const found = calendars.find((c) => c.id === resource.externalId);
        if (!found) throw new GoogleError("not_found", "This calendar isn’t in your Google account.");
        if (resource.kind === "calendar_sync" && !["owner", "writer"].includes(found.accessRole ?? "")) throw new GoogleError("forbidden", "Your Google account can’t add events to this calendar.");
        await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "verified", note: "Ready.", detail: found.timeZone });
      } else if (resource.kind === "business_location") {
        const account = resource.detail ?? "";
        const locations = await businessLocations(access.token, account);
        if (!locations.some((l) => l.name === resource.externalId)) throw new GoogleError("not_found", "This location isn’t in your Google account.");
        await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "verified", note: "Ready." });
      } else if (resource.kind === "ads_account" || resource.kind === "conversion_destination") {
        const developer = adsDeveloperToken();
        if (!developer) throw new GoogleError("not_configured", "Google Ads isn’t available yet.");
        const account = resource.kind === "ads_account" ? resource.externalId : (resource.detail ?? "").split(":")[0];
        const reachable = await accessibleCustomers(access.token, developer);
        if (!reachable.includes(account.replace(/-/g, ""))) throw new GoogleError("not_found", "Your Google account can’t reach this ad account.");
        await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "verified", note: "Ready." });
      }
    } catch (error) {
      await ctx.runMutation(internal.google.setResourceAccess, { resourceId: args.resourceId, access: "lost", note: plainProblem(error) });
    }
    return null;
  },
});

export const storeChoices = internalMutation({
  args: { companyId: v.id("companies"), kind: v.union(v.literal("calendars"), v.literal("locations"), v.literal("ads_accounts"), v.literal("folder_contents"), v.literal("conversion_actions")), scope: v.optional(v.string()), items: v.array(v.object({ id: v.string(), label: v.string(), detail: v.optional(v.string()) })), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("googleChoices").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", args.kind)).take(20)) await ctx.db.delete(old._id);
    await ctx.db.insert("googleChoices", { ...args, items: args.items.slice(0, 300), fetchedAt: Date.now() });
    return null;
  },
});

/** Lists what the Owner can choose from, as Google sees it now, into googleChoices for the page to show. */
export const listChoices = internalAction({
  args: { connectionId: v.id("googleConnections"), kind: v.union(v.literal("calendars"), v.literal("locations"), v.literal("ads_accounts"), v.literal("folder_contents"), v.literal("conversion_actions")), scope: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const access = await accessTokenFor(ctx, args.connectionId);
    const companyId = access.ok ? access.companyId : null;
    if (!access.ok || !companyId) return null;
    const store = (items: { id: string; label: string; detail?: string }[], problem?: string) => ctx.runMutation(internal.googleWork.storeChoices, { companyId, kind: args.kind, scope: args.scope, items, problem });
    try {
      if (args.kind === "calendars") {
        const calendars = await listCalendars(access.token);
        await store(calendars.map((c) => ({ id: c.id, label: c.summary, detail: `${c.accessRole ?? ""}${c.timeZone ? ` · ${c.timeZone}` : ""}${c.primary ? " · primary" : ""}` })));
      } else if (args.kind === "locations") {
        const items: { id: string; label: string; detail?: string }[] = [];
        for (const account of await businessAccounts(access.token)) {
          for (const location of await businessLocations(access.token, account.name)) items.push({ id: location.name, label: location.title ?? location.name, detail: account.name });
        }
        await store(items, items.length ? undefined : "This Google account doesn’t manage any Business Profile locations.");
      } else if (args.kind === "ads_accounts") {
        const developer = adsDeveloperToken();
        if (!developer) return await store([], "Google Ads isn’t available yet."), null;
        const ids = await accessibleCustomers(access.token, developer);
        await store(ids.map((id) => ({ id, label: `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` })), ids.length ? undefined : "This Google account doesn’t have any Google Ads accounts.");
      } else if (args.kind === "conversion_actions") {
        const developer = adsDeveloperToken();
        if (!developer) return await store([], "Google Ads isn’t available yet."), null;
        const items: { id: string; label: string; detail?: string }[] = [];
        for (const account of await ctx.runQuery(internal.googleAds.adsAccountsFor, { companyId })) {
          const rows = await adsSearch<{ conversionAction?: { id?: string; name?: string } }>(access.token, developer, account.id, "SELECT conversion_action.id, conversion_action.name FROM conversion_action WHERE conversion_action.status = 'ENABLED'", account.login ?? undefined);
          for (const row of rows) if (row.conversionAction?.id) items.push({ id: String(row.conversionAction.id), label: row.conversionAction.name ?? "Conversion", detail: account.id });
        }
        await store(items, items.length ? undefined : "Choose a Google Ads account first, or add a conversion in Google Ads.");
      } else if (args.kind === "folder_contents" && args.scope) {
        const children = await listChildren(access.token, args.scope);
        await store(children.map((f) => ({ id: f.id, label: f.name, detail: f.mimeType })), children.length ? undefined : "No files here yet.");
      }
    } catch (error) {
      await store([], plainProblem(error));
    }
    return null;
  },
});

export type ExecutorInput = { job: Doc<"googleJobs">; token: string | null; payload: Record<string, unknown>; reconcile: boolean };
export type ExecutorOutput = { outcome?: "done" | "retry" | "uncertain" | "failed" | "cancelled"; result?: unknown; providerRef?: string; error?: string };
export type Executor = (ctx: ActionCtx, input: ExecutorInput) => Promise<ExecutorOutput>;
export type JobId = Id<"googleJobs">;
