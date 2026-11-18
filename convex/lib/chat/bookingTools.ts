/**
 * Company Chat over Booking Experiences (docs/booking/00-architecture.md). Chat reads experiences and
 * edits drafts through the same checked save the builder uses, as the member chatting, attributed
 * "Selestial, asked by <name> in Chat". It never publishes, never changes a price, a deposit or an
 * agreement (those live in Services & Pricing and the booking rules), and every edit answers with what
 * changed, which existing settings it uses, what is missing, and whether the page could be published.
 *
 * These are workspace tools, not the Sales agent's: Sales is not released, so nothing here acts on its own.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { createExperience, writeDraft } from "../../bookingExperiences";
import { normalizeDefinition, EXPERIENCE_KINDS, KIND_LABELS, STEP_IDS, STEP_LABELS, type Definition, type ExperienceKind, type StepId } from "../booking/definition";
import { instantBlocker } from "../booking/logic";
import { catalogOf, readiness, type Item } from "../booking/readiness";
import { bookingSettingsOf } from "../booking/settings";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const refused = (why: string): Outcome => ({ status: "refused", why });
const link = (id: Id<"bookingExperiences">, name: string) => ({ href: `/app/agents/sales/booking-forms/${id}`, label: `Open ${name}` });

async function findExperience(ctx: ToolCtx, value: unknown): Promise<Doc<"bookingExperiences"> | null> {
  if (typeof value !== "string" || !value.trim()) return null;
  const id = ctx.db.normalizeId("bookingExperiences", value.trim());
  if (id) {
    const row = await ctx.db.get(id);
    return row && row.companyId === ctx.company._id ? row : null;
  }
  const wanted = value.trim().toLowerCase();
  const rows = await ctx.db
    .query("bookingExperiences")
    .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.company._id))
    .take(100);
  return rows.find((row) => row.name.toLowerCase() === wanted || row.slug === wanted) ?? rows.find((row) => row.name.toLowerCase().includes(wanted)) ?? null;
}

/** The builder's context, for calling the same functions the workspace calls. */
function asMember(ctx: ToolCtx) {
  return Object.assign(ctx, { companyId: ctx.company._id, identity: { subject: ctx.member.userId ?? "", tokenIdentifier: "", issuer: "" } }) as unknown as Parameters<typeof writeDraft>[0];
}

function words(items: Item[]) {
  return { blockers: items.filter((i) => i.severity === "blocker").map((i) => i.message), warnings: items.filter((i) => i.severity === "warning").map((i) => i.message) };
}

/** Why each offered service can't be quoted and booked instantly, in words: the questions and rules in the way. */
async function quoteBlockers(ctx: ToolCtx, def: Definition) {
  const catalog = await catalogOf(ctx, ctx.company._id);
  const out: { service: string; why: string[] }[] = [];
  for (const offered of def.services.offered) {
    const found = catalog.get(offered.serviceKey);
    if (!found) {
      out.push({ service: offered.displayName || offered.serviceKey, why: ["It has no published version in Services & Pricing."] });
      continue;
    }
    const spec = found.spec;
    const why: string[] = [];
    const blocked = instantBlocker(spec, null);
    if (blocked) why.push(blocked);
    if (spec.pricing.method === "hourly_per_cleaner" || spec.pricing.method === "hourly_per_crew") why.push("It is priced by the hour, so the online price is an estimate.");
    for (const q of spec.questions) if (q.walkthroughIf) why.push(`The answer to "${q.label}" can require a walkthrough.`);
    for (const level of spec.modifiers.condition.enabled ? spec.modifiers.condition.levels : []) if (level.requiresWalkthrough) why.push(`Choosing the condition "${level.label}" requires a walkthrough.`);
    if (spec.pricing.method === "size_bands" && spec.pricing.bands.every((b) => b.to !== null)) why.push(`Properties of ${Math.max(...spec.pricing.bands.map((b) => b.to ?? 0)).toLocaleString()} sq ft or more go to a custom quote.`);
    if (spec.modifiers.recurring.enabled) why.push("Choosing a recurring schedule sends a request: recurring billing isn't connected yet.");
    out.push({ service: spec.name, why });
  }
  if (def.behavior.mode !== "instant") out.unshift({ service: "Whole page", why: [`The page is set to ${def.behavior.mode === "estimate_request" ? "ask for an estimate" : "ask for a walkthrough"}, so nothing books instantly.`] });
  return out;
}

const HEX = { type: "string" as const, optional: true, max: 7, description: "A color like #0f766e." };

export const BOOKING_TOOLS: ChatTool[] = [
  {
    name: "list_booking_experiences",
    label: "Reading the booking experiences",
    description: "The company's booking experiences (Sales › Booking Forms): name, kind, status, whether it books instantly or sends a request, how many services it offers, and its address. Read only.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const rows = await ctx.db
        .query("bookingExperiences")
        .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.company._id))
        .order("desc")
        .take(50);
      const settings = await bookingSettingsOf(ctx, ctx.company);
      return {
        status: "done",
        summary: rows.length ? `${rows.length} booking experience${rows.length === 1 ? "" : "s"}.` : "No booking experiences yet.",
        data: {
          handle: settings.handle ?? null,
          experiences: rows.map((r) => ({ id: r._id, name: r.name, kind: KIND_LABELS[r.kind].label, status: r.status, mode: r.draft.behavior.mode, services: r.draft.services.offered.filter((o) => !o.hidden).length, publishedVersion: r.publishedVersion ?? null, draftHasChanges: r.draftDiffers })),
        },
        link: { href: "/app/agents/sales/booking-forms", label: "Open Booking Forms" },
      };
    },
  },
  {
    name: "read_booking_experience",
    label: "Reading a booking experience",
    description: "One booking experience's draft: its steps and words, offered services and which is featured, booking behavior (instant or request, payment policy, agreement), what blocks publishing, and for each offered service what stops an instant firm quote (walkthrough answers, size limits, hourly pricing, recurring schedules). Use this to answer 'which questions are preventing instant quotes'. Read only.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { experience: { type: "string", max: 120, description: "The experience's name or id." } } },
    run: async (ctx, args) => {
      const experience = await findExperience(ctx, args.experience);
      if (!experience) return refused("No booking experience by that name. Use list_booking_experiences.");
      const def = experience.draft;
      const settings = await bookingSettingsOf(ctx, ctx.company);
      const items = await readiness(ctx, ctx.company, def, settings, await catalogOf(ctx, ctx.company._id));
      const policy = settings.paymentPolicies.find((p) => p.id === def.behavior.paymentPolicyId) ?? null;
      return {
        status: "done",
        summary: `${experience.name}: ${words(items).blockers.length ? `${words(items).blockers.length} thing(s) block publishing` : "ready to publish"}.`,
        data: {
          name: experience.name,
          status: experience.status,
          steps: def.steps.map((s) => ({ step: STEP_LABELS[s.id], title: s.copy.title, subtitle: s.copy.subtitle, blocks: s.sections.filter((x) => !x.hidden).map((x) => x.id) })),
          services: def.services.offered.map((o) => ({ key: o.serviceKey, displayName: o.displayName || null, featured: def.services.featuredKey === o.serviceKey, hidden: o.hidden })),
          mode: def.behavior.mode,
          payment: policy ? `${policy.label} (from the booking rules)` : "No payment online",
          agreement: settings.agreements.find((a) => a.id === def.behavior.agreementId)?.label ?? null,
          brand: def.theme.useCompanyBrand ? `The company's colors (${settings.profile.brandColor}, ${settings.profile.accentColor})` : `${def.theme.brandColor}, ${def.theme.accentColor}`,
          quoteBlockers: await quoteBlockers(ctx, def),
          ...words(items),
        },
        link: link(experience._id, experience.name),
      };
    },
  },
  {
    name: "create_booking_experience",
    label: "Creating a booking experience",
    description: `Starts a new booking experience as a draft, from the reference booking layout and the company's own published services for that kind: ${EXPERIENCE_KINDS.map((k) => `${k} (${KIND_LABELS[k].label})`).join(", ")}. A commercial one asks for a walkthrough. It is never published here. Owners and Managers.`,
    kind: "draft",
    minimumRole: "manager",
    input: { type: "object", properties: { kind: { type: "string", enum: EXPERIENCE_KINDS }, name: { type: "string", optional: true, max: 80 } } },
    run: async (ctx, args) => {
      const kind = args.kind as ExperienceKind;
      const id = await createExperience(asMember(ctx), kind, args.name as string | undefined, "chat");
      const experience = (await ctx.db.get(id))!;
      const settings = await bookingSettingsOf(ctx, ctx.company);
      const items = await readiness(ctx, ctx.company, experience.draft, settings, await catalogOf(ctx, ctx.company._id));
      const offered = experience.draft.services.offered.length;
      return {
        status: "done",
        summary: `Created the draft "${experience.name}" with ${offered} published service${offered === 1 ? "" : "s"}. It isn't published.`,
        data: {
          uses: ["Published services from Services & Pricing", "The company's public profile and colors from the booking rules", "Booking hours and ZIP codes from Business details"],
          missing: offered ? [] : [`No published ${KIND_LABELS[kind].label.toLowerCase()} services yet: publish one in Services & Pricing.`],
          ...words(items),
        },
        link: link(id, experience.name),
      };
    },
  },
  {
    name: "edit_booking_experience",
    label: "Editing a booking experience",
    description:
      "Changes a booking experience's draft, the same draft the builder shows: feature a service, order or hide services, the page's own colors (or the company's), step headlines and text, request instead of instant booking, build a service comparison from the services' real scope, add trust statements (they must be confirmed by a person before publishing). Never changes prices, deposits, agreements or hours, and never publishes. Owners and Managers.",
    kind: "draft",
    minimumRole: "manager",
    input: {
      type: "object",
      properties: {
        experience: { type: "string", max: 120 },
        changes: {
          type: "object",
          properties: {
            featureService: { type: "string", optional: true, max: 80, description: "A service's name or key to feature." },
            order: { type: "array", optional: true, maxItems: 12, items: { type: "string", max: 80 }, description: "Service names or keys, first to last." },
            hide: { type: "array", optional: true, maxItems: 12, items: { type: "string", max: 80 } },
            show: { type: "array", optional: true, maxItems: 12, items: { type: "string", max: 80 } },
            useCompanyBrand: { type: "boolean", optional: true },
            brandColor: HEX,
            accentColor: HEX,
            mode: { type: "string", optional: true, enum: ["instant", "estimate_request", "walkthrough_request"] },
            stepCopy: { type: "array", optional: true, maxItems: 6, items: { type: "object", properties: { step: { type: "string", enum: STEP_IDS }, title: { type: "string", optional: true, max: 120 }, subtitle: { type: "string", optional: true, max: 400 }, button: { type: "string", optional: true, max: 40 } } } },
            buildComparison: { type: "boolean", optional: true },
            addTrust: { type: "array", optional: true, maxItems: 4, items: { type: "string", max: 160 } },
          },
        },
      },
    },
    run: async (ctx, args) => {
      const experience = await findExperience(ctx, args.experience);
      if (!experience) return refused("No booking experience by that name. Use list_booking_experiences.");
      const c = args.changes as Record<string, unknown>;
      const def = structuredClone(experience.draft);
      const catalog = await catalogOf(ctx, ctx.company._id);
      const changed: string[] = [];
      const keyOf = (value: string) => {
        const v = value.toLowerCase();
        const offered = def.services.offered.find((o) => o.serviceKey === value || (catalog.get(o.serviceKey)?.name ?? "").toLowerCase() === v || o.displayName.toLowerCase() === v);
        if (offered) return offered.serviceKey;
        for (const [key, row] of catalog) if (key === value || row.name.toLowerCase() === v) return key;
        return null;
      };
      const nameOf = (key: string) => catalog.get(key)?.name ?? key;
      if (typeof c.featureService === "string") {
        const key = keyOf(c.featureService);
        if (!key) return refused(`"${c.featureService}" isn't a published service.`);
        if (!def.services.offered.some((o) => o.serviceKey === key)) def.services.offered.push({ serviceKey: key, displayName: "", blurb: "", benefits: [], badge: "", hidden: false });
        def.services.featuredKey = key;
        const row = def.services.offered.find((o) => o.serviceKey === key)!;
        row.hidden = false;
        if (!row.badge) row.badge = "Most popular";
        def.services.offered = [row, ...def.services.offered.filter((o) => o.serviceKey !== key)];
        changed.push(`Featured ${nameOf(key)} and moved it first.`);
      }
      if (Array.isArray(c.order)) {
        const keys = (c.order as string[]).map(keyOf).filter((k): k is string => Boolean(k));
        def.services.offered.sort((a, b) => (keys.indexOf(a.serviceKey) === -1 ? 99 : keys.indexOf(a.serviceKey)) - (keys.indexOf(b.serviceKey) === -1 ? 99 : keys.indexOf(b.serviceKey)));
        changed.push(`Ordered the services: ${def.services.offered.map((o) => nameOf(o.serviceKey)).join(", ")}.`);
      }
      for (const [field, hidden] of [["hide", true], ["show", false]] as const) {
        for (const value of (c[field] as string[] | undefined) ?? []) {
          const key = keyOf(value);
          if (!key) return refused(`"${value}" isn't a published service.`);
          let row = def.services.offered.find((o) => o.serviceKey === key);
          if (!row && !hidden) def.services.offered.push((row = { serviceKey: key, displayName: "", blurb: "", benefits: [], badge: "", hidden: false }));
          if (row) row.hidden = hidden;
          changed.push(`${hidden ? "Hid" : "Showed"} ${nameOf(key)}.`);
        }
      }
      if (typeof c.useCompanyBrand === "boolean") {
        def.theme.useCompanyBrand = c.useCompanyBrand;
        changed.push(c.useCompanyBrand ? "Uses the company's own colors." : "Uses the page's own colors.");
      }
      if (typeof c.brandColor === "string" || typeof c.accentColor === "string") {
        def.theme.useCompanyBrand = false;
        if (typeof c.brandColor === "string") def.theme.brandColor = c.brandColor;
        if (typeof c.accentColor === "string") def.theme.accentColor = c.accentColor;
        changed.push(`Colors set to ${def.theme.brandColor} and ${def.theme.accentColor}.`);
      }
      if (typeof c.mode === "string") {
        def.behavior.mode = c.mode as Definition["behavior"]["mode"];
        if (def.behavior.mode !== "instant") def.behavior.paymentPolicyId = null;
        changed.push(def.behavior.mode === "instant" ? "Books instantly." : def.behavior.mode === "estimate_request" ? "Asks for an estimate instead of booking." : "Asks for a walkthrough instead of booking.");
      }
      for (const row of (c.stepCopy as { step: StepId; title?: string; subtitle?: string; button?: string }[] | undefined) ?? []) {
        const step = def.steps.find((s) => s.id === row.step)!;
        if (row.title !== undefined) step.copy.title = row.title;
        if (row.subtitle !== undefined) step.copy.subtitle = row.subtitle;
        if (row.button !== undefined) step.copy.button = row.button;
        changed.push(`Rewrote the ${STEP_LABELS[row.step]} step's words.`);
      }
      if (c.buildComparison === true) {
        const rows = new Map<string, { group: string; included: string[] }>();
        for (const o of def.services.offered.filter((x) => !x.hidden)) for (const item of catalog.get(o.serviceKey)?.spec.included ?? []) rows.set(item.label, { group: item.section ?? "Everywhere", included: [...(rows.get(item.label)?.included ?? []), o.serviceKey] });
        def.services.comparison.rows = [...rows.entries()].slice(0, 40).map(([label, row]) => ({ label: label.slice(0, 120), group: row.group.slice(0, 80), included: row.included }));
        const service = def.steps.find((s) => s.id === "service")!;
        const section = service.sections.find((s) => s.id === "comparison");
        if (section) section.hidden = false;
        else service.sections.unshift({ id: "comparison", hidden: false });
        changed.push(`Built a comparison of ${def.services.comparison.rows.length} tasks from the services' published scope.`);
      }
      for (const text of (c.addTrust as string[] | undefined) ?? []) {
        if (def.content.trust.length >= 8) break;
        def.content.trust.push({ id: `t_${Math.random().toString(36).slice(2, 8)}`, text, confirmed: false });
        changed.push(`Added the trust statement "${text}" (a person must confirm it is true before publishing).`);
      }
      if (!changed.length) return refused("Nothing to change was given.");
      try {
        normalizeDefinition(def);
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "That change isn't allowed.");
      }
      const result = await writeDraft(asMember(ctx), experience, def, experience.draftRevision, { via: "chat" });
      if (!result.ok) return refused(`${result.conflict.savedBy} saved this experience a moment ago. Read it again before changing it.`);
      const settings = await bookingSettingsOf(ctx, ctx.company);
      const fresh = (await ctx.db.get(experience._id))!;
      const items = await readiness(ctx, ctx.company, fresh.draft, settings, catalog);
      return {
        status: "done",
        summary: changed.join(" "),
        data: {
          changed,
          uses: ["Prices, scope and questions from Services & Pricing (unchanged)", "Payment and agreement rules from the booking rules (unchanged)"],
          effects: {
            price: "None: display words never change a price.",
            payment: fresh.draft.behavior.mode === "instant" ? (settings.paymentPolicies.find((p) => p.id === fresh.draft.behavior.paymentPolicyId)?.label ?? "No payment online") : "No payment: requests never charge.",
            booking: fresh.draft.behavior.mode === "instant" ? "Customers can book instantly where the price is firm." : "Customers send a request; nothing is reserved or charged.",
          },
          publishReady: words(items).blockers.length === 0,
          ...words(items),
          note: "The draft is saved. Publishing is the Owner's, in the builder.",
        },
        link: link(experience._id, experience.name),
      };
    },
  },
  {
    name: "publish_booking_experience",
    label: "Publishing a booking experience",
    description: "Publishing a booking experience is not something Chat does: the Owner publishes from the builder after checking the preview and the publish checklist.",
    kind: "unavailable",
    minimumRole: "owner",
    input: { type: "object", properties: {} },
    run: async () => ({ status: "unavailable", why: "Publishing is the Owner's, in Sales › Booking Forms, after the checklist and preview." }),
  },
];
