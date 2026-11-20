/**
 * What each activation task actually does, one transactional step at a time (convex/activation.ts runs
 * them). Every step goes through the workspace's own builders and the agents' own workflows, so the
 * drafts, permissions, approvals, billing and outbox are the ones the rest of the product uses.
 *
 * Rules every step keeps:
 *  - It reuses what exists. A draft the owner already has, or edited, is reported and left as it is.
 *  - It only reports what a record shows. A count is a count of rows; nothing says "found" without reading.
 *  - It never sends anything itself. Anything that reaches a person goes through the agent's workflow,
 *    which checks its permission, consent and budget again at that moment.
 *  - A step is one mutation: what it makes and what the task says about it commit together, or neither
 *    does, so a retry never makes a second draft.
 */
import type { UserIdentity } from "convex/server";

import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { createExperience } from "../../bookingExperiences";
import { draftNeed } from "../../hiringNeeds";
import { createAgreement } from "../agreements/store";
import type { MemberAccess } from "../builders";
import { coverJob, type CoverState } from "../dispatch/workflow";
import type { Actor } from "../events";
import { purposesOf } from "../inbox/mailboxes";
import { enqueueRun as enqueueRetentionRun } from "../retention/runs";
import { view as opportunityView } from "../sales/agentOpportunity";
import { activeRun, enqueueRun as enqueueSalesRun } from "../sales/runs";
import { salesSettings } from "../sales/settings";
import { CATEGORY_CHOICES } from "../setup/facts";
import { createDraft } from "../services/workflow";
import { TEMPLATES as SERVICE_TEMPLATES } from "../services/templates";
import { liveTaskByKey, openTask } from "../taskState";
import type { Agent } from "../statuses";
import { BATCH_LIMIT, type Snapshot, type TemplateId } from "./plan";
import type { Blocker, Output } from "./schema";

export type Step = { at: number; words: string; kind: "done" | "info" | "failed" | "waiting" };
export type Env = {
  ctx: MutationCtx;
  /** The Owner who started the batch, re-checked before this step: the builders write in their name. */
  access: MutationCtx & MemberAccess;
  company: Doc<"companies">;
  activation: Doc<"activations">;
  task: Doc<"activationTasks">;
  snapshot: Snapshot;
  now: number;
};
export type Result =
  | { kind: "done"; state: "completed" | "ready_for_review"; statusLine: string; steps: Step[]; outputs: Output[] }
  | { kind: "watch"; statusLine: string; steps: Step[]; outputs: Output[]; watching: { kind: string; keys: string[]; until: number }; checkAfterMs: number }
  | { kind: "blocked"; state: "waiting_info" | "waiting_connection"; statusLine: string; blocker: Blocker; steps: Step[]; outputs: Output[] };

const MINUTE = 60_000;
const DAY = 86_400_000;
const step = (now: number, words: string, kind: Step["kind"] = "done"): Step => ({ at: now, words, kind });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The builders write as the Owner who started the batch. Only their id and role are read from this. */
export function accessFor(ctx: MutationCtx, company: Doc<"companies">, member: Doc<"members">): MutationCtx & MemberAccess {
  const identity = { tokenIdentifier: `activation|${member._id}`, subject: member.userId ?? "", issuer: member.userIssuer ?? "selestial" } as UserIdentity;
  return Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { identity, member, company, companyId: company._id, role: "owner" as const });
}

const agentActor = (agent: Agent): Actor => ({ kind: "agent", agent });

/** Records a draft on the setup row too, so going through setup again opens the same draft. */
async function notePrepared(ctx: MutationCtx, companyId: Id<"companies">, patch: Partial<NonNullable<Doc<"companySetups">["prepared"]>>) {
  const setup = await ctx.db
    .query("companySetups")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
  if (!setup) return;
  const now = Date.now();
  await ctx.db.patch(setup._id, { prepared: { ...(setup.prepared ?? {}), ...patch }, milestones: { ...setup.milestones, ...(setup.milestones.firstArtifactAt === undefined ? { firstArtifactAt: now } : {}) }, updatedAt: now });
}

const MAIN_CATEGORY = (s: Snapshot) => s.facts.categories.find((value) => ["residential", "commercial", "short_term_rental", "property_management", "post_construction", "specialty"].includes(value)) ?? "residential";
const SERVICE_FOR: Record<string, string> = { residential: "res-standard", commercial: "com-office", short_term_rental: "str-turnover", property_management: "pm-vacant", post_construction: "pc-final", specialty: "res-deep" };

// ── Sales ───────────────────────────────────────────────────────────────────────────────────────────

async function serviceDraft(env: Env): Promise<Result> {
  const { ctx, snapshot: s, now } = env;
  const existingId = s.sales.draftServiceId as Id<"services"> | null;
  const existing = existingId ? await ctx.db.get(existingId) : null;
  if (existing && existing.companyId === env.company._id) {
    return {
      kind: "done",
      state: "ready_for_review",
      statusLine: `Your service draft “${existing.name}” is ready for review.`,
      steps: [step(now, `Found your existing service draft “${existing.name}” and left it exactly as it is.`)],
      outputs: [{ kind: "service_draft", ref: { table: "services", id: existing._id, label: existing.name, href: `/app/services/${existing._id}` }, state: "draft", created: false, ...(existing.origin === "template" ? { flags: ["Example prices from a template: review them before publishing."] } : {}) }],
    };
  }
  const template = SERVICE_TEMPLATES.find((row) => row.id === SERVICE_FOR[MAIN_CATEGORY(s)]) ?? SERVICE_TEMPLATES[0];
  const { serviceId } = await createDraft(env.access, { category: template.category, spec: template.spec, origin: "template", templateId: template.id, via: "workspace", actor: agentActor("sales") });
  await notePrepared(ctx, env.company._id, { serviceId });
  const label = CATEGORY_CHOICES.find((c) => c.value === MAIN_CATEGORY(s))?.label.toLowerCase() ?? "homes";
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: "Your service draft is ready for review.",
    steps: [step(now, `Chose the “${template.spec.name}” starting point because you clean for ${label}.`), step(now, `Created the draft “${template.spec.name}” in Services & Pricing. It is not published.`)],
    outputs: [{ kind: "service_draft", ref: { table: "services", id: serviceId, label: template.spec.name, href: `/app/services/${serviceId}` }, state: "draft", created: true, flags: ["Example prices from a template: review them before publishing."] }],
  };
}

const PAGE_KIND: Record<string, "residential" | "commercial" | "short_term_rental"> = { residential: "residential", commercial: "commercial", short_term_rental: "short_term_rental", property_management: "residential", post_construction: "commercial", specialty: "residential" };

async function bookingPage(env: Env): Promise<Result> {
  const { ctx, snapshot: s, now } = env;
  const canTake = s.sales.activeServices > 0;
  const flags = canTake ? [] : ["Takes no bookings until it is published with a live service."];
  const existingId = s.sales.bookingPageId as Id<"bookingExperiences"> | null;
  const existing = existingId ? await ctx.db.get(existingId) : null;
  if (existing && existing.companyId === env.company._id) {
    return {
      kind: "done",
      state: existing.status === "published" ? "completed" : "ready_for_review",
      statusLine: existing.status === "published" ? `Your booking page “${existing.name}” is already published.` : `Your booking page “${existing.name}” is ready for review.`,
      steps: [step(now, `Found your booking page “${existing.name}” and left it exactly as it is.`)],
      outputs: [{ kind: "booking_page", ref: { table: "bookingExperiences", id: existing._id, label: existing.name, href: `/app/agents/sales/booking-forms/${existing._id}` }, state: existing.status, created: false, flags }],
    };
  }
  const experienceId = await createExperience(env.access, PAGE_KIND[MAIN_CATEGORY(s)] ?? "residential");
  await notePrepared(ctx, env.company._id, { experienceId });
  const page = await ctx.db.get(experienceId);
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: "Your booking page is ready for review.",
    steps: [step(now, `Created the booking page draft “${page?.name ?? "Booking page"}” in Sales › Booking forms.`), ...(canTake ? [] : [step(now, "It cannot take bookings yet: publish a service first, then the page.", "info")])],
    outputs: [{ kind: "booking_page", ref: { table: "bookingExperiences", id: experienceId, label: page?.name ?? "Booking page", href: `/app/agents/sales/booking-forms/${experienceId}` }, state: "draft", created: true, flags }],
  };
}

const AGREEMENT_FOR: Record<string, "one_time_residential" | "office_janitorial" | "str_turnover"> = { residential: "one_time_residential", commercial: "office_janitorial", short_term_rental: "str_turnover" };

async function agreementDraft(env: Env): Promise<Result> {
  const { ctx, snapshot: s, now } = env;
  const flags = ["Starting text: nobody has reviewed these terms."];
  const existingId = s.sales.agreementId as Id<"agreements"> | null;
  const existing = existingId ? await ctx.db.get(existingId) : null;
  if (existing && existing.companyId === env.company._id) {
    return {
      kind: "done",
      state: "ready_for_review",
      statusLine: `Your agreement “${existing.title}” is ready for review.`,
      steps: [step(now, `Found your agreement “${existing.title}” and left it exactly as it is.`)],
      outputs: [{ kind: "agreement_draft", ref: { table: "agreements", id: existing._id, label: existing.title, href: `/app/agreements/${existing._id}` }, state: existing.workflow, created: false, flags }],
    };
  }
  const agreementId = await createAgreement(env.access, { docType: AGREEMENT_FOR[MAIN_CATEGORY(s)] ?? "one_time_residential", origin: "manual", note: "Prepared by Sales when you started your agents" });
  await notePrepared(ctx, env.company._id, { agreementId });
  const row = await ctx.db.get(agreementId);
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: "Your agreement draft is ready for review.",
    steps: [step(now, `Created the agreement draft “${row?.title ?? "Service agreement"}” from Selestial's starting text.`)],
    outputs: [{ kind: "agreement_draft", ref: { table: "agreements", id: agreementId, label: row?.title ?? "Service agreement", href: `/app/agreements/${agreementId}` }, state: "draft", created: true, flags }],
  };
}

/** Answers built only from what the Owner confirmed. A topic they already answered, or were proposed, is skipped. */
export function proposedAnswersFrom(s: Snapshot): { topic: string; question: string; answer: string; basis: string }[] {
  const out: { topic: string; question: string; answer: string; basis: string }[] = [];
  if (s.facts.areas) out.push({ topic: "Service area", question: "What areas do you serve?", answer: `We serve ${s.facts.areas.replace(/\.$/, "")}.`, basis: "Areas you serve, as you confirmed them" });
  if (s.facts.categories.length) {
    const kinds = s.facts.categories.map((value) => CATEGORY_CHOICES.find((c) => c.value === value)?.label.toLowerCase() ?? value);
    const words = kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
    out.push({ topic: "Services", question: "What kinds of cleaning do you do?", answer: `We clean ${words}. Tell us about your space and we'll confirm what fits.`, basis: "Who you clean for, as you confirmed it" });
  }
  if (s.facts.phone || s.facts.email) {
    const ways = [s.facts.phone ? `call or text ${s.facts.phone}` : null, s.facts.email ? `email ${s.facts.email}` : null].filter(Boolean).join(", or ");
    out.push({ topic: "Contact", question: "How can I reach you?", answer: `You can ${ways}.`, basis: "Your public contact details, as you confirmed them" });
  }
  return out;
}

async function faqAnswers(env: Env): Promise<Result> {
  const { ctx, company, snapshot: s, now } = env;
  const settings = salesSettings(company);
  const taken = new Set([...settings.answers, ...settings.proposedAnswers].map((row) => row.topic.trim().toLowerCase()));
  const fresh = proposedAnswersFrom(s).filter((row) => !taken.has(row.topic.toLowerCase()));
  const skipped = proposedAnswersFrom(s).length - fresh.length;
  const steps: Step[] = [];
  if (fresh.length) {
    const stored = company.sales ?? {};
    const proposedAnswers = [...(stored.proposedAnswers ?? []), ...fresh.map((row, i) => ({ id: `p${now.toString(36)}${i}`, ...row, proposedAt: now }))].slice(0, 40);
    await ctx.db.patch(company._id, { sales: { ...stored, proposedAnswers, revision: (stored.revision ?? 0) + 1 } });
    steps.push(step(now, `Proposed ${plural(fresh.length, "answer")} from your confirmed details: ${fresh.map((row) => row.topic.toLowerCase()).join(", ")}.`));
  }
  if (skipped) steps.push(step(now, `Left ${plural(skipped, "topic")} you already have an answer or proposal for exactly as ${skipped === 1 ? "it is" : "they are"}.`, "info"));
  const total = salesSettings((await ctx.db.get(company._id)) ?? company).proposedAnswers.length;
  if (total === 0) {
    return { kind: "done", state: "completed", statusLine: "Your Playbook already answers these questions.", steps: steps.length ? steps : [step(now, "Your Playbook already has an answer for every topic your confirmed details cover.")], outputs: [] };
  }
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: `${plural(total, "proposed answer")} ${total === 1 ? "is" : "are"} ready for your approval.`,
    steps,
    outputs: [{ kind: "proposed_answers", ref: { table: "companies", id: company._id, label: "Sales Playbook: proposed answers", href: "/app/agents/sales/playbook#proposed" }, state: "proposed", created: fresh.length > 0, count: total, flags: ["Sales uses none of these until you approve each one."] }],
  };
}

async function inquiryFollowThrough(env: Env, phase: "start" | "check"): Promise<Result> {
  const { ctx, company, task, now } = env;
  if (phase === "start") {
    const keys: string[] = [];
    let skipped = 0;
    for (const id of env.snapshot.sales.inquiryIds.slice(0, BATCH_LIMIT.inquiries)) {
      const row = await ctx.db.get(id as Id<"salesOpportunities">);
      const opp = row && row.companyId === company._id ? opportunityView(row) : null;
      // Checked again now: a person may have taken it, it may have closed, or Sales may already be on it.
      if (!opp || opp.agent.takeover || (await activeRun(ctx, opp))) {
        skipped += 1;
        continue;
      }
      const key = `activation:${env.activation._id}:${opp._id}`;
      await enqueueSalesRun(ctx, opp, { trigger: "manual", key });
      keys.push(key);
    }
    const steps: Step[] = [step(now, `Read ${plural(env.snapshot.sales.openInquiries, "open inquiry", "open inquiries")}: ${keys.length} ${keys.length === 1 ? "was" : "were"} missing a next step.`)];
    if (skipped) steps.push(step(now, `Left ${plural(skipped, "inquiry", "inquiries")} alone: a person or Sales' own routine is already on ${skipped === 1 ? "it" : "them"}.`, "info"));
    const remaining = env.snapshot.sales.inquiryIds.length - keys.length - skipped;
    if (remaining > 0) steps.push(step(now, `Sales' routine check picks up the other ${remaining}.`, "info"));
    if (!keys.length) return summarizeInquiries(env, [], steps);
    return { kind: "watch", statusLine: "Reviewing imported inquiries.", steps, outputs: [], watching: { kind: "sales_runs", keys, until: now + 30 * MINUTE }, checkAfterMs: 15_000 };
  }
  // check: read each run back from its own record.
  const runs = (await Promise.all((task.watching?.keys ?? []).map((key) => ctx.db.query("salesRuns").withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("key", key)).first()))).filter((row): row is Doc<"salesRuns"> => row !== null);
  const pending = runs.filter((row) => row.status === "queued" || row.status === "running");
  if (pending.length && now < (task.watching?.until ?? 0)) {
    return { kind: "watch", statusLine: `Reviewing imported inquiries: ${runs.length - pending.length} of ${runs.length} done.`, steps: [], outputs: task.outputs, watching: task.watching!, checkAfterMs: 20_000 };
  }
  const steps: Step[] = [step(now, `Sales reviewed ${plural(runs.length - pending.length, "inquiry", "inquiries")} that were missing a next step.`)];
  for (const run of runs.filter((row) => row.status === "skipped").slice(0, 3)) steps.push(step(now, run.result ?? "Sales skipped one inquiry.", "info"));
  const failed = runs.filter((row) => row.status === "failed");
  if (failed.length) steps.push(step(now, `${plural(failed.length, "inquiry", "inquiries")} could not be reviewed: ${failed[0].result ?? "Sales stopped."}`, "failed"));
  if (pending.length) steps.push(step(now, `${plural(pending.length, "review")} took longer than expected; Sales' routine check finishes ${pending.length === 1 ? "it" : "them"}.`, "info"));
  // What Sales' own executions charged for these runs, read back from billing's record.
  const charges = [];
  for (const run of runs) {
    const execution = run.executionId ? await ctx.db.get(run.executionId) : null;
    if (execution) charges.push({ executionId: execution._id, credits: execution.credits, state: execution.state });
  }
  await ctx.db.patch(task._id, { charges });
  return summarizeInquiries(env, runs, steps);
}

/** What waits on the owner across open inquiries, counted from Sales' own prepared actions. Nothing is estimated. */
async function summarizeInquiries(env: Env, runs: Doc<"salesRuns">[], steps: Step[]): Promise<Result> {
  const { ctx, company, task, now } = env;
  const waiting = [
    ...(await ctx.db
      .query("salesActions")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "prepared"))
      .take(200)),
    ...(await ctx.db
      .query("salesActions")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "awaiting_approval"))
      .take(200)),
  ];
  const ranIds = new Set(runs.map((row) => row._id));
  const sent = (
    await ctx.db
      .query("salesActions")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "sent"))
      .take(200)
  ).filter((row) => row.runId !== undefined && ranIds.has(row.runId));
  const opps = new Set(waiting.map((row) => row.opportunityId)).size;
  if (waiting.length) steps.push(step(now, `${plural(opps, "inquiry", "inquiries")} ${opps === 1 ? "has" : "have"} ${plural(waiting.length, "prepared follow-up")} waiting for your review. Nothing was sent without your permission.`));
  if (sent.length) steps.push(step(now, `Sent ${plural(sent.length, "message")} you allowed Sales to send on its own.`));
  if (!waiting.length && !sent.length) steps.push(step(now, "Every open inquiry is waiting on the customer or already has its next step.", "info"));
  const approvals = waiting.map((row) => row.approvalId).filter((id): id is Id<"approvals"> => id !== undefined);
  if (approvals.length) await ctx.db.patch(task._id, { approvals: [...new Set([...task.approvals, ...approvals])] });
  const outputs: Output[] = [];
  if (waiting.length) outputs.push({ kind: "follow_up_drafts", ref: { table: "salesActions", id: waiting[0]._id, label: `${plural(opps, "inquiry", "inquiries")} with follow-up drafts`, href: "/app/agents/sales/pipeline" }, state: "awaiting your review", created: runs.length > 0, count: opps });
  if (sent.length) outputs.push({ kind: "follow_ups_sent", ref: { table: "salesActions", id: sent[0]._id, label: `${plural(sent.length, "follow-up")} sent`, href: "/app/agents/sales/pipeline" }, state: "sent", created: true, count: sent.length });
  return {
    kind: "done",
    state: waiting.length ? "ready_for_review" : "completed",
    statusLine: waiting.length ? `${plural(opps, "inquiry", "inquiries")} ${opps === 1 ? "has" : "have"} follow-up drafts ready.` : sent.length ? `Sales followed up on ${plural(sent.length, "inquiry", "inquiries")}.` : "Your open inquiries are all waiting on customers or already handled.",
    steps,
    outputs,
  };
}

// ── Recruiter ───────────────────────────────────────────────────────────────────────────────────────

/** The role draft, from templates and the Owner's confirmed facts. Pay is never set here. */
export function roleDraftFor(s: Snapshot) {
  const contractor = s.facts.workforce.includes("contractors") && !s.facts.workforce.includes("employees");
  const kinds = s.facts.categories.length ? s.facts.categories : ["residential"];
  const what = kinds.map((value) => CATEGORY_CHOICES.find((c) => c.value === value)?.label.toLowerCase() ?? value).join(", ");
  const questions = [
    { key: "transport", label: "Do you have reliable transportation to get to each job?", kind: "yes_no" as const, required: true },
    ...(contractor ? [{ key: "supplies", label: "Can you bring your own cleaning supplies and equipment?", kind: "yes_no" as const, required: false }] : []),
    ...(kinds.includes("short_term_rental") ? [{ key: "same_day", label: "Can you work same-day turnovers between guest check-out and check-in?", kind: "yes_no" as const, required: false }] : []),
    ...(kinds.includes("commercial") ? [{ key: "evenings", label: "Can you work evenings after business hours?", kind: "yes_no" as const, required: false }] : []),
  ];
  return {
    title: "Cleaner",
    responsibilities: `Clean ${what} for ${s.companyName} to the company's checklist, arrive on time, and report anything unusual at a visit.`,
    location: s.facts.location ?? s.facts.areas ?? "Your service area",
    requiredAvailability: "Tell us the days and hours you can usually work.",
    engagement: contractor ? ("contractor" as const) : ("employee" as const),
    openings: 1,
    questions,
    criteria: [
      { key: "experience", label: "Paid cleaning experience", field: "experienceYears", test: { kind: "person_reviews" as const }, fixed: false },
      { key: "availability", label: "Available on the days you need", field: "availableDays", test: { kind: "person_reviews" as const }, fixed: false },
      { key: "transport_ok", label: "Has reliable transportation", field: "q.transport", test: { kind: "is_true" as const }, fixed: false },
    ],
  };
}

async function roleDraft(env: Env): Promise<Result> {
  const { ctx, snapshot: s, now } = env;
  for (const id of [s.recruiter.openNeedId, s.recruiter.draftNeedId]) {
    const need = id ? await ctx.db.get(id as Id<"hiringNeeds">) : null;
    if (need && need.companyId === env.company._id) {
      const open = need.status === "open";
      const words = open ? "open to applicants" : need.status === "paused" ? "paused, not taking applications" : "draft, not published";
      return {
        kind: "done",
        state: open ? "completed" : "ready_for_review",
        statusLine: open ? `Your open role “${need.title}” already has an application form.` : `Your role “${need.title}” is ready for review.`,
        steps: [step(now, `Found your role “${need.title}” (${words}) and left it exactly as it is.`)],
        outputs: [{ kind: "hiring_role", ref: { table: "hiringNeeds", id: need._id, label: `${need.title}: role and application form`, href: "/app/agents/recruiter/hiring-needs" }, state: words, created: false }],
      };
    }
  }
  const draft = roleDraftFor(s);
  const needId = await draftNeed(ctx, env.company._id, env.access.member, draft, agentActor("recruiter"));
  await notePrepared(ctx, env.company._id, { hiringNeedId: needId });
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: "Your application form is ready.",
    steps: [
      step(now, `Drafted the role “${draft.title}” as ${draft.engagement === "contractor" ? "independent contractor" : "employee"} work, ${env.snapshot.facts.workforce.length ? "from how you said your cleaners work" : "by default, since you haven't said how your cleaners work: change it on the role if they are contractors"}.`),
      step(now, `Built its application form with ${plural(draft.questions.length, "screening question")} and ${plural(draft.criteria.length, "requirement")} a person reviews.`),
      step(now, "Left pay unset: you approve pay for the role yourself.", "info"),
    ],
    outputs: [{ kind: "hiring_role", ref: { table: "hiringNeeds", id: needId, label: `${draft.title}: role and application form`, href: "/app/agents/recruiter/hiring-needs" }, state: "draft, not published", created: true, flags: ["Draft: applicants can't apply and nobody is invited until you open the role.", "Pay is not set."] }],
  };
}

async function applicantReview(env: Env, phase: "start" | "check"): Promise<Result> {
  const { ctx, company, task, now } = env;
  const mailboxes = (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .take(20)
  ).filter((row) => row.status === "connected" && purposesOf(row).includes("hiring"));
  if (phase === "start") {
    if (!mailboxes.length) {
      return {
        kind: "blocked",
        state: "waiting_connection",
        statusLine: "Waiting for your hiring inbox.",
        blocker: { kind: "connection", words: "I prepared your hiring application. Connect your hiring inbox to identify applicants who should receive it.", action: { label: "Connect your hiring inbox", href: "/app/agents/recruiter/applicants" } },
        steps: [],
        outputs: [],
      };
    }
    for (const mailbox of mailboxes) await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: mailbox._id });
    return {
      kind: "watch",
      statusLine: "Reading your hiring inbox.",
      steps: [step(now, `Asked Recruiter to read ${mailboxes.length === 1 ? mailboxes[0].address : plural(mailboxes.length, "hiring inbox", "hiring inboxes")} now.`)],
      outputs: [],
      watching: { kind: "inbox", keys: mailboxes.map((row) => `${row._id}@${row.lastSyncAt ?? 0}`), until: now + 10 * MINUTE },
      checkAfterMs: 20_000,
    };
  }
  const keys = task.watching?.keys ?? [];
  let finished = 0;
  const problems: string[] = [];
  for (const key of keys) {
    const [id, since] = key.split("@");
    const row = await ctx.db.get(id as Id<"mailboxConnections">);
    if (!row || row.companyId !== company._id) continue;
    if ((row.lastSyncAt ?? 0) > Number(since)) finished += 1;
    else if (row.status !== "connected") problems.push(`${row.address} stopped working.`);
  }
  if (finished + problems.length < keys.length && now < (task.watching?.until ?? 0)) {
    return { kind: "watch", statusLine: "Reading your hiring inbox.", steps: [], outputs: task.outputs, watching: task.watching!, checkAfterMs: 30_000 };
  }
  const applications = await ctx.db
    .query("applications")
    .withIndex("by_company_stage", (q) => q.eq("companyId", company._id))
    .take(500);
  const fresh = applications.filter((row) => row._creationTime >= task.createdAt);
  const openNeeds = await ctx.db
    .query("hiringNeeds")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
    .take(1);
  const steps: Step[] = [step(now, finished ? "Read your hiring inbox." : "Your hiring inbox did not finish reading in time; Recruiter's routine check continues.", finished ? "done" : "info")];
  for (const problem of problems) steps.push(step(now, problem, "failed"));
  if (!fresh.length) {
    steps.push(step(now, "No new applications were in the inbox. Recruiter keeps checking every 10 minutes.", "info"));
    return { kind: "done", state: "completed", statusLine: "No new applicants yet. Recruiter keeps checking your inbox.", steps, outputs: [] };
  }
  steps.push(step(now, `Filed ${plural(fresh.length, "application")} from the people who applied.`));
  if (!openNeeds.length) steps.push(step(now, "Nobody was invited: no role is open yet.", "info"));
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: `${plural(fresh.length, "applicant")} filed from your hiring inbox.`,
    steps,
    outputs: [{ kind: "applicants", ref: { table: "applications", id: fresh[0]._id, label: `${plural(fresh.length, "new applicant")}`, href: "/app/agents/recruiter/applicants" }, state: "filed", created: true, count: fresh.length }],
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────────────────────────────

const COVER_GROUP: Record<CoverState, "covered" | "offered" | "decision" | "gap" | "skip"> = {
  covered: "covered",
  underway: "skip",
  gone: "skip",
  held: "skip",
  closed: "skip",
  offer_out: "offered",
  offered: "offered",
  awaiting_decision: "decision",
  proposed: "decision",
  with_person: "decision",
  off: "gap",
  no_candidate: "gap",
  too_late: "gap",
  paused: "gap",
  too_early: "skip",
};

async function coverageReview(env: Env): Promise<Result> {
  const { ctx, now } = env;
  const ids = env.snapshot.dispatch.uncoveredJobIds.slice(0, BATCH_LIMIT.jobs);
  const groups: Record<"covered" | "offered" | "decision" | "gap" | "skip", Id<"jobs">[]> = { covered: [], offered: [], decision: [], gap: [], skip: [] };
  for (const id of ids) groups[COVER_GROUP[await coverJob(ctx, id as Id<"jobs">)]].push(id as Id<"jobs">);
  const covered = env.snapshot.dispatch.upcomingJobs - env.snapshot.dispatch.uncoveredJobs;
  const steps: Step[] = [step(now, `Checked coverage for ${plural(env.snapshot.dispatch.upcomingJobs, "upcoming visit")}: ${covered} already had every cleaner they need.`)];
  if (groups.offered.length) steps.push(step(now, `Offered ${plural(groups.offered.length, "visit")} to eligible cleaners, as your permissions allow.`));
  if (groups.decision.length) steps.push(step(now, `Prepared ${plural(groups.decision.length, "offer")} for your approval.`));
  if (groups.gap.length) steps.push(step(now, `${plural(groups.gap.length, "visit")} still ${groups.gap.length === 1 ? "has" : "have"} no cleaner Dispatch can offer.`, "waiting"));
  if (env.snapshot.dispatch.uncoveredJobs > ids.length) steps.push(step(now, `Dispatch's routine check works the other ${env.snapshot.dispatch.uncoveredJobs - ids.length}.`, "info"));
  const needs = groups.gap.length + groups.decision.length;
  const outputs: Output[] = [{ kind: "coverage_plan", ref: { table: "jobs", id: ids[0] ?? "schedule", label: "Coverage for the next two weeks", href: "/app/schedule" }, state: needs ? `${needs} need coverage` : "covered or offered", created: true, count: needs }];
  return {
    kind: "done",
    state: needs ? "ready_for_review" : "completed",
    statusLine: needs ? `${plural(needs, "upcoming job")} ${needs === 1 ? "needs" : "need"} coverage.` : ids.length ? `Every uncovered visit now has an offer out.` : "Every upcoming visit is covered.",
    steps,
    outputs,
  };
}

/** One open item in an agent's own queue per real gap. An item still open from before is reused. */
async function gapTask(env: Env, agent: Agent, key: string, title: string, nextAction: string, completion: string): Promise<Output> {
  const existing = await liveTaskByKey(env.ctx, env.company._id, key);
  const taskId = existing?._id ?? (await openTask(env.ctx, { companyId: env.company._id, agent, title, nextAction, dueAt: env.now + 3 * DAY, completionCondition: completion, key, actor: agentActor(agent) }));
  return { kind: "checklist_item", ref: { table: "tasks", id: taskId, label: title, href: `/app/agents/${agent}?open=task:${taskId}` }, state: "open", created: !existing };
}

async function readiness(env: Env): Promise<Result> {
  const s = env.snapshot;
  const outputs: Output[] = [];
  if (s.dispatch.readyCleaners === 0) outputs.push(await gapTask(env, "dispatch", "activation.ready:cleaners", "Add cleaners who are ready for work", "Add your cleaners and mark the ones ready for assignments.", "At least one cleaner is ready for work."));
  if (s.dispatch.cleanersWithoutAvailability > 0) outputs.push(await gapTask(env, "dispatch", "activation.ready:availability", `Set weekly availability for ${plural(s.dispatch.cleanersWithoutAvailability, "cleaner")}`, "Confirm the days and hours each ready cleaner can work.", "Every ready cleaner has weekly availability."));
  if (!s.dispatch.canText) outputs.push(await gapTask(env, "dispatch", "activation.ready:texting", "Set up texting so job offers reach cleaners", "Finish the texting number and registration in Settings › Compliance.", "Texting is ready to send job offers."));
  if (!outputs.length) {
    return { kind: "done", state: "completed", statusLine: "Dispatch has what it needs to offer work.", steps: [step(env.now, `Checked: ${plural(s.dispatch.readyCleaners, "ready cleaner")}, each with availability, and texting is set up.`)], outputs: [] };
  }
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: `Your coverage-readiness checklist has ${plural(outputs.length, "item")}.`,
    steps: [step(env.now, `Found ${plural(outputs.length, "gap")} that stop Dispatch from offering work, and put each in Dispatch's queue.`)],
    outputs,
  };
}

// ── Retention ───────────────────────────────────────────────────────────────────────────────────────

async function retentionReview(env: Env, phase: "start" | "check"): Promise<Result> {
  const { ctx, company, task, now } = env;
  const key = `activation:${env.activation._id}`;
  if (phase === "start") {
    await enqueueRetentionRun(ctx, { companyId: company._id, kind: "reconcile", key });
    return { kind: "watch", statusLine: "Reviewing completed services and recurring plans.", steps: [step(now, "Asked Retention to reconcile your visits, plans, billing and agreements.")], outputs: [], watching: { kind: "retention_runs", keys: [key], until: now + 15 * MINUTE }, checkAfterMs: 15_000 };
  }
  const run = await ctx.db
    .query("retentionRuns")
    .withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("key", key))
    .first();
  if (run && (run.status === "queued" || run.status === "running") && now < (task.watching?.until ?? 0)) {
    return { kind: "watch", statusLine: "Reviewing completed services and recurring plans.", steps: [], outputs: task.outputs, watching: task.watching!, checkAfterMs: 20_000 };
  }
  const signals = await ctx.db
    .query("retentionSignals")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
    .take(200);
  const attention = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "needs_attention"))
    .take(200);
  const steps: Step[] = [step(now, run?.status === "failed" ? "Retention could not finish reconciling; its routine check tries again." : "Reconciled your visits, plans, billing and agreements.", run?.status === "failed" ? "failed" : "done")];
  if (!signals.length && !attention.length) {
    steps.push(step(now, "Nothing needs follow-through right now.", "info"));
    return { kind: "done", state: "completed", statusLine: "Retention found nothing that needs follow-through right now.", steps, outputs: [] };
  }
  if (signals.length) steps.push(step(now, `Found ${plural(signals.length, "signal")} worth a look.`));
  if (attention.length) steps.push(step(now, `${plural(attention.length, "customer case")} ${attention.length === 1 ? "needs" : "need"} your decision.`, "waiting"));
  const first = attention[0] ?? null;
  return {
    kind: "done",
    state: "ready_for_review",
    statusLine: attention.length ? `${plural(attention.length, "customer case")} ${attention.length === 1 ? "needs" : "need"} your decision.` : `${plural(signals.length, "retention signal")} ready to review.`,
    steps,
    outputs: [
      {
        kind: "retention_cases",
        ref: first ? { table: "retentionCases", id: first._id, label: first.title, href: `/app/agents/retention/needs-attention?case=${first._id}` } : { table: "retentionSignals", id: signals[0]._id, label: `${plural(signals.length, "signal")} to review`, href: "/app/agents/retention" },
        state: first ? "needs your decision" : "open",
        created: true,
        count: attention.length || signals.length,
      },
    ],
  };
}

async function careSetup(env: Env): Promise<Result> {
  const s = env.snapshot;
  const outputs: Output[] = [];
  if (!s.retention.guaranteeWritten) outputs.push(await gapTask(env, "retention", "activation.care:guarantee", "Write your service guarantee in your own words", "Add the guarantee Retention may offer when a visit falls short, in the Retention Playbook.", "The guarantee is written in the Retention Playbook."));
  if (!s.retention.reviewLink) outputs.push(await gapTask(env, "retention", "activation.care:review_link", "Add the link where customers leave reviews", "Add your review link in the Retention Playbook, so happy customers can be pointed to it.", "A review link is set in the Retention Playbook."));
  const feedback: Output = {
    kind: "feedback_request",
    ref: { table: "companies", id: env.company._id, label: "Feedback request after a customer's first visit", href: "/app/agents/retention/playbook" },
    state: s.retention.feedbackAfterFirst ? "on" : "off",
    created: false,
    flags: [`Sent only after a completed visit; Retention ${s.retention.feedbackLevel === "propose" ? "asks you first" : s.retention.feedbackLevel === "off" ? "is not allowed to send it" : "may send it under your permissions"}.`],
  };
  const steps: Step[] = [step(env.now, `Checked your feedback request: it is ${s.retention.feedbackAfterFirst ? "on" : "off"} after a customer's first visit.`)];
  if (outputs.length) steps.push(step(env.now, `Put ${plural(outputs.length, "missing piece")} of your recovery workflow in Retention's queue.`));
  return {
    kind: "done",
    state: outputs.length ? "ready_for_review" : "completed",
    statusLine: outputs.length ? `Your feedback and recovery checklist has ${plural(outputs.length, "item")}.` : "Your feedback form and recovery workflow are ready.",
    steps,
    outputs: [feedback, ...outputs],
  };
}

/** Runs one step of a task. "check" is called again for tasks waiting on an agent's own workflow. */
export async function runStep(env: Env, phase: "start" | "check"): Promise<Result> {
  switch (env.task.template as TemplateId) {
    case "sales.service_draft":
      return serviceDraft(env);
    case "sales.booking_page":
      return bookingPage(env);
    case "sales.agreement_draft":
      return agreementDraft(env);
    case "sales.faq_answers":
      return faqAnswers(env);
    case "sales.inquiry_follow_through":
      return inquiryFollowThrough(env, phase);
    case "recruiter.role_draft":
      return roleDraft(env);
    case "recruiter.applicant_review":
      return applicantReview(env, phase);
    case "dispatch.coverage_review":
      return coverageReview(env);
    case "dispatch.readiness":
      return readiness(env);
    case "retention.review":
      return retentionReview(env, phase);
    case "retention.care_setup":
      return careSetup(env);
  }
}
