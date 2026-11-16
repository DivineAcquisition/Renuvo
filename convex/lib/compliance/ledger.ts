/**
 * The two append-only records in this area: the history of every permission change, and the agreements
 * a company accepted. This file is the only place that writes them, and it only inserts. Nothing changes
 * or removes a row; convex/compliance.test.ts checks the source for it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { DocumentKind } from "../trust/documents";
import type { PermissionStatus } from "./schema";

/** Copies a permission as it now stands into the history, with the status it had before. */
export async function appendPermissionHistory(ctx: MutationCtx, row: Doc<"contactPermissions">, previousStatus: PermissionStatus | null): Promise<Id<"permissionHistory">> {
  return ctx.db.insert("permissionHistory", {
    companyId: row.companyId,
    permissionId: row._id,
    recipient: row.recipient,
    channel: row.channel,
    category: row.category,
    status: row.status,
    previousStatus,
    source: row.source,
    disclosureId: row.disclosureId,
    disclosureText: row.disclosureText,
    evidence: row.evidence,
    recordedBy: row.recordedBy,
    stopKeyword: row.stopKeyword,
    at: row.at,
  });
}

export async function appendAcceptance(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; documentId: string; kind: DocumentKind; memberId: Id<"members">; userId: string; at: number },
): Promise<Id<"agreementAcceptances">> {
  return ctx.db.insert("agreementAcceptances", {
    companyId: input.companyId,
    documentId: input.documentId,
    kind: input.kind,
    acceptedBy: { memberId: input.memberId, userId: input.userId },
    at: input.at,
  });
}
