/**
 * Recording a recipient's choice and keeping suppressions. Every permission change updates the one
 * current row and appends a copy to the history; every suppression change is an event.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { appendPermissionHistory } from "./ledger";
import type { Category, Channel, PermissionSource, PermissionStatus, Recipient, RecordedBy, SuppressionReason, SuppressionScope } from "./schema";
import { CATEGORIES } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export async function currentPermission(ctx: Ctx, companyId: Id<"companies">, recipient: Recipient, channel: Channel, category: Category): Promise<Doc<"contactPermissions"> | null> {
  return ctx.db
    .query("contactPermissions")
    .withIndex("by_company_recipient", (q) => q.eq("companyId", companyId).eq("recipient.kind", recipient.kind).eq("recipient.id", recipient.id).eq("channel", channel).eq("category", category))
    .unique();
}

export async function recipientPermissions(ctx: Ctx, companyId: Id<"companies">, recipient: Recipient): Promise<Doc<"contactPermissions">[]> {
  return ctx.db
    .query("contactPermissions")
    .withIndex("by_company_recipient", (q) => q.eq("companyId", companyId).eq("recipient.kind", recipient.kind).eq("recipient.id", recipient.id))
    .take(20);
}

export type PermissionChange = {
  companyId: Id<"companies">;
  recipient: Recipient;
  channel: Channel;
  category: Category;
  status: PermissionStatus;
  source: PermissionSource;
  /** Leave out to keep the wording already on the row. */
  disclosureId?: Id<"consentDisclosures">;
  disclosureText?: string;
  evidence?: string;
  recordedBy: RecordedBy;
  stopKeyword?: boolean;
  at: number;
  actor: Actor;
};

/** Sets the current answer and appends it to the history. The wording a person agreed to stays on the row after a withdrawal. */
export async function setPermission(ctx: MutationCtx, change: PermissionChange): Promise<Doc<"contactPermissions">> {
  const existing = await currentPermission(ctx, change.companyId, change.recipient, change.channel, change.category);
  const fields = {
    status: change.status,
    source: change.source,
    evidence: change.evidence,
    recordedBy: change.recordedBy,
    stopKeyword: change.stopKeyword || undefined,
    at: change.at,
    ...(change.disclosureId !== undefined || change.disclosureText !== undefined ? { disclosureId: change.disclosureId, disclosureText: change.disclosureText } : {}),
  };
  let id: Id<"contactPermissions">;
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    id = existing._id;
  } else {
    id = await ctx.db.insert("contactPermissions", { companyId: change.companyId, recipient: change.recipient, channel: change.channel, category: change.category, ...fields });
  }
  const row = (await ctx.db.get(id))!;
  await appendPermissionHistory(ctx, row, existing?.status ?? null);
  await recordEvent(ctx, {
    companyId: change.companyId,
    type: change.status === "granted" ? "consent.granted" : "consent.withdrawn",
    actor: change.actor,
    subject: { table: "contactPermissions", id },
    data: { recipientKind: change.recipient.kind, recipientId: change.recipient.id, channel: change.channel, category: change.category, source: change.source, previous: existing?.status ?? null },
  });
  return row;
}

/** Withdraws every granted permission this recipient has on a channel. Answers with the categories it withdrew. */
export async function withdrawChannel(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; recipient: Recipient; channel: Channel; categories?: readonly Category[]; source: PermissionSource; recordedBy: RecordedBy; stopKeyword?: boolean; evidence?: string; actor: Actor; at: number },
): Promise<Category[]> {
  const withdrawn: Category[] = [];
  for (const category of input.categories ?? CATEGORIES) {
    const row = await currentPermission(ctx, input.companyId, input.recipient, input.channel, category);
    if (!row || row.status !== "granted") continue;
    await setPermission(ctx, { companyId: input.companyId, recipient: input.recipient, channel: input.channel, category, status: "withdrawn", source: input.source, evidence: input.evidence, recordedBy: input.recordedBy, stopKeyword: input.stopKeyword, at: input.at, actor: input.actor });
    withdrawn.push(category);
  }
  return withdrawn;
}

// ── Suppressions ─────────────────────────────────────────────────────────────────────────────────

export async function activeSuppressions(ctx: Ctx, companyId: Id<"companies">, channel: Channel, address: string): Promise<Doc<"suppressions">[]> {
  const rows = await ctx.db
    .query("suppressions")
    .withIndex("by_company_channel_address", (q) => q.eq("companyId", companyId).eq("channel", channel).eq("address", address))
    .take(50);
  return rows.filter((row) => row.liftedAt === undefined);
}

/** The suppression that stops this category at this address now, if any. A scope of "all" stops every category. */
export function blockingSuppression(rows: Doc<"suppressions">[], category: Category): Doc<"suppressions"> | null {
  return rows.find((row) => row.liftedAt === undefined && (row.scope === "all" || row.scope === category)) ?? null;
}

/** Adds a suppression unless an identical one is already in force. Answers with the one in force and whether it is new. */
export async function addSuppression(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; channel: Channel; address: string; scope: SuppressionScope; reason: SuppressionReason; sourceMessage?: string; note?: string; at: number; actor: Actor },
): Promise<{ suppression: Doc<"suppressions">; created: boolean }> {
  const active = await activeSuppressions(ctx, input.companyId, input.channel, input.address);
  const same = active.find((row) => row.scope === input.scope && row.reason === input.reason);
  if (same) return { suppression: same, created: false };
  const id = await ctx.db.insert("suppressions", {
    companyId: input.companyId,
    channel: input.channel,
    address: input.address,
    scope: input.scope,
    reason: input.reason,
    at: input.at,
    sourceMessage: input.sourceMessage,
    note: input.note,
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "suppression.added", actor: input.actor, subject: { table: "suppressions", id }, data: { channel: input.channel, scope: input.scope, reason: input.reason } });
  return { suppression: (await ctx.db.get(id))!, created: true };
}

export async function liftSuppression(ctx: MutationCtx, row: Doc<"suppressions">, input: { liftedBy: RecordedBy; note?: string; actor: Actor }): Promise<void> {
  await ctx.db.patch(row._id, { liftedAt: Date.now(), liftedBy: input.liftedBy, liftNote: input.note });
  await recordEvent(ctx, { companyId: row.companyId, type: "suppression.lifted", actor: input.actor, subject: { table: "suppressions", id: row._id }, data: { channel: row.channel, scope: row.scope, reason: row.reason } });
}

/** What a person reads about where an opt-out came from: at most 200 characters, with any link taken out. */
export function excerpt(body: string): string {
  return body.replace(/https?:\/\/\S+/gi, "[link]").replace(/\s+/g, " ").trim().slice(0, 200);
}
