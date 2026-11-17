/**
 * A cleaner's private link to their own earnings statement: `<public id>.<signature>`, signed with
 * ACTION_LINK_SECRET under words of its own so it never opens a job, an offer or a pay page. The token
 * is never stored. One live link per cleaner: issuing a new one revokes the last. The page behind it
 * shows that cleaner's own jobs and pay only.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { siteOrigin } from "../dispatch/links";
import { newPublicId } from "./payLinks";

const encoder = new TextEncoder();
export const STATEMENT_DAYS = 90;
const DAY = 86_400_000;

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

async function sign(publicId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.statement.v1:${publicId}`)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const statementLinksConfigured = () => secret() !== null;

export async function statementToken(link: Pick<Doc<"statementLinks">, "publicId">): Promise<string | null> {
  const key = secret();
  return key ? `${link.publicId}.${await sign(link.publicId, key)}` : null;
}

export const statementUrl = (token: string) => `${siteOrigin()}/c/earnings/${token}`;

/** The link a token names, if it is still open. A wrong signature, an unknown, expired or revoked link all read as null. */
export async function linkForStatementToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"statementLinks"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(publicId, key))) return null;
  const link = await ctx.db
    .query("statementLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!link || link.revokedAt !== undefined || link.expiresAt <= Date.now()) return null;
  return link;
}

export async function liveStatementLink(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, cleanerId: Id<"cleaners">): Promise<Doc<"statementLinks"> | null> {
  const rows = await ctx.db
    .query("statementLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleanerId))
    .order("desc")
    .take(5);
  return rows.find((row) => row.revokedAt === undefined && row.expiresAt > Date.now()) ?? null;
}

/** Issues a fresh link and revokes any open one. */
export async function issueStatementLink(ctx: MutationCtx, input: { companyId: Id<"companies">; cleanerId: Id<"cleaners">; by: Id<"members"> }): Promise<Doc<"statementLinks">> {
  const now = Date.now();
  const open = await ctx.db
    .query("statementLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", input.companyId).eq("cleanerId", input.cleanerId))
    .take(50);
  for (const row of open) if (row.revokedAt === undefined) await ctx.db.patch(row._id, { revokedAt: now });
  const id = await ctx.db.insert("statementLinks", { companyId: input.companyId, cleanerId: input.cleanerId, publicId: newPublicId(), issuedBy: input.by, issuedAt: now, expiresAt: now + STATEMENT_DAYS * DAY });
  return (await ctx.db.get(id))!;
}
