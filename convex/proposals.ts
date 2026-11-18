/**
 * Proposals for commercial, office and short-term rental work.
 *
 * - The workspace draft holds the proposal while it is being prepared. Saving freezes a version: its
 *   content and a hash of it. A sent version is never rewritten; a change is a new version.
 * - Custom rates need the Owner's approval of that exact version's content (by hash) before it is sent.
 * - The customer's link always shows the latest sent version. Their answer names the version and hash
 *   they saw, so an answer to an older version is refused, and answering twice records it once.
 * - Accepting starts a service setup: an agreement prepared from the accepted terms, billing on the
 *   accepted invoice terms, and each site's access and schedule. Nothing is scheduled by accepting.
 * - Viewing the link lets the reader see the proposal. Accepting asks them to name themselves and
 *   confirm their authority; it does not change who the contract is with.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { requestApproval } from "./lib/approvalQueue";
import { createAgreement } from "./lib/agreements/store";
import { companyMutation, companyQuery, salesLinkMutation, salesLinkQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { localInstant, type Cadence } from "./lib/sales/cadence";
import { checkCapacity } from "./lib/sales/capacity";
import type { DraftBody } from "./lib/sales/draft";
import { linkToken, linkUrl, newLinkId } from "./lib/sales/links";
import { channelFor, queueSalesMessage } from "./lib/sales/outbox";
import { createPlan, todayIn } from "./lib/sales/plans";
import { buildContent, customerCopy, TEMPLATE_FIELDS, type ProposalContent } from "./lib/sales/proposalContent";
import type { ProposalStatus, ProposalTemplate } from "./lib/sales/schema";
import { createVisit } from "./lib/sales/visits";
import { canonical } from "./lib/services/store";
import { formatCents } from "./lib/services/words";
import { optionalEmail, optionalText, text } from "./lib/text";
import { setMilestone } from "./sales";

const DAY = 86_400_000;

export const STATUS_WORDS: Record<ProposalStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent",
  changes_requested: "Changes requested",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a newer version",
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function templateOf(segment: string): ProposalTemplate {
  return segment === "office" ? "office" : segment === "str" ? "str" : "commercial";
}

function effectiveStatus(row: Doc<"proposals">): ProposalStatus {
  return (row.status === "sent" || row.status === "changes_requested") && row.expiresAt !== undefined && row.expiresAt < Date.now() ? "expired" : row.status;
}

async function versionRow(ctx: QueryCtx | MutationCtx, proposalId: Id<"proposals">, version: number) {
  return ctx.db
    .query("proposalVersions")
    .withIndex("by_proposal_version", (q) => q.eq("proposalId", proposalId).eq("version", version))
    .unique();
}

// ── Staff ────────────────────────────────────────────────────────────────────────────────────────

/** The proposal as it would be saved now, from the draft, with what is unresolved. */
export const preview = companyQuery({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
    const content = await buildContent(ctx, ctx.company, templateOf(draft.segment), customer, draft.body as DraftBody);
    const proposal = draft.proposalId ? await ctx.db.get(draft.proposalId) : null;
    return {
      content,
      fields: TEMPLATE_FIELDS[templateOf(draft.segment)],
      proposal: proposal ? { _id: proposal._id, status: effectiveStatus(proposal), statusWords: STATUS_WORDS[effectiveStatus(proposal)], latestVersion: proposal.latestVersion, sentVersion: proposal.sentVersion, approval: proposal.approval ?? null, expiresAt: proposal.expiresAt ?? null, viewCount: proposal.viewCount } : null,
      canApproveRates: isOwner(ctx.role),
    };
  },
});

/**
 * Freezes the draft's proposal as a new version. The same content twice is the same version. Custom
 * rates ask the Owner to approve this exact version; the Owner's own custom rates are approved by saving.
 */
export const saveVersion = companyMutation({
  args: { draftId: v.id("salesDrafts"), revision: v.number() },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    if (draft.mode !== "proposal") throw userError("This draft is a booking.");
    if (draft.revision !== args.revision) throw userError("The draft changed since the preview was shown. Review it again.");
    if (!draft.customerId) throw userError("Choose the client first.");
    const customer = await owned(ctx, draft.customerId);
    const template = templateOf(draft.segment);
    const content = await buildContent(ctx, ctx.company, template, customer, draft.body as DraftBody);
    const hash = await sha256(canonical(content));
    const now = Date.now();
    let proposal = draft.proposalId ? await ctx.db.get(draft.proposalId) : null;
    if (proposal && (proposal.status === "accepted" || proposal.status === "declined")) throw userError(`This proposal was ${proposal.status}. Start a new proposal for further changes.`);
    if (!proposal) {
      const proposalId = await ctx.db.insert("proposals", { companyId: ctx.companyId, ...(draft.opportunityId ? { opportunityId: draft.opportunityId } : {}), draftId: draft._id, customerId: customer._id, template, title: content.title, status: "draft", sentVersion: 0, latestVersion: 0, viewCount: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
      await ctx.db.patch(draft._id, { proposalId, status: "proposal_created", updatedAt: now });
      proposal = (await ctx.db.get(proposalId))!;
    }
    const latest = proposal.latestVersion ? await versionRow(ctx, proposal._id, proposal.latestVersion) : null;
    let version = proposal.latestVersion;
    if (!latest || latest.hash !== hash) {
      version = proposal.latestVersion + 1;
      await ctx.db.insert("proposalVersions", { companyId: ctx.companyId, proposalId: proposal._id, version, content, hash, createdBy: ctx.member._id, createdAt: now });
    }
    let approval = proposal.approval && proposal.approval.hash === hash ? proposal.approval : undefined;
    if (content.customRates && !approval) {
      if (isOwner(ctx.role)) approval = undefined;
      else {
        const approvalId = await requestApproval(ctx, {
          companyId: ctx.companyId,
          action: "sales.discount_out_of_band",
          summary: `Custom rates for ${customer.name}: ${content.sites.filter((s) => s.priceBasis === "custom").map((s) => `${s.label} ${s.priceCents !== null ? formatCents(s.priceCents) : ""} (calculated ${s.referenceCents !== null ? formatCents(s.referenceCents) : "none"})`).join("; ")}`,
          reason: content.sites.filter((s) => s.customReason).map((s) => `${s.label}: ${s.customReason}`).join(" ") || "Custom rates",
          decideBy: now + 3 * DAY,
          authorizes: `Sending version ${version} of this proposal with these rates, exactly as written.`,
          ifWaiting: "The proposal isn't sent.",
          proposal: { kind: "proposal_rates", proposalId: proposal._id, version, hash },
          about: { table: "customers", id: customer._id },
        });
        approval = { hash, approvalId, state: "waiting" };
      }
    }
    const ready = content.unresolved.length === 0 && (!content.customRates || isOwner(ctx.role) || approval?.state === "approved");
    const keepsStatus = proposal.status === "sent" || proposal.status === "changes_requested";
    await ctx.db.patch(proposal._id, { title: content.title, latestVersion: version, ...(approval ? { approval } : { approval: undefined }), status: keepsStatus ? proposal.status : ready ? "ready" : "draft", updatedAt: now });
    await setMilestone(ctx, draft.opportunityId, content.unresolved.some((u) => /walkthrough/.test(u)) ? "assessment_needed" : content.unresolved.length ? "pricing_pending" : "proposal_ready", content.unresolved[0] ?? "Send the proposal");
    return { proposalId: proposal._id, version, unresolved: content.unresolved, waitingForApproval: approval?.state === "waiting" };
  },
});

/** Sends the latest version. Refused while anything is unresolved or custom rates are unapproved. */
export const send = companyMutation({
  args: { proposalId: v.id("proposals"), version: v.number(), message: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const proposal = await owned(ctx, args.proposalId);
    const status = effectiveStatus(proposal);
    if (status === "accepted" || status === "declined" || status === "withdrawn") throw userError(`This proposal was ${status}.`);
    if (args.version !== proposal.latestVersion) throw userError("A newer version was saved. Review it before sending.");
    const row = await versionRow(ctx, proposal._id, args.version);
    if (!row) throw userError("Save the proposal first.");
    const content = row.content as ProposalContent;
    if (content.unresolved.length) throw userError(`Still unresolved: ${content.unresolved.join("; ")}.`);
    if (content.customRates && !isOwner(ctx.role) && !(proposal.approval?.hash === row.hash && proposal.approval.state === "approved")) throw userError("The custom rates are waiting for the Owner's approval of this version.");
    const customer = await owned(ctx, proposal.customerId);
    if (!customer.email) throw userError("Add the client's email to send the proposal.");
    const now = Date.now();
    const publicId = proposal.publicId ?? newLinkId();
    await ctx.db.patch(proposal._id, { status: "sent", sentVersion: row.version, publicId, expiresAt: now + content.expiresInDays * DAY, updatedAt: now });
    await ctx.db.patch(row._id, { sentAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "proposal.sent", actor: byMember(ctx), subject: { table: "proposals", id: proposal._id }, data: { version: row.version } });
    const note = optionalText(args.message, "Message", 1000);
    await queueSalesMessage(ctx, {
      company: ctx.company,
      customer,
      purpose: "proposal_sent",
      channel: "email",
      subject: `${row.version > 1 ? "Updated proposal" : "Your proposal"} from ${ctx.company.name}`,
      body: `Hi ${customer.name.split(" ")[0] || "there"},\n\n${note ?? `${ctx.company.name} has prepared a proposal for you.`}\n\nRead it, and accept, ask for changes or decline here:\n{proposal}\n\nIt's open until ${new Date(now + content.expiresInDays * DAY).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`,
      links: [{ placeholder: "{proposal}", kind: "proposal", id: proposal._id }],
      dedupeKey: `proposal:${proposal._id}:v${row.version}`,
      actor: byMember(ctx),
    });
    await setMilestone(ctx, proposal.opportunityId, "proposal_sent", "Follow up if the client hasn't answered");
    const token = await linkToken("proposal", publicId);
    return { url: token ? linkUrl("proposal", token) : null };
  },
});

export const withdraw = companyMutation({
  args: { proposalId: v.id("proposals"), reason: v.string() },
  handler: async (ctx, args) => {
    const proposal = await owned(ctx, args.proposalId);
    if (proposal.status === "accepted") throw userError("An accepted proposal can't be withdrawn. Change the service through its setup or a new agreement.");
    await ctx.db.patch(proposal._id, { status: "withdrawn", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "proposal.withdrawn", actor: byMember(ctx), subject: { table: "proposals", id: proposal._id }, data: { reason: text(args.reason, "The reason", 300) } });
    return null;
  },
});

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("proposals")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(100);
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const version = row.latestVersion ? await versionRow(ctx, row._id, row.latestVersion) : null;
      const status = effectiveStatus(row);
      out.push({ _id: row._id, draftId: row.draftId ?? null, title: row.title, customer: customer?.name ?? "Client", template: row.template, status, statusWords: STATUS_WORDS[status], version: row.latestVersion, sites: (version?.content as ProposalContent | undefined)?.sites.length ?? 0, updatedAt: row.updatedAt, setupId: row.setupId ?? null });
    }
    return out;
  },
});

/** One proposal's history: versions, the client's answers, views and the service setup. */
export const get = companyQuery({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => {
    const proposal = await owned(ctx, args.proposalId);
    const versions = await ctx.db
      .query("proposalVersions")
      .withIndex("by_proposal_version", (q) => q.eq("proposalId", proposal._id))
      .take(50);
    const responses = await ctx.db
      .query("proposalResponses")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
      .take(50);
    const token = proposal.publicId ? await linkToken("proposal", proposal.publicId) : null;
    return {
      proposal: { ...proposal, publicId: undefined, status: effectiveStatus(proposal), statusWords: STATUS_WORDS[effectiveStatus(proposal)] },
      versions: versions.map((row) => ({ version: row.version, createdAt: row.createdAt, sentAt: row.sentAt ?? null, hash: row.hash.slice(0, 12) })),
      responses: responses.map((row) => ({ kind: row.kind, version: row.version, name: row.name, email: row.email ?? null, title: row.title ?? null, signer: row.signer ?? null, note: row.note ?? null, optionId: row.optionId ?? null, at: row.at })),
      url: token && (proposal.status === "sent" || proposal.status === "changes_requested") ? linkUrl("proposal", token) : null,
    };
  },
});

/** Carries out the Owner's decision on custom rates: approval names the exact version content by hash. */
export async function afterProposalDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped") {
  const at = Date.now();
  if (approval.proposal?.kind !== "proposal_rates") return { ok: false, detail: "Not a proposal decision.", at };
  const { proposalId, version, hash } = approval.proposal;
  const proposal = await ctx.db.get(proposalId);
  if (!proposal || proposal.companyId !== approval.companyId) return { ok: false, detail: "The proposal no longer exists.", at };
  if (proposal.latestVersion !== version || proposal.approval?.hash !== hash) return { ok: false, detail: "The proposal changed since this was asked. The new version needs its own approval.", at };
  const state = decision === "approved" ? ("approved" as const) : ("declined" as const);
  const row = await versionRow(ctx, proposalId, version);
  const unresolved = (row?.content as ProposalContent | undefined)?.unresolved.length ?? 1;
  await ctx.db.patch(proposal._id, { approval: { ...proposal.approval, state }, ...(state === "approved" && unresolved === 0 && proposal.status === "draft" ? { status: "ready" as const } : {}), updatedAt: at });
  return { ok: true, detail: state === "approved" ? `Version ${version}'s rates are approved; it can be sent.` : "The rates were declined. Change them and save a new version.", at };
}

// ── The client's link ──────────────────────────────────────────────────────────────────────────

async function resolve(ctx: QueryCtx | MutationCtx, publicId: string) {
  const proposal = await ctx.db
    .query("proposals")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!proposal) return null;
  const company = await ctx.db.get(proposal.companyId);
  return company ? { proposal, company } : null;
}

export const publicView = salesLinkQuery({
  kind: "proposal",
  resolve,
  args: {},
  handler: async (ctx) => {
    if (!ctx.link) return null;
    const { proposal, company } = ctx.link;
    const status = effectiveStatus(proposal);
    const shownVersion = status === "accepted" && proposal.acceptedVersion ? proposal.acceptedVersion : proposal.sentVersion;
    const row = shownVersion ? await versionRow(ctx, proposal._id, shownVersion) : null;
    if (!row) return null;
    const responses = await ctx.db
      .query("proposalResponses")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
      .order("desc")
      .take(1);
    return {
      company: company.name,
      status,
      version: row.version,
      hash: row.hash,
      content: customerCopy(row.content as ProposalContent),
      expiresAt: proposal.expiresAt ?? null,
      lastResponse: responses[0] ? { kind: responses[0].kind, at: responses[0].at, version: responses[0].version } : null,
    };
  },
});

export const viewed = salesLinkMutation({
  kind: "proposal",
  resolve,
  args: {},
  handler: async (ctx) => {
    const { proposal } = ctx.link;
    if (proposal.status !== "sent" && proposal.status !== "changes_requested") return null;
    await ctx.db.patch(proposal._id, { viewCount: proposal.viewCount + 1, ...(proposal.firstViewedAt ? {} : { firstViewedAt: Date.now() }) });
    if (!proposal.firstViewedAt) await recordEvent(ctx, { companyId: proposal.companyId, type: "proposal.viewed", actor: { kind: "system" }, subject: { table: "proposals", id: proposal._id } });
    return null;
  },
});

/**
 * The client's answer: accept, ask for changes, or decline. It names the version and hash they read;
 * an answer to anything but the live version is refused. Accepting twice records one acceptance.
 */
export const respond = salesLinkMutation({
  kind: "proposal",
  resolve,
  args: {
    version: v.number(),
    hash: v.string(),
    kind: v.union(v.literal("accept"), v.literal("changes"), v.literal("decline")),
    optionId: v.optional(v.string()),
    name: v.string(),
    email: v.optional(v.string()),
    title: v.optional(v.string()),
    authorized: v.boolean(),
    signer: v.optional(v.object({ name: v.string(), email: v.string(), title: v.optional(v.string()) })),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { proposal, company } = ctx.link;
    if (args.kind === "accept" && proposal.status === "accepted" && proposal.acceptedVersion === args.version) return { recorded: false, already: true };
    const status = effectiveStatus(proposal);
    if (status === "expired") throw userError("This proposal has expired. Ask the company for a new one.");
    if (status !== "sent" && status !== "changes_requested") throw userError("This proposal can no longer be answered here.");
    if (args.version !== proposal.sentVersion) throw userError("A newer version of this proposal was sent. Reload to read it before answering.");
    const row = await versionRow(ctx, proposal._id, args.version);
    if (!row || row.hash !== args.hash) throw userError("This proposal changed since you opened it. Reload to read the current version.");
    const content = row.content as ProposalContent;
    const name = text(args.name, "Your name", 120);
    const note = optionalText(args.note, "Your note", 2000);
    if (args.kind === "changes" && !note) throw userError("Say what you'd like changed.");
    if (args.kind === "accept" && !args.authorized) throw userError(`Confirm you're authorized to accept for ${content.client.name}, or name the person who is.`);
    if (args.optionId && !content.options.some((o) => o.id === args.optionId)) throw userError("Choose one of the options shown.");
    const signer = args.signer ? { name: text(args.signer.name, "Signer's name", 120), email: optionalEmail(args.signer.email) ?? "", ...(args.signer.title?.trim() ? { title: args.signer.title.trim().slice(0, 120) } : {}) } : undefined;
    if (signer && !signer.email) throw userError("Give the signer's email.");
    const at = Date.now();
    await ctx.db.insert("proposalResponses", { companyId: proposal.companyId, proposalId: proposal._id, version: row.version, hash: row.hash, kind: args.kind, ...(args.optionId ? { optionId: args.optionId } : {}), name, ...(optionalEmail(args.email) ? { email: optionalEmail(args.email) } : {}), ...(args.title?.trim() ? { title: args.title.trim().slice(0, 120) } : {}), ...(signer ? { signer } : {}), ...(note ? { note } : {}), at });
    const subject = { table: "proposals" as const, id: proposal._id };
    if (args.kind === "decline") {
      await ctx.db.patch(proposal._id, { status: "declined", updatedAt: at });
      await recordEvent(ctx, { companyId: proposal.companyId, type: "proposal.declined", actor: { kind: "system" }, subject, data: { version: row.version } });
      await stopFollowUps(ctx, proposal, "declined");
      return { recorded: true, already: false };
    }
    if (args.kind === "changes") {
      await ctx.db.patch(proposal._id, { status: "changes_requested", updatedAt: at });
      await recordEvent(ctx, { companyId: proposal.companyId, type: "proposal.changes_requested", actor: { kind: "system" }, subject, data: { version: row.version } });
      await stopFollowUps(ctx, proposal, "changes_requested");
      return { recorded: true, already: false };
    }
    // Accepted: bound to this version and option, and a setup starts. Nothing is scheduled yet.
    const setupId = await ctx.db.insert("serviceSetups", {
      companyId: proposal.companyId,
      proposalId: proposal._id,
      version: row.version,
      customerId: proposal.customerId,
      startTogether: content.terms.startTogether,
      agreement: "pending",
      billing: "pending",
      sites: content.sites.filter((site) => site.propertyId).map((site) => ({ key: site.key, propertyId: site.propertyId as Id<"properties">, label: site.label, access: site.internal.accessNotes ? ("in_progress" as const) : ("pending" as const), schedule: "pending" as const })),
      status: "open",
      createdAt: at,
      updatedAt: at,
    });
    await ctx.db.patch(proposal._id, { status: "accepted", acceptedVersion: row.version, setupId, updatedAt: at });
    await recordEvent(ctx, { companyId: proposal.companyId, type: "proposal.accepted", actor: { kind: "system" }, subject, data: { version: row.version, optionId: args.optionId ?? null } });
    await stopFollowUps(ctx, proposal, "proposal_accepted");
    void company;
    return { recorded: true, already: false };
  },
});

async function stopFollowUps(ctx: MutationCtx, proposal: Doc<"proposals">, milestone: "declined" | "changes_requested" | "proposal_accepted") {
  if (!proposal.opportunityId) return;
  const opportunity = await ctx.db.get(proposal.opportunityId);
  if (!opportunity) return;
  const next = milestone === "proposal_accepted" ? "Prepare the agreement and service setup" : milestone === "changes_requested" ? "Read the client's changes and send a new version" : undefined;
  await ctx.db.patch(opportunity._id, {
    milestone,
    ...(milestone === "declined" ? { stage: "lost" as const, closedReason: "Declined the proposal", followUps: "stopped" as const } : { followUps: "paused" as const }),
    nextAction: next,
    nextActionAt: next ? Date.now() + DAY : undefined,
    updatedAt: Date.now(),
  });
}

// ── Service setup after acceptance ───────────────────────────────────────────────────────────────

export const setup = companyQuery({
  args: { setupId: v.id("serviceSetups") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.setupId);
    const proposal = await ctx.db.get(row.proposalId);
    const version = proposal ? await versionRow(ctx, proposal._id, row.version) : null;
    const content = version?.content as ProposalContent | undefined;
    const agreement = row.agreementId ? await ctx.db.get(row.agreementId) : null;
    const response = proposal
      ? (
          await ctx.db
            .query("proposalResponses")
            .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
            .order("desc")
            .take(5)
        ).find((r) => r.kind === "accept")
      : undefined;
    return {
      setup: row,
      proposal: proposal ? { _id: proposal._id, title: proposal.title, template: proposal.template } : null,
      content: content ?? null,
      agreement: agreement ? { _id: agreement._id, title: agreement.title, workflow: agreement.workflow } : null,
      acceptedBy: response ? { name: response.name, title: response.title ?? null, signer: response.signer ?? null, at: response.at } : null,
      sites: await Promise.all(
        row.sites.map(async (site) => {
          const plan = site.planId ? await ctx.db.get(site.planId) : null;
          const info = content?.sites.find((s) => s.key === site.key);
          return { ...site, plan: plan ? { _id: plan._id, status: plan.status } : null, perTurnover: info?.perTurnover ?? false, cadence: info?.cadence ?? null, priceCents: info?.priceCents ?? null, ready: siteBlockers(row, agreement?.workflow ?? null, site).length === 0, blockers: siteBlockers(row, agreement?.workflow ?? null, site) };
        }),
      ),
    };
  },
});

function siteBlockers(setup: Doc<"serviceSetups">, agreementWorkflow: string | null, site: Doc<"serviceSetups">["sites"][number]): string[] {
  const out: string[] = [];
  if (agreementWorkflow !== "signed") out.push(agreementWorkflow ? "The agreement isn't signed yet." : "The agreement hasn't been prepared.");
  if (setup.billing !== "done") out.push("Billing isn't set up.");
  if (site.access !== "done" && site.access !== "not_needed") out.push("Access isn't confirmed.");
  return out;
}

/** Prepares the agreement from the accepted version: sites, service, rates and terms carried over. */
export const prepareAgreement = companyMutation({
  args: { setupId: v.id("serviceSetups") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.setupId);
    if (row.agreementId) return row.agreementId;
    const proposal = await owned(ctx, row.proposalId);
    const version = await versionRow(ctx, proposal._id, row.version);
    const content = version!.content as ProposalContent;
    const response = (
      await ctx.db
        .query("proposalResponses")
        .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
        .order("desc")
        .take(5)
    ).find((r) => r.kind === "accept");
    const docType = proposal.template === "office" ? "office_janitorial" : proposal.template === "str" ? "str_turnover" : "commercial_msa";
    const sites = content.sites.map((s) => `${s.label}${s.address ? ` (${s.address})` : ""}: ${s.service?.name ?? ""}, ${s.cadence ?? ""}, ${s.priceCents !== null ? formatCents(s.priceCents) : "rate to confirm"} per ${s.perTurnover ? "turnover" : "visit"}`);
    const terms: Record<string, string | number | string[]> = {
      [proposal.template === "str" ? "propertyList" : "siteList"]: sites.join("\n"),
      scopeSummary: content.sites.flatMap((s) => s.scope).slice(0, 40).join("; "),
      serviceName: content.sites.map((s) => s.service?.name).filter(Boolean).join(", "),
    };
    if (content.terms.netDays !== null) terms.paymentDueDays = content.terms.netDays;
    const months = /^(\d+)/.exec(content.terms.contractTerm);
    terms.termMonths = months ? Number(months[1]) : 0;
    const single = content.sites.length === 1 ? content.sites[0]! : null;
    if (single?.priceCents) terms.pricePerVisitCents = single.priceCents;
    if (content.totals.fixedMonthlyEstimateCents !== null && !content.totals.anyVariable && content.terms.invoiceFrequency.includes("monthly")) terms.monthlyTotalCents = content.totals.fixedMonthlyEstimateCents;
    if (response?.signer) terms.counterpartySigner = `${response.signer.name}${response.signer.title ? `, ${response.signer.title}` : ""}`;
    const links: { table: "customers" | "properties"; id: string }[] = [{ table: "customers", id: proposal.customerId }, ...content.sites.filter((s) => s.propertyId).slice(0, 5).map((s) => ({ table: "properties" as const, id: s.propertyId! }))];
    const agreementId = await createAgreement(ctx as never, { docType, links, terms, origin: "manual", note: `From proposal version ${row.version}, accepted` } as never);
    // The signer the client named signs; the contract stays with the client.
    if (response?.signer) {
      const agreement = (await ctx.db.get(agreementId))!;
      const parties = agreement.parties.map((party) => (party.role === "customer" || party.record?.table === "customers" ? { ...party, signer: false } : party));
      parties.push({ role: "client_signer", name: response.signer.name, email: response.signer.email, signer: true, order: parties.length + 1 } as never);
      await ctx.db.patch(agreementId, { parties });
    }
    await ctx.db.patch(row._id, { agreementId, agreement: "in_progress", updatedAt: Date.now() });
    await setMilestone(ctx, proposal.opportunityId, "agreement_pending", "Review the agreement and send it for signature");
    return agreementId;
  },
});

/** Records a setup step a person completed: billing on the accepted terms, or a site's access. */
export const markStep = companyMutation({
  args: { setupId: v.id("serviceSetups"), step: v.union(v.literal("billing"), v.literal("access")), siteKey: v.optional(v.string()), done: v.boolean() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.setupId);
    const state = args.done ? ("done" as const) : ("pending" as const);
    if (args.step === "billing") await ctx.db.patch(row._id, { billing: state, updatedAt: Date.now() });
    else {
      if (!row.sites.some((s) => s.key === args.siteKey)) throw userError("That site isn't in this setup.");
      await ctx.db.patch(row._id, { sites: row.sites.map((s) => (s.key === args.siteKey ? { ...s, access: state } : s)), updatedAt: Date.now() });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service_setup.step", actor: byMember(ctx), subject: { table: "serviceSetups", id: row._id }, data: { step: args.step, siteKey: args.siteKey ?? null, done: args.done } });
    return null;
  },
});

async function setupContent(ctx: MutationCtx & MemberAccess, setupId: Id<"serviceSetups">) {
  const row = await owned(ctx, setupId);
  const version = await versionRow(ctx, row.proposalId, row.version);
  const agreement = row.agreementId ? await ctx.db.get(row.agreementId) : null;
  return { row, content: version!.content as ProposalContent, agreementWorkflow: agreement?.workflow ?? null };
}

/**
 * Starts a site's recurring service at the accepted rate, after its requirements are met. Only then is
 * anything scheduled; the plan makes visits with the usual checks and hands them to Dispatch.
 */
export const activateSite = companyMutation({
  args: { setupId: v.id("serviceSetups"), siteKey: v.string(), startDate: v.string(), arrivalMinute: v.number() },
  handler: async (ctx, args) => {
    const { row, content, agreementWorkflow } = await setupContent(ctx, args.setupId);
    const site = row.sites.find((s) => s.key === args.siteKey);
    const info = content.sites.find((s) => s.key === args.siteKey);
    if (!site || !info) throw userError("That site isn't in this setup.");
    if (site.planId) throw userError("This site's service has already started.");
    const blockers = siteBlockers(row, agreementWorkflow, site);
    if (row.startTogether && row.sites.some((s) => siteBlockers(row, agreementWorkflow, s).length)) blockers.push("The agreement says all sites start together, and another site isn't ready.");
    if (blockers.length) throw userError(blockers.join(" "));
    if (info.perTurnover) throw userError("Turnovers are scheduled one at a time from real stays. Use Schedule a turnover.");
    if (args.startDate < todayIn(ctx.company.timezone)) throw userError("Start today or later.");
    const cadence = info.internal.cadence as Cadence | null;
    if (!cadence || !info.internal.versionId || info.priceCents === null) throw userError("This site has no cadence or rate in the accepted proposal.");
    const planId = await createPlan(ctx, ctx.company, {
      customerId: row.customerId,
      propertyId: site.propertyId,
      setupId: row._id,
      startDate: args.startDate,
      arrivalMinute: args.arrivalMinute,
      arrivalWindowMinutes: 60,
      durationMinutes: info.internal.durationMinutes ?? 120,
      crew: info.internal.crew ?? 1,
      cadence,
      serviceKey: info.service!.key,
      versionId: info.internal.versionId as Id<"serviceVersions">,
      quoteInput: (info.internal.input ?? {}) as never,
      visitPriceCents: info.priceCents,
      billing: content.terms.invoiceFrequency.includes("monthly") ? "monthly_consolidated" : "per_visit",
      createdBy: ctx.member._id,
    });
    const now = Date.now();
    const sites = row.sites.map((s) => (s.key === site.key ? { ...s, schedule: "done" as const, planId, activatedAt: now } : s));
    await ctx.db.patch(row._id, { sites, status: sites.every((s) => s.planId || s.schedule === "not_needed") ? "active" : "open", updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service_setup.site_activated", actor: byMember(ctx), subject: { table: "serviceSetups", id: row._id }, data: { siteKey: site.key } });
    const proposal = await ctx.db.get(row.proposalId);
    if (proposal) await setMilestone(ctx, proposal.opportunityId, "service_activated");
    return planId;
  },
});

/** One STR turnover at the accepted standing rate, from a real stay, checked against capacity now. */
export const scheduleTurnover = companyMutation({
  args: { setupId: v.id("serviceSetups"), siteKey: v.string(), date: v.string(), startMinute: v.number(), deadlineMinute: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { row, content, agreementWorkflow } = await setupContent(ctx, args.setupId);
    const site = row.sites.find((s) => s.key === args.siteKey);
    const info = content.sites.find((s) => s.key === args.siteKey);
    if (!site || !info || !info.perTurnover) throw userError("That site isn't a turnover site in this setup.");
    const blockers = siteBlockers(row, agreementWorkflow, site);
    if (blockers.length) throw userError(blockers.join(" "));
    if (!info.internal.versionId || info.priceCents === null || !info.service) throw userError("The accepted proposal has no turnover rate for this site.");
    const startsAt = localInstant(args.date, args.startMinute, ctx.company.timezone);
    const minutes = info.internal.durationMinutes ?? 120;
    const endsAt = startsAt + minutes * 60_000;
    if (args.deadlineMinute !== undefined && endsAt > localInstant(args.date, args.deadlineMinute, ctx.company.timezone)) throw userError("The turnover can't finish before check-in at that start time.");
    const crew = info.internal.crew ?? 1;
    const capacity = await checkCapacity(ctx, ctx.company, { startsAt, endsAt }, crew);
    if (capacity.state !== "fits" && capacity.state !== "tight") throw userError(capacity.why);
    const jobId = await createVisit(ctx, { company: ctx.company, customerId: row.customerId, propertyId: site.propertyId, versionId: info.internal.versionId as Id<"serviceVersions">, serviceKey: info.service.key, priceCents: info.priceCents, startsAt, endsAt, crew, arrivalWindowMinutes: 0, instructions: info.internal.accessNotes ?? undefined, actor: byMember(ctx), from: "plan" });
    if (args.deadlineMinute !== undefined) await ctx.db.patch(jobId, { hardDeadlineAt: localInstant(args.date, args.deadlineMinute, ctx.company.timezone) });
    if (site.schedule !== "done") await ctx.db.patch(row._id, { sites: row.sites.map((s) => (s.key === site.key ? { ...s, schedule: "done" as const, activatedAt: s.activatedAt ?? Date.now() } : s)), updatedAt: Date.now() });
    return jobId;
  },
});

// ── Sweep ────────────────────────────────────────────────────────────────────────────────────────

/** Marks sent proposals past their expiry as expired. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const status of ["sent", "changes_requested"] as const) {
      const rows = await ctx.db
        .query("proposals")
        .withIndex("by_status_expires", (q) => q.eq("status", status).lt("expiresAt", now))
        .take(100);
      for (const row of rows) {
        await ctx.db.patch(row._id, { status: "expired", updatedAt: now });
        await recordEvent(ctx, { companyId: row.companyId, type: "proposal.expired", actor: { kind: "system" }, subject: { table: "proposals", id: row._id } });
        if (row.opportunityId) {
          const opportunity = await ctx.db.get(row.opportunityId);
          if (opportunity && opportunity.stage !== "won") await ctx.db.patch(opportunity._id, { milestone: "expired", nextAction: "Decide whether to send a new version", nextActionAt: now + DAY, updatedAt: now });
        }
      }
    }
    void internal;
    return null;
  },
});
