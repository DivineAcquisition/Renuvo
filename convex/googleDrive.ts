/**
 * Google Drive, Docs and Sheets for a company: reading the files the Owner chose as knowledge, saving
 * records (photos, resumes, agreements, reports) into the folders the Owner chose, exporting an agreement
 * as a Google Doc, and the schedule as a Google Sheet. Every write is a googleJobs job with a key, so it
 * happens once even if asked twice.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { companyMutation, companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { can } from "./lib/agreements/access";
import { load as loadAgreement, versionRow } from "./lib/agreements/store";
import { requireFeature } from "./lib/google/connection";
import { enqueue } from "./lib/google/jobs";
import { localParts } from "./lib/availability";
import type { Role } from "./lib/roles";

const PURPOSES = ["photos", "resumes", "agreements", "reports", "creative", "documents"] as const;
export const purposeValidator = v.union(...PURPOSES.map((p) => v.literal(p)));

async function outputFolder(ctx: Parameters<typeof requireFeature>[0], companyId: Id<"companies">, purpose: (typeof PURPOSES)[number]): Promise<Doc<"googleResources">> {
  const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", companyId).eq("kind", "drive_output")).take(50);
  const folder = rows.find((r) => r.purpose === purpose && r.access !== "lost") ?? rows.find((r) => !r.purpose && r.access !== "lost");
  if (!folder) throw userError(`No Drive folder is chosen for ${purpose}. The Owner chooses one under Integrations › Google.`);
  return folder;
}

/** Reads the chosen knowledge sources again. The text is kept for Chat and proposed as company knowledge for the Owner to confirm. */
export const importKnowledge = ownerMutation({
  args: { resourceId: v.id("googleResources") },
  handler: async (ctx, args) => {
    const connection = await requireFeature(ctx, ctx.companyId, "drive");
    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.companyId !== ctx.companyId || resource.kind !== "drive_source") notFound();
    return enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "knowledge_import", key: `knowledge_import:${resource._id}:${Math.floor(Date.now() / 600_000)}`, payload: { resourceId: resource._id }, requestedBy: ctx.member._id });
  },
});

/**
 * Exports one version of an agreement as a Google Doc in the agreements folder. It is a copy for reading
 * and sharing: it does not send, approve or sign anything, and the agreement's state does not change.
 */
type Asker = MutationCtx & Parameters<typeof loadAgreement>[0] & { member: Doc<"members">; role: Role };

export async function queueAgreementExport(ctx: Asker, agreementId: string, version?: number) {
  const companyId = ctx.company._id;
  const agreement = await loadAgreement(ctx, agreementId);
  if (!can(ctx.role, "archiveExport")) throw userError("Your role cannot export agreements.", "not_allowed");
  const connection = await requireFeature(ctx, companyId, "drive");
  const folder = await outputFolder(ctx, companyId, "agreements");
  const row = await versionRow(ctx, agreement, version ?? agreement.signedVersion ?? agreement.currentVersion);
  const queued = await enqueue(ctx, { companyId, connectionId: connection._id, kind: "doc_export", key: `doc_export:${agreement._id}:v${row.version}`, payload: { agreementId: agreement._id, version: row.version, resourceId: folder._id }, requestedBy: ctx.member._id });
  await recordEvent(ctx, { companyId, type: "agreement.google_doc_requested", actor: byMember(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: row.version } });
  return { ...queued, agreementId: agreement._id, version: row.version, workflow: agreement.workflow };
}

/**
 * Exports one version of an agreement as a Google Doc in the agreements folder. It is a copy for reading
 * and sharing: it does not send, approve or sign anything, and the agreement's state does not change.
 */
export const exportAgreement = companyMutation({
  args: { agreementId: v.string(), version: v.optional(v.number()) },
  handler: async (ctx, args) => queueAgreementExport({ ...ctx, company: ctx.company }, args.agreementId, args.version),
});

/** Where each export of an agreement stands, with its Google link once it exists. */
export const exportsFor = companyQuery({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await loadAgreement({ ...ctx, company: ctx.company }, args.agreementId);
    const rows = [];
    for (let version = agreement.currentVersion; version >= 1 && rows.length < 10; version -= 1) {
      const job = await ctx.db.query("googleJobs").withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", `doc_export:${agreement._id}:v${version}`)).first();
      if (job) rows.push({ version, status: job.status, link: job.result ? ((JSON.parse(job.result) as { webViewLink?: string }).webViewLink ?? null) : null, error: job.lastError ?? null });
    }
    return rows;
  },
});

/** Saves an agreement's original file or a visit's photo to the folder chosen for it. */
export const saveRecordFile = companyMutation({
  args: { record: v.union(v.object({ table: v.literal("agreementFiles"), id: v.id("agreementFiles") }), v.object({ table: v.literal("evidence"), id: v.id("evidence") })) },
  handler: async (ctx, args) => {
    const connection = await requireFeature(ctx, ctx.companyId, "drive");
    let storageId: Id<"_storage">;
    let name: string;
    let purpose: (typeof PURPOSES)[number];
    let mimeType = "application/octet-stream";
    if (args.record.table === "agreementFiles") {
      const file = await ctx.db.get(args.record.id);
      if (!file || file.companyId !== ctx.companyId || file.classification === "unclassified") notFound();
      if (file.agreementId) await loadAgreement({ ...ctx, company: ctx.company }, file.agreementId);
      else if (file.access !== "company" && ctx.role !== "owner" && !(file.access === "workforce" && ctx.role === "manager")) notFound();
      storageId = file.storageId;
      name = file.name;
      mimeType = file.contentType;
      purpose = file.classification === "agreement" ? "agreements" : "documents";
    } else {
      const photo = await ctx.db.get(args.record.id);
      if (!photo || photo.companyId !== ctx.companyId) notFound();
      storageId = photo.storageId;
      name = `visit-${photo.jobId}-${photo.kind}-${photo.uploadedAt}.jpg`;
      mimeType = "image/jpeg";
      purpose = "photos";
    }
    const folder = await outputFolder(ctx, ctx.companyId, purpose);
    return enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "drive_upload", key: `drive_upload:${args.record.table}:${args.record.id}:${folder.externalId}`, payload: { resourceId: folder._id, storageId, name, mimeType }, requestedBy: ctx.member._id });
  },
});

/** The next two weeks of visits as a Google Sheet in the reports folder. Owners and Managers. */
export const exportSchedule = managerMutation({
  args: {},
  handler: async (ctx) => {
    const connection = await requireFeature(ctx, ctx.companyId, "drive");
    const folder = await outputFolder(ctx, ctx.companyId, "reports");
    const now = Date.now();
    const jobs = await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", now).lt("startsAt", now + 14 * 86_400_000)).take(500);
    const rows: (string | number)[][] = [["Date", "Start", "End", "Service", "Status", "Customer"]];
    const tz = ctx.company.timezone;
    const fmt = (at: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(at));
    for (const job of jobs) {
      const customer = await ctx.db.get(job.customerId);
      rows.push([localParts(job.startsAt, tz).day, fmt(job.startsAt), fmt(job.endsAt), job.serviceType, job.status, customer?.name ?? ""]);
    }
    const day = localParts(now, tz).day;
    return enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "sheet_export", key: `sheet_export:schedule:${day}:${jobs.length}:${jobs.map((j) => j._id).join("").slice(-24)}`, payload: { resourceId: folder._id, title: `Schedule from ${day}`, rows }, requestedBy: ctx.member._id });
  },
});

/** The text of the chosen knowledge sources, as last read. Readable by any member, like confirmed company knowledge. */
export const sources = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", "drive_source")).take(100);
    const out = [];
    for (const resource of rows) {
      const texts = await ctx.db.query("googleDriveTexts").withIndex("by_company_resource", (q) => q.eq("companyId", ctx.companyId).eq("resourceId", resource._id)).take(50);
      out.push({ resourceId: resource._id, label: resource.label, access: resource.access, files: texts.map((t) => ({ name: t.name, chars: t.text.length, fetchedAt: t.fetchedAt })) });
    }
    return out;
  },
});

// ── For the worker ──────────────────────────────────────────────────────────────────────────────

export const agreementText = internalQuery({
  args: { agreementId: v.id("agreements"), version: v.number() },
  handler: async (ctx, args) => {
    const agreement = await ctx.db.get(args.agreementId);
    if (!agreement) return null;
    const row = await ctx.db.query("agreementVersions").withIndex("by_company_agreement_version", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id).eq("version", args.version)).unique();
    return row ? { title: agreement.title, markdown: row.markdown, hash: row.hash, workflow: agreement.workflow } : null;
  },
});

export const storeTexts = internalMutation({
  args: { companyId: v.id("companies"), resourceId: v.id("googleResources"), files: v.array(v.object({ fileId: v.string(), name: v.string(), text: v.string() })), proposeBy: v.optional(v.id("members")) },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("googleDriveTexts").withIndex("by_company_resource", (q) => q.eq("companyId", args.companyId).eq("resourceId", args.resourceId)).take(100)) await ctx.db.delete(old._id);
    for (const file of args.files) await ctx.db.insert("googleDriveTexts", { companyId: args.companyId, resourceId: args.resourceId, fileId: file.fileId, name: file.name.slice(0, 200), text: file.text.slice(0, 200_000), fetchedAt: Date.now() });
    // Text from a document is a proposal: the Owner confirms it before it becomes company knowledge.
    if (args.proposeBy) {
      for (const file of args.files.slice(0, 10)) {
        await ctx.db.insert("companyKnowledge", { companyId: args.companyId, text: `From Google Drive, "${file.name}":\n${file.text.slice(0, 4000)}`, status: "proposed", proposedBy: args.proposeBy, createdAt: Date.now() });
      }
    }
    return null;
  },
});

/** The Google Doc copy of an agreement exists. Recorded on the agreement's history; its status is untouched. */
export const exported = internalMutation({
  args: { companyId: v.id("companies"), agreementId: v.id("agreements"), version: v.number(), link: v.string() },
  handler: async (ctx, args) => {
    const agreement = await ctx.db.get(args.agreementId);
    if (!agreement || agreement.companyId !== args.companyId) return null;
    await recordEvent(ctx, { companyId: args.companyId, type: "agreement.google_doc_exported", actor: { kind: "system" }, subject: { table: "agreements", id: agreement._id }, data: { version: args.version } });
    return null;
  },
});
