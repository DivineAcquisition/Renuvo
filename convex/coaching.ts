/**
 * Coaching and feedback: internal notes, feedback shared with the cleaner, training items, and Selestial's
 * drafts. A draft is written from the records the suggestion rests on and does nothing until a person
 * publishes it; only then does the cleaner see it (if it is to be shared). Coaching is never a disciplinary
 * step: that is a personnel request an authorized person decides. Owners and Managers only.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { owned } from "./lib/access";
import { managerMutation, managerQuery } from "./lib/builders";
import { draftCoaching } from "./lib/cleaners/coaching";
import { COACHING_KINDS } from "./lib/cleaners/schema";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { optionalText, text } from "./lib/text";

const kindValidator = v.union(...COACHING_KINDS.map((kind) => v.literal(kind)));
const actionValidator = v.object({ text: v.string(), dueAt: v.optional(v.number()) });
const evidenceValidator = v.object({ kind: v.union(v.literal("job"), v.literal("assignment"), v.literal("measure"), v.literal("requirement"), v.literal("message")), id: v.optional(v.string()), label: v.string() });


function cleanActions(actions: { text: string; dueAt?: number }[]) {
  if (actions.length > 10) throw userError("Up to 10 actions.");
  return actions.map((row) => ({ text: text(row.text, "An action", 300), dueAt: row.dueAt }));
}

export const list = managerQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const rows = await ctx.db
      .query("coachingNotes")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(100);
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"members"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "A team member");
      return names.get(id)!;
    };
    const out = [];
    for (const row of rows) {
      out.push({
        noteId: row._id,
        kind: row.kind,
        visibility: row.visibility,
        status: row.status,
        title: row.title,
        body: row.body,
        evidence: row.evidence,
        actions: row.actions,
        followUpAt: row.followUpAt ?? null,
        author: row.author.kind === "selestial" ? "Selestial (draft)" : ((await nameOf(row.author.memberId)) ?? "A team member"),
        fromSelestial: row.author.kind === "selestial",
        reviewedBy: await nameOf(row.reviewedBy),
        sharedAt: row.sharedAt ?? null,
        response: row.response ?? null,
        outcome: row.outcome ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  },
});

/** A note written by a person. Shared means the cleaner sees it in their portal now. */
export const create = managerMutation({
  args: { cleanerId: v.id("cleaners"), kind: kindValidator, visibility: v.union(v.literal("internal"), v.literal("shared")), title: v.string(), body: v.string(), evidence: v.optional(v.array(evidenceValidator)), actions: v.optional(v.array(actionValidator)), followUpAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (cleaner.status === "ended") throw userError("This engagement has ended.");
    const now = Date.now();
    const noteId = await ctx.db.insert("coachingNotes", {
      companyId: ctx.companyId,
      cleanerId: cleaner._id,
      kind: args.kind,
      visibility: args.visibility,
      status: "active",
      title: text(args.title, "The title", 160),
      body: text(args.body, "The note", 4000),
      evidence: (args.evidence ?? []).slice(0, 20),
      actions: cleanActions(args.actions ?? []),
      followUpAt: args.followUpAt,
      author: { kind: "member", memberId: ctx.member._id },
      sharedAt: args.visibility === "shared" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.coaching_added", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { noteId, kind: args.kind, shared: args.visibility === "shared" } });
    return noteId;
  },
});

/**
 * Selestial drafts a note from the records a suggestion rests on. It stays a draft, seen by nobody but the
 * office, until a person publishes it. Asking twice finds the draft already there.
 */
export const draftFromRecords = managerMutation({
  args: { cleanerId: v.id("cleaners"), key: v.union(v.literal("late"), v.literal("no_show"), v.literal("recognize"), v.literal("unanswered")) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const answer = await draftCoaching(ctx, ctx.company, cleaner, args.key, byMember(ctx));
    return { noteId: answer.noteId, already: answer.already };
  },
});

/** Changes a draft or an active note. A resolved or withdrawn note stays as it was. */
export const edit = managerMutation({
  args: { noteId: v.id("coachingNotes"), title: v.optional(v.string()), body: v.optional(v.string()), visibility: v.optional(v.union(v.literal("internal"), v.literal("shared"))), actions: v.optional(v.array(actionValidator)), followUpAt: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, args) => {
    const note = await owned(ctx, args.noteId);
    if (note.status === "resolved" || note.status === "withdrawn") throw userError("This note is closed.");
    if (note.sharedAt && args.visibility === "internal") throw userError("This was already shared with them. Withdraw it instead.");
    const now = Date.now();
    await ctx.db.patch(note._id, {
      ...(args.title !== undefined ? { title: text(args.title, "The title", 160) } : {}),
      ...(args.body !== undefined ? { body: text(args.body, "The note", 4000) } : {}),
      ...(args.visibility !== undefined ? { visibility: args.visibility } : {}),
      ...(args.actions !== undefined ? { actions: cleanActions(args.actions) } : {}),
      ...(args.followUpAt !== undefined ? { followUpAt: args.followUpAt ?? undefined } : {}),
      // Sharing an active note that was internal makes it visible now.
      ...(note.status === "active" && args.visibility === "shared" && !note.sharedAt ? { sharedAt: now } : {}),
      updatedAt: now,
    });
    return null;
  },
});

/** A person approves a draft. If it is to be shared, the cleaner sees it from now on. */
export const publish = managerMutation({
  args: { noteId: v.id("coachingNotes") },
  handler: async (ctx, args) => {
    const note = await owned(ctx, args.noteId);
    if (note.status !== "draft" && note.status !== "awaiting_review") throw userError("Only a draft is published.");
    const now = Date.now();
    await ctx.db.patch(note._id, { status: "active", reviewedBy: ctx.member._id, reviewedAt: now, sharedAt: note.visibility === "shared" ? now : undefined, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.coaching_added", actor: byMember(ctx), subject: { table: "cleaners", id: note.cleanerId }, data: { noteId: note._id, kind: note.kind, shared: note.visibility === "shared", fromDraft: true } });
    return null;
  },
});

export const resolve = managerMutation({
  args: { noteId: v.id("coachingNotes"), outcome: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const note = await owned(ctx, args.noteId);
    if (note.status !== "active") throw userError("Only an active note is closed this way.");
    await ctx.db.patch(note._id, { status: "resolved", outcome: optionalText(args.outcome, "Outcome", 1000), resolvedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** Withdraws a draft or a note. A withdrawn shared note disappears from their portal. */
export const withdraw = managerMutation({
  args: { noteId: v.id("coachingNotes") },
  handler: async (ctx, args) => {
    const note = await owned(ctx, args.noteId);
    if (note.status === "withdrawn") return null;
    await ctx.db.patch(note._id, { status: "withdrawn", updatedAt: Date.now() });
    return null;
  },
});
