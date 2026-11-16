/** Shared by the Recruiter scenario tests: a company with an open role, a test hiring inbox, and the mock email service. */
import { vi } from "vitest";

import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { DEFAULT_FREQUENCY, writeProfile } from "../convex/lib/compliance/profile";
import { mockEmails } from "../convex/lib/messaging/email";
import { mockOutbox } from "../convex/lib/messaging/provider";
import { mockCalendar } from "../convex/lib/recruiter/calendar";
import type { MessageBody } from "../convex/lib/recruiter/mail";
import { mockInbox, resetMockInboxes } from "../convex/lib/recruiter/mailbox";
import { mockModel } from "../convex/lib/recruiter/model";
import type { Stage } from "../convex/lib/recruiter/schema";
import { mockEnvelopes } from "../convex/lib/recruiter/signature";
import { addMember, company, start, type T } from "./harness";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** Monday March 1, 2027, 10:00 in Chicago: inside the default sending hours. */
export const MONDAY_10AM = Date.UTC(2027, 2, 1, 16, 0);
export const INBOX = "hiring@alpha.test";

/** Fake time, a link secret, and the mock email, text and mailbox services. Returns what to undo. */
export function recruiterTestEnv() {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_10AM);
  process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
  process.env.EMAIL_PROVIDER = "mock";
  process.env.MESSAGING_PROVIDER = "mock";
  mockEmails.length = 0;
  mockOutbox.length = 0;
  resetMockInboxes();
  mockModel.looksLikeHiring = null;
  mockModel.interpret = null;
  mockModel.seen.length = 0;
  mockCalendar.busy.length = 0;
  mockCalendar.events.length = 0;
  mockCalendar.released.length = 0;
  mockEnvelopes.length = 0;
  return () => {
    vi.useRealTimers();
    for (const name of ["ACTION_LINK_SECRET", "EMAIL_PROVIDER", "MESSAGING_PROVIDER", "RECRUITER_MODEL", "CALENDAR_PROVIDER", "SIGNATURE_PROVIDER"]) delete process.env[name];
  };
}

/** Runs everything that is due now (sends and what follows them), without moving far in time. */
export async function flush(t: T) {
  for (let i = 0; i < 8; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/** Moves the clock forward and runs what became due, including the scheduled sweeps a deployment runs by cron. */
export async function later(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.mutation(internal.messaging.sweepStuck, {});
  await t.mutation(internal.recruiter.followUps, {});
  await t.mutation(internal.recruiter.interviewReminders, {});
  await flush(t);
}

let serial = 0;
/** A synthetic message for the test inbox. No real person or address appears in any of these. */
export function mail(fields: Partial<MessageBody> & Pick<MessageBody, "from" | "subject" | "text">): MessageBody {
  serial += 1;
  return { id: fields.id ?? `msg-${serial}`, receivedAt: fields.receivedAt ?? Date.now(), attachments: [], ...fields };
}

export const indeedApplication = (overrides: Partial<MessageBody> = {}) =>
  mail({
    from: "Indeed <no-reply@indeed.com>",
    subject: "New application for House Cleaner - Austin, TX",
    text: "Maria Lopez applied to House Cleaner.\nEmail: maria.lopez@example.test\nPhone: (512) 555-0142\nLocation: Austin, TX\nExperience: 3 years residential cleaning\nApplication ID: IND-48213\n\nView the application on Indeed.",
    ...overrides,
  });

export const zipApplication = (overrides: Partial<MessageBody> = {}) =>
  mail({
    from: "Jordan Kim via ZipRecruiter <jordan.k.8f3a@reply.ziprecruiter.com>",
    subject: "New candidate: Jordan Kim for House Cleaner",
    text: "Jordan Kim applied for your House Cleaner job.\nPhone: 512-555-0188\nCandidate ID: ZR-99107\n\nReply to this email to contact the candidate.",
    ...overrides,
  });

export const NEED = {
  title: "House Cleaner",
  responsibilities: "Clean homes to our checklist, alone or with one other cleaner.",
  location: "Austin, TX",
  coverageAreas: ["78701", "78702"],
  requiredAvailability: "At least two weekdays, and Saturdays in busy weeks.",
  serviceTypes: ["standard"],
  engagement: "contractor" as const,
  openings: 2,
  questions: [{ key: "own_supplies", label: "Do you have your own cleaning supplies?", kind: "yes_no" as const, required: true }],
  criteria: [
    { key: "experience", label: "At least one year of paid cleaning experience", field: "experienceYears", test: { kind: "at_least" as const, value: 1 }, fixed: true },
    { key: "saturdays", label: "Can work Saturdays", field: "availableDays", test: { kind: "includes_any" as const, values: ["Saturday"] }, fixed: false },
    { key: "supplies", label: "Has their own cleaning supplies", field: "q.own_supplies", test: { kind: "is_true" as const }, fixed: false },
  ],
};

export const ANSWERS = { fullName: "Maria Lopez", email: "maria.lopez@example.test", phone: "5125550142", city: "Austin", experienceYears: 3, experienceSummary: "Three years cleaning homes and two short-term rentals.", availableDays: ["Tuesday", "Thursday", "Saturday"], hoursPerWeek: 25, serviceAreas: ["78701"], "q.own_supplies": true };

export async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  // A company whose sending setup is finished, so the shared policy lets its messages through. Quiet hours
  // are off here; a test that needs them sets them. Registration approval is Selestial staff's to record,
  // so it is written directly.
  await t.run(async (ctx) =>
    writeProfile(ctx, companyId, {
      messaging: { senderName: "Alpha Cleaning", smsNumber: "+15125550100", emailFromAddress: "hiring@mail.selestial.test", registration: { status: "approved", updatedAt: Date.now(), updatedBy: "staff" }, quietHours: null, frequency: DEFAULT_FREQUENCY },
    }),
  );
  const needId = await as.mutation(api.hiringNeeds.create, { companyId, ...NEED });
  // Reading starts an hour before "now", so the messages a test delivers are all inside the window.
  const connectionId = await as.mutation(api.recruiter.connectMailbox, { companyId, provider: "mock", address: INBOX, processFrom: MONDAY_10AM - HOUR });
  const inbox = mockInbox(INBOX);
  const sync = async () => {
    const result = await t.action(internal.recruiterInbox.sync, { connectionId });
    await flush(t);
    return result;
  };
  /** Puts messages in the inbox and reads it. */
  const receive = async (...messages: MessageBody[]) => {
    inbox.messages.push(...messages);
    return sync();
  };
  const allow = (action: string, level: "off" | "propose" | "execute_and_report" | "execute" = "execute") => as.mutation(api.permissions.set, { companyId, action, level });
  const applications = (stage?: Stage) => as.query(api.applications.list, { companyId, ...(stage ? { stage } : {}) });
  const detail = (applicationId: Id<"applications">) => as.query(api.applications.get, { companyId, applicationId });
  const approvals = () => as.query(api.approvals.list, { companyId });
  const decide = (approvalId: Id<"approvals">, decision: "approved" | "changed" | "skipped" = "approved", note?: string) => as.mutation(api.approvals.decide, { companyId, approvalId, decision, note });
  /** Approves every pending proposal and runs what that sets off. */
  const approveAll = async () => {
    const pending = await approvals();
    for (const approval of pending) await decide(approval._id);
    await flush(t);
    return pending.length;
  };
  const tasks = (status: "open" | "waiting" | "needs_decision" | "done" | "cancelled" = "needs_decision") => as.query(api.tasks.list, { companyId, status, agent: "recruiter" });
  const manager = () => addMember(t, as, companyId, "manager-a", "manager");
  const office = () => addMember(t, as, companyId, "office-a", "office");
  return { t, as, companyId, needId, connectionId, inbox, sync, receive, allow, applications, detail, approvals, decide, approveAll, tasks, manager, office };
}
export type Setup = Awaited<ReturnType<typeof setup>>;

/** Emails the mock service accepted for this address, oldest first. */
export function emailsTo(address: string) {
  return mockEmails.filter((row) => row.to === address && row.result === "accepted");
}

/** The link in the newest email of this kind to this address, as the applicant would receive it. */
export function tokenFor(address: string, purpose: "apply" | "interview" | "hiring-offer"): string {
  for (const email of [...emailsTo(address)].reverse()) {
    const match = email.text.match(new RegExp(`/c/${purpose}/([A-Za-z0-9_.-]+)`));
    if (match) return match[1];
  }
  throw new Error(`no ${purpose} link was emailed to ${address}`);
}

/** One genuine application, taken to an invitation the applicant has received. */
export async function invited(s: Setup, message = indeedApplication()) {
  await s.receive(message);
  await s.approveAll();
  const [application] = await s.applications("invited");
  return { applicationId: application.applicationId, token: tokenFor(application.contact.address!, "apply"), address: application.contact.address! };
}

/** An application taken through the form to a screened, submitted application. */
export async function submitted(s: Setup, answers: Record<string, string | number | boolean | string[]> = ANSWERS, message = indeedApplication()) {
  const invite = await invited(s, message);
  await s.t.mutation(api.applicantPages.submit, { token: invite.token, answers, attested: true });
  await flush(s.t);
  return invite;
}
