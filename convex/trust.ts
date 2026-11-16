/**
 * The trust registry: who Selestial is, how to reach it, which providers handle data, what it claims
 * about security and on what evidence, and which documents are published.
 *
 * Anyone may read `publicSnapshot`, which goes through `publicView` and shows only what is verified and
 * meant for the public. Staff read everything. Only staff admins change anything, every change needs a
 * note, and every change is written to the trust change log with what it was before and after.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { publicQuery, staffMutation, staffQuery, type StaffAccess } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { email, text } from "./lib/text";
import { logTrustChange, type TrustAuthor } from "./lib/trust/changes";
import { dateOnly } from "./lib/trust/checks";
import { DOCUMENT_VERSIONS, versionById } from "./lib/trust/documents";
import {
  claimAreaValidator,
  claimStatusValidator,
  contactsValidator,
  providerStatusValidator,
  publicationStatusValidator,
  reviewStatusValidator,
  verifiedValidator,
} from "./lib/trust/schema";
import { publicView, SEED, SEED_PUBLISHED_AT, type PublicSnapshot } from "./lib/trust/seed";

const SETTINGS_KEY = "public";

// ── Small checks ──────────────────────────────────────────────────────────────────────────────────

function key(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(trimmed)) throw userError("The key must be lower-case letters, digits and dashes.");
  return trimmed;
}

function nullableText(value: string | null, label: string, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw userError(`${label} is too long.`);
  return trimmed;
}

function webAddress(value: string | null): string | null {
  const trimmed = nullableText(value, "The policy address", 500);
  if (trimmed === null) return null;
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(trimmed)) throw userError("The policy address must start with https://.");
  return trimmed;
}

function author(ctx: StaffAccess): TrustAuthor {
  return { staffId: ctx.staff._id, name: ctx.staff.name };
}

/** A row's own fields, without the ids Convex adds, for the change log. */
function content(row: { _id: unknown; _creationTime: unknown } | null): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };
  delete out._id;
  delete out._creationTime;
  return out;
}

async function settingsRow(ctx: QueryCtx | MutationCtx) {
  return ctx.db
    .query("trustSettings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
}

// ── Public ────────────────────────────────────────────────────────────────────────────────────────

/**
 * What anyone may see, signed in or not. Unverified names and contacts are null; providers only when in
 * use or connected; claims only when public and verified. Never evidence, notes, staff names or
 * request data. Before the record is seeded, the seed itself is shown through the same filter.
 */
export const publicSnapshot = publicQuery({
  args: {},
  handler: async (ctx): Promise<PublicSnapshot> => {
    const settings = await settingsRow(ctx);
    if (!settings) return publicView({ ...SEED, updatedAt: SEED_PUBLISHED_AT });
    const providers = await ctx.db.query("trustProviders").take(200);
    const claims = await ctx.db.query("trustClaims").take(200);
    const publications = await ctx.db.query("policyPublications").take(200);
    const latest = await ctx.db.query("trustChanges").withIndex("by_at").order("desc").first();
    return publicView({
      settings,
      providers,
      claims,
      publications,
      updatedAt: Math.max(settings.updatedAt, latest?.at ?? 0),
    });
  },
});

// ── Staff reads ───────────────────────────────────────────────────────────────────────────────────

/** Everything in the registry, with evidence and review state. Documents with no row show as "draft". */
export const admin = staffQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsRow(ctx);
    const providers = await ctx.db.query("trustProviders").take(200);
    const claims = await ctx.db.query("trustClaims").take(200);
    const rows = await ctx.db.query("policyPublications").take(200);
    const byDocument = new Map(rows.map((row) => [row.documentId, row]));
    return {
      seeded: settings !== null,
      settings,
      providers: [...providers].sort((a, b) => a.name.localeCompare(b.name)),
      claims: [...claims].sort((a, b) => a.key.localeCompare(b.key)),
      publications: DOCUMENT_VERSIONS.map((version) => {
        const row = byDocument.get(version.id);
        return {
          documentId: version.id,
          kind: version.kind,
          title: version.title,
          effectiveOn: version.effectiveOn,
          recorded: Boolean(row),
          status: row?.status ?? ("draft" as const),
          publishedAt: row?.publishedAt ?? null,
          publishedBy: row?.publishedBy ?? null,
          approvalNote: row?.approvalNote ?? null,
        };
      }),
      viewer: { role: ctx.staff.role, canEdit: ctx.staff.role === "admin" },
    };
  },
});

/** The trust change log, newest first. */
export const changes = staffQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 50)));
    return ctx.db.query("trustChanges").withIndex("by_at").order("desc").take(limit);
  },
});

// ── Staff writes: admins only, each with a note ───────────────────────────────────────────────────

export const updateSettings = staffMutation({
  adminOnly: true,
  args: {
    legalEntity: v.optional(v.string()),
    mailingAddress: v.optional(v.string()),
    governingPlace: v.optional(v.string()),
    contacts: v.optional(contactsValidator),
    securityTxtExpiresOn: v.optional(v.string()),
    verified: v.optional(verifiedValidator),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const note = text(args.note, "A note", 500);
    const before = await settingsRow(ctx);
    const base = before ?? { key: SETTINGS_KEY, ...SEED.settings, updatedAt: 0, updatedBy: "seed" };
    const next = {
      key: SETTINGS_KEY,
      legalEntity: args.legalEntity === undefined ? base.legalEntity : text(args.legalEntity, "The legal name", 200),
      mailingAddress: args.mailingAddress === undefined ? base.mailingAddress : text(args.mailingAddress, "The mailing address", 300),
      governingPlace: args.governingPlace === undefined ? base.governingPlace : text(args.governingPlace, "The governing law place", 200),
      contacts: args.contacts
        ? { security: email(args.contacts.security, "The security contact"), privacy: email(args.contacts.privacy, "The privacy contact"), support: email(args.contacts.support, "The support contact") }
        : base.contacts,
      securityTxtExpiresOn: args.securityTxtExpiresOn === undefined ? base.securityTxtExpiresOn : dateOnly(args.securityTxtExpiresOn, "The security.txt expiry"),
      verified: args.verified ?? base.verified,
      updatedAt: Date.now(),
      updatedBy: ctx.staff._id as string,
    };
    if (before) await ctx.db.replace(before._id, next);
    else await ctx.db.insert("trustSettings", next);
    await logTrustChange(ctx, { table: "trustSettings", key: SETTINGS_KEY, before: content(before), after: next, by: author(ctx), note });
    return null;
  },
});

export const upsertProvider = staffMutation({
  adminOnly: true,
  args: {
    key: v.string(),
    name: v.string(),
    purpose: v.string(),
    dataHandled: v.string(),
    locations: v.union(v.string(), v.null()),
    agreementRef: v.union(v.string(), v.null()),
    policyUrl: v.union(v.string(), v.null()),
    status: providerStatusValidator,
    reviewStatus: reviewStatusValidator,
    reviewedOn: v.string(),
    publicNote: v.optional(v.string()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const note = text(args.note, "A note", 500);
    const providerKey = key(args.key);
    const publicNote = nullableText(args.publicNote ?? null, "The public note", 300);
    const next = {
      key: providerKey,
      name: text(args.name, "The name", 80),
      purpose: text(args.purpose, "The purpose", 200),
      dataHandled: text(args.dataHandled, "The data handled", 600),
      locations: nullableText(args.locations, "The locations", 300),
      agreementRef: nullableText(args.agreementRef, "The agreement", 300),
      policyUrl: webAddress(args.policyUrl),
      status: args.status,
      reviewStatus: args.reviewStatus,
      reviewedOn: dateOnly(args.reviewedOn, "The review date"),
      ...(publicNote ? { publicNote } : {}),
    };
    const before = await ctx.db
      .query("trustProviders")
      .withIndex("by_key", (q) => q.eq("key", providerKey))
      .unique();
    if (before) await ctx.db.replace(before._id, next);
    else await ctx.db.insert("trustProviders", next);
    await logTrustChange(ctx, { table: "trustProviders", key: providerKey, before: content(before), after: next, by: author(ctx), note });
    return null;
  },
});

export const removeProvider = staffMutation({
  adminOnly: true,
  args: { key: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const note = text(args.note, "A note", 500);
    const row = await ctx.db
      .query("trustProviders")
      .withIndex("by_key", (q) => q.eq("key", args.key.trim().toLowerCase()))
      .unique();
    if (!row) notFound();
    await ctx.db.delete(row._id);
    await logTrustChange(ctx, { table: "trustProviders", key: row.key, before: content(row), after: null, by: author(ctx), note });
    return null;
  },
});

export const upsertClaim = staffMutation({
  adminOnly: true,
  args: {
    key: v.string(),
    area: claimAreaValidator,
    text: v.string(),
    evidence: v.string(),
    status: claimStatusValidator,
    reviewedOn: v.string(),
    public: v.boolean(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const note = text(args.note, "A note", 500);
    // A sentence is said in public only when it is built and someone checked the evidence.
    if (args.public && args.status !== "implemented_verified") throw userError("A claim can be public only when it is implemented and verified.");
    const claimKey = key(args.key);
    const next = {
      key: claimKey,
      area: args.area,
      text: text(args.text, "The claim", 400),
      evidence: text(args.evidence, "The evidence", 2000),
      status: args.status,
      reviewedOn: dateOnly(args.reviewedOn, "The review date"),
      public: args.public,
    };
    const before = await ctx.db
      .query("trustClaims")
      .withIndex("by_key", (q) => q.eq("key", claimKey))
      .unique();
    if (before) await ctx.db.replace(before._id, next);
    else await ctx.db.insert("trustClaims", next);
    await logTrustChange(ctx, { table: "trustClaims", key: claimKey, before: content(before), after: next, by: author(ctx), note });
    return null;
  },
});

export const setPublication = staffMutation({
  adminOnly: true,
  args: { documentId: v.string(), status: publicationStatusValidator, note: v.string(), approvalNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const note = text(args.note, "A note", 500);
    const version = versionById(args.documentId);
    if (!version) throw userError("There is no document with that id.");
    const before = await ctx.db
      .query("policyPublications")
      .withIndex("by_document", (q) => q.eq("documentId", version.id))
      .unique();
    const approvalNote = args.approvalNote === undefined ? before?.approvalNote : text(args.approvalNote, "The approval note", 500);
    const publishing = args.status === "published" && before?.status !== "published";
    const next: Omit<Doc<"policyPublications">, "_id" | "_creationTime"> = {
      documentId: version.id,
      status: args.status,
      // Publishing stamps the time and who; withdrawing keeps when it was first published.
      publishedAt: publishing ? Date.now() : before?.publishedAt,
      publishedBy: publishing ? (ctx.staff._id as string) : before?.publishedBy,
      approvalNote,
    };
    if (before) await ctx.db.replace(before._id, next);
    else await ctx.db.insert("policyPublications", next);
    await logTrustChange(ctx, { table: "policyPublications", key: version.id, before: content(before), after: next, by: author(ctx), note });
    return null;
  },
});

// ── Seed ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Writes the owner-confirmed trust record (convex/lib/trust/seed.ts) into an empty deployment. Run
 * again, it adds only what is missing and never overwrites what staff changed since.
 * `npx convex run trust:seed`.
 */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const by: TrustAuthor = { name: "seed" };
    const note = "Seeded from the facts the owner confirmed on 2026-11-16.";
    const added = { settings: 0, providers: 0, claims: 0, publications: 0 };
    if (!(await settingsRow(ctx))) {
      const row = { key: SETTINGS_KEY, ...SEED.settings, updatedAt: Date.now(), updatedBy: "seed" };
      await ctx.db.insert("trustSettings", row);
      await logTrustChange(ctx, { table: "trustSettings", key: SETTINGS_KEY, before: null, after: row, by, note });
      added.settings += 1;
    }
    for (const provider of SEED.providers) {
      const found = await ctx.db
        .query("trustProviders")
        .withIndex("by_key", (q) => q.eq("key", provider.key))
        .unique();
      if (found) continue;
      await ctx.db.insert("trustProviders", provider);
      await logTrustChange(ctx, { table: "trustProviders", key: provider.key, before: null, after: provider, by, note });
      added.providers += 1;
    }
    for (const claim of SEED.claims) {
      const found = await ctx.db
        .query("trustClaims")
        .withIndex("by_key", (q) => q.eq("key", claim.key))
        .unique();
      if (found) continue;
      await ctx.db.insert("trustClaims", claim);
      await logTrustChange(ctx, { table: "trustClaims", key: claim.key, before: null, after: claim, by, note });
      added.claims += 1;
    }
    for (const publication of SEED.publications) {
      const found = await ctx.db
        .query("policyPublications")
        .withIndex("by_document", (q) => q.eq("documentId", publication.documentId))
        .unique();
      if (found) continue;
      await ctx.db.insert("policyPublications", publication);
      await logTrustChange(ctx, { table: "policyPublications", key: publication.documentId, before: null, after: publication, by, note });
      added.publications += 1;
    }
    return added;
  },
});
