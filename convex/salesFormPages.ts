/**
 * The public side of a booking form: what the page shows, and taking a submission.
 *
 * `view` is a public read: a published form is public by definition. It returns the published
 * questions, the company's display name and the names of the services the form lists, and nothing else
 * about the company.
 *
 * `submit` is called only by the Selestial web server, which holds PUBLIC_FORM_SECRET and passes a hash
 * of the visitor's address (never the address). A submission is refused, without saying which check
 * failed, when the hidden field was filled or it arrived faster than a person could type it; it is
 * limited per visitor and per form; and the browser's own key makes a double click or a retried request
 * one submission. A submission becomes a customer (matched or new), an opportunity, and Sales's first
 * step, exactly once.
 */
import { v } from "convex/values";

import { publicQuery, serverMutation } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { AGENT_PROFILES } from "./lib/departments";
import { allow } from "./lib/rateLimit";
import { checkSubmission, type Answers } from "./lib/sales/forms";
import { fileInquiry, type Consent } from "./lib/sales/intake";
import { SYSTEM } from "./lib/sales/opportunities";
import { enqueueRun } from "./lib/sales/runs";
import { publishedCatalog } from "./lib/services/store";

const HOUR = 60 * 60_000;
export const PER_VISITOR_PER_HOUR = 5;
export const PER_FORM_PER_HOUR = 120;
/** Faster than this from page load to submit is not a person. */
const MIN_FILL_MS = 2500;

export const view = publicQuery({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    if (args.publicId.length > 64) return null;
    const form = await ctx.db
      .query("salesForms")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!form) return null;
    const company = await ctx.db.get(form.companyId);
    if (!company) return null;
    const profile = await readProfile(ctx, company._id);
    const name = profile.messaging.senderName ?? company.name;
    // A form taken offline keeps its address and says it is closed, so an old link is not a dead end.
    if (form.status !== "published" || !form.published) return { open: false as const, company: name };
    const catalog = await publishedCatalog(ctx, company._id);
    return {
      open: true as const,
      company: name,
      form: form.published,
      version: form.publishedVersion,
      services: form.published.serviceKeys.flatMap((key) => {
        const found = catalog.find((item) => item.service.key === key);
        return found ? [{ key, name: found.version.spec.name, summary: found.version.spec.summary.slice(0, 200) }] : [];
      }),
    };
  },
});

export type SubmitResult = { status: "saved"; title: string; body: string } | { status: "invalid"; problems: Record<string, string> } | { status: "limited" } | { status: "closed" };

export const submit = serverMutation({
  args: {
    publicId: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    message: v.string(),
    serviceKey: v.string(),
    answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
    smsConsent: v.boolean(),
    /** A field people never see. Anything in it means a script filled the form. */
    website: v.string(),
    /** How long the page was open before it was sent, measured by the page. */
    elapsedMs: v.number(),
    clientKey: v.string(),
    visitorKey: v.string(),
    campaign: v.optional(v.string()),
    medium: v.optional(v.string()),
    referrer: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SubmitResult> => {
    const form = args.publicId.length <= 64 ? await ctx.db.query("salesForms").withIndex("by_publicId", (q) => q.eq("publicId", args.publicId)).unique() : null;
    const company = form ? await ctx.db.get(form.companyId) : null;
    if (!form || !company || form.status !== "published" || !form.published || company.suspendedAt !== undefined) return { status: "closed" };
    const definition = form.published;
    const done: SubmitResult = { status: "saved", title: definition.confirmation.title, body: definition.confirmation.body };
    // A script that filled the hidden field, or answered in an instant, is told it worked and nothing is kept.
    if (args.website.trim() !== "" || args.elapsedMs < MIN_FILL_MS) return done;
    const clientKey = args.clientKey.trim().slice(0, 80);
    if (clientKey.length < 8) return { status: "invalid", problems: { form: "Reload the page and try again." } };
    const key = `${form._id}:${clientKey}`;
    const seen = await ctx.db
      .query("salesFormSubmissions")
      .withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("clientKey", key))
      .first();
    if (seen) return done;
    const visitorKey = args.visitorKey.trim().slice(0, 128) || "unknown";
    if (!(await allow(ctx, `sales-form:visitor:${form._id}:${visitorKey}`, PER_VISITOR_PER_HOUR, HOUR))) return { status: "limited" };
    if (!(await allow(ctx, `sales-form:${form._id}`, PER_FORM_PER_HOUR, HOUR))) return { status: "limited" };

    const now = Date.now();
    const checked = checkSubmission(definition, { name: args.name, email: args.email, phone: args.phone, message: args.message, serviceKey: args.serviceKey, answers: args.answers as Answers, smsConsent: args.smsConsent }, now, key);
    if (!checked.ok) return { status: "invalid", problems: checked.problems };
    const clean = (value: string | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : undefined);
    const source = { campaign: clean(args.campaign, 120), medium: clean(args.medium, 60), referrer: clean(args.referrer, 200) };
    const submissionId = await ctx.db.insert("salesFormSubmissions", { companyId: company._id, formId: form._id, formVersion: form.publishedVersion, answers: checked.answers, contact: checked.contact, consent: { sms: checked.smsConsent, ...(checked.smsConsent ? { smsText: definition.consent.smsText } : {}), at: now }, source, clientKey: key, status: "accepted", receivedAt: now });

    // What they agreed to, and only that. An email address given to get a reply is permission to reply by email about this request.
    const consent: Consent[] = [];
    if (checked.contact.email) consent.push({ channel: "email", source: "web_form", evidence: `Asked for a reply on the "${form.name}" form and gave this address.` });
    if (checked.smsConsent && checked.contact.phone) consent.push({ channel: "sms", source: "web_form", evidence: `Ticked the box on the "${form.name}" form.`, disclosureText: definition.consent.smsText });
    const message = args.message.trim().slice(0, 2000);
    const inquiry = [message, ...checked.notes].filter(Boolean).join("\n") || `${definition.intent === "booking_request" ? "Booking request" : "Estimate request"} from the "${form.name}" form.`;
    const { opportunity, created } = await fileInquiry(ctx, company, {
      contact: checked.contact,
      kind: definition.kind,
      source: { kind: "form", formId: form._id, submissionId, ...source },
      inquiry,
      receivedAt: now,
      // Replies go by text only when the person said yes to texts; otherwise by email.
      channel: checked.smsConsent && checked.contact.phone ? "sms" : checked.contact.email ? "email" : "sms",
      facts: checked.facts,
      serviceKey: checked.serviceKey ?? (definition.serviceKeys.length === 1 ? definition.serviceKeys[0] : undefined),
      timing: checked.timing,
      consent,
      dedupeKey: `form:${key}`,
      actor: SYSTEM,
    });
    await ctx.db.patch(submissionId, { opportunityId: opportunity._id });
    if (created && AGENT_PROFILES.sales.built && opportunity.match.state !== "needs_review") {
      const first = await ctx.db
        .query("salesMessages")
        .withIndex("by_company_opportunity", (q) => q.eq("companyId", company._id).eq("opportunityId", opportunity._id))
        .first();
      // Only the person's own free-text message is read for details; the form's answers are already facts.
      await enqueueRun(ctx, opportunity, { trigger: "inquiry", key: `inquiry:${opportunity._id}`, messageId: message ? first?._id : undefined });
    }
    return done;
  },
});
