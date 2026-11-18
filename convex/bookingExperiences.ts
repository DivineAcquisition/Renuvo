/**
 * Growth → Sales → Booking Forms: the company's booking experiences (docs/booking/00-architecture.md).
 *
 * Who does what (the same split as Services & Pricing):
 *  - Everyone in the company reads experiences, versions, sessions and the funnel.
 *  - Managers and the Owner draft, duplicate, test and send a recovery note a customer asked for.
 *  - The Owner publishes, unpublishes, rolls back, archives and changes the shared booking rules,
 *    because those decide what customers are charged and asked to sign.
 *
 * Drafts are shared by people and Chat. Every save names the revision it started from; a different
 * revision is refused with who saved and when, and nothing is overwritten unless the person chooses to.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { verifiedPlan } from "./lib/billing/access";
import { companyQuery, managerMutation, ownerMutation, type MemberAccess } from "./lib/builders";
import { DOC_TYPE_BY_KEY } from "./lib/agreements/catalog";
import { approvedKit, bookingTerms } from "./lib/booking/agreement";
import { defaultDefinition, definitionValidator, experienceKindValidator, KIND_LABELS, normalizeDefinition, type Definition, type ExperienceKind } from "./lib/booking/definition";
import { funnel } from "./lib/booking/funnel";
import { ensureCustomer } from "./lib/booking/handoff";
import { VARIABLE_BY_KEY } from "./lib/agreements/variables";
import { allow } from "./lib/rateLimit";
import { queueBookingMessage } from "./lib/booking/messages";
import { blockersOf, catalogOf, FIX_LINKS, readiness } from "./lib/booking/readiness";
import { bookingAgreementValidator, paymentPolicyValidator } from "./lib/booking/schema";
import { bookingSettingsOf, normalizeSettings, settingsRow, slugify, normalizeSlug, SCHEDULING_LIMITS } from "./lib/booking/settings";
import { customerName } from "./lib/booking/session";
import { newToken, OPEN_SESSION_LIFE, tokenHash } from "./lib/booking/tokens";
import { canonical } from "./lib/services/store";
import { sha256 } from "./lib/agreements/hash";
import { siteOrigin } from "./lib/dispatch/links";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { stripeState } from "./lib/finance/stripeState";
import { businessSettingsOf } from "./lib/settings/business";
import { publishedCatalog } from "./lib/services/store";
import { startingCents } from "./lib/services/engine";
import { CATEGORY_LABELS, type Category } from "./lib/services/spec";
import { scheduleLabel } from "./lib/services/words";

export const STALE_EXPERIENCE = "Someone else saved this experience after you opened it.";

async function memberName(ctx: QueryCtx, id: Id<"members"> | undefined): Promise<string> {
  if (!id) return "Selestial";
  const m = await ctx.db.get(id);
  return m?.name ?? "A former member";
}

function publicUrl(handle: string | undefined, slug: string): string | null {
  return handle ? `${siteOrigin()}/b/${handle}/${slug}` : null;
}

async function uniqueSlug(ctx: QueryCtx, companyId: Id<"companies">, base: string, except?: Id<"bookingExperiences">): Promise<string> {
  let slug = slugify(base);
  for (let i = 2; i < 200; i += 1) {
    const taken = await ctx.db
      .query("bookingExperiences")
      .withIndex("by_company_slug", (q) => q.eq("companyId", companyId).eq("slug", slug))
      .unique();
    if (!taken || taken._id === except) return slug;
    slug = `${slugify(base).slice(0, 36)}-${i}`;
  }
  throw userError("Choose a different page address.");
}

const CATEGORY_FOR: Record<ExperienceKind, Category[]> = {
  residential: ["residential"],
  recurring: ["residential"],
  campaign: ["residential", "short_term_rental"],
  commercial: ["commercial", "property_management", "post_construction", "specialty"],
  short_term_rental: ["short_term_rental"],
};

/**
 * A starting definition from the company's own published services: the kind's services in the catalog's
 * order, the first featured, and a comparison of what each includes, built from their real scope.
 */
export async function starterDefinition(ctx: QueryCtx, companyId: Id<"companies">, kind: ExperienceKind): Promise<Definition> {
  const def = defaultDefinition(kind);
  const catalog = await publishedCatalog(ctx, companyId);
  const fits = catalog.filter((row) => CATEGORY_FOR[kind].includes(row.version.spec.category)).slice(0, 6);
  def.services.offered = fits.map((row) => ({ serviceKey: row.service.key, displayName: "", blurb: "", benefits: [], badge: "", hidden: false }));
  def.services.featuredKey = fits[0]?.service.key ?? null;
  if (fits.length > 0) def.services.offered[0].badge = "Most popular";
  if (fits.length >= 2) {
    const labels = new Map<string, { group: string; included: Set<string> }>();
    for (const row of fits) {
      for (const item of row.version.spec.included) {
        const entry = labels.get(item.label) ?? { group: item.section ?? "Everywhere", included: new Set<string>() };
        entry.included.add(row.service.key);
        labels.set(item.label, entry);
      }
    }
    def.services.comparison.rows = [...labels.entries()].slice(0, 30).map(([label, entry]) => ({ label: label.slice(0, 120), group: entry.group.slice(0, 80), included: [...entry.included] }));
  }
  return def;
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await bookingSettingsOf(ctx, ctx.company);
    const rows = await ctx.db
      .query("bookingExperiences")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(60);
    const since = Date.now() - 30 * 24 * 60 * 60_000;
    const experiences = [];
    for (const row of rows) {
      const events = await ctx.db
        .query("bookingEvents")
        .withIndex("by_company_experience_at", (q) => q.eq("companyId", ctx.companyId).eq("experienceId", row._id).gte("at", since))
        .take(5000);
      const live = events.filter((e) => !e.test);
      experiences.push({
        id: row._id,
        name: row.name,
        kind: row.kind,
        kindLabel: KIND_LABELS[row.kind].label,
        status: row.status,
        slug: row.slug,
        url: row.status === "published" ? publicUrl(settings.handle, row.slug) : null,
        publishedVersion: row.publishedVersion ?? null,
        draftDiffers: row.draftDiffers,
        updatedAt: row.updatedAt,
        draftSavedBy: row.draftSavedBy,
        started: live.filter((e) => e.type === "booking_started").length,
        confirmed: live.filter((e) => e.type === "booking_confirmed").length,
        requests: live.filter((e) => e.type === "request_sent").length,
        mode: row.draft.behavior.mode,
        brandColor: row.draft.theme.useCompanyBrand ? settings.profile.brandColor : row.draft.theme.brandColor,
        services: row.draft.services.offered.filter((s) => !s.hidden).length,
      });
    }
    const attention = await ctx.db
      .query("bookingSessions")
      .withIndex("by_company_status_updated", (q) => q.eq("companyId", ctx.companyId).eq("status", "needs_attention"))
      .take(20);
    return {
      handle: settings.handle ?? null,
      linkBase: `${siteOrigin()}/b/`,
      experiences,
      needsAttention: attention.length,
      plan: verifiedPlan(ctx.company),
      canDraft: ctx.role === "owner" || ctx.role === "manager",
      canPublish: ctx.role === "owner",
    };
  },
});

/** Approved customer agreement templates the rules can point at. */
async function templateChoices(ctx: QueryCtx, companyId: Id<"companies">) {
  const rows = await ctx.db
    .query("agreementTemplates")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "approved"))
    .take(100);
  return rows.filter((t) => DOC_TYPE_BY_KEY.get(t.docType)?.category === "customer").map((t) => ({ id: t._id, title: t.title, docType: t.docType, version: t.approvedVersion ?? t.currentVersion }));
}

export const get = companyQuery({
  args: { experienceId: v.id("bookingExperiences") },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    const settings = await bookingSettingsOf(ctx, ctx.company);
    const catalog = await catalogOf(ctx, ctx.companyId);
    const draft = normalizeOrRaw(experience.draft);
    const items = await readiness(ctx, ctx.company, draft, settings, catalog);
    const versions = await ctx.db
      .query("bookingExperienceVersions")
      .withIndex("by_company_experience_version", (q) => q.eq("companyId", ctx.companyId).eq("experienceId", experience._id))
      .order("desc")
      .take(30);
    const published = await publishedCatalog(ctx, ctx.companyId);
    const stripe = await stripeState(ctx, ctx.companyId);
    const business = businessSettingsOf(ctx.company);
    const logoUrl = settings.profile.logo ? await ctx.storage.getUrl(settings.profile.logo) : null;
    const heroUrl = draft.theme.heroImage ? await ctx.storage.getUrl(draft.theme.heroImage) : null;
    return {
      experience: { id: experience._id, name: experience.name, slug: experience.slug, kind: experience.kind, status: experience.status, publishedVersion: experience.publishedVersion ?? null, publishedAt: experience.publishedAt ?? null, draftRevision: experience.draftRevision, draftSavedAt: experience.draftSavedAt, draftSavedBy: experience.draftSavedBy, draftDiffers: experience.draftDiffers },
      draft,
      url: publicUrl(settings.handle, experience.slug),
      items: items.map((i) => ({ ...i, link: FIX_LINKS[i.fix].href ? FIX_LINKS[i.fix] : null })),
      versions: await Promise.all(versions.map(async (row) => ({ version: row.version, publishedAt: row.publishedAt, publishedBy: await memberName(ctx, row.publishedBy), note: row.note ?? null, restoredFrom: row.restoredFrom ?? null, current: row.version === experience.publishedVersion }))),
      // What the builder may choose from, all from their own homes. Prices are never editable here.
      services: published
        .filter((row) => row.service.status === "active")
        .map((row) => ({
          key: row.service.key,
          id: row.service._id,
          name: row.version.spec.name,
          category: CATEGORY_LABELS[row.version.spec.category],
          summary: row.version.spec.summary,
          method: row.version.spec.pricing.method,
          startingCents: startingCents(row.version.spec),
          version: row.version.version,
          included: row.version.spec.included.map((i) => ({ label: i.label, section: i.section ?? null })),
          promotions: row.version.spec.modifiers.promotions.map((p) => ({ id: p.id, label: p.label, approved: p.approved, startsOn: p.startsOn, endsOn: p.endsOn })),
          frequencies: row.version.spec.modifiers.recurring.enabled ? row.version.spec.modifiers.recurring.options.map((o) => scheduleLabel(o.schedule)) : [],
          spec: row.version.spec,
        })),
      settings: {
        handle: settings.handle ?? null,
        profile: { ...settings.profile, logoUrl },
        scheduling: settings.scheduling,
        paymentPolicies: settings.paymentPolicies,
        agreements: settings.agreements,
        revision: settings.revision,
      },
      heroUrl,
      templates: await templateChoices(ctx, ctx.companyId),
      inherited: {
        timezone: ctx.company.timezone,
        serviceAreas: business.serviceAreas.length,
        hours: business.hours,
        canPayByCard: stripe.canPayByCard,
        stripeTestMode: stripe.testMode,
        plan: verifiedPlan(ctx.company),
      },
      canDraft: ctx.role === "owner" || ctx.role === "manager",
      canPublish: ctx.role === "owner",
    };
  },
});

function normalizeOrRaw(def: Definition): Definition {
  try {
    return normalizeDefinition(def);
  } catch {
    return def;
  }
}

/** The company's booking rules, for the rules panel. */
export const rules = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await bookingSettingsOf(ctx, ctx.company);
    return {
      handle: settings.handle ?? null,
      profile: { ...settings.profile, logoUrl: settings.profile.logo ? await ctx.storage.getUrl(settings.profile.logo) : null },
      scheduling: settings.scheduling,
      paymentPolicies: settings.paymentPolicies,
      agreements: settings.agreements,
      revision: settings.revision,
      limits: SCHEDULING_LIMITS,
      templates: await templateChoices(ctx, ctx.companyId),
      canChange: ctx.role === "owner",
    };
  },
});

/** What an agreement template still needs before bookings can use it: its variables that booking facts don't fill. */
export const agreementNeeds = companyQuery({
  args: { templateId: v.id("agreementTemplates") },
  handler: async (ctx, args) => {
    const found = await approvedKit(ctx, ctx.companyId, args.templateId);
    if ("why" in found) return { ok: false as const, why: found.why, needs: [] };
    const type = DOC_TYPE_BY_KEY.get(found.template.docType)!;
    const filled = new Set(Object.keys(bookingTerms({ companyName: "x", customerName: "x", address: "x", priceCents: 1, depositCents: 1, startsAt: 0, windowMinutes: 60, elapsedMinutes: 60, timezone: ctx.company.timezone, accessNotes: "x", spec: { name: "x", summary: "x", excluded: ["x"], included: [{ id: "x", label: "x", section: "x", requiresPhoto: false }] } as never })));
    const keys = new Set<string>();
    for (const clause of found.kit.clauses) for (const m of clause.body.matchAll(/\{\{(\w+)\}\}/g)) keys.add(m[1]);
    const needs = [...keys]
      .filter((k) => !filled.has(k))
      .map((k) => {
        const def = found.kit.extra?.find((x) => x.key === k) ?? VARIABLE_BY_KEY.get(k);
        return { key: k, label: def?.label ?? k, ask: def?.ask ?? "", type: def?.type ?? "text", choices: def?.choices ?? [] };
      });
    return { ok: true as const, why: null, needs, title: found.template.title, docType: type.label };
  },
});

export const sessions = companyQuery({
  args: { experienceId: v.optional(v.id("bookingExperiences")), status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = args.experienceId
      ? await ctx.db
          .query("bookingSessions")
          .withIndex("by_company_experience_created", (q) => q.eq("companyId", ctx.companyId).eq("experienceId", args.experienceId!))
          .order("desc")
          .take(100)
      : await ctx.db
          .query("bookingSessions")
          .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
          .order("desc")
          .take(100);
    const tz = ctx.company.timezone;
    return rows
      .filter((s) => !args.status || s.status === args.status)
      .map((s) => ({
        id: s._id,
        experienceId: s.experienceId,
        test: s.test,
        status: s.status,
        step: s.step,
        name: customerName(s) || null,
        hasEmail: Boolean(s.contact?.email),
        service: s.quote?.serviceKey ?? null,
        totalCents: s.quote?.grandTotalCents ?? null,
        when: s.schedule ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(s.schedule.startsAt)) : null,
        states: { answers: s.answersState, quote: s.quoteState, agreement: s.agreementState, payment: s.paymentState, capacity: s.capacityState, confirmation: s.confirmationState },
        blockers: s.blockers,
        jobId: s.jobId ?? null,
        invoiceId: s.invoiceId ?? null,
        taskId: s.taskId ?? null,
        source: s.attribution.source || null,
        campaign: s.attribution.campaign || null,
        recoveryOfferedAt: s.recoveryOfferedAt ?? null,
        canRecover: !s.test && s.status === "active" && Boolean(s.contact?.email) && !s.recoveryOfferedAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
  },
});

const FUNNEL_STEPS = ["location", "size", "service", "details", "checkout"] as const;

/** The funnel from what happened: sessions that reached each step, and where they stopped. Test sessions apart. */
export const analytics = companyQuery({
  args: { experienceId: v.id("bookingExperiences"), days: v.number(), test: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await owned(ctx, args.experienceId);
    const days = Math.min(Math.max(1, Math.round(args.days)), 365);
    const since = Date.now() - days * 24 * 60 * 60_000;
    const events = (
      await ctx.db
        .query("bookingEvents")
        .withIndex("by_company_experience_at", (q) => q.eq("companyId", ctx.companyId).eq("experienceId", args.experienceId).gte("at", since))
        .take(20_000)
    ).filter((e) => e.test === Boolean(args.test));
    const sessionsWith = (pred: (e: Doc<"bookingEvents">) => boolean) => new Set(events.filter(pred).map((e) => e.sessionId)).size;
    const started = sessionsWith((e) => e.type === "booking_started");
    const steps = FUNNEL_STEPS.map((step) => ({ step, completed: sessionsWith((e) => e.type === "step_completed" && e.step === step) }));
    const sources = new Map<string, { started: number; confirmed: number }>();
    for (const e of events) {
      const key = e.campaign ? `${e.source ?? "direct"} · ${e.campaign}` : (e.source ?? "direct");
      const row = sources.get(key) ?? { started: 0, confirmed: 0 };
      if (e.type === "booking_started") row.started += 1;
      if (e.type === "booking_confirmed") row.confirmed += 1;
      sources.set(key, row);
    }
    return {
      days,
      started,
      steps,
      quoted: sessionsWith((e) => e.type === "quote_calculated"),
      scheduled: sessionsWith((e) => e.type === "schedule_selected"),
      signed: sessionsWith((e) => e.type === "agreement_completed"),
      paymentStarted: sessionsWith((e) => e.type === "payment_started"),
      paid: sessionsWith((e) => e.type === "payment_verified"),
      confirmed: sessionsWith((e) => e.type === "booking_confirmed"),
      requests: sessionsWith((e) => e.type === "request_sent"),
      recovered: sessionsWith((e) => e.type === "recovery_completed"),
      revenueCents: events.filter((e) => e.type === "booking_confirmed").reduce((sum, e) => sum + (e.amountCents ?? 0), 0),
      sources: [...sources.entries()].map(([source, row]) => ({ source, ...row })).sort((a, b) => b.started - a.started).slice(0, 10),
    };
  },
});

// ── Changing ─────────────────────────────────────────────────────────────────────────────────────

const actorName = (ctx: MemberAccess, via?: "chat") => (via === "chat" ? `Selestial, asked by ${ctx.member.name} in Chat` : ctx.member.name);

export const create = managerMutation({
  args: { kind: experienceKindValidator, name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return createExperience(ctx, args.kind, args.name);
  },
});

export async function createExperience(ctx: MutationCtx & MemberAccess, kind: ExperienceKind, name?: string, via?: "chat"): Promise<Id<"bookingExperiences">> {
  const label = (name?.trim() || KIND_LABELS[kind].label).slice(0, 80);
  const count = await ctx.db
    .query("bookingExperiences")
    .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
    .take(101);
  if (count.length >= 100) throw userError("A company can keep up to 100 booking experiences. Archive one first.");
  const draft = normalizeDefinition(await starterDefinition(ctx, ctx.companyId, kind));
  const now = Date.now();
  const id = await ctx.db.insert("bookingExperiences", {
    companyId: ctx.companyId,
    name: label,
    slug: await uniqueSlug(ctx, ctx.companyId, label),
    kind,
    status: "draft",
    draft,
    draftRevision: 1,
    draftSavedAt: now,
    draftSavedBy: actorName(ctx, via),
    draftDiffers: true,
    createdBy: ctx.member._id,
    createdAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "booking_experience.created", actor: byMember(ctx), subject: { table: "bookingExperiences", id }, data: { kind, via: via ?? "workspace" } });
  return id;
}

/** Saves the draft. A stale revision is refused unless the person chose to save over the newer one. */
export async function writeDraft(ctx: MutationCtx & MemberAccess, experience: Doc<"bookingExperiences">, definition: Definition, expectedRevision: number, options: { force?: boolean; via?: "chat" } = {}) {
  if (experience.status === "archived") throw userError("Restore this experience before changing it.");
  if (experience.draftRevision !== expectedRevision && !options.force) {
    return { ok: false as const, conflict: { savedBy: experience.draftSavedBy, savedAt: experience.draftSavedAt, revision: experience.draftRevision } };
  }
  const draft = normalizeDefinition(definition);
  if (canonical(draft) === canonical(experience.draft)) return { ok: true as const, revision: experience.draftRevision, unchanged: true };
  // A new hero image must be one this company uploaded.
  if (draft.theme.heroImage && draft.theme.heroImage !== experience.draft.theme.heroImage) await claimImage(ctx, draft.theme.heroImage);
  const published = experience.publishedVersion !== undefined ? await versionRow(ctx, experience, experience.publishedVersion) : null;
  const now = Date.now();
  await ctx.db.patch(experience._id, { draft, draftRevision: experience.draftRevision + 1, draftSavedAt: now, draftSavedBy: actorName(ctx, options.via), draftDiffers: !published || canonical(published.definition) !== canonical(draft), updatedAt: now });
  return { ok: true as const, revision: experience.draftRevision + 1, unchanged: false };
}

export const saveDraft = managerMutation({
  args: { experienceId: v.id("bookingExperiences"), expectedRevision: v.number(), definition: definitionValidator, force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    return writeDraft(ctx, experience, args.definition, args.expectedRevision, { force: args.force });
  },
});

export const rename = managerMutation({
  args: { experienceId: v.id("bookingExperiences"), name: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    const name = args.name.trim().slice(0, 80);
    if (!name) throw userError("Name the experience.");
    let slug = experience.slug;
    if (args.slug !== undefined && args.slug !== experience.slug) {
      if (experience.status === "published" && ctx.role !== "owner") throw userError("Only the Owner can change a published page's address.");
      slug = normalizeSlug(args.slug);
      if ((await uniqueSlug(ctx, ctx.companyId, slug, experience._id)) !== slug) throw userError("Another experience already uses that address.");
    }
    await ctx.db.patch(experience._id, { name, slug, updatedAt: Date.now() });
    return { slug };
  },
});

export const duplicate = managerMutation({
  args: { experienceId: v.id("bookingExperiences") },
  handler: async (ctx, args) => {
    const source = await owned(ctx, args.experienceId);
    const name = `${source.name} (copy)`.slice(0, 80);
    const now = Date.now();
    const id = await ctx.db.insert("bookingExperiences", {
      companyId: ctx.companyId,
      name,
      slug: await uniqueSlug(ctx, ctx.companyId, name),
      kind: source.kind,
      status: "draft",
      draft: source.draft,
      draftRevision: 1,
      draftSavedAt: now,
      draftSavedBy: ctx.member.name,
      draftDiffers: true,
      duplicatedFrom: source._id,
      createdBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking_experience.duplicated", actor: byMember(ctx), subject: { table: "bookingExperiences", id }, data: { from: source._id } });
    return id;
  },
});

async function versionRow(ctx: QueryCtx, experience: Doc<"bookingExperiences">, version: number) {
  return ctx.db
    .query("bookingExperienceVersions")
    .withIndex("by_company_experience_version", (q) => q.eq("companyId", experience.companyId).eq("experienceId", experience._id).eq("version", version))
    .unique();
}

async function publishDefinition(ctx: MutationCtx & MemberAccess, experience: Doc<"bookingExperiences">, definition: Definition, note: string | undefined, restoredFrom?: number) {
  const def = normalizeDefinition(definition);
  const settings = await bookingSettingsOf(ctx, ctx.company);
  const items = await readiness(ctx, ctx.company, def, settings, await catalogOf(ctx, ctx.companyId));
  const blockers = blockersOf(items);
  if (blockers.length) throw userError(`This can't be published yet: ${blockers[0].message}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ""}`);
  const latest = await ctx.db
    .query("bookingExperienceVersions")
    .withIndex("by_company_experience_version", (q) => q.eq("companyId", ctx.companyId).eq("experienceId", experience._id))
    .order("desc")
    .first();
  const version = (latest?.version ?? 0) + 1;
  const now = Date.now();
  await ctx.db.insert("bookingExperienceVersions", { companyId: ctx.companyId, experienceId: experience._id, version, definition: def, hash: sha256(canonical(def)), ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}), ...(restoredFrom !== undefined ? { restoredFrom } : {}), publishedBy: ctx.member._id, publishedAt: now });
  await ctx.db.patch(experience._id, { status: "published", publishedVersion: version, publishedAt: now, draftDiffers: canonical(experience.draft) !== canonical(def), updatedAt: now });
  await recordEvent(ctx, { companyId: ctx.companyId, type: restoredFrom !== undefined ? "booking_experience.rolled_back" : "booking_experience.published", actor: byMember(ctx), subject: { table: "bookingExperiences", id: experience._id }, data: { version, ...(restoredFrom !== undefined ? { from: restoredFrom } : {}) } });
  return { version };
}

/**
 * Publishes the draft, checked in full, as one new version. Sessions already under way keep the version
 * they started on for their words and layout; prices, times and rules are checked again for them as usual.
 */
export const publish = ownerMutation({
  args: { experienceId: v.id("bookingExperiences"), expectedRevision: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    if (experience.draftRevision !== args.expectedRevision) throw userError(`${STALE_EXPERIENCE} Review the latest before publishing.`);
    if (experience.status === "archived") throw userError("Restore this experience before publishing it.");
    return publishDefinition(ctx, experience, experience.draft, args.note);
  },
});

/** Publishes an earlier version again, as a new version. Payments, bookings and signed agreements are untouched. */
export const rollback = ownerMutation({
  args: { experienceId: v.id("bookingExperiences"), version: v.number() },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    const row = await versionRow(ctx, experience, args.version);
    if (!row) throw userError("That version doesn't exist.");
    return publishDefinition(ctx, experience, row.definition, `Restored version ${args.version}.`, args.version);
  },
});

/** Copies an earlier version into the draft, to edit before publishing. */
export const restoreToDraft = managerMutation({
  args: { experienceId: v.id("bookingExperiences"), version: v.number(), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    const row = await versionRow(ctx, experience, args.version);
    if (!row) throw userError("That version doesn't exist.");
    return writeDraft(ctx, experience, row.definition, args.expectedRevision);
  },
});

export const unpublish = ownerMutation({
  args: { experienceId: v.id("bookingExperiences") },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    if (experience.status !== "published") return { ok: true };
    await ctx.db.patch(experience._id, { status: "unpublished", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking_experience.unpublished", actor: byMember(ctx), subject: { table: "bookingExperiences", id: experience._id } });
    return { ok: true };
  },
});

export const archive = ownerMutation({
  args: { experienceId: v.id("bookingExperiences"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    const now = Date.now();
    await ctx.db.patch(experience._id, args.archived ? { status: "archived", archivedAt: now, updatedAt: now } : { status: experience.publishedVersion !== undefined ? "unpublished" : "draft", archivedAt: undefined, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.archived ? "booking_experience.archived" : "booking_experience.restored", actor: byMember(ctx), subject: { table: "bookingExperiences", id: experience._id } });
    return { ok: true };
  },
});

/** The shared booking rules. The Owner's: they decide what customers pay and sign. */
export const saveRules = ownerMutation({
  args: {
    expectedRevision: v.number(),
    handle: v.optional(v.string()),
    profile: v.object({ displayName: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()), website: v.optional(v.string()), logo: v.optional(v.id("_storage")), brandColor: v.string(), accentColor: v.string() }),
    scheduling: v.object({ mode: v.union(v.literal("capacity"), v.literal("request")), noticeHours: v.number(), horizonDays: v.number(), slotMinutes: v.number(), holdMinutes: v.number(), defaultWindowMinutes: v.number() }),
    paymentPolicies: v.array(paymentPolicyValidator),
    agreements: v.array(bookingAgreementValidator),
  },
  handler: async (ctx, args) => {
    const row = await settingsRow(ctx, ctx.companyId);
    const current = row?.revision ?? 0;
    if (current !== args.expectedRevision) throw userError("The booking rules were changed somewhere else. Reload to see the latest.");
    const next = normalizeSettings(args);
    if (next.handle) {
      const taken = await ctx.db
        .query("bookingSettings")
        .withIndex("by_handle", (q) => q.eq("handle", next.handle))
        .first();
      if (taken && taken.companyId !== ctx.companyId) throw userError("Another company already uses that booking address.");
    }
    for (const rule of next.agreements) {
      const template = await ctx.db.get(rule.templateId);
      if (!template || template.companyId !== ctx.companyId) throw userError("An agreement template wasn't found.");
    }
    if (next.profile.logo && next.profile.logo !== row?.profile.logo) await claimImage(ctx, next.profile.logo);
    const now = Date.now();
    const fields = { ...next, handle: next.handle, revision: current + 1, updatedBy: ctx.member._id, updatedAt: now };
    const id = row ? (await ctx.db.replace(row._id, { companyId: ctx.companyId, ...fields }), row._id) : await ctx.db.insert("bookingSettings", { companyId: ctx.companyId, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking_rules.updated", actor: byMember(ctx), subject: { table: "bookingSettings", id }, data: { revision: current + 1, policies: next.paymentPolicies.length, agreements: next.agreements.length } });
    return { revision: current + 1 };
  },
});

const IMAGE_TYPES = /^image\/(png|jpe?g|webp)$/;
const FRESH_UPLOAD = 60 * 60_000;

/**
 * Registers an uploaded image to this company, or confirms it is already this company's. A stored file
 * has no owner of its own, so an id is only accepted when it was uploaded within the hour and nothing
 * (another company's booking page, Creative Studio, Agreements, receipts, Chat) has claimed it. SVG is
 * refused: it can carry script, and these images are shown to the public.
 */
async function claimImage(ctx: MutationCtx & MemberAccess, storageId: Id<"_storage">) {
  const gone = () => userError("The image wasn't found. Upload it again.");
  const mine = await ctx.db
    .query("bookingImages")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (mine) {
    if (mine.companyId !== ctx.companyId) throw gone();
    return;
  }
  const meta = await ctx.db.system.get(storageId);
  if (!meta) throw gone();
  if (!IMAGE_TYPES.test(meta.contentType ?? "")) throw userError("Use a PNG, JPEG or WebP image.");
  if (meta.size > 2 * 1024 * 1024) throw userError("Use an image under 2 MB.");
  if (meta._creationTime < Date.now() - FRESH_UPLOAD) throw gone();
  for (const table of ["mediaAssets", "agreementFiles", "expenseReceipts", "chatUploads"] as const) {
    const claimed = await ctx.db
      .query(table)
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (claimed) throw gone();
  }
  await ctx.db.insert("bookingImages", { companyId: ctx.companyId, storageId, uploadedBy: ctx.member._id, createdAt: Date.now() });
}

export const uploadUrl = managerMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/** Checks an uploaded image for the experience (hero) and answers with its address for the preview. */
export const checkUpload = managerMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await claimImage(ctx, args.storageId);
    return { url: await ctx.storage.getUrl(args.storageId) };
  },
});

/**
 * A test booking of the current draft, for the builder's preview and the "Test booking" button. It
 * never charges, never creates a visit, never messages anyone, and is counted apart from live activity.
 */
export const startTest = managerMutation({
  args: { experienceId: v.id("bookingExperiences") },
  handler: async (ctx, args) => {
    const experience = await owned(ctx, args.experienceId);
    if (!(await allowTest(ctx))) throw userError("Too many test bookings in a short time. Wait a few minutes.");
    const token = newToken();
    const now = Date.now();
    const sessionId = await ctx.db.insert("bookingSessions", {
      companyId: ctx.companyId,
      experienceId: experience._id,
      version: 0,
      test: true,
      startedBy: ctx.member._id,
      tokenHash: tokenHash(token),
      tokenIssuedAt: now,
      expiresAt: now + OPEN_SESSION_LIFE,
      status: "active",
      step: "location",
      mode: experience.draft.behavior.mode,
      home: {},
      answers: {},
      answersState: "incomplete",
      quoteState: "none",
      agreementState: "not_required",
      paymentState: "not_required",
      capacityState: "none",
      confirmationState: "open",
      blockers: [],
      attribution: { source: "test", medium: "", campaign: "", referrer: "", landing: "" },
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await funnel(ctx, (await ctx.db.get(sessionId))!, "booking_started");
    return { token };
  },
});

async function allowTest(ctx: MutationCtx & MemberAccess) {
  return allow(ctx, `booking-test:${ctx.member._id}`, 60, 10 * 60_000);
}

/**
 * A person sends a customer who stopped part-way the link to finish. Sales is not released, so no agent
 * sends these on its own; the message still passes the one sending policy (consent, quiet hours, opt-outs).
 */
export const sendRecovery = managerMutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await owned(ctx, args.sessionId);
    if (session.test) throw userError("Test bookings never send messages.");
    if (session.status !== "active") throw userError("This booking is already finished.");
    if (!session.contact?.email) throw userError("This customer didn't leave an email address.");
    if (session.recoveryOfferedAt) throw userError("A reminder was already sent for this booking.");
    const experience = await ctx.db.get(session.experienceId);
    if (!experience || experience.draft.behavior.offerRecovery === false) throw userError("Reminders are turned off for this experience.");
    // A reminder needs a customer record to address; making one for an unfinished booking is the office's choice here.
    if (!session.customerId) {
      await ensureCustomer(ctx, session, experience.kind === "commercial" ? "commercial" : experience.kind === "short_term_rental" ? "short_term_rental" : "home");
    }
    const message = await queueBookingMessage(ctx, { sessionId: session._id, purpose: "booking_recovery", dedupeKey: `booking:${session._id}:recovery`, actor: byMember(ctx) });
    await ctx.db.patch(session._id, { recoveryOfferedAt: Date.now() });
    await funnel(ctx, (await ctx.db.get(session._id))!, "recovery_offered");
    return { status: message?.status ?? "not_sent", problem: message?.problem ?? null };
  },
});

/** Ends a customer's private link. Their booking is unchanged; they ask the company for a new link. */
export const revokeLink = managerMutation({
  args: { sessionId: v.id("bookingSessions") },
  handler: async (ctx, args) => {
    const session = await owned(ctx, args.sessionId);
    await ctx.db.patch(session._id, { revokedAt: Date.now(), linkTokenHash: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.link_revoked", actor: byMember(ctx), subject: { table: "bookingSessions", id: session._id } });
    return { ok: true };
  },
});
