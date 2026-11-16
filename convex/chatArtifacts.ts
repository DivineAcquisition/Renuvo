/**
 * Drafts made in Company Chat, for the document workspace beside the conversation. A draft belongs to
 * the member who made it, like the chat it came from. Editing saves a new version from the version the
 * person was looking at; recording terms approved, sent or signed is a separate, explicit step.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { companyMutation, companyQuery, managerMutation } from "./lib/builders";
import { createArtifact, readableArtifact, reviseArtifact, setArtifactState, STATE_WORDS, unresolvedFields, versionOf } from "./lib/chat/artifacts";
import { artifactKindValidator, artifactStateValidator } from "./lib/chat/schema";
import { byMember } from "./lib/events";

export const list = companyQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("chatArtifacts")
      .withIndex("by_company_creator_updated", (q) => q.eq("companyId", ctx.companyId).eq("createdBy", ctx.member._id))
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map((row) => ({ artifactId: row._id, title: row.title, kind: row.kind, state: row.state, currentVersion: row.currentVersion, updatedAt: row.updatedAt, conversationId: row.conversationId ?? null })) };
  },
});

/** One draft at one version (the latest by default), with its history. */
export const get = companyQuery({
  args: { artifactId: v.string(), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const artifact = await readableArtifact(ctx, ctx.companyId, ctx.member._id, args.artifactId);
    const shown = await versionOf(ctx, artifact, args.version ?? artifact.currentVersion);
    const versions = await ctx.db
      .query("chatArtifactVersions")
      .withIndex("by_company_artifact_version", (q) => q.eq("companyId", ctx.companyId).eq("artifactId", artifact._id))
      .order("desc")
      .take(100);
    const source = artifact.conversationId ? await ctx.db.get(artifact.conversationId) : null;
    return {
      artifactId: artifact._id,
      title: artifact.title,
      kind: artifact.kind,
      state: artifact.state,
      stateWords: STATE_WORDS[artifact.state],
      stateNote: artifact.stateNote ?? null,
      stateAt: artifact.stateAt ?? null,
      approvedVersion: artifact.approvedVersion ?? null,
      currentVersion: artifact.currentVersion,
      version: shown ? { version: shown.version, content: shown.content, author: shown.author.kind, note: shown.note ?? null, createdAt: shown.createdAt, unresolved: unresolvedFields(shown.content) } : null,
      versions: versions.map((row) => ({ version: row.version, author: row.author.kind, note: row.note ?? null, createdAt: row.createdAt })),
      source: source ? (source.shelf === "deleted" ? { deleted: true as const } : { deleted: false as const, conversationId: source._id, title: source.title }) : null,
      canRecord: ctx.role !== "office",
    };
  },
});

/** A blank or pasted document started from the workspace rather than from a chat. */
export const create = companyMutation({
  args: { title: v.string(), kind: artifactKindValidator, content: v.string() },
  handler: async (ctx, args) => createArtifact(ctx, { companyId: ctx.companyId, memberId: ctx.member._id, title: args.title, kind: args.kind, content: args.content, author: { kind: "member", memberId: ctx.member._id }, actor: byMember(ctx) }),
});

/** A person's edit, saved as the next version of the version they were editing. */
export const save = companyMutation({
  args: { artifactId: v.string(), baseVersion: v.number(), content: v.string(), title: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const artifact = await readableArtifact(ctx, ctx.companyId, ctx.member._id, args.artifactId);
    return reviseArtifact(ctx, artifact, { baseVersion: args.baseVersion, content: args.content, title: args.title, note: args.note, author: { kind: "member", memberId: ctx.member._id }, actor: byMember(ctx) });
  },
});

/** Owners and Managers record a document's terms approved, sent or signed, for the version on screen. */
export const setState = managerMutation({
  args: { artifactId: v.string(), version: v.number(), state: artifactStateValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const artifact = await readableArtifact(ctx, ctx.companyId, ctx.member._id, args.artifactId);
    await setArtifactState(ctx, artifact, { version: args.version, state: args.state, note: args.note, memberId: ctx.member._id });
    return null;
  },
});
