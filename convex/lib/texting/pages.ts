/**
 * The company's own texting pages: its privacy policy, its texting terms and its texting sign-up form,
 * published on the link host under the company's public address (its booking handle):
 *   /b/<handle>/legal/privacy, /b/<handle>/legal/texting, /b/<handle>/texts
 * A published page is never edited. Publishing different words makes a new version and retires the old
 * one; publishing the same words changes nothing. The sign-up page records consent against a
 * consentDisclosures version, so every permission it collects names the exact wording shown.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { defaultSettings, RESERVED, settingsRow, slugify } from "../booking/settings";
import { siteOrigin } from "../dispatch/links";
import type { PageKind } from "./schema";

export type Links = { privacy: string; terms: string; signup: string };

export function hostedLinks(handle: string): Links {
  const origin = siteOrigin();
  return { privacy: `${origin}/b/${handle}/legal/privacy`, terms: `${origin}/b/${handle}/legal/texting`, signup: `${origin}/b/${handle}/texts` };
}

/** The links a registration is filed with: the company's own privacy and terms pages when it chose them, and always Selestial's hosted sign-up. */
export function linksFor(setup: Pick<Doc<"textingSetups">, "hosting" | "ownSite">, handle: string | null): Links | null {
  if (!handle) return null;
  const hosted = hostedLinks(handle);
  if (setup.hosting === "own_site") return { privacy: setup.ownSite?.privacyUrl ?? "", terms: setup.ownSite?.termsUrl ?? "", signup: hosted.signup };
  return hosted;
}

export async function handleOf(ctx: QueryCtx, companyId: Id<"companies">): Promise<string | null> {
  return (await settingsRow(ctx, companyId))?.handle ?? null;
}

/** The company's public address, giving it one from its name when it has none. Never changes an existing one. */
export async function ensureHandle(ctx: MutationCtx, company: Doc<"companies">): Promise<string> {
  const row = await settingsRow(ctx, company._id);
  if (row?.handle) return row.handle;
  const base = slugify(company.name).replace(/^booking-/, "").slice(0, 34) || "company";
  let handle = "";
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? (base.length >= 3 ? base : `${base}-co`) : `${base}-${n}`;
    const taken = await ctx.db
      .query("bookingSettings")
      .withIndex("by_handle", (q) => q.eq("handle", candidate))
      .first();
    if (!taken && !RESERVED.has(candidate)) {
      handle = candidate;
      break;
    }
  }
  if (!handle) handle = `${base.slice(0, 28)}-${company._id.slice(-6)}`.toLowerCase();
  const now = Date.now();
  if (row) await ctx.db.patch(row._id, { handle, revision: row.revision + 1, updatedAt: now });
  else await ctx.db.insert("bookingSettings", { ...defaultSettings(company), handle, revision: 1, updatedAt: now });
  return handle;
}

/** The page in force for a kind, or null. */
export async function currentPage(ctx: QueryCtx, companyId: Id<"companies">, kind: PageKind): Promise<Doc<"textingPages"> | null> {
  const row = await ctx.db
    .query("textingPages")
    .withIndex("by_company_kind_version", (q) => q.eq("companyId", companyId).eq("kind", kind))
    .order("desc")
    .first();
  return row && row.retiredAt === undefined ? row : null;
}

/** The consent wording version for this text, reusing the latest when the words are the same. */
export async function disclosureFor(ctx: MutationCtx, companyId: Id<"companies">, category: "operational" | "marketing", text: string, by: Id<"members">): Promise<Id<"consentDisclosures">> {
  const latest = await ctx.db
    .query("consentDisclosures")
    .withIndex("by_company_channel_category", (q) => q.eq("companyId", companyId).eq("channel", "sms").eq("category", category))
    .order("desc")
    .first();
  if (latest && latest.text === text) return latest._id;
  return ctx.db.insert("consentDisclosures", { companyId, channel: "sms", category, text, version: (latest?.version ?? 0) + 1, createdAt: Date.now(), createdBy: by });
}

/** Publishes a page if its words differ from the one in force. Answers with the page in force and whether it changed. */
export async function publishPage(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; kind: PageKind; body: string; marketing?: string; by: Id<"members"> },
): Promise<{ page: Doc<"textingPages">; changed: boolean }> {
  const current = await currentPage(ctx, input.companyId, input.kind);
  const marketing = input.marketing?.trim() || undefined;
  if (current && current.body === input.body && (current.marketing ?? undefined) === marketing) return { page: current, changed: false };
  const now = Date.now();
  const extra: Partial<Doc<"textingPages">> = {};
  if (input.kind === "signup") {
    extra.smsDisclosureId = await disclosureFor(ctx, input.companyId, "operational", input.body, input.by);
    if (marketing) extra.marketingDisclosureId = await disclosureFor(ctx, input.companyId, "marketing", marketing, input.by);
  }
  if (current) await ctx.db.patch(current._id, { retiredAt: now });
  const id = await ctx.db.insert("textingPages", {
    companyId: input.companyId,
    kind: input.kind,
    version: (current?.version ?? 0) + 1,
    body: input.body,
    ...(marketing ? { marketing } : {}),
    ...extra,
    publishedAt: now,
    publishedBy: input.by,
  });
  return { page: (await ctx.db.get(id))!, changed: true };
}
