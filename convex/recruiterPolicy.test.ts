/**
 * @vitest-environment edge-runtime
 *
 * Recruiter on the shared sending policy: what counts as permission to write to an applicant, and every
 * check the policy makes, at planning time and again at the moment of sending.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ANSWERS, DAY, emailsTo, flush, HOUR, indeedApplication, invited, later, recruiterTestEnv, setup, type Setup } from "../tests/recruiterHarness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { readProfile, writeProfile } from "./lib/compliance/profile";
import { recipientsAt } from "./lib/compliance/recipients";
import { mockEmails } from "./lib/messaging/email";
import { mockOutbox } from "./lib/messaging/provider";

const MARIA = "maria.lopez@example.test";

async function permissions(s: Setup, applicantId: string) {
  return s.as.query(api.consent.forRecipient, { companyId: s.companyId, recipient: { kind: "applicant", id: applicantId } });
}

async function messages(s: Setup) {
  return s.t.run(async (ctx) => ctx.db.query("messages").collect().then((rows) => rows.filter((m) => m.purpose !== "member_notice")));
}

async function setMessaging(s: Setup, change: Record<string, unknown>) {
  await s.t.run(async (ctx) => {
    const current = (await readProfile(ctx, s.companyId)).messaging;
    await writeProfile(ctx, s.companyId, { messaging: { ...current, ...change } });
  });
}

describe("Recruiter on the shared sending policy", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = recruiterTestEnv();
  });
  afterEach(() => undo());

  it("records email permission when someone applies, with the notification as evidence, and nothing for texts", async () => {
    const s = await setup();
    await s.receive(indeedApplication());
    const [row] = await s.applications();
    const view = await permissions(s, row.applicantId);
    expect(JSON.stringify(view)).toContain("job_application");
    const t = await s.t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
    expect(t).toEqual([expect.objectContaining({ channel: "email", category: "recruiting", status: "granted", source: "job_application", recordedBy: { kind: "system" }, evidence: expect.stringContaining("Applied for House Cleaner through Indeed") })]);
    // A second notification about the same application records nothing new.
    await s.receive(indeedApplication({ id: "again" }));
    expect(await s.t.run(async (ctx) => (await ctx.db.query("permissionHistory").collect()).length)).toBe(1);
  });

  it("the applicant's own tick is the only permission to text, with the wording they agreed to; unticking withdraws it", async () => {
    const s = await setup();
    const { token } = await invited(s);
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { phone: "512-555-0142", smsConsent: true } });
    let rows = await s.t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
    expect(rows.find((row) => row.channel === "sms")).toMatchObject({ status: "granted", source: "applicant_form", recordedBy: { kind: "recipient" }, disclosureText: expect.stringContaining("You may text me at this number") });
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { smsConsent: false } });
    rows = await s.t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
    expect(rows.find((row) => row.channel === "sms")).toMatchObject({ status: "withdrawn", source: "applicant_form" });
  });

  it("the shared lookup finds applicants by email and by phone, so a STOP or an unsubscribe reaches them", async () => {
    const s = await setup();
    const { token } = await invited(s);
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { phone: "512-555-0142", smsConsent: true } });
    const found = await s.t.run(async (ctx) => ({ email: await recipientsAt(ctx, s.companyId, "email", MARIA), sms: await recipientsAt(ctx, s.companyId, "sms", "+15125550142") }));
    expect(found.email).toEqual([expect.objectContaining({ kind: "applicant", name: "Maria Lopez" })]);
    expect(found.sms).toEqual([expect.objectContaining({ kind: "applicant", phone: "+15125550142" })]);
  });

  it("a STOP texted by an applicant stops their texts at once; email about the application still goes", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { token } = await invited(s);
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { phone: "512-555-0142", smsConsent: true } });
    const reply = await s.t.mutation(internal.inbound.sms, { to: "+15125550100", from: "+15125550142", body: "STOP", receivedAt: Date.now() });
    expect(reply.kind).toBe("stop");
    await later(s.t, 49 * HOUR);
    // The reminder email went; its text was refused by the policy, in its own words.
    expect(emailsTo(MARIA)).toHaveLength(2);
    expect(mockOutbox.filter((row) => row.to === "+15125550142" && row.body.includes("application"))).toEqual([]);
    const text = (await messages(s)).find((row) => row.applicationId && row.channel === "sms");
    expect(text).toMatchObject({ status: "not_sent", problem: expect.stringContaining("replied STOP") });
  });

  it("an email unsubscribe stops recruiting email to that applicant, checked again at the moment of sending", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    await invited(s);
    // The reminder is planned first; the unsubscribe lands before it is sent.
    await later(s.t, 47 * HOUR);
    await s.t.mutation(internal.inbound.emailUnsubscribe, { companyId: s.companyId, address: MARIA, category: "recruiting" });
    await later(s.t, 3 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    const reminder = (await messages(s)).find((row) => row.purpose === "application_follow_up");
    expect(reminder === undefined || reminder.status === "not_sent").toBe(true);
  });

  it("nothing goes while the company is suspended or its email setup is unfinished, and the reason is on the record", async () => {
    const s = await setup();
    await setMessaging(s, { emailFromAddress: undefined });
    await s.receive(indeedApplication());
    await s.approveAll();
    expect(mockEmails).toEqual([]);
    const [first] = await messages(s);
    expect(first).toMatchObject({ status: "not_sent", problem: "Email needs the address messages are sent from." });
    const [row] = await s.applications();
    expect(row.nextAction).toMatchObject({ by: "owner" });

    await setMessaging(s, { emailFromAddress: "hiring@mail.selestial.test" });
    await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { suspendedAt: Date.now() }));
    await s.as.mutation(api.applications.inviteAgain, { companyId: s.companyId, applicationId: row.applicationId }).catch(() => null);
    expect(mockEmails).toEqual([]);
    expect((await messages(s)).every((message) => message.status === "not_sent")).toBe(true);
  });

  it("quiet hours hold an invitation and send it when they end", async () => {
    const s = await setup();
    // 10:00 company time now; quiet from 09:00 to 11:00 for this test.
    await setMessaging(s, { quietHours: { start: "09:00", end: "11:00", appliesToOperational: false } });
    await s.receive(indeedApplication());
    await s.approveAll();
    expect(mockEmails).toEqual([]);
    const [held] = await messages(s);
    expect(held).toMatchObject({ status: "held", problem: expect.stringContaining("quiet hours") });
    expect((await s.applications())[0].stage).toBe("invitation_awaiting_approval");
    await later(s.t, HOUR + 60_000);
    expect(emailsTo(MARIA)).toHaveLength(1);
    expect((await s.applications())[0].stage).toBe("invited");
  });

  it("the weekly limit counts recruiting messages to one applicant across everything Recruiter sends", async () => {
    const s = await setup();
    await setMessaging(s, { frequency: { marketingPerWeek: 2, recruitingPerWeek: 1 } });
    await s.allow("recruiter.follow_up", "execute");
    await invited(s);
    await later(s.t, 49 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    const reminder = (await messages(s)).find((row) => row.purpose === "application_follow_up")!;
    expect(reminder).toMatchObject({ status: "not_sent", problem: expect.stringContaining("The company allows 1 a week") });
  });

  it("a paused Recruiter sends nothing by itself, while a person may still send", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { applicationId } = await invited(s);
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["recruiter"] });
    await later(s.t, 49 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    // A person sends a new link by hand: that is not Recruiter acting.
    await s.as.mutation(api.applications.inviteAgain, { companyId: s.companyId, applicationId });
    await flush(s.t);
    expect(emailsTo(MARIA)).toHaveLength(2);
  });

  it("asking not to be contacted withdraws every permission, and a bounce puts the address on the shared do-not-send list", async () => {
    const s = await setup();
    const { applicationId } = await invited(s);
    await s.receive({ id: "reply-stop", receivedAt: Date.now(), from: `Maria Lopez <${MARIA}>`, subject: "Re: Next step", text: "Please stop emailing me.", attachments: [] });
    const rows = await s.t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
    expect(rows.find((row) => row.channel === "email")).toMatchObject({ status: "withdrawn", source: "email_reply", recordedBy: { kind: "recipient" } });
    // Recording that they changed their mind grants email again, as a person's record.
    const applicantId = (await s.detail(applicationId)).applicantId as Id<"applicants">;
    await s.as.mutation(api.applications.setDoNotContact, { companyId: s.companyId, applicantId, doNotContact: false, reason: "Called and asked to continue." });
    expect((await s.t.run(async (ctx) => ctx.db.query("contactPermissions").collect())).find((row) => row.channel === "email")).toMatchObject({ status: "granted", source: "staff" });

    await s.receive(indeedApplication({ id: "b1", text: "Bo Reyes applied to House Cleaner.\nEmail: bounce.bo@example.test\nApplication ID: IND-7" }));
    await s.approveAll();
    const suppressions = await s.t.run(async (ctx) => ctx.db.query("suppressions").collect());
    expect(suppressions).toEqual([expect.objectContaining({ channel: "email", address: "bounce.bo@example.test", scope: "all", reason: "bounce" })]);
  });

  it("the end-to-end proof still holds on the policy: one invitation, the form, reminders stop, the summary reaches the owner", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { token } = await invited(s);
    await s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true });
    await later(s.t, 7 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(1);
    const [row] = await s.as.query(api.applications.screeningQueue, { companyId: s.companyId });
    expect(row.screening!.recommendation).toBe("advance");
    // Every applicant message carried its purpose to the policy.
    const intents = await s.t.run(async (ctx) => ctx.db.query("sendIntents").collect());
    expect(intents).toEqual([expect.objectContaining({ channel: "email", address: MARIA, category: "recruiting", origin: "manual", recipient: expect.objectContaining({ kind: "applicant" }) })]);
  });
});
