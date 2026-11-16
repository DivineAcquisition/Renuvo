/**
 * Drafts made in chat: agreements, proposals, pricing worksheets, SOPs, checklists, messages and plans.
 * A draft has one identity and a history of versions. Revising it adds a version to that history; it
 * never makes a disconnected copy. A revision names the version it starts from, so two edits made from
 * the same version cannot silently overwrite each other.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { text } from "../text";
import type { ArtifactKind, ArtifactState, ContextRef } from "./schema";

export const MAX_CONTENT = 200_000;

type Author = { kind: "assistant"; runId: Id<"chatRuns"> } | { kind: "member"; memberId: Id<"members"> };

function content(value: string): string {
  if (value.length > MAX_CONTENT) throw userError("The document is too long to save.");
  if (!value.trim()) throw userError("The document is empty.");
  return value.replace(/\r\n/g, "\n");
}

/** A draft the member may read: in their company, and theirs. Anyone else gets "Not found.". */
export async function readableArtifact(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, memberId: Id<"members">, artifactId: string): Promise<Doc<"chatArtifacts">> {
  const id = ctx.db.normalizeId("chatArtifacts", artifactId);
  const artifact = id ? await ctx.db.get(id) : null;
  if (!artifact || artifact.companyId !== companyId || artifact.createdBy !== memberId) notFound();
  return artifact;
}

export async function versionOf(ctx: QueryCtx | MutationCtx, artifact: Doc<"chatArtifacts">, version = artifact.currentVersion): Promise<Doc<"chatArtifactVersions"> | null> {
  return ctx.db
    .query("chatArtifactVersions")
    .withIndex("by_company_artifact_version", (q) => q.eq("companyId", artifact.companyId).eq("artifactId", artifact._id).eq("version", version))
    .unique();
}

export async function createArtifact(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; memberId: Id<"members">; conversationId?: Id<"conversations">; title: string; kind: ArtifactKind; content: string; linked?: ContextRef[]; author: Author; actor: Actor },
): Promise<Id<"chatArtifacts">> {
  const now = Date.now();
  const artifactId = await ctx.db.insert("chatArtifacts", {
    companyId: input.companyId,
    createdBy: input.memberId,
    conversationId: input.conversationId,
    title: text(input.title, "The title", 160),
    kind: input.kind,
    currentVersion: 1,
    state: "draft",
    linked: input.linked?.slice(0, 10),
    updatedAt: now,
    createdAt: now,
  });
  await ctx.db.insert("chatArtifactVersions", { companyId: input.companyId, artifactId, version: 1, content: content(input.content), author: input.author, createdAt: now });
  await recordEvent(ctx, { companyId: input.companyId, type: "chat_artifact.created", actor: input.actor, subject: { table: "chatArtifacts", id: artifactId }, data: { kind: input.kind } });
  await ctx.scheduler.runAfter(0, internal.knowledge.index, { kind: "artifact", id: artifactId });
  return artifactId;
}

/**
 * Adds a version. Refused when the draft has moved past `baseVersion`, so a revision is always made from
 * what the reviser saw. A new version of a document whose terms were approved is a draft again: the
 * approval was for the old words.
 */
export async function reviseArtifact(ctx: MutationCtx, artifact: Doc<"chatArtifacts">, input: { baseVersion: number; content: string; note?: string; title?: string; author: Author; actor: Actor }): Promise<number> {
  if (input.baseVersion !== artifact.currentVersion) {
    throw userError(`This draft changed since version ${input.baseVersion}; it is now at version ${artifact.currentVersion}. Open the latest version and revise that.`);
  }
  const current = await versionOf(ctx, artifact);
  const next = artifact.currentVersion + 1;
  const body = content(input.content);
  if (current && current.content === body && (!input.title || input.title.trim() === artifact.title)) return artifact.currentVersion;
  const now = Date.now();
  await ctx.db.insert("chatArtifactVersions", { companyId: artifact.companyId, artifactId: artifact._id, version: next, content: body, author: input.author, note: input.note?.trim().slice(0, 300) || undefined, createdAt: now });
  const reopened = artifact.state !== "draft";
  await ctx.db.patch(artifact._id, {
    currentVersion: next,
    updatedAt: now,
    title: input.title ? text(input.title, "The title", 160) : artifact.title,
    ...(reopened ? { state: "draft" as const, approvedVersion: undefined, stateNote: `Version ${next} changed the document after it was marked ${STATE_WORDS[artifact.state].toLowerCase()}; it is a draft again.`, stateAt: now } : {}),
  });
  await recordEvent(ctx, { companyId: artifact.companyId, type: "chat_artifact.revised", actor: input.actor, subject: { table: "chatArtifacts", id: artifact._id }, data: { version: next, reopened } });
  await ctx.scheduler.runAfter(0, internal.knowledge.index, { kind: "artifact", id: artifact._id });
  return next;
}

export const STATE_WORDS: Record<ArtifactState, string> = {
  draft: "Draft",
  terms_approved: "Terms approved",
  sent: "Sent (recorded by a person)",
  signed: "Signed (recorded by a person)",
};

const ORDER: ArtifactState[] = ["draft", "terms_approved", "sent", "signed"];

/**
 * A person records what happened to a document, for the version they are looking at. No signing service
 * is connected, so "sent" and "signed" are a person's record of something done outside Selestial.
 */
export async function setArtifactState(ctx: MutationCtx, artifact: Doc<"chatArtifacts">, input: { version: number; state: ArtifactState; note?: string; memberId: Id<"members"> }): Promise<void> {
  if (input.version !== artifact.currentVersion) throw userError(`That is version ${input.version}, but the document is at version ${artifact.currentVersion}. Review the latest version first.`);
  if (input.state === "draft") {
    await ctx.db.patch(artifact._id, { state: "draft", approvedVersion: undefined, stateNote: input.note?.trim().slice(0, 500) || undefined, stateBy: input.memberId, stateAt: Date.now() });
  } else {
    const from = ORDER.indexOf(artifact.state);
    const to = ORDER.indexOf(input.state);
    if (to !== from + 1) throw userError(`A ${STATE_WORDS[artifact.state].toLowerCase()} document can next be marked ${STATE_WORDS[ORDER[from + 1] ?? "signed"].toLowerCase()}, one step at a time.`);
    await ctx.db.patch(artifact._id, {
      state: input.state,
      approvedVersion: input.state === "terms_approved" ? input.version : artifact.approvedVersion,
      stateNote: input.note?.trim().slice(0, 500) || undefined,
      stateBy: input.memberId,
      stateAt: Date.now(),
    });
  }
  await recordEvent(ctx, { companyId: artifact.companyId, type: `chat_artifact.${input.state}`, actor: { kind: "member", memberId: input.memberId }, subject: { table: "chatArtifacts", id: artifact._id }, data: { version: input.version } });
}

/** Unresolved fields are written [[TO CONFIRM: what]]. A person sees how many are left before approving. */
export function unresolvedFields(markdown: string): string[] {
  return [...markdown.matchAll(/\[\[TO CONFIRM:\s*([^\]]+?)\s*\]\]/g)].map((match) => match[1]).slice(0, 100);
}
