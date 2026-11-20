/**
 * Admin Support Sessions (docs/operations/03-support-sessions.md): Selestial staff opening a company's
 * workspace to help, without the owner's password and without becoming the owner.
 *
 * Staff start a session for one company, with a reason, in View mode. Manage mode is a separate step: a
 * reason, a fresh second factor, and either the owner's grant or an open incident for that company. The
 * company functions themselves enforce the session (convex/lib/builders.ts), so nothing here depends on
 * what the browser shows or hides.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { noticeInApp } from "./lib/activation/notices";
import { ownerMutation, ownerQuery, staffMutation, staffQuery } from "./lib/builders";
import { notAllowed, notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { notifyMembers } from "./lib/notify/route";
import { activeGrant, ensureSupportMember, manageBasisHolds, openIncidentFor, requireRecentVerification, sessionOpen, supportEnabled } from "./lib/support/access";
import { capabilitiesOf, GRANT_DEFAULT_HOURS, GRANT_MAX_HOURS, SESSION_MS } from "./lib/support/catalog";
import { previewRoleValidator } from "./lib/support/schema";
import { optionalText, text } from "./lib/text";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** Revealed customer content stays shown this long, then hides again. */
const REVEAL_MS = 15 * MINUTE;

async function identityOf(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) notFound();
  return identity;
}

/** The caller's own open session, or "Not found." for anyone else's. */
async function mySession(ctx: MutationCtx & { staff: Doc<"staff"> }, sessionId: Id<"supportSessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.staffId !== ctx.staff._id) notFound();
  if (!sessionOpen(session, Date.now())) throw userError("This support session has ended. Start a new one from the staff console.", "not_allowed");
  return session;
}

async function log(ctx: MutationCtx, session: Doc<"supportSessions">, kind: Doc<"supportEvents">["kind"], summary: string) {
  await ctx.db.insert("supportEvents", { sessionId: session._id, companyId: session.companyId, staffId: session.staffId, kind, summary: summary.slice(0, 500), at: Date.now() });
}

/**
 * Ends a session. A Manage session that changed something sends the owner one summary: in the app, and
 * by email through the shared notice router, once per session.
 */
async function endSession(ctx: MutationCtx, session: Doc<"supportSessions">, reason: NonNullable<Doc<"supportSessions">["endReason"]>) {
  const now = Date.now();
  if (session.endedAt !== undefined) return;
  await ctx.db.patch(session._id, { endedAt: now, endReason: reason });
  const words = { exited: "ended the support session", expired: "the support session expired", revoked: "the owner ended support access", staff_removed: "the support session was closed" }[reason];
  await log(ctx, session, "ended", words);
  if (!session.manage || session.changes === 0 || session.summarizedAt) return;
  const changes = await ctx.db
    .query("supportEvents")
    .withIndex("by_session_at", (q) => q.eq("sessionId", session._id))
    .take(200);
  const done = [...new Set(changes.filter((row) => row.kind === "change").map((row) => row.summary))];
  const summary = `Selestial Support ${done.slice(0, 6).join(", ")}${done.length > 6 ? ", and more" : ""}.`;
  await noticeInApp(ctx, { companyId: session.companyId, kind: "support_access", headline: "Selestial Support finished helping", summary, key: `support:${session._id}:summary` });
  await notifyMembers(ctx, { companyId: session.companyId, event: "support_summary", ref: session._id, facts: { changes: session.changes, summary, reason: session.reason, startedAt: session.startedAt, endedAt: now } });
  await ctx.db.patch(session._id, { summarizedAt: now });
}

// ── Staff ────────────────────────────────────────────────────────────────────────────────────────

/** Opens a company's workspace in View mode, for a reason, for an hour. Needs a second factor confirmed in the last ten minutes. */
export const start = staffMutation({
  args: { companyId: v.id("companies"), reason: v.string(), incidentId: v.optional(v.id("incidents")), ticket: v.optional(v.string()), previewRole: v.optional(previewRoleValidator) },
  handler: async (ctx, args) => {
    if (!supportEnabled()) throw userError("Support sessions are turned off on this deployment.", "not_allowed");
    if (!capabilitiesOf(ctx.staff).has("workspace.view")) notAllowed();
    requireRecentVerification(await identityOf(ctx));
    const company = await ctx.db.get(args.companyId);
    if (!company) notFound();
    const reason = text(args.reason, "The reason", 500);
    if (reason.length < 10) throw userError("Say why you're opening this workspace. The company sees it.");
    if (args.incidentId) {
      const incident = await ctx.db.get(args.incidentId);
      if (!incident || incident.companyId !== company._id) notFound();
    }
    await ensureSupportMember(ctx, company._id);
    const now = Date.now();
    const sessionId = await ctx.db.insert("supportSessions", {
      staffId: ctx.staff._id,
      companyId: company._id,
      mode: "view",
      reason,
      incidentId: args.incidentId,
      ticket: optionalText(args.ticket, "The ticket", 100),
      previewRole: args.previewRole ?? "owner",
      startedAt: now,
      expiresAt: now + SESSION_MS,
      changes: 0,
    });
    await log(ctx, (await ctx.db.get(sessionId))!, "started", `viewed your workspace: ${reason}`);
    return sessionId;
  },
});

/** What the banner shows, read on every screen of the session. Only the staff member's own session. */
export const session = staffQuery({
  args: { sessionId: v.id("supportSessions") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.sessionId);
    if (!found || found.staffId !== ctx.staff._id) return null;
    const company = await ctx.db.get(found.companyId);
    const now = Date.now();
    const open = sessionOpen(found, now);
    const grant = open ? await activeGrant(ctx, found.companyId, now) : null;
    const incident = open ? await openIncidentFor(ctx, found.companyId, found.incidentId) : null;
    return {
      id: found._id,
      companyId: found.companyId,
      companyName: company?.name ?? "Deleted company",
      timezone: company?.timezone ?? "UTC",
      mode: found.mode,
      previewRole: found.previewRole,
      reason: found.reason,
      startedAt: found.startedAt,
      expiresAt: found.expiresAt,
      revealedUntil: found.revealedUntil ?? null,
      changes: found.changes,
      open,
      endedAt: found.endedAt ?? null,
      endReason: found.endReason ?? null,
      manageHolds: found.mode === "manage" ? await manageBasisHolds(ctx, found, now) : false,
      // What would allow Manage, so the banner can say so before anyone tries.
      manageBasis: grant ? ("owner_grant" as const) : incident ? ("incident" as const) : null,
      incident: incident ? { id: incident._id, title: incident.title } : null,
      grantExpiresAt: grant?.expiresAt ?? null,
    };
  },
});

/** Switches to Manage: a reason, a fresh second factor, and the owner's grant or an open incident for this company. */
export const switchToManage = staffMutation({
  args: { sessionId: v.id("supportSessions"), reason: v.string() },
  handler: async (ctx, args) => {
    const found = await mySession(ctx, args.sessionId);
    requireRecentVerification(await identityOf(ctx));
    const reason = text(args.reason, "The reason", 500);
    if (reason.length < 10) throw userError("Say what you need to change. The company sees it.");
    const now = Date.now();
    const grant = await activeGrant(ctx, found.companyId, now);
    const incident = grant ? null : await openIncidentFor(ctx, found.companyId, found.incidentId);
    if (!grant && !incident) throw userError("Manage needs the owner's permission (Settings › Support access) or an open incident for this company.", "not_allowed");
    const manage = grant ? { at: now, reason, basis: "owner_grant" as const, grantId: grant._id } : { at: now, reason, basis: "incident" as const, incidentId: incident!._id };
    await ctx.db.patch(found._id, { mode: "manage", manage });
    await log(ctx, found, "manage", `switched to Manage: ${reason}`);
    // The owner hears at once that Selestial can make changes now, and why.
    await noticeInApp(ctx, { companyId: found.companyId, kind: "support_access", headline: "Selestial Support is making changes in your workspace", summary: reason, key: `support:${found._id}:manage` });
    return null;
  },
});

/** Back to View, at any time. Giving up the ability to change things needs no check. */
export const switchToView = staffMutation({
  args: { sessionId: v.id("supportSessions") },
  handler: async (ctx, args) => {
    const found = await mySession(ctx, args.sessionId);
    if (found.mode === "view") return null;
    await ctx.db.patch(found._id, { mode: "view" });
    await log(ctx, found, "manage", "switched back to View");
    return null;
  },
});

/** Another hour, with a fresh second factor. */
export const extend = staffMutation({
  args: { sessionId: v.id("supportSessions") },
  handler: async (ctx, args) => {
    const found = await mySession(ctx, args.sessionId);
    requireRecentVerification(await identityOf(ctx));
    await ctx.db.patch(found._id, { expiresAt: Date.now() + SESSION_MS });
    await log(ctx, found, "extended", "extended the support session by an hour");
    return null;
  },
});

/** Shows customer message content for fifteen minutes, with a reason the owner sees. */
export const reveal = staffMutation({
  args: { sessionId: v.id("supportSessions"), reason: v.string() },
  handler: async (ctx, args) => {
    const found = await mySession(ctx, args.sessionId);
    requireRecentVerification(await identityOf(ctx));
    const reason = text(args.reason, "The reason", 500);
    if (reason.length < 10) throw userError("Say why you need to read message content. The company sees it.");
    await ctx.db.patch(found._id, { revealedUntil: Date.now() + REVEAL_MS });
    await log(ctx, found, "revealed", `read message content: ${reason}`);
    return null;
  },
});

export const exit = staffMutation({
  args: { sessionId: v.id("supportSessions") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.sessionId);
    if (!found || found.staffId !== ctx.staff._id) notFound();
    await endSession(ctx, found, "exited");
    return null;
  },
});

/** The staff member's own open sessions, so the console can offer to return to one. */
export const mine = staffQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("supportSessions")
      .withIndex("by_staff_started", (q) => q.eq("staffId", ctx.staff._id).gt("startedAt", now - 2 * SESSION_MS))
      .order("desc")
      .take(20);
    const out = [];
    for (const row of rows.filter((session) => sessionOpen(session, now))) {
      out.push({ id: row._id, companyId: row.companyId, companyName: (await ctx.db.get(row.companyId))?.name ?? "Deleted company", mode: row.mode, expiresAt: row.expiresAt });
    }
    return out;
  },
});

/** The Operations Activity view: what staff did in support sessions, newest first, across companies. */
export const activity = staffQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("supportEvents").withIndex("by_at").order("desc").take(100);
    const names = new Map<string, string>();
    const name = async (id: Id<"companies"> | Id<"staff">) => {
      if (!names.has(id)) names.set(id, ((await ctx.db.get(id)) as { name?: string } | null)?.name ?? "Deleted");
      return names.get(id)!;
    };
    const out = [];
    for (const row of rows) out.push({ id: row._id, kind: row.kind, summary: row.summary, at: row.at, sessionId: row.sessionId, company: { id: row.companyId, name: await name(row.companyId) }, staff: await name(row.staffId) });
    return out;
  },
});

/** Whether support access is available at all here, and what this staff member may do. */
export const capabilities = staffQuery({
  args: {},
  handler: async (ctx) => ({ enabled: supportEnabled(), capabilities: [...capabilitiesOf(ctx.staff)] }),
});

/** Every minute: sessions past their time end, and their summaries go out. Requests already refuse them. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("supportSessions")
      .withIndex("by_open_expires", (q) => q.eq("endedAt", undefined).lt("expiresAt", now))
      .take(50);
    for (const row of due) await endSession(ctx, row, "expired");
    return due.length;
  },
});

/** A staff member's open sessions end when their staff access is removed. Called by staff.remove. */
export async function endSessionsOf(ctx: MutationCtx, staffId: Id<"staff">) {
  const rows = await ctx.db
    .query("supportSessions")
    .withIndex("by_staff_started", (q) => q.eq("staffId", staffId))
    .order("desc")
    .take(50);
  for (const row of rows) if (row.endedAt === undefined) await endSession(ctx, row, "staff_removed");
}

// ── The owner ────────────────────────────────────────────────────────────────────────────────────

/** Support access history (Settings › Support access): when Selestial was here, why, in which mode, and what it changed. */
export const history = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sessions = await ctx.db
      .query("supportSessions")
      .withIndex("by_company_started", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(50);
    const out = [];
    for (const row of sessions) {
      const events = await ctx.db
        .query("supportEvents")
        .withIndex("by_session_at", (q) => q.eq("sessionId", row._id))
        .take(200);
      out.push({
        id: row._id,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? null,
        open: sessionOpen(row, now),
        // The furthest it went: a session that switched to Manage at any point is shown as Manage.
        mode: row.manage ? ("manage" as const) : ("view" as const),
        reason: row.reason,
        manageReason: row.manage?.reason ?? null,
        basis: row.manage?.basis ?? null,
        ticket: row.ticket ?? null,
        changes: events.filter((event) => event.kind === "change").map((event) => ({ summary: event.summary, at: event.at })),
        revealed: events.filter((event) => event.kind === "revealed").map((event) => ({ summary: event.summary, at: event.at })),
      });
    }
    const grant = await activeGrant(ctx, ctx.companyId, now);
    return { sessions: out, grant: grant ? { id: grant._id, grantedAt: grant.grantedAt, expiresAt: grant.expiresAt, note: grant.note ?? null } : null, enabled: supportEnabled() };
  },
});

/** The owner lets Selestial Support make changes, for a limited time. Viewing never needed this. */
export const grantManage = ownerMutation({
  args: { hours: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const hours = args.hours ?? GRANT_DEFAULT_HOURS;
    if (!Number.isFinite(hours) || hours < 1 || hours > GRANT_MAX_HOURS) throw userError(`Choose between 1 and ${GRANT_MAX_HOURS} hours.`);
    const now = Date.now();
    const existing = await activeGrant(ctx, ctx.companyId, now);
    if (existing) await ctx.db.patch(existing._id, { revokedAt: now, revokedBy: ctx.member._id });
    const grantId = await ctx.db.insert("supportGrants", { companyId: ctx.companyId, grantedBy: ctx.member._id, grantedAt: now, expiresAt: now + Math.round(hours) * HOUR, note: optionalText(args.note, "The note", 300) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "support.access_granted", actor: byMember(ctx), subject: { table: "supportGrants", id: grantId }, data: { hours: Math.round(hours) } });
    return grantId;
  },
});

/** The owner ends that permission. Any Manage session relying on it drops back to View at once. */
export const revokeManage = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const grant = await activeGrant(ctx, ctx.companyId, now);
    if (!grant) return null;
    await ctx.db.patch(grant._id, { revokedAt: now, revokedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "support.access_revoked", actor: byMember(ctx), subject: { table: "supportGrants", id: grant._id } });
    const sessions = await ctx.db
      .query("supportSessions")
      .withIndex("by_company_started", (q) => q.eq("companyId", ctx.companyId).gt("startedAt", now - 2 * SESSION_MS))
      .take(50);
    for (const row of sessions) {
      if (row.endedAt === undefined && row.manage?.grantId === grant._id && row.mode === "manage") {
        await ctx.db.patch(row._id, { mode: "view" });
        await log(ctx, row, "manage", "back to View: the owner ended Manage access");
      }
    }
    return null;
  },
});

