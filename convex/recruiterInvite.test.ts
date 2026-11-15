/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refusal } from "../tests/harness";
import { ANSWERS, DAY, emailsTo, flush, HOUR, indeedApplication, invited, later, mail, recruiterTestEnv, setup, submitted, tokenFor, zipApplication } from "../tests/recruiterHarness";
import { api, internal } from "./_generated/api";
import { mockEmails } from "./lib/messaging/email";
import { mockOutbox } from "./lib/messaging/provider";

const MARIA = "maria.lopez@example.test";

describe("Recruiter: invitation, the application page, reminders and replies", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = recruiterTestEnv();
  });
  afterEach(() => undo());

  it("sends one invitation after approval, from the company, with only verified details", async () => {
    const s = await setup();
    await s.receive(indeedApplication());
    const [approval] = await s.approvals();
    const answer = await s.decide(approval._id);
    expect(answer.carriedOut).toMatchObject({ ok: true });
    await flush(s.t);
    expect(mockEmails).toHaveLength(1);
    const [email] = mockEmails;
    expect(email).toMatchObject({ to: MARIA, fromName: "Alpha Cleaning Hiring Team", replyTo: "hiring@alpha.test", subject: "Next step for your House Cleaner application at Alpha Cleaning" });
    expect(email.text).toContain("Hi Maria,");
    expect(email.text).toContain("Thank you for applying for the House Cleaner position at Alpha Cleaning through Indeed.");
    expect(email.text).toMatch(/\/c\/apply\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(email.text).toContain("an automated system");
    // No claim about being shortlisted, approved or hired.
    expect(email.text).not.toMatch(/shortlist|approved|hired|congratulations|interview/i);
    const [row] = await s.applications("invited");
    expect(row).toMatchObject({ stage: "invited", nextAction: { by: "applicant" } });
    // Delivery is the message's own record, separate from the application's stage. Nothing says "opened" or "read".
    const detail = await s.detail(row.applicationId);
    const out = detail.conversation.find((entry) => entry.direction === "out")!;
    expect(out).toMatchObject({ purpose: "application_invitation", channel: "email", status: "delivered" });
    expect(Object.keys(out)).not.toContain("openedAt");
    // The token is nowhere at rest: not in the message row, the link row or the event log.
    const token = tokenFor(MARIA, "apply");
    const everything = await s.t.run(async (ctx) => JSON.stringify([await ctx.db.query("messages").collect(), await ctx.db.query("applicantLinks").collect(), await ctx.db.query("events").collect(), await ctx.db.query("toolRuns").collect()]));
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(token.split(".")[1]);
  });

  it("leaves out the first name and the job board when they are not known", async () => {
    const s = await setup();
    await s.receive(mail({ from: "Indeed <no-reply@indeed.com>", subject: "New application for House Cleaner", text: "A candidate applied.\nEmail: someone@example.test" }));
    await s.approveAll();
    expect(mockEmails[0].text).toContain("Hello,");
    await s.receive(mail({ from: "Chris Park <chris.park@example.test>", subject: "Application for the House Cleaner position", text: "I would like to apply for the House Cleaner position." }));
    await s.approveAll();
    const direct = emailsTo("chris.park@example.test")[0];
    expect(direct.text).toContain("Hi Chris,");
    expect(direct.text).toContain("position at Alpha Cleaning.");
    expect(direct.text).not.toContain("through");
  });

  it("sends without review only when the Owner chose that and every criterion holds", async () => {
    const s = await setup();
    // Automatic mode alone is not enough: the permission is still on Propose.
    await s.as.mutation(api.recruiter.updatePlaybook, { companyId: s.companyId, settings: { invitationMode: "auto" } });
    await s.receive(indeedApplication({ id: "auto-1" }));
    expect(mockEmails).toEqual([]);
    expect(await s.approvals()).toHaveLength(1);
    await s.approveAll();
    // With the permission raised too, a clean job-board application goes by itself...
    await s.allow("recruiter.send_invitation", "execute");
    await s.receive(indeedApplication({ id: "auto-2", text: "Lee Wong applied to House Cleaner.\nEmail: lee.wong@example.test\nApplication ID: IND-2" }));
    expect(emailsTo("lee.wong@example.test")).toHaveLength(1);
    // ...and one that someone wrote in directly still waits for a person.
    await s.receive(mail({ from: "Chris Park <chris.park@example.test>", subject: "Application for the House Cleaner position", text: "I would like to apply for the House Cleaner position." }));
    expect(emailsTo("chris.park@example.test")).toEqual([]);
    const [waiting] = await s.approvals();
    expect(waiting.reason).toContain("Not sent automatically");
  });

  it("a changed or skipped proposal sends nothing and leaves the application with a person", async () => {
    const s = await setup();
    await s.receive(indeedApplication());
    const [approval] = await s.approvals();
    await s.decide(approval._id, "skipped");
    await flush(s.t);
    expect(mockEmails).toEqual([]);
    const [row] = await s.applications();
    expect(row).toMatchObject({ stage: "received", withPerson: true, nextAction: { by: "owner" } });
    // Another notification about the same application does not bring the proposal back while a person has it.
    await s.receive(indeedApplication({ id: "again" }));
    expect(await s.approvals()).toEqual([]);
    await s.as.mutation(api.applications.handBack, { companyId: s.companyId, applicationId: row.applicationId });
    expect(await s.approvals()).toHaveLength(1);
  });

  it("does not send a second invitation when the send is retried after it succeeded", async () => {
    const s = await setup();
    const { applicationId } = await invited(s);
    expect(mockEmails).toHaveLength(1);
    const messageId = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect())[0]._id);
    // The worker runs again, the workflow is asked again, another notification arrives, and the agent's tool is called twice.
    await s.t.action(internal.messaging.deliver, { messageId });
    await s.t.action(internal.messaging.deliver, { messageId });
    await s.receive(indeedApplication({ id: "repeat" }));
    for (const key of ["k1", "k1", "k2"]) {
      const run = await s.t.mutation(internal.recruiterTools.run, { companyId: s.companyId, tool: "send_approved_invitation", input: { applicationId }, idempotencyKey: key });
      expect(run.result).toMatchObject(key === "k1" ? { detail: "The invitation was already sent." } : { detail: "The invitation was already sent." });
    }
    await s.approveAll();
    await flush(s.t);
    expect(mockEmails).toHaveLength(1);
    expect((await s.detail(applicationId)).conversation.filter((entry) => entry.direction === "out")).toHaveLength(1);
  });

  it("a send that died half way is never sent again by itself", async () => {
    const s = await setup();
    await s.receive(indeedApplication({ text: "Cory Diaz applied to House Cleaner.\nEmail: crash.cory@example.test" }));
    await s.approveAll();
    await later(s.t, 6 * 60 * 1000);
    const [row] = await s.applications();
    const detail = await s.detail(row.applicationId);
    expect(detail.conversation.find((entry) => entry.direction === "out")).toMatchObject({ status: "unconfirmed" });
    expect(row.stage).not.toBe("invited");
    expect(mockEmails.filter((email) => email.to === "crash.cory@example.test")).toHaveLength(1);
    expect((await s.tasks()).some((task) => task.openQuestion?.includes("not known whether it went"))).toBe(true);
    // No reminders follow an invitation nobody knows was received.
    await later(s.t, 3 * DAY);
    expect(mockEmails).toHaveLength(1);
  });

  it("treats a bounce as a wrong address, not as an applicant who ignored the invitation", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    await s.receive(indeedApplication({ text: "Bo Reyes applied to House Cleaner.\nEmail: bounce.bo@example.test" }));
    await s.approveAll();
    const [row] = await s.applications();
    expect(row).toMatchObject({ stage: "contact_needed", contact: { status: "direct", bounced: true }, nextAction: { by: "owner" } });
    const detail = await s.detail(row.applicationId);
    expect(detail.conversation.find((entry) => entry.direction === "out")).toMatchObject({ status: "failed", bouncedAt: expect.any(Number), problem: "The address rejected the message." });
    expect(detail.remindersSent).toBe(0);
    // A week on (a Monday again, inside sending hours), nothing more was sent: no reminder, no second invitation.
    await later(s.t, 7 * DAY);
    expect(mockEmails).toHaveLength(1);
    expect((await s.tasks()).some((task) => task.title === "Email to Bo Reyes bounced")).toBe(true);
    // A person corrects the address. A new proposal follows, and the new invitation goes to the new address.
    await s.as.mutation(api.applications.resolveContact, { companyId: s.companyId, applicationId: row.applicationId, address: "bo.reyes@example.test" });
    await s.approveAll();
    expect(emailsTo("bo.reyes@example.test")).toHaveLength(1);
    expect((await s.detail(row.applicationId)).stage).toBe("invited");
  });

  it("also records a bounce the email service reports later", async () => {
    const s = await setup();
    const { applicationId } = await invited(s, indeedApplication({ text: "Slow Sam applied to House Cleaner.\nEmail: slow.sam@example.test" }));
    const sent = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect())[0]);
    expect(sent).toMatchObject({ status: "sent" });
    expect(sent.deliveredAt).toBeUndefined();
    await s.t.mutation(internal.messaging.receipt, { provider: "mock-email", eventId: "evt-1", providerMessageId: sent.providerMessageId!, outcome: "bounced" });
    // The same report twice changes nothing twice.
    expect(await s.t.mutation(internal.messaging.receipt, { provider: "mock-email", eventId: "evt-1", providerMessageId: sent.providerMessageId!, outcome: "bounced" })).toBe("duplicate");
    expect(await s.detail(applicationId)).toMatchObject({ stage: "contact_needed", contact: { bounced: true } });
  });

  it("saves a draft, lets the applicant return to it, and submits only when asked", async () => {
    const s = await setup();
    const { applicationId, token } = await invited(s);
    // Opening the page, however often, changes nothing.
    for (let i = 0; i < 3; i += 1) {
      const page = await s.t.query(api.applicantPages.application, { token });
      expect(page).toMatchObject({ company: "Alpha Cleaning", role: "House Cleaner", state: "open", firstName: "Maria" });
      // What was verified is offered for correction: the name and the address they gave. Nothing else.
      expect(page.form!.answers).toEqual({ fullName: "Maria Lopez", email: MARIA });
    }
    expect((await s.detail(applicationId)).stage).toBe("invited");
    const page = await s.t.query(api.applicantPages.application, { token });
    // The form asks nothing kept for onboarding.
    expect(JSON.stringify(page.form!.fields)).not.toMatch(/ssn|social security|bank|routing|tax|date of birth|driver/i);
    expect(JSON.stringify(page)).not.toMatch(/minutes to complete|takes about/i);

    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { phone: "(512) 555-0142", experienceYears: 3, availableDays: ["Tuesday", "Saturday", "Someday"], notAQuestion: "x" } });
    expect((await s.detail(applicationId))).toMatchObject({ stage: "application_started", form: { answered: 4, required: 7 } });
    // A return visit, on another device: the draft comes from the server, cleaned to the form's own questions.
    const back = await s.t.query(api.applicantPages.application, { token });
    expect(back.form!.answers).toEqual({ fullName: "Maria Lopez", email: MARIA, phone: "15125550142", experienceYears: 3, availableDays: ["Tuesday", "Saturday"] });
    expect(back.form!.progress).toEqual({ answered: 4, required: 7 });

    // Submitting with required answers missing is refused, and so is submitting without the confirmation.
    expect(await refusal(s.t.mutation(api.applicantPages.submit, { token, answers: {}, attested: true }))).toContain("Please answer:");
    expect(await refusal(s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: false }))).toContain("confirm");
    expect((await s.detail(applicationId)).stage).toBe("application_started");
    await s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true });
    const done = await s.t.query(api.applicantPages.application, { token });
    expect(done).toMatchObject({ state: "submitted", form: null });
    // It cannot be changed or submitted twice.
    expect(await refusal(s.t.mutation(api.applicantPages.saveDraft, { token, answers: { experienceYears: 9 } }))).toBe("This application has already been submitted.");
    expect(await refusal(s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true }))).toBe("This application has already been submitted.");
  });

  it("stops reminders the moment the application is submitted", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { token, applicationId } = await invited(s);
    await later(s.t, 24 * HOUR);
    await s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true });
    await later(s.t, 6 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(1);
    expect((await s.detail(applicationId)).remindersSent).toBe(0);
  });

  it("reminds on the Owner's schedule, up to the limit, then asks a person instead of rejecting", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { applicationId } = await invited(s);
    await later(s.t, 47 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    await later(s.t, 2 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(2);
    expect(emailsTo(MARIA)[1].subject).toBe("Reminder: your House Cleaner application at Alpha Cleaning");
    // Running the sweep again and again sends the same reminder once.
    await later(s.t, HOUR);
    await later(s.t, HOUR);
    expect(emailsTo(MARIA)).toHaveLength(2);
    // The second reminder falls due on a Saturday. It is planned then and goes out when sending hours next open, on Monday.
    await later(s.t, 3 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(2);
    await later(s.t, 2 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(3);
    expect((await s.detail(applicationId)).remindersSent).toBe(2);
    // The limit is reached. Silence is not a rejection: the application is still open and a person decides.
    await later(s.t, 7 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(3);
    const row = await s.detail(applicationId);
    expect(row).toMatchObject({ stage: "invited", closure: null, nextAction: { by: "owner" } });
    expect((await s.tasks()).some((task) => task.openQuestion?.includes("Not answering is not a no"))).toBe(true);
  });

  it("asks before each reminder while the permission is on Propose", async () => {
    const s = await setup();
    await invited(s);
    await later(s.t, 49 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    await later(s.t, HOUR);
    const pending = await s.approvals();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ action: "recruiter.follow_up", proposal: { kind: "send_follow_up", attempt: 1 } });
    await s.approveAll();
    expect(emailsTo(MARIA)).toHaveLength(2);
  });

  it("texts a reminder only to an applicant who gave permission on the form", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    // The notification carried a phone number. That is not permission to text.
    const { token } = await invited(s);
    await later(s.t, 49 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(2);
    expect(mockOutbox).toEqual([]);
    // The applicant ticks the box on their own draft. The next reminder is also texted.
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { phone: "512-555-0142", smsConsent: true } });
    await later(s.t, 3 * DAY);
    await later(s.t, 2 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(3);
    expect(mockOutbox).toHaveLength(1);
    expect(mockOutbox[0]).toMatchObject({ to: "+15125550142" });
    expect(mockOutbox[0].body).toContain("Alpha Cleaning: your House Cleaner application is not finished yet.");
    expect(mockOutbox[0].body).toContain("Reply STOP");
  });

  it("pauses reminders while an applicant's question is unanswered", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { applicationId } = await invited(s);
    await s.receive(mail({ from: `Maria Lopez <${MARIA}>`, subject: "Re: Next step for your House Cleaner application at Alpha Cleaning", text: "Hi, do I need my own car for this job?" }));
    const row = await s.detail(applicationId);
    expect(row).toMatchObject({ stage: "invited", waitingOnReply: true, nextAction: { by: "owner" } });
    expect(row.conversation.at(-1)).toMatchObject({ direction: "in", classification: "applicant_reply" });
    expect((await s.tasks()).some((task) => task.title === "Maria Lopez replied about their application")).toBe(true);
    await later(s.t, 4 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(1);
    // A person answers and says so. Reminders may go again.
    await s.as.mutation(api.applications.markReplyAnswered, { companyId: s.companyId, applicationId });
    await later(s.t, HOUR);
    expect(emailsTo(MARIA)).toHaveLength(2);
  });

  it("stops everything when the applicant withdraws or asks not to be contacted", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const maria = await invited(s);
    await s.receive(zipApplication({ from: "Jordan Kim <jordan.kim@example.test>", text: "Jordan Kim applied for your House Cleaner job.\nEmail: jordan.kim@example.test\nCandidate ID: ZR-1" }));
    await s.approveAll();
    await s.receive(
      mail({ from: `Maria Lopez <${MARIA}>`, subject: "Re: Next step", text: "Thanks, but I found another job. Please withdraw my application." }),
      mail({ from: "Jordan Kim <jordan.kim@example.test>", subject: "Re: Next step", text: "Please stop emailing me." }),
    );
    expect(await s.detail(maria.applicationId)).toMatchObject({ stage: "withdrawn" });
    const jordan = (await s.applications()).find((row) => row.name === "Jordan Kim")!;
    expect((await s.detail(jordan.applicationId)).applicant?.doNotContact).toMatchObject({ reason: "Asked by email not to be contacted." });
    // The withdrawn applicant's link no longer opens the form.
    expect(await s.t.query(api.applicantPages.application, { token: maria.token })).toMatchObject({ state: "withdrawn", form: null });
    expect(await refusal(s.t.mutation(api.applicantPages.saveDraft, { token: maria.token, answers: {} }))).toBe("This link is no longer active.");
    await later(s.t, 7 * DAY);
    expect(mockEmails).toHaveLength(2);
    // Withdrawing on the page itself works the same way.
    await s.receive(indeedApplication({ id: "w3", text: "Ana Ruiz applied to House Cleaner.\nEmail: ana.ruiz@example.test" }));
    await s.approveAll();
    await s.t.mutation(api.applicantPages.withdraw, { token: tokenFor("ana.ruiz@example.test", "apply") });
    expect((await s.applications("withdrawn")).map((row) => row.name).sort()).toEqual(["Ana Ruiz", "Maria Lopez"]);
  });

  it("stops reminders when the role closes, when a person takes over, and when the link is revoked", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    const { applicationId, token } = await invited(s);
    await s.as.mutation(api.hiringNeeds.setStatus, { companyId: s.companyId, needId: s.needId, status: "paused" });
    await later(s.t, 50 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    expect(await s.t.query(api.applicantPages.application, { token })).toMatchObject({ state: "role_closed", form: null });
    await s.as.mutation(api.hiringNeeds.setStatus, { companyId: s.companyId, needId: s.needId, status: "open" });
    await s.as.mutation(api.applications.takeOver, { companyId: s.companyId, applicationId });
    await later(s.t, HOUR);
    expect(emailsTo(MARIA)).toHaveLength(1);
    await s.as.mutation(api.applications.handBack, { companyId: s.companyId, applicationId });
    await s.as.mutation(api.applications.close, { companyId: s.companyId, applicationId, reason: "role_closed" });
    await later(s.t, 5 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(1);
    expect(await s.t.query(api.applicantPages.application, { token })).toMatchObject({ state: "closed", form: null });
  });

  it("an expired or revoked link shows nothing and accepts nothing", async () => {
    const s = await setup();
    const { token, applicationId } = await invited(s);
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { experienceYears: 3, city: "Austin" } });
    await later(s.t, 15 * DAY);
    const page = await s.t.query(api.applicantPages.application, { token });
    expect(page).toMatchObject({ state: "expired", form: null });
    expect(JSON.stringify(page)).not.toContain("Austin");
    expect(await refusal(s.t.mutation(api.applicantPages.saveDraft, { token, answers: { experienceYears: 4 } }))).toBe("This link has expired.");
    expect(await refusal(s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true }))).toBe("This link has expired.");
    // The expiry is not the applicant's "no": the application is still open and a person is asked what to do.
    expect(await s.detail(applicationId)).toMatchObject({ stage: "application_started", closure: null, nextAction: { by: "owner" } });

    // A token that was tampered with, a cleaner's kind of page, and a made-up token all name nothing.
    const forged = `${token.split(".")[0]}.${"A".repeat(43)}`;
    for (const bad of [forged, "nonsense", `${token}x`]) expect(await refusal(s.t.query(api.applicantPages.application, { token: bad }))).toBe("Not found.");
    expect(await refusal(s.t.query(api.applicantPages.interview, { token }))).toBe("Not found.");
    expect(await refusal(s.t.query(api.links.offer, { token }))).toBe("Not found.");
  });

  it("keeps uploads private, of allowed kinds, and tied to their own application", async () => {
    const s = await setup();
    const { token, applicationId } = await invited(s);
    const store = (type: string, bytes = 2000) => s.t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));
    expect(typeof (await s.t.mutation(api.applicantPages.fileUploadUrl, { token }))).toBe("string");
    const resume = await store("application/pdf");
    const attached = await s.t.mutation(api.applicantPages.attachFile, { token, storageId: resume, kind: "resume", fileName: "../../My Resume<script>.pdf", clientKey: "resume-key-1" });
    // A retry with the same key records it once.
    expect(await s.t.mutation(api.applicantPages.attachFile, { token, storageId: resume, kind: "resume", fileName: "My Resume.pdf", clientKey: "resume-key-1" })).toMatchObject({ duplicate: true });
    const bad = await store("application/x-msdownload");
    expect(await refusal(s.t.mutation(api.applicantPages.attachFile, { token, storageId: bad, kind: "supporting", fileName: "run.exe", clientKey: "bad-key-0001" }))).toContain("Files must be");
    const detail = await s.detail(applicationId);
    expect(detail.attachments).toEqual([expect.objectContaining({ kind: "resume", fileName: ".._.._My Resume_script_.pdf", verified: false })]);
    // An Owner gets a short-lived address for it. Someone outside the company, or without a manager's role, does not.
    expect(typeof (await s.as.query(api.applications.attachmentUrl, { companyId: s.companyId, attachmentId: attached.attachmentId }))).toBe("string");
    const office = await s.office();
    expect(await refusal(office.query(api.applications.attachmentUrl, { companyId: s.companyId, attachmentId: attached.attachmentId }))).toBe("Not allowed.");
    // Another applicant's link cannot remove it.
    await s.receive(indeedApplication({ id: "other", text: "Ana Ruiz applied to House Cleaner.\nEmail: ana.ruiz@example.test" }));
    await s.approveAll();
    expect(await refusal(s.t.mutation(api.applicantPages.removeFile, { token: tokenFor("ana.ruiz@example.test", "apply"), attachmentId: attached.attachmentId }))).toBe("Not found.");
  });

  it("the first end-to-end proof: notification in, one invitation, form completed, reminders stop, summary reaches the owner", async () => {
    const s = await setup();
    await s.allow("recruiter.follow_up", "execute");
    // A genuine application notification enters the test inbox, among other mail.
    await s.receive(mail({ from: "Indeed <no-reply@indeed.com>", subject: "Sponsor your job", text: "Boost it." }), indeedApplication(), indeedApplication({ id: "dup" }));
    // The correct recipient is resolved, and one invitation is sent after approval.
    expect(await s.approveAll()).toBe(1);
    expect(mockEmails.map((email) => email.to)).toEqual([MARIA]);
    // The applicant completes the tokenized form.
    const token = tokenFor(MARIA, "apply");
    await s.t.mutation(api.applicantPages.saveDraft, { token, answers: { experienceYears: 3 } });
    await later(s.t, 49 * HOUR);
    expect(emailsTo(MARIA)).toHaveLength(2);
    await s.t.mutation(api.applicantPages.submit, { token, answers: ANSWERS, attested: true });
    // Follow-ups stop.
    await later(s.t, 10 * DAY);
    expect(emailsTo(MARIA)).toHaveLength(2);
    // An evidence-backed screening summary reaches the owner.
    const [row] = await s.as.query(api.applications.screeningQueue, { companyId: s.companyId });
    expect(row).toMatchObject({ name: "Maria Lopez", stage: "screening", nextAction: { by: "owner" } });
    expect(row.screening!.recommendation).toBe("advance");
    expect(row.screening!.results).toEqual([
      { key: "experience", label: "At least one year of paid cleaning experience", outcome: "meets", evidence: 'Answered "3". The requirement is at least 1.', source: "The application form", fixed: true },
      { key: "saturdays", label: "Can work Saturdays", outcome: "meets", evidence: 'Answered "Tuesday, Thursday, Saturday". The requirement is at least one of: Saturday.', source: "The application form", fixed: false },
      { key: "supplies", label: "Has their own cleaning supplies", outcome: "meets", evidence: 'Answered "Yes".', source: "The application form", fixed: false },
    ]);
    const review = (await s.tasks()).find((task) => task.title === "Review Maria Lopez for House Cleaner")!;
    expect(review.openQuestion).toContain("3 years of paid cleaning experience");
    expect(review.openQuestion).toContain("Decide whether to interview");
    const overview = await s.as.query(api.recruiter.overview, { companyId: s.companyId });
    expect(overview).toMatchObject({ openHiringNeeds: 1, awaitingScreening: 1, incompleteApplications: 0, invitationsAwaitingApproval: 0, contactNeeded: 0, inboxConnected: true });
  });

  it("uses what a submitted application says", async () => {
    const s = await setup();
    const { applicationId } = await submitted(s);
    const detail = await s.detail(applicationId);
    expect(detail.facts).toEqual(expect.arrayContaining([expect.objectContaining({ field: "experience_years", value: "3", from: "form" }), expect.objectContaining({ field: "experience", from: "message" })]));
    expect(detail.form).toMatchObject({ answered: 7, required: 7 });
  });
});
