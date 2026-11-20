/**
 * Migration tutorials: which ones an owner may see, what they did with them, and the staff controls that
 * publish, flag and re-point them (lib/tutorials/catalog.ts holds the tutorials themselves).
 *
 * Only a published tutorial is ever returned to an owner. A tutorial whose media is missing is returned
 * without media, so a screen shows its written steps instead of a player that cannot play.
 *
 * Analytics: a tutorial event says which tutorial, where, and what happened. Nothing about the file, the
 * rows or the owner's answers is accepted. A completed video is not evidence that anyone exported anything.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { companyMutation, companyQuery, staffMutation, staffQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { allow } from "./lib/rateLimit";
import { optionalText } from "./lib/text";
import { TUTORIALS, tutorialById, type Media, type State, type Tutorial } from "./lib/tutorials/catalog";
import { mediaValidator, placementValidator, stateValidator, tutorialEventValidator, TUTORIAL_EVENTS } from "./lib/tutorials/schema";

type Settings = Doc<"tutorialSettings">;

async function settingsMap(ctx: QueryCtx): Promise<Map<string, Settings>> {
  const rows = await ctx.db.query("tutorialSettings").take(500);
  return new Map(rows.map((row) => [row.tutorialId, row]));
}

function effective(tutorial: Tutorial, settings: Settings | undefined): { state: State; media: Media | null; reportedAt: number | null } {
  return { state: settings?.state ?? tutorial.defaultState, media: settings?.media ?? tutorial.media, reportedAt: settings?.reportedAt ?? null };
}

/** A media address must be https, or a path on Selestial's own site. */
function checkMedia(media: Media) {
  for (const value of [media.video, media.poster, media.captions]) {
    if (!/^https:\/\/[^\s]+$/.test(value) && !/^\/[^\s]*$/.test(value)) throw userError("Media addresses must start with https:// or /.");
  }
  if (!Number.isInteger(media.version) || media.version < 1) throw userError("The media version must be a whole number from 1.");
  if (media.durationSeconds <= 0 || media.durationSeconds > 600) throw userError("The duration must be from 1 to 600 seconds.");
}

/**
 * Published tutorials, as an owner sees them. The catalog's own fields plus the media in force, and whether
 * someone reported the steps as changed and staff have not looked yet.
 */
export const published = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsMap(ctx);
    return TUTORIALS.flatMap((tutorial) => {
      const now = effective(tutorial, settings.get(tutorial.id));
      if (now.state !== "published") return [];
      return [{ ...tutorial, media: now.media, reported: now.reportedAt !== null }];
    });
  },
});

/**
 * Every tutorial's state, without its content: lets a screen say honestly that a walkthrough exists but is
 * not ready, and offer the platform's own article instead.
 */
export const availability = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsMap(ctx);
    return TUTORIALS.map((tutorial) => ({ id: tutorial.id, published: effective(tutorial, settings.get(tutorial.id)).state === "published" }));
  },
});

export const track = companyMutation({
  args: { tutorialId: v.string(), kind: tutorialEventValidator, placement: placementValidator },
  handler: async (ctx, args) => {
    if (!tutorialById(args.tutorialId)) throw userError("That tutorial is not in the catalog.");
    // A busy player can send many events; an owner's own use is never refused, only thinned.
    if (!(await allow(ctx, `tutorial:${ctx.companyId}`, 120, 60_000))) return null;
    await ctx.db.insert("tutorialEvents", { companyId: ctx.companyId, tutorialId: args.tutorialId, kind: args.kind, placement: args.placement, at: Date.now() });
    return null;
  },
});

/** An owner says the steps no longer match. Staff see it; the tutorial is flagged until they review it. */
export const reportOutdated = companyMutation({
  args: { tutorialId: v.string(), placement: placementValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tutorial = tutorialById(args.tutorialId);
    if (!tutorial) throw userError("That tutorial is not in the catalog.");
    if (!(await allow(ctx, `tutorial-report:${ctx.companyId}`, 5, 3_600_000))) throw userError("Thanks, we already have your report.", "limit");
    const now = Date.now();
    const settings = await ctx.db.query("tutorialSettings").withIndex("by_tutorial", (q) => q.eq("tutorialId", tutorial.id)).first();
    const media = settings?.media ?? tutorial.media;
    await ctx.db.insert("tutorialReports", { tutorialId: tutorial.id, companyId: ctx.companyId, note: optionalText(args.note?.trim() || undefined, "The note", 1000), contentVersion: tutorial.contentVersion, mediaVersion: media?.version, status: "open", createdAt: now });
    if (settings) await ctx.db.patch(settings._id, { reportedAt: now });
    else await ctx.db.insert("tutorialSettings", { tutorialId: tutorial.id, state: tutorial.defaultState, reportedAt: now, updatedBy: "owner report", updatedAt: now });
    await ctx.db.insert("tutorialEvents", { companyId: ctx.companyId, tutorialId: tutorial.id, kind: "reported_outdated", placement: args.placement, at: now });
    return null;
  },
});

// ── Staff ─────────────────────────────────────────────────────────────────────────────────────────

/** Every tutorial with its state, media, open reports and verification, for the staff panel. */
export const staffList = staffQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsMap(ctx);
    const open = await ctx.db.query("tutorialReports").withIndex("by_status", (q) => q.eq("status", "open")).take(500);
    return TUTORIALS.map((tutorial) => {
      const row = settings.get(tutorial.id);
      const now = effective(tutorial, row);
      return {
        id: tutorial.id,
        title: tutorial.title,
        platform: tutorial.platform,
        task: tutorial.task,
        state: now.state,
        media: now.media,
        mediaOverridden: Boolean(row?.media),
        contentVersion: tutorial.contentVersion,
        docsCheckedOn: tutorial.docsCheckedOn,
        interfaceVerifiedOn: tutorial.interfaceVerifiedOn,
        hasTranscript: tutorial.transcript !== null,
        sources: tutorial.sources,
        note: row?.note ?? null,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ?? null,
        reports: open.filter((report) => report.tutorialId === tutorial.id).map((report) => ({ id: report._id, note: report.note ?? null, at: report.createdAt, mediaVersion: report.mediaVersion ?? null })),
      };
    });
  },
});

async function upsert(ctx: Parameters<Parameters<typeof staffMutation>[0]["handler"]>[0], tutorial: Tutorial, patch: Partial<Settings>) {
  const row = await ctx.db.query("tutorialSettings").withIndex("by_tutorial", (q) => q.eq("tutorialId", tutorial.id)).first();
  const base = { updatedBy: ctx.staff.name || ctx.email, updatedAt: Date.now() };
  if (row) await ctx.db.patch(row._id, { ...patch, ...base });
  else await ctx.db.insert("tutorialSettings", { tutorialId: tutorial.id, state: tutorial.defaultState, ...patch, ...base });
}

/**
 * Changes a tutorial's state. Publishing needs the steps followed in a real account and a reviewed
 * transcript when there is media: a tutorial is never published on documentation alone with a video.
 */
export const setState = staffMutation({
  args: { tutorialId: v.string(), state: stateValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tutorial = tutorialById(args.tutorialId);
    if (!tutorial) throw userError("That tutorial is not in the catalog.");
    if (args.state === "published") {
      if (!tutorial.interfaceVerifiedOn) throw userError("Follow the steps in a real account and record the date in the catalog before publishing.");
      const row = await ctx.db.query("tutorialSettings").withIndex("by_tutorial", (q) => q.eq("tutorialId", tutorial.id)).first();
      if ((row?.media ?? tutorial.media) && !tutorial.transcript) throw userError("A video needs its reviewed transcript in the catalog before it is published.");
    }
    await upsert(ctx, tutorial, { state: args.state, note: optionalText(args.note?.trim() || undefined, "The note", 1000), ...(args.state !== "needs_update" ? { reportedAt: undefined } : {}) });
    return null;
  },
});

/** Points a tutorial at a new media version, for every screen at once. `null` returns to the catalog's media. */
export const setMedia = staffMutation({
  args: { tutorialId: v.string(), media: v.union(mediaValidator, v.null()) },
  handler: async (ctx, args) => {
    const tutorial = tutorialById(args.tutorialId);
    if (!tutorial) throw userError("That tutorial is not in the catalog.");
    if (args.media) checkMedia(args.media);
    await upsert(ctx, tutorial, { media: args.media ?? undefined });
    return null;
  },
});

export const resolveReport = staffMutation({
  args: { reportId: v.id("tutorialReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw userError("That report is no longer here.", "not_found");
    await ctx.db.patch(report._id, { status: "reviewed" });
    const left = (await ctx.db.query("tutorialReports").withIndex("by_tutorial", (q) => q.eq("tutorialId", report.tutorialId)).take(500)).filter((row) => row.status === "open" && row._id !== report._id);
    if (!left.length) {
      const row = await ctx.db.query("tutorialSettings").withIndex("by_tutorial", (q) => q.eq("tutorialId", report.tutorialId)).first();
      if (row) await ctx.db.patch(row._id, { reportedAt: undefined });
    }
    return null;
  },
});

const DAY = 86_400_000;

/**
 * Tutorial use in the window, and beside it how companies that opened a tutorial fared against those that
 * did not. The comparison is shown as it is: companies that look for help differ in other ways too, so it is
 * never a measure of what a tutorial caused. Counts only; no company is named.
 */
export const metrics = staffQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const days = Math.min(Math.max(Math.round(args.days ?? 30), 1), 365);
    const since = Date.now() - days * DAY;
    const events = await ctx.db.query("tutorialEvents").withIndex("by_at", (q) => q.gte("at", since)).take(20000);
    const byTutorial = new Map<string, Record<string, number>>();
    for (const event of events) {
      const counts = byTutorial.get(event.tutorialId) ?? Object.fromEntries(TUTORIAL_EVENTS.map((kind) => [kind, 0]));
      counts[event.kind] += 1;
      byTutorial.set(event.tutorialId, counts);
    }
    const setups = (await ctx.db.query("companySetups").take(10000)).filter((row) => row.milestones.startedAt >= since);
    const opened = new Set(events.filter((event) => event.kind === "opened").map((event) => event.companyId as string));
    const imported = new Set<string>();
    for (const setup of setups) {
      const run = await ctx.db.query("clientImportRuns").withIndex("by_company_key", (q) => q.eq("companyId", setup.companyId)).filter((q) => q.gt(q.field("created"), 0)).first();
      if (run) imported.add(setup.companyId);
    }
    const group = (rows: typeof setups) => ({ companies: rows.length, importedClients: rows.filter((row) => imported.has(row.companyId)).length, enteredWorkspace: rows.filter((row) => row.milestones.enteredAt !== undefined).length });
    return {
      days,
      tutorials: TUTORIALS.map((tutorial) => ({ id: tutorial.id, title: tutorial.title, counts: byTutorial.get(tutorial.id) ?? Object.fromEntries(TUTORIAL_EVENTS.map((kind) => [kind, 0])) })),
      comparison: { openedTutorial: group(setups.filter((row) => opened.has(row.companyId))), didNot: group(setups.filter((row) => !opened.has(row.companyId))) },
    };
  },
});
