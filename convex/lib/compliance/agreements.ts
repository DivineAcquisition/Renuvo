/**
 * A company accepting Selestial's terms. An acceptance points at one exact version and is never changed
 * or removed: a new version needs a new acceptance.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent } from "../events";
import { currentVersion, type DocumentKind } from "../trust/documents";
import { appendAcceptance } from "./ledger";

export const NOT_CURRENT = "That is not the current version.";

/** The newest acceptance of one kind of agreement by this company, or null. */
export async function latestAcceptance(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, kind: DocumentKind): Promise<Doc<"agreementAcceptances"> | null> {
  const rows = await ctx.db
    .query("agreementAcceptances")
    .withIndex("by_company_at", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(100);
  return rows.find((row) => row.kind === kind) ?? null;
}

/**
 * Records the acceptance of the current terms. Accepting the same version again changes nothing and
 * answers with the first acceptance. Any other version is refused.
 */
export async function acceptTerms(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; documentId: string; memberId: Id<"members">; userId: string },
): Promise<{ acceptanceId: Id<"agreementAcceptances">; created: boolean }> {
  const terms = currentVersion("terms");
  if (input.documentId !== terms.id) throw userError(NOT_CURRENT);
  const existing = await ctx.db
    .query("agreementAcceptances")
    .withIndex("by_company_document", (q) => q.eq("companyId", input.companyId).eq("documentId", terms.id))
    .first();
  if (existing) return { acceptanceId: existing._id, created: false };
  const acceptanceId = await appendAcceptance(ctx, { companyId: input.companyId, documentId: terms.id, kind: "terms", memberId: input.memberId, userId: input.userId, at: Date.now() });
  await recordEvent(ctx, {
    companyId: input.companyId,
    type: "agreement.accepted",
    actor: { kind: "member", memberId: input.memberId },
    subject: { table: "agreementAcceptances", id: acceptanceId },
    data: { documentId: terms.id, kind: "terms" },
  });
  return { acceptanceId, created: true };
}
