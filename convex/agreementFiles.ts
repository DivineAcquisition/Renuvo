/**
 * Uploading existing agreements and supporting records, in three steps so nothing is lost or mislabeled:
 *  1. `register`: the file is received and kept exactly as it came;
 *  2. `inspect` (a scheduled action, because only actions can read stored files): checks the file's real
 *     type, reads text where it can, and suggests what the file is. A file that fails is removed; an
 *     extraction that fails keeps the original;
 *  3. `finalize`: a person says what it is, and it becomes an agreement or a supporting record.
 *
 * A file is never treated as signed because it was uploaded: a signed upload needs a named person's
 * verification, recorded as theirs. Selestial does not scan files for malware.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { companyMutation, companyQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { can, mayDraft, mayRead, readableClasses } from "./lib/agreements/access";
import { docType, SUPPORTING_KINDS } from "./lib/agreements/catalog";
import { contentHash } from "./lib/agreements/compose";
import { classify, checkFile, MAX_TEXT, supportingAccess } from "./lib/agreements/upload";
import { createAgreement, load, prefill } from "./lib/agreements/store";

const linkInput = v.object({ table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("applications")), id: v.string() });
const supportingKeys = SUPPORTING_KINDS.map((k) => k.key) as string[];
const DAY = 24 * 60 * 60 * 1000;

export const uploadUrl = companyMutation({
  args: {},
  handler: async (ctx) => {
    if (!can(ctx.role, "draft")) throw userError("Your role cannot upload agreements.", "not_allowed");
    if (!(await allow(ctx, `agreement.upload:${ctx.member._id}`, 20, 10 * 60 * 1000))) throw userError("Too many uploads in a few minutes. Wait a moment.", "limit");
    return ctx.storage.generateUploadUrl();
  },
});

/** Step 1: the file is received. Its declared type and size are checked now; its contents are checked next. */
export const register = companyMutation({
  args: { storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, args) => {
    if (!can(ctx.role, "draft")) throw userError("Your role cannot upload agreements.", "not_allowed");
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) throw userError("That upload was not found. Try again.");
    const taken = await ctx.db.query("agreementFiles").withIndex("by_storage", (q) => q.eq("storageId", args.storageId)).first();
    if (taken) throw userError("That file was already added.");
    const name = args.name.trim().slice(0, 200) || "Uploaded file";
    const early = checkFile({ name, contentType: meta.contentType ?? "", size: meta.size, head: new Uint8Array() });
    // An obviously wrong type or size is refused here. A type whose contents cannot be checked yet is checked in `inspect`.
    if (!early.ok && !/contents do not match|binary/.test(early.why)) {
      await ctx.storage.delete(args.storageId);
      throw userError(early.why);
    }
    const id = await ctx.db.insert("agreementFiles", { companyId: ctx.companyId, storageId: args.storageId, name, contentType: meta.contentType ?? "application/octet-stream", size: meta.size, sha256: meta.sha256, classification: "unclassified", access: "restricted", extraction: { state: "pending" }, scan: "not_scanned", uploadedBy: ctx.member._id, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.agreementFiles.inspect, { fileId: id });
    return id;
  },
});

export const toInspect = internalQuery({
  args: { fileId: v.id("agreementFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    return file && file.extraction.state === "pending" ? { storageId: file.storageId, name: file.name, contentType: file.contentType, size: file.size } : null;
  },
});

/** Step 2. Reads the stored file: its first bytes decide whether it is what it says, and plain text is extracted. */
export const inspect = internalAction({
  args: { fileId: v.id("agreementFiles") },
  handler: async (ctx, args): Promise<null> => {
    const file = await ctx.runQuery(internal.agreementFiles.toInspect, args);
    if (!file) return null;
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) {
      await ctx.runMutation(internal.agreementFiles.inspected, { fileId: args.fileId, ok: false, why: "The file could not be read from storage." });
      return null;
    }
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const checked = checkFile({ name: file.name, contentType: file.contentType, size: file.size, head });
    if (!checked.ok) {
      await ctx.runMutation(internal.agreementFiles.inspected, { fileId: args.fileId, ok: false, why: checked.why });
      return null;
    }
    let text: string | undefined;
    let extraction: { state: "read" | "failed" | "not_supported"; note?: string } = { state: "not_supported", note: "Selestial cannot read this kind of file yet. The original is kept and can be downloaded; add the key terms by hand." };
    if (checked.readable) {
      try {
        const raw = (await blob.text()).replace(/\r\n/g, "\n").slice(0, MAX_TEXT);
        if (raw.trim()) {
          text = raw;
          extraction = { state: "read" };
        } else extraction = { state: "failed", note: "The file has no text. The original is kept." };
      } catch {
        extraction = { state: "failed", note: "The text could not be read. The original is kept." };
      }
    }
    await ctx.runMutation(internal.agreementFiles.inspected, { fileId: args.fileId, ok: true, contentType: checked.contentType, text, extraction });
    return null;
  },
});

export const inspected = internalMutation({
  args: { fileId: v.id("agreementFiles"), ok: v.boolean(), why: v.optional(v.string()), contentType: v.optional(v.string()), text: v.optional(v.string()), extraction: v.optional(v.object({ state: v.union(v.literal("read"), v.literal("failed"), v.literal("not_supported")), note: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.extraction.state !== "pending") return null;
    if (!args.ok) {
      // A file that is not what it claims is removed; nothing about it is kept but the reason.
      await ctx.storage.delete(file.storageId);
      await ctx.db.patch(file._id, { extraction: { state: "rejected", note: args.why }, size: 0 });
      return null;
    }
    const suggestion = classify(file.name, args.text ?? null);
    await ctx.db.patch(file._id, { contentType: args.contentType ?? file.contentType, extraction: args.extraction!, text: args.text, suggestion: { classification: suggestion.classification, docType: suggestion.docType, supportingKind: suggestion.supportingKind, confidence: suggestion.confidence, reasons: suggestion.reasons } });
    return null;
  },
});

/** Where an upload stands, for the uploader (or anyone who may draft) while it is inspected. */
export const status = companyQuery({
  args: { fileId: v.id("agreementFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.companyId !== ctx.companyId || file.uploadedBy !== ctx.member._id) throw userError("Not found.", "not_found");
    return { id: file._id, name: file.name, extraction: file.extraction, suggestion: file.suggestion ?? null, classification: file.classification, agreementId: file.agreementId ?? null, ready: file.extraction.state !== "pending" && file.extraction.state !== "rejected" };
  },
});

/** Step 3. A person says what the file is. Until then it is not an agreement and not a supporting record. */
export const finalize = companyMutation({
  args: {
    fileId: v.id("agreementFiles"),
    classification: v.union(v.literal("agreement"), v.literal("supporting")),
    docType: v.optional(v.string()),
    supportingKind: v.optional(v.string()),
    links: v.optional(v.array(linkInput)),
    expiresOn: v.optional(v.string()),
    /** The uploader says this was signed outside Selestial. It is recorded as their verification, never as a collected signature. */
    externallySigned: v.optional(v.object({ signedOn: v.optional(v.string()), signers: v.array(v.string()), note: v.string() })),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.companyId !== ctx.companyId || file.uploadedBy !== ctx.member._id) throw userError("Not found.", "not_found");
    if (file.classification !== "unclassified") throw userError("This file was already filed.");
    if (file.extraction.state === "pending") throw userError("Selestial is still checking this file. Try again in a moment.");
    if (file.extraction.state === "rejected") throw userError(file.extraction.note ?? "This file was not accepted.");
    const now = Date.now();
    for (const link of args.links ?? []) await prefill(ctx, [link]);
    const linkedWorker = (args.links ?? []).some((l) => l.table === "cleaners" || l.table === "applications");

    if (args.classification === "supporting") {
      const kind = args.supportingKind ?? file.suggestion?.supportingKind ?? "other_record";
      if (!supportingKeys.includes(kind)) throw userError("That is not a supporting record kind.");
      const access = supportingAccess(kind as never, linkedWorker);
      if (!mayDraft(ctx.role, access)) throw userError("Your role cannot add this kind of record.", "not_allowed");
      const first = (args.links ?? [])[0];
      const known = first ? await prefill(ctx, [first]) : null;
      await ctx.db.patch(file._id, { classification: "supporting", supportingKind: kind, access, text: undefined, linked: first && known?.labels[0] ? { table: first.table, id: first.id, label: known.labels[0].label } : undefined, expiresOn: args.expiresOn });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement_file.added", actor: byMember(ctx), subject: { table: "agreementFiles", id: file._id }, data: { kind, classification: "supporting" } });
      return { agreementId: null, fileId: file._id };
    }

    const typeKey = args.docType ?? file.suggestion?.docType;
    if (!typeKey) throw userError("Choose which kind of agreement this is.");
    const type = docType(typeKey);
    if (args.externallySigned) {
      if (!can(ctx.role, "approve") || !mayRead(ctx.role, type.access)) throw userError("Only an Owner or Manager can record that a document was signed elsewhere.", "not_allowed");
      if (!args.externallySigned.note.trim() || args.externallySigned.signers.filter((s) => s.trim()).length === 0) throw userError("To record a document as signed elsewhere, name who signed and say how you verified it.");
    }
    const name = file.name;
    const markdown = file.text ?? `# ${name}\n\nThe original file is attached to this agreement. ${file.extraction.note ?? ""}`.trim();
    const agreementId = await createAgreement(ctx, { docType: type.key, title: name.replace(/\.[a-z0-9]+$/i, ""), origin: "upload", links: args.links, kit: { clauses: [] }, note: "Imported from an uploaded file" });
    const created = (await ctx.db.get(agreementId))!;
    const first = await ctx.db.query("agreementVersions").withIndex("by_company_agreement_version", (q) => q.eq("companyId", ctx.companyId).eq("agreementId", agreementId).eq("version", 1)).unique();
    if (first) await ctx.db.patch(first._id, { markdown, hash: contentHash(markdown), unresolved: [] });
    await ctx.db.patch(file._id, { classification: "agreement", agreementId, access: type.access, text: undefined, expiresOn: args.expiresOn });
    await ctx.db.patch(agreementId, { originalFileId: file._id });
    if (args.externallySigned) {
      const verification = { verifiedBy: ctx.member._id, verifiedAt: now, signedOn: args.externallySigned.signedOn, signers: args.externallySigned.signers.map((s) => s.trim()).filter(Boolean).slice(0, 10), note: args.externallySigned.note.trim().slice(0, 500) };
      await ctx.db.patch(agreementId, { provenance: "externally_signed", externalVerification: verification, workflow: "signed", signedVersion: 1, lifecycle: { ...created.lifecycle, ...(args.externallySigned.signedOn ? { effectiveOn: args.externallySigned.signedOn } : {}) }, updatedAt: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.external_signature_verified", actor: byMember(ctx), subject: { table: "agreements", id: agreementId }, data: { signers: verification.signers.length } });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement_file.added", actor: byMember(ctx), subject: { table: "agreementFiles", id: file._id }, data: { classification: "agreement", docType: type.key } });
    return { agreementId, fileId: file._id };
  },
});

/** A short-lived link to an original or a supporting record. Only people allowed to read the document get one; the download is recorded. */
export const downloadUrl = companyMutation({
  args: { fileId: v.id("agreementFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file || file.companyId !== ctx.companyId || file.classification === "unclassified" || !mayRead(ctx.role, file.access)) throw userError("Not found.", "not_found");
    if (file.agreementId) await load(ctx, file.agreementId);
    const url = await ctx.storage.getUrl(file.storageId);
    if (!url) throw userError("The file is no longer available.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement_file.downloaded", actor: byMember(ctx), subject: { table: "agreementFiles", id: file._id } });
    return { url, name: file.name, contentType: file.contentType };
  },
});

/** Supporting records (insurance, licenses, official forms), filtered by what the caller may see. */
export const supporting = companyQuery({
  args: { kind: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const classes = new Set(readableClasses(ctx.role));
    const rows = await ctx.db.query("agreementFiles").withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(300);
    return rows
      .filter((row) => row.classification === "supporting" && classes.has(row.access) && (!args.kind || row.supportingKind === args.kind))
      .map((row) => ({ id: row._id, name: row.name, kind: row.supportingKind ?? "other_record", kindLabel: SUPPORTING_KINDS.find((k) => k.key === row.supportingKind)?.label ?? "Other supporting record", size: row.size, linked: row.linked ?? null, expiresOn: row.expiresOn ?? null, extraction: row.extraction, createdAt: row.createdAt }));
  },
});

/** Uploads nobody filed within a day are removed, so abandoned files do not pile up in storage. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("agreementFiles").withIndex("by_company_created").order("asc").take(200);
    let removed = 0;
    for (const row of rows) {
      if (row.classification !== "unclassified" || Date.now() - row.createdAt < DAY) continue;
      if (row.extraction.state !== "rejected") await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return removed;
  },
});

export type FileId = Id<"agreementFiles">;
export type FileDoc = Doc<"agreementFiles">;
