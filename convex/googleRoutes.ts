/**
 * Drive times and day plans from Google, with Selestial's own platform credentials (not a company's
 * Google account). Both answer questions only: a drive time is shown beside a visit, and a day plan is a
 * proposal in which every visit may only go to cleaners Selestial's own eligibility and availability
 * rules already allow. Nothing here assigns a cleaner or moves a visit.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { companyQuery, managerMutation } from "./lib/builders";
import { candidatesFor } from "./lib/dispatch/workflow";
import { userError } from "./lib/errors";
import { enqueue } from "./lib/google/jobs";
import { mapsServerKey } from "./lib/google/platform";
import { matrix, optimize, type Visit, type Worker } from "./lib/google/routes";
import { serviceAccountToken } from "./lib/google/serviceAccount";
import { addLocalDays, startOfLocalDay } from "./lib/time";

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;
/** A pair of points, rounded to about 100 m, so nearby addresses share one answer. */
export const pairKey = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => `${round(a.lat)},${round(a.lng)}>${round(b.lat)},${round(b.lng)}`;

export function dayBounds(day: string, timezone: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw userError("Choose a day as YYYY-MM-DD.");
  const start = startOfLocalDay(Date.parse(`${day}T12:00:00Z`), timezone);
  return { start, end: addLocalDays(start, 1, timezone) };
}

/** Drive times between back-to-back visits on a day, as last read. Missing pairs are simply missing. */
export const travelForDay = companyQuery({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    const { start, end } = dayBounds(args.day, ctx.company.timezone);
    const jobs = (await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", start).lt("startsAt", end)).take(300)).filter((j) => j.status !== "cancelled");
    const out: { fromJobId: Id<"jobs">; toJobId: Id<"jobs">; seconds: number | null; meters: number | null; ok: boolean; fetchedAt: number }[] = [];
    const points = await Promise.all(jobs.map(async (j) => ({ job: j, address: (await ctx.db.get(j.propertyId))?.address })));
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i].address;
      const b = points[i + 1].address;
      if (a?.lat === undefined || a.lng === undefined || b?.lat === undefined || b.lng === undefined) continue;
      const row = await ctx.db.query("googleTravel").withIndex("by_company_pair", (q) => q.eq("companyId", ctx.companyId).eq("pairKey", pairKey({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }))).first();
      if (row) out.push({ fromJobId: points[i].job._id, toJobId: points[i + 1].job._id, seconds: row.seconds ?? null, meters: row.meters ?? null, ok: row.ok, fetchedAt: row.fetchedAt });
    }
    return { configured: Boolean(mapsServerKey()), legs: out };
  },
});

export const travelPairs = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobs = (await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", args.companyId).gte("startsAt", now - DAY / 2).lt("startsAt", now + 2 * DAY)).take(300)).filter((j) => j.status !== "cancelled");
    const places: { lat: number; lng: number }[] = [];
    for (const job of jobs) {
      const address = (await ctx.db.get(job.propertyId))?.address;
      if (address?.lat !== undefined && address.lng !== undefined) places.push({ lat: address.lat, lng: address.lng });
    }
    const pairs: { a: { lat: number; lng: number }; b: { lat: number; lng: number }; key: string }[] = [];
    for (let i = 0; i + 1 < places.length; i += 1) {
      const key = pairKey(places[i], places[i + 1]);
      const cached = await ctx.db.query("googleTravel").withIndex("by_company_pair", (q) => q.eq("companyId", args.companyId).eq("pairKey", key)).first();
      if (!cached || cached.fetchedAt < now - 7 * DAY) pairs.push({ a: places[i], b: places[i + 1], key });
    }
    return pairs.slice(0, 50);
  },
});

export const storeTravel = internalMutation({
  args: { companyId: v.id("companies"), rows: v.array(v.object({ key: v.string(), seconds: v.optional(v.number()), meters: v.optional(v.number()), ok: v.boolean() })) },
  handler: async (ctx, args) => {
    for (const row of args.rows) {
      for (const old of await ctx.db.query("googleTravel").withIndex("by_company_pair", (q) => q.eq("companyId", args.companyId).eq("pairKey", row.key)).take(3)) await ctx.db.delete(old._id);
      await ctx.db.insert("googleTravel", { companyId: args.companyId, pairKey: row.key, seconds: row.seconds, meters: row.meters, ok: row.ok, fetchedAt: Date.now() });
    }
    return null;
  },
});

export const refreshTravel = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<null> => {
    const key = mapsServerKey();
    if (!key) return null;
    const pairs = await ctx.runQuery(internal.googleRoutes.travelPairs, args);
    const rows: { key: string; seconds?: number; meters?: number; ok: boolean }[] = [];
    for (const pair of pairs) {
      const [leg] = await matrix(key, [pair.a], [pair.b]);
      rows.push({ key: pair.key, seconds: leg?.seconds ?? undefined, meters: leg?.meters ?? undefined, ok: leg?.ok ?? false });
    }
    if (rows.length) await ctx.runMutation(internal.googleRoutes.storeTravel, { companyId: args.companyId, rows });
    return null;
  },
});

/** Asks for a day plan. The answer is a proposal on the job record; it changes no assignment. */
export const requestDayPlan = managerMutation({
  args: { day: v.string() },
  handler: async (ctx, args) => {
    dayBounds(args.day, ctx.company.timezone);
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_CLOUD_PROJECT) throw userError("Day plans are not set up on this deployment (GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CLOUD_PROJECT).");
    return enqueue(ctx, { companyId: ctx.companyId, kind: "route_proposal", key: `route_proposal:${args.day}:${Math.floor(Date.now() / 300_000)}`, payload: { day: args.day }, requestedBy: ctx.member._id });
  },
});

export const dayPlans = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(200);
    return rows.filter((r) => r.kind === "route_proposal").slice(0, 10).map((r) => ({ day: (JSON.parse(r.payload) as { day: string }).day, status: r.status, proposal: r.result ? JSON.parse(r.result) : null, error: r.lastError ?? null, updatedAt: r.updatedAt }));
  },
});

/** The day's open visits with a map point, and for each the cleaners Selestial's own rules allow. */
export const planInput = internalQuery({
  args: { companyId: v.id("companies"), day: v.string() },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;
    const { start, end } = dayBounds(args.day, company.timezone);
    const jobs = (await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", args.companyId).gte("startsAt", start).lt("startsAt", end)).take(100)).filter((j) => j.status === "scheduled");
    const visits: Visit[] = [];
    const without: string[] = [];
    const names = new Map<string, string>();
    for (const job of jobs) {
      const address = (await ctx.db.get(job.propertyId))?.address;
      if (address?.lat === undefined || address.lng === undefined) {
        without.push(job._id);
        continue;
      }
      const found = await candidatesFor(ctx, company, job);
      for (const c of found.candidates) names.set(c.cleanerId, c.name);
      visits.push({ id: job._id, place: { lat: address.lat, lng: address.lng }, windowStart: job.startsAt, windowEnd: job.startsAt + (job.arrivalWindowMinutes ?? 0) * 60_000, durationSeconds: Math.max(1800, Math.round((job.endsAt - job.startsAt) / 1000)), allowed: found.candidates.map((c) => c.cleanerId) });
    }
    const workers: Worker[] = [...names.keys()].map((id) => ({ id, shiftStart: start + 6 * 3_600_000, shiftEnd: start + 21 * 3_600_000 }));
    return { visits, workers, names: Object.fromEntries(names), withoutMapPoint: without };
  },
});

export const propose = internalAction({
  args: { companyId: v.id("companies"), day: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; routes: { cleanerId: string; name: string; visits: { jobId: string; start: string }[] }[]; skipped: string[]; withoutMapPoint: string[]; note: string } | { ok: false; why: string }> => {
    const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    if (!project) return { ok: false, why: "GOOGLE_CLOUD_PROJECT is not set." };
    const input = await ctx.runQuery(internal.googleRoutes.planInput, args);
    if (!input) return { ok: false, why: "The company was not found." };
    if (input.visits.length === 0 || input.workers.length === 0) return { ok: true, routes: [], skipped: input.visits.map((v) => v.id), withoutMapPoint: input.withoutMapPoint, note: "No open visit with a map point has an eligible cleaner." };
    const token = await serviceAccountToken();
    const plan = await optimize(token, project, input.visits, input.workers);
    return {
      ok: true,
      routes: plan.routes.map((r) => ({ cleanerId: r.worker, name: input.names[r.worker] ?? "", visits: r.visits.map((v) => ({ jobId: v.id, start: v.start })) })),
      skipped: plan.skipped,
      withoutMapPoint: input.withoutMapPoint,
      note: "A proposal only. Offers are still sent one by one through Dispatch, which checks every rule again.",
    };
  },
});

/** Every 30 minutes: drive times for the next two days, for companies with visits that have map points. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!mapsServerKey()) return 0;
    const now = Date.now();
    const jobs = await ctx.db.query("jobs").withIndex("by_status_start", (q) => q.eq("status", "scheduled").gte("startsAt", now).lt("startsAt", now + 2 * DAY)).take(2000);
    const companies = new Set(jobs.map((j) => j.companyId));
    const bucket = Math.floor(now / (30 * 60_000));
    for (const companyId of companies) await enqueue(ctx, { companyId, kind: "travel_refresh", key: `travel_refresh:${bucket}`, payload: {} });
    return companies.size;
  },
});
