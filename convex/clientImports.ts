/**
 * Importing clients and their properties from a spreadsheet or another system (lib/clients/importing.ts).
 *
 * Check first: every row is shown with its problems, the existing clients it may duplicate, and whether it
 * was imported before. Then commit, in batches: each batch is kept under the key the screen sent, so sending
 * it again returns the same result instead of importing twice. Every row is checked again as it is written,
 * and a row that fails does not stop the others. Imported contacts get no permission to be texted or emailed.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { managerMutation, managerQuery } from "./lib/builders";
import { possibleDuplicates, refreshClient } from "./lib/clients/directory";
import { COMMIT_LIMIT, hasAddress, kindOf, ROW_LIMIT, rowProblems, typeOf, type ImportRow } from "./lib/clients/importing";
import { importRowValidator } from "./lib/connectors/schema";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { optionalEmail, optionalText, text } from "./lib/text";
import { cleanAddress } from "./properties";

const rowValidator = importRowValidator;
const sourceValidator = v.union(v.literal("csv"), v.literal("jobber"), v.literal("housecall_pro"));

type Ctx = Parameters<typeof possibleDuplicates>[0];

async function importedAs(ctx: Ctx, companyId: Id<"companies">, source: string, externalId: string | undefined): Promise<Id<"customers"> | null> {
  if (!externalId?.trim()) return null;
  const row = await ctx.db
    .query("importedRecords")
    .withIndex("by_company_source_external", (q) => q.eq("companyId", companyId).eq("source", source).eq("externalId", externalId.trim()))
    .first();
  return row ? row.customerId : null;
}

/** What importing these rows would do, row by row. Nothing is written. */
export const check = managerQuery({
  args: { source: sourceValidator, rows: v.array(rowValidator) },
  handler: async (ctx, args) => {
    if (args.rows.length > ROW_LIMIT) throw userError(`Import up to ${ROW_LIMIT} clients at a time.`);
    const out = [];
    const seen = new Map<string, number>();
    for (const [index, row] of args.rows.entries()) {
      const problems = rowProblems(row);
      const before = await importedAs(ctx, ctx.companyId, args.source, row.externalId);
      const matches = problems.length || before ? [] : await possibleDuplicates(ctx, ctx.companyId, { name: row.name.trim(), email: row.email?.trim() || undefined, phone: row.phone?.trim() || undefined });
      const key = `${row.name.trim().toLowerCase()}|${(row.email ?? "").trim().toLowerCase()}|${(row.phone ?? "").replace(/\D/g, "")}`;
      const sameAsRow = seen.get(key) ?? null;
      if (sameAsRow === null) seen.set(key, index);
      out.push({ index, name: row.name.trim(), problems, importedBefore: before !== null, matches: matches.slice(0, 3).map((match) => ({ customerId: match.customerId, name: match.name, why: match.reason })), sameAsRow, property: hasAddress(row) });
    }
    return { rows: out, willCreate: out.filter((row) => !row.problems.length && !row.importedBefore && !row.matches.length && row.sameAsRow === null).length };
  },
});

/**
 * Imports one batch. `addAnyway` lists rows to add although they may duplicate a client; `skip` lists rows
 * the owner left out. Sent twice under the same key, it returns the first result and writes nothing.
 */
export const commit = managerMutation({
  args: { importKey: v.string(), source: sourceValidator, label: v.string(), rows: v.array(v.object({ index: v.number(), row: rowValidator })), addAnyway: v.array(v.number()), skip: v.array(v.number()) },
  handler: async (ctx, args) => {
    const importKey = text(args.importKey, "The import key", 120);
    const existing = await ctx.db
      .query("clientImportRuns")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("importKey", importKey))
      .first();
    if (existing) return { runId: existing._id, repeated: true, created: existing.created, skipped: existing.skipped, failed: existing.failed, results: existing.results };
    if (args.rows.length > COMMIT_LIMIT) throw userError(`Send up to ${COMMIT_LIMIT} rows in one batch.`);
    const now = Date.now();
    const results: { index: number; name: string; outcome: "created" | "skipped" | "failed"; reason?: string; customerId?: Id<"customers"> }[] = [];
    const inBatch = new Set<string>();
    for (const { index, row } of args.rows) {
      const name = row.name.trim().slice(0, 160);
      if (args.skip.includes(index)) {
        results.push({ index, name, outcome: "skipped", reason: "You left it out." });
        continue;
      }
      const problems = rowProblems(row);
      if (problems.length) {
        results.push({ index, name: name || `Row ${index + 1}`, outcome: "failed", reason: problems.join(" ") });
        continue;
      }
      const before = await importedAs(ctx, ctx.companyId, args.source, row.externalId);
      if (before) {
        results.push({ index, name, outcome: "skipped", reason: "Already imported from this system.", customerId: before });
        continue;
      }
      const key = `${name.toLowerCase()}|${(row.email ?? "").trim().toLowerCase()}|${(row.phone ?? "").replace(/\D/g, "")}`;
      if (inBatch.has(key)) {
        results.push({ index, name, outcome: "skipped", reason: "The same client is in the file twice." });
        continue;
      }
      if (!args.addAnyway.includes(index)) {
        const matches = await possibleDuplicates(ctx, ctx.companyId, { name, email: row.email?.trim() || undefined, phone: row.phone?.trim() || undefined });
        if (matches.length) {
          results.push({ index, name, outcome: "skipped", reason: `It may be ${matches[0].name}, who is already a client.`, customerId: matches[0].customerId });
          continue;
        }
      }
      try {
        const customerId = await createClient(ctx, row, args.source, now);
        if (row.externalId?.trim()) await ctx.db.insert("importedRecords", { companyId: ctx.companyId, source: args.source, externalId: row.externalId.trim().slice(0, 120), customerId, createdAt: now });
        inBatch.add(key);
        results.push({ index, name, outcome: "created", customerId });
      } catch (error) {
        const words = (error as { data?: { message?: string } }).data?.message ?? "It could not be saved.";
        results.push({ index, name, outcome: "failed", reason: words });
      }
    }
    const count = (outcome: string) => results.filter((row) => row.outcome === outcome).length;
    const runId = await ctx.db.insert("clientImportRuns", { companyId: ctx.companyId, importKey, source: args.source, label: text(args.label || "Spreadsheet", "The import name", 120), results, created: count("created"), skipped: count("skipped"), failed: count("failed"), by: ctx.member._id, createdAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "clients.imported", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { source: args.source, created: count("created"), skipped: count("skipped"), failed: count("failed") } });
    return { runId, repeated: false, created: count("created"), skipped: count("skipped"), failed: count("failed"), results };
  },
});

async function createClient(ctx: Parameters<typeof refreshClient>[0] & { companyId: Id<"companies"> }, row: ImportRow, source: string, now: number): Promise<Id<"customers">> {
  const name = text(row.name, "Name", 160);
  const email = row.email?.trim() ? optionalEmail(row.email.trim()) : undefined;
  const phone = optionalText(row.phone?.trim() || undefined, "Phone", 40);
  const notes = [row.notes?.trim(), row.schedule?.trim() ? `Schedule in the old system: ${row.schedule.trim()}` : ""].filter(Boolean).join("\n");
  // Everything is checked before anything is written, so a failed row leaves nothing half made.
  const address = hasAddress(row) ? cleanAddress({ line1: row.line1!.trim(), ...(row.line2?.trim() ? { line2: row.line2.trim() } : {}), city: row.city!.trim(), region: row.region!.trim(), postalCode: row.postalCode!.trim() }) : null;
  const customerId = await ctx.db.insert("customers", {
    companyId: ctx.companyId,
    name,
    kind: kindOf(row),
    type: typeOf(row),
    email,
    phone,
    ...(notes ? { preferences: notes.slice(0, 2000) } : {}),
    status: "active",
    relationship: "active",
    relationshipAt: now,
    // No communication permission is set: an import is never consent to text or email.
    source: `import:${source}`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  if (email || phone) await ctx.db.insert("clientContacts", { companyId: ctx.companyId, customerId, name, email, phone, roles: ["primary", "billing"], propertyIds: [], status: "active", createdAt: now, updatedAt: now });
  if (address) {
    await ctx.db.insert("properties", { companyId: ctx.companyId, customerId, address, kind: kindOf(row) === "commercial" ? "commercial" : kindOf(row) === "short_term_rental" ? "short_term_rental" : "home", status: "active", revision: 1, createdAt: now, updatedAt: now });
  }
  await refreshClient(ctx, customerId);
  return customerId;
}
