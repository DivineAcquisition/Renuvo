/**
 * Turning one message from the hiring inbox into records, inside one transaction.
 *
 * Three things are kept apart: the person (applicant), their application to one role, and each message
 * that mentioned it. The same message arriving again changes nothing. A second notification about the
 * same application is filed under it and invites nobody. Two people are never merged on a name alone,
 * and the same person applying to a second role gets a second application.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent } from "../events";
import { askPerson, isActive, RECRUITER, setNextAction, withdrawApplication } from "./applications";
import { resolveContact } from "./contact";
import type { Interpretation } from "./interpret";
import { routeApplication } from "./invitations";
import { addressOf, isNotificationAddress, boardFor, type MessageHeader } from "./mail";
import type { Classification, ContactEvidence, Fact, Source } from "./schema";
import { DAY, recruiterSettings } from "./settings";

export type Verdict = { classification: Classification; classifiedBy: "rule" | "model"; reason: string; source?: Source };
export type IngestInput = {
  header: MessageHeader;
  verdict: Verdict;
  /** Present only for mail whose body was opened. */
  read?: Interpretation;
  excerpt?: string;
  attachments?: { name: string; contentType: string; size: number; read: boolean }[];
  /** Addresses the headers offered, already sorted by kind. */
  headerEvidence?: Omit<ContactEvidence, "sourceMessageId">[];
};

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The hiring need a role name points at, whatever its status. Null when none or more than one fits. */
export async function matchNeed(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, role: string | undefined): Promise<Doc<"hiringNeeds"> | null> {
  if (!role) return null;
  const wanted = normalizeTitle(role);
  if (!wanted) return null;
  const needs: Doc<"hiringNeeds">[] = [];
  for (const status of ["open", "paused", "closed"] as const) {
    needs.push(
      ...(await ctx.db
        .query("hiringNeeds")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(200)),
    );
  }
  const names = (need: Doc<"hiringNeeds">) => [need.title, ...need.titleAliases].map(normalizeTitle).filter(Boolean);
  const exact = needs.filter((need) => names(need).includes(wanted));
  const pick = (found: Doc<"hiringNeeds">[]) => {
    // An open role wins over a closed one of the same name. Two open roles of the same name is a question for a person.
    const open = found.filter((need) => need.status === "open");
    if (open.length === 1) return open[0];
    return found.length === 1 ? found[0] : null;
  };
  if (exact.length > 0) return pick(exact);
  // Job boards append a place or a pay line to the title: "House Cleaner - Austin, TX".
  return pick(needs.filter((need) => names(need).some((name) => name.length >= 4 && (` ${wanted} `.includes(` ${name} `)))));
}

async function applicantByEmail(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, email: string): Promise<Doc<"applicants"> | null> {
  return ctx.db
    .query("applicants")
    .withIndex("by_company_email", (q) => q.eq("companyId", companyId).eq("email", email))
    .first();
}

/** The applicant this evidence reliably points at, and one it only might be. */
async function findApplicant(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, evidence: ContactEvidence[], phone: string | undefined, name: string | undefined) {
  for (const kind of ["direct", "relay"] as const) {
    for (const entry of evidence.filter((row) => row.kind === kind)) {
      const found = await applicantByEmail(ctx, companyId, entry.address);
      if (found && !found.redactedAt) return { applicant: found, maybe: null };
    }
  }
  const sameName = (other: Doc<"applicants">) => Boolean(name && other.name && normalizeTitle(other.name) === normalizeTitle(name));
  if (phone) {
    const byPhone = await ctx.db
      .query("applicants")
      .withIndex("by_company_phone", (q) => q.eq("companyId", companyId).eq("phone", phone))
      .take(5);
    // A shared phone is common in a household. A phone and a name together are one person.
    const both = byPhone.find((row) => !row.redactedAt && sameName(row));
    if (both) return { applicant: both, maybe: null };
  }
  if (name) {
    const recent = await ctx.db
      .query("applicants")
      .withIndex("by_company_created", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(500);
    const maybe = recent.find((row) => !row.redactedAt && sameName(row));
    if (maybe) return { applicant: null, maybe };
  }
  return { applicant: null, maybe: null };
}

function factsFrom(read: Interpretation, sourceMessageId: Id<"sourceMessages">, receivedAt: number): Fact[] {
  const where = "the notification's subject or text";
  const out: Fact[] = [];
  const add = (field: string, value: string | undefined, from: Fact["from"] = "message", at = where) => {
    if (value) out.push({ field, value, from, where: at, sourceMessageId });
  };
  add("name", read.name);
  add("role", read.role);
  add("phone", read.phone);
  add("location", read.location);
  add("experience", read.experience);
  add("availability", read.availability);
  add("resume", read.resume, "resume", "an attachment on the notification");
  add("applied_at", new Date(receivedAt).toISOString(), "message", "when the notification arrived");
  return out;
}

function mergeFacts(existing: Fact[], incoming: Fact[]): Fact[] {
  const out = [...existing];
  for (const fact of incoming) {
    if (fact.field === "applied_at") continue;
    if (!out.some((row) => row.field === fact.field && row.value === fact.value)) out.push(fact);
  }
  return out.slice(0, 60);
}

function mergeEvidence(existing: ContactEvidence[], incoming: ContactEvidence[]): ContactEvidence[] {
  const out = [...existing];
  for (const entry of incoming) {
    if (!out.some((row) => row.address === entry.address && row.kind === entry.kind)) out.push(entry);
  }
  return out.slice(0, 30);
}

async function handleReply(ctx: MutationCtx, connection: Doc<"mailboxConnections">, sourceMessageId: Id<"sourceMessages">, input: IngestInput): Promise<string> {
  const senders = [addressOf(input.header.from), addressOf(input.header.replyTo)].filter((value): value is string => Boolean(value));
  let applicant: Doc<"applicants"> | null = null;
  for (const address of senders) applicant ??= await applicantByEmail(ctx, connection.companyId, address);
  const applications = applicant
    ? (
        await ctx.db
          .query("applications")
          .withIndex("by_company_applicant", (q) => q.eq("companyId", connection.companyId).eq("applicantId", applicant._id))
          .order("desc")
          .take(20)
      ).filter(isActive)
    : [];
  if (!applicant || applications.length === 0) {
    await ctx.db.patch(sourceMessageId, { flag: "A reply from someone with no open application on file." });
    return "reply_unmatched";
  }
  const application = applications[0];
  await ctx.db.patch(sourceMessageId, { applicationId: application._id, ...(applications.length > 1 ? { flag: "The sender has more than one open application. This was filed under the newest." } : {}) });
  const intent = input.read?.replyIntent ?? "question";
  const who = applicant.name ?? "An applicant";
  await recordEvent(ctx, { companyId: connection.companyId, type: "application.reply_received", actor: { kind: "system" }, subject: { table: "applications", id: application._id }, data: { intent } });

  if (intent === "withdraw") {
    await withdrawApplication(ctx, application, { kind: "system" }, "by email");
    return "withdrawn";
  }
  if (intent === "no_contact") {
    await ctx.db.patch(applicant._id, { doNotContact: { at: Date.now(), reason: "Asked by email not to be contacted." } });
    for (const row of applications) {
      await setNextAction(ctx, row, { what: `${who} asked not to be contacted. Nothing more will be sent. Close the application unless they tell you otherwise.`, by: "owner", dueAt: Date.now() + DAY });
      await askPerson(ctx, row, { what: "reply", title: `${who} asked not to be contacted`, question: "Recruiter has stopped all messages to this person. Close the application, or record that they changed their mind.", dueAt: Date.now() + DAY, completionCondition: "The application was closed, or contact was allowed again" });
    }
    return "no_contact";
  }
  // Any other reply is treated as a question: reminders wait until a person has answered it.
  await ctx.db.patch(application._id, { questionSince: application.questionSince ?? Date.now() });
  await setNextAction(ctx, application, { what: `${who} replied. Read it and answer; reminders are paused until you do.`, by: "owner", dueAt: Date.now() + DAY });
  await askPerson(ctx, application, { what: "reply", title: `${who} replied about their application`, question: "Read the reply in the hiring inbox and answer it, then mark it answered. Reminders to this applicant are paused until then.", dueAt: Date.now() + DAY, completionCondition: "The reply was answered" });
  return "question";
}

/** Files one message. Returns what became of it, for the sync's own report. */
export async function ingestMessage(ctx: MutationCtx, connection: Doc<"mailboxConnections">, input: IngestInput): Promise<string> {
  const companyId = connection.companyId;
  const seen = await ctx.db
    .query("sourceMessages")
    .withIndex("by_connection_message", (q) => q.eq("connectionId", connection._id).eq("providerMessageId", input.header.id))
    .first();
  if (seen) return "seen";

  const { verdict, read } = input;
  const base = { companyId, connectionId: connection._id, providerMessageId: input.header.id, classification: verdict.classification, classifiedBy: verdict.classifiedBy, receivedAt: input.header.receivedAt };
  // Unrelated mail leaves only its id and that verdict: no sender, no subject, no text.
  if (verdict.classification === "unrelated") {
    await ctx.db.insert("sourceMessages", base);
    return "unrelated";
  }
  const sourceMessageId = await ctx.db.insert("sourceMessages", {
    ...base,
    threadId: input.header.threadId,
    reason: verdict.reason.slice(0, 200),
    source: read?.source ?? verdict.source,
    fromAddress: addressOf(input.header.from) ?? undefined,
    replyTo: addressOf(input.header.replyTo) ?? undefined,
    subject: input.header.subject.slice(0, 200),
    excerpt: input.excerpt,
    attachments: input.attachments,
    flag: read?.forwarded ? "Forwarded mail: the addresses inside it are not proof of who the applicant is." : undefined,
  });
  if (verdict.classification === "promotion" || verdict.classification === "suggested_candidate" || !read) return verdict.classification;
  if (verdict.classification === "applicant_reply") return handleReply(ctx, connection, sourceMessageId, input);

  const company = (await ctx.db.get(companyId))!;
  const settings = recruiterSettings(company);
  const source = read.source;
  const fromAddress = addressOf(input.header.from);
  const evidence: ContactEvidence[] = [...(input.headerEvidence ?? []), ...read.addresses].map((entry) => ({ ...entry, sourceMessageId }));
  // Someone who wrote in themselves is writing from their own address. A job board, a forward or a no-reply sender is not.
  if (source === "direct" && !read.forwarded && fromAddress && !boardFor(fromAddress) && !isNotificationAddress(fromAddress)) {
    for (const entry of evidence) if (entry.address === fromAddress && entry.where === "header: From") entry.kind = "direct";
  }

  // A person who wrote in themselves is named by their own sender line, when the message itself did not say.
  const senderName = input.header.from.match(/^\s*"?([^"<@]{2,80}?)"?\s*</)?.[1]?.trim();
  if (!read.name && source === "direct" && !read.forwarded && senderName && !/\d/.test(senderName)) read.name = senderName;

  // The same application, named by the job board's own id.
  let application: Doc<"applications"> | null = null;
  if (read.sourceApplicationId) {
    application = await ctx.db
      .query("applications")
      .withIndex("by_company_source", (q) => q.eq("companyId", companyId).eq("source", source).eq("sourceApplicationId", read.sourceApplicationId))
      .first();
  }
  if (verdict.classification === "status_update") {
    if (application) await ctx.db.patch(sourceMessageId, { applicationId: application._id });
    return "status_update";
  }

  const need = await matchNeed(ctx, companyId, read.role);
  const found = application ? { applicant: await ctx.db.get(application.applicantId), maybe: null } : await findApplicant(ctx, companyId, evidence, read.phone, read.name);
  if (!application && found.applicant) {
    const theirs = await ctx.db
      .query("applications")
      .withIndex("by_company_applicant", (q) => q.eq("companyId", companyId).eq("applicantId", found.applicant!._id))
      .take(50);
    // The same person and the same role: the same application, unless the earlier one has ended.
    const sameRole = (row: Doc<"applications">) => (need ? row.needId === need._id : row.needId === undefined && normalizeTitle(row.roleSeen ?? "") === normalizeTitle(read.role ?? ""));
    application = theirs.find((row) => isActive(row) && sameRole(row)) ?? null;
    // Someone applying again after an earlier application ended gets a new application, and a person looks before anything is sent.
    if (!application && theirs.some(sameRole)) await ctx.db.patch(sourceMessageId, { flag: "This person applied for this role before, and that application has ended." });
  }

  const facts = factsFrom(read, sourceMessageId, input.header.receivedAt);
  if (application) {
    // A repeat notification. It is filed, anything new it says is kept, and nobody is invited twice.
    const contact = application.contact.resolvedBy
      ? { ...application.contact, evidence: mergeEvidence(application.contact.evidence, evidence) }
      : { ...resolveContact(mergeEvidence(application.contact.evidence, evidence), application.source, settings.verifiedRelays), bouncedAt: application.contact.bouncedAt };
    await ctx.db.patch(application._id, { facts: mergeFacts(application.facts, facts), contact });
    await ctx.db.patch(sourceMessageId, { applicationId: application._id, classification: "duplicate_notification" });
    await recordEvent(ctx, { companyId, type: "application.duplicate_notification", actor: { kind: "system" }, subject: { table: "applications", id: application._id }, data: { source } });
    await routeApplication(ctx, application._id);
    return "duplicate_notification";
  }

  const contact = resolveContact(evidence, source, settings.verifiedRelays);
  let applicantId = found.applicant?._id;
  if (!applicantId) {
    applicantId = await ctx.db.insert("applicants", {
      companyId,
      name: read.name,
      email: contact.address,
      phone: read.phone,
      location: read.location,
      possibleDuplicateOf: found.maybe?._id,
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId, type: "applicant.recorded", actor: RECRUITER, subject: { table: "applicants", id: applicantId }, data: { source } });
  } else if (found.applicant) {
    await ctx.db.patch(applicantId, { name: found.applicant.name ?? read.name, phone: found.applicant.phone ?? read.phone, email: found.applicant.email ?? contact.address });
  }
  const applicationId = await ctx.db.insert("applications", {
    companyId,
    applicantId,
    needId: need?._id,
    roleSeen: read.role,
    source,
    sourceApplicationId: read.sourceApplicationId,
    appliedAt: input.header.receivedAt,
    stage: "received",
    contact,
    facts,
    followUpsSent: 0,
    nextAction: { what: "Work out the next step", by: "recruiter", dueAt: Date.now() + DAY },
    createdAt: Date.now(),
  });
  await ctx.db.patch(sourceMessageId, { applicationId });
  await recordEvent(ctx, { companyId, type: "application.received", actor: RECRUITER, subject: { table: "applications", id: applicationId }, data: { source, contact: contact.status, matchedRole: Boolean(need) } });
  if (found.maybe) {
    await askPerson(ctx, { _id: applicationId, companyId }, { what: "duplicate", title: `Is ${read.name ?? "this applicant"} already on file?`, question: `Another applicant has the same name and nothing else ties them together. They were kept as two people. Check, and merge them only if they are the same person.`, dueAt: Date.now() + 2 * DAY, completionCondition: "A person confirmed whether these are the same person" });
  }
  await routeApplication(ctx, applicationId);
  return "new_application";
}
