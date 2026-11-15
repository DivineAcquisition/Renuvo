/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accepted, dispatchTestEnv, flush, linkFor, PHONES, setup } from "../tests/dispatchHarness";
import { company, dispatchCleaner, dispatchJob, dispatchPlace, HOUR, JOB_END, JOB_START, NOW, refusal } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { mockOutbox } from "./lib/messaging/provider";

const MINUTE = 60 * 1000;

describe("Dispatch: from a staffing need to accepted coverage", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("staffs a one-cleaner job: approved proposal, texted offer, acceptance through the link", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    // Approval first: nothing has gone to any cleaner yet.
    await flush(s.t);
    expect(mockOutbox).toEqual([]);
    expect((await s.board(jobId)).group).toBe("awaiting_approval");
    const [proposal] = await s.as.query(api.approvals.list, { companyId: s.companyId });
    await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: proposal._id, decision: "approved" });
    await flush(s.t);

    // One text, to Lena, with the area but not the street, her pay and the deadline.
    expect(mockOutbox).toHaveLength(1);
    expect(mockOutbox[0].to).toBe(PHONES.Lena);
    expect(mockOutbox[0].body).toContain("Alpha Cleaning: job offer.");
    expect(mockOutbox[0].body).toContain("Austin 78701");
    expect(mockOutbox[0].body).toContain("Est. pay $80.00");
    expect(mockOutbox[0].body).not.toContain("12 Elm St");
    expect((await s.board(jobId)).group).toBe("offers_out");

    // Opening the link shows the offer and changes nothing, however often it is opened.
    const token = linkFor(PHONES.Lena, "offer");
    for (let i = 0; i < 3; i += 1) {
      const page = await s.t.query(api.links.offer, { token });
      expect(page.state).toBe("open");
      expect(page.offer).toMatchObject({ area: "Austin 78701", estimatedPay: "$80.00", role: "Solo job" });
      expect(JSON.stringify(page)).not.toContain("Elm");
    }
    expect((await s.job(jobId)).coverage).toBe("offered");

    const answer = await s.t.mutation(api.links.acceptOffer, { token });
    expect(answer.status).toBe("accepted");
    await flush(s.t);
    const after = await s.board(jobId);
    expect(after).toMatchObject({ group: "fully_staffed", requiredCrew: 1, acceptedCrew: 1, openPlaces: 0 });
    expect(await s.tasks("done")).toMatchObject([{ outcome: "Lena accepted the visit." }]);

    // The offer page now says accepted and points at the job; the address is shown only on the job page.
    const offerPage = await s.t.query(api.links.offer, { token });
    expect(offerPage).toMatchObject({ state: "accepted", offer: null, jobToken: answer.jobToken });
    const jobPage = await s.t.query(api.links.job, { token: answer.jobToken! });
    expect(jobPage.detail?.address).toMatchObject({ line1: "12 Elm St" });
    // A confirmation with the job link was texted too.
    expect(linkFor(PHONES.Lena, "job")).toBe(answer.jobToken);
  });

  it("keeps a two-cleaner job partially staffed until both places are accepted", async () => {
    const s = await setup();
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place, {});
    await s.t.run(async (ctx) => ctx.db.patch(jobId, { requiredCrew: 2 }));
    await s.t.mutation(internal.dispatch.cover, { jobId });
    await flush(s.t);

    // One offer per open place: Lena as lead, Rosa as support.
    let row = await s.board(jobId);
    expect(row).toMatchObject({ requiredCrew: 2, acceptedCrew: 0, offersOut: 2, group: "offers_out" });
    expect(row.offers.map((offer) => [offer.name, offer.role])).toEqual([["Lena", "lead"], ["Rosa", "support"]]);

    await s.t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Lena, "offer") });
    await flush(s.t);
    row = await s.board(jobId);
    // One acceptance is not coverage. Required and accepted are reported separately.
    expect(row).toMatchObject({ requiredCrew: 2, acceptedCrew: 1, openPlaces: 1, group: "offers_out" });
    expect((await s.job(jobId)).coverage).not.toBe("covered");
    expect(await refusal(s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId }))).toBe("Not every place on this job has an accepted cleaner yet, so it cannot start.");
    expect(await s.tasks("done")).toEqual([]);
    // Rosa's offer is still open: one cleaner accepting does not withdraw the other place's offer.
    expect((await s.t.query(api.links.offer, { token: linkFor(PHONES.Rosa, "offer") })).state).toBe("open");

    // Rosa declines. The job is partially staffed, plainly, and nobody else can be asked.
    await s.t.mutation(api.links.declineOffer, { token: linkFor(PHONES.Rosa, "offer") });
    row = await s.board(jobId);
    expect(row).toMatchObject({ acceptedCrew: 1, openPlaces: 1, offersOut: 0, group: "partially_staffed" });
    const [stuck] = await s.tasks("needs_decision");
    expect(stuck.openQuestion).toContain("1 of 2 places are accepted.");

    // A third cleaner joins and takes the second place. Only now is the job fully staffed.
    const mia = await dispatchCleaner(s.as, s.companyId, "Mia");
    await s.as.mutation(api.cleaners.update, { companyId: s.companyId, cleanerId: mia, phone: PHONES.Mia });
    await s.t.mutation(internal.dispatch.cover, { jobId });
    await flush(s.t);
    await s.t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Mia, "offer") });
    row = await s.board(jobId);
    expect(row).toMatchObject({ acceptedCrew: 2, openPlaces: 0, group: "fully_staffed", hasLead: true });
    expect(row.crew.map((member) => [member.name, member.role])).toEqual([["Lena", "lead"], ["Mia", "support"]]);
    expect((await s.tasks("done"))[0].outcome).toBe("All 2 places are accepted: Lena, Mia.");
  });

  it("lets only one of two simultaneous acceptances take the last place", async () => {
    const s = await setup(["Lena", "Rosa", "Mia"]);
    await s.autonomous();
    await s.allow("dispatch.broadcast_offer");
    await s.as.mutation(api.dispatchOps.setPolicy, { companyId: s.companyId, policy: { broadcastEnabled: true, broadcastSize: 3 } });
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    // Broadcast is on, so three cleaners hold an offer for the one place.
    expect((await s.board(jobId)).offersOut).toBe(3);
    const tokens = (["Lena", "Rosa", "Mia"] as const).map((name) => linkFor(PHONES[name], "offer"));

    // All three answer at once. Each acceptance is its own transaction that reads the job's places again,
    // so the second and third see the first: their offers were withdrawn and their links closed with it.
    const settled = await Promise.allSettled(tokens.map((token) => s.t.mutation(api.links.acceptOffer, { token })));
    const answers = settled.map((entry) => (entry.status === "fulfilled" ? entry.value : { status: "refused" as const }));
    expect(answers.map((answer) => answer.status).sort()).toEqual(["accepted", "refused", "refused"]);
    const after = await s.job(jobId);
    expect(after.assignments.filter((row) => row.status === "accepted")).toHaveLength(1);
    expect(after.staffing).toMatchObject({ required: 1, accepted: 1, open: 0 });
    // The others are told plainly, and trying again changes nothing.
    const loser = tokens[answers.findIndex((answer) => answer.status !== "accepted")];
    expect((await s.t.query(api.links.offer, { token: loser })).state).toBe("filled");
    expect(await refusal(s.t.mutation(api.links.acceptOffer, { token: loser }))).toBe("This link is no longer active.");
    expect((await s.job(jobId)).assignments.filter((row) => row.status === "accepted")).toHaveLength(1);
  });

  it("refuses an acceptance that conflicts with work the cleaner already accepted", async () => {
    const s = await setup(["Lena"]);
    await s.autonomous();
    const first = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    // Dispatch will not even offer Lena an overlapping job while she holds this one.
    const second = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START + HOUR, endsAt: JOB_END + HOUR });
    await flush(s.t);
    expect((await s.job(second)).assignments).toEqual([]);
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId: second })).excluded).toMatchObject([{ name: "Lena", code: "already_booked" }]);

    // Suppose two overlapping offers exist anyway. Accepting one makes the other impossible to accept.
    const forced = await s.t.run(async (ctx) =>
      ctx.db.insert("assignments", { companyId: s.companyId, jobId: second, cleanerId: s.cleaners.Lena, status: "offered", scope: "x", payCents: 8000, offeredAt: NOW, respondBy: NOW + HOUR, jobStartsAt: JOB_START + HOUR }),
    );
    await s.t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Lena, "offer") });
    expect(await refusal(s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: forced, answer: "accepted" }))).toBe("This cleaner has already accepted another job at that time.");
    expect((await s.job(first)).coverage).toBe("covered");
    expect((await s.job(second)).coverage).not.toBe("covered");
  });

  it("stops an expired or revoked link from doing anything, and keeps job access apart from the offer's deadline", async () => {
    const s = await setup();
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    const lenaOffer = linkFor(PHONES.Lena, "offer");
    const respondBy = (await s.job(jobId)).assignments[0].respondBy;

    // Past the deadline the link does nothing, before any schedule has run.
    vi.setSystemTime(respondBy + 1);
    expect((await s.t.query(api.links.offer, { token: lenaOffer })).state).toBe("expired");
    expect(await refusal(s.t.mutation(api.links.acceptOffer, { token: lenaOffer }))).toBe("This link has expired.");
    expect((await s.job(jobId)).assignments[0].status).toBe("offered");
    await s.t.mutation(internal.assignments.expireDue, {});
    await flush(s.t);

    // Rosa is asked next and accepts. Her job link outlives the offer's deadline by design.
    const rosaOffer = linkFor(PHONES.Rosa, "offer");
    const { jobToken } = await s.t.mutation(api.links.acceptOffer, { token: rosaOffer });
    vi.setSystemTime(JOB_START - 10 * MINUTE);
    expect((await s.t.query(api.links.job, { token: jobToken! })).state).toBe("active");
    // The spent offer link cannot be used to accept again or to decline after the fact.
    expect(await refusal(s.t.mutation(api.links.declineOffer, { token: rosaOffer }))).toBe("This link is no longer active.");

    // A manager revokes the job link. It shows nothing and does nothing from then on.
    const links = (await s.record(jobId)).links;
    const live = links.find((link) => link.purpose === "job" && link.status === "active")!;
    await s.as.mutation(api.dispatchOps.revokeActionLink, { companyId: s.companyId, linkId: live.linkId, reason: "Phone lost" });
    const page = await s.t.query(api.links.job, { token: jobToken! });
    expect(page).toMatchObject({ state: "ended", detail: null });
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: jobToken! }))).toBe("This link is no longer active.");

    // A made-up token, a tampered one and an offer token on the job page all get the same nothing.
    for (const bad of ["nope", `${jobToken!.split(".")[0]}.AAAA`, `x${jobToken}`]) expect(await refusal(s.t.query(api.links.job, { token: bad }))).toBe("Not found.");
    expect(await refusal(s.t.query(api.links.job, { token: rosaOffer }))).toBe("Not found.");
  });

  it("moves on or asks first after a decline, as the owner's permission says", async () => {
    const s = await setup();
    await s.allow("dispatch.request_acceptance");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    // Asking the next cleaner is on Propose: the decline produces a proposal, not a second text.
    await s.t.mutation(api.links.declineOffer, { token: linkFor(PHONES.Lena, "offer") });
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.to === PHONES.Rosa)).toEqual([]);
    const [proposal] = await s.as.query(api.approvals.list, { companyId: s.companyId });
    expect(proposal).toMatchObject({ action: "dispatch.send_replacement_offer", proposal: { cleanerId: s.cleaners.Rosa } });
    expect((await s.board(jobId)).group).toBe("awaiting_approval");

    // Once the owner allows it, the same decline goes straight to the next cleaner.
    await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: proposal._id, decision: "approved" });
    await flush(s.t);
    await s.allow("dispatch.send_replacement_offer");
    await s.t.mutation(api.links.declineOffer, { token: linkFor(PHONES.Rosa, "offer") });
    // Nobody is left, so it is escalated with the reasons, not left looking handled.
    const [task] = await s.tasks("needs_decision");
    expect(task.openQuestion).toBe("No cleaner can be asked to take this visit. Lena already declined this visit; Rosa already declined this visit. Decide how to cover it.");
    expect((await s.board(jobId)).group).toBe("needs_staffing");
  });

  it("does not count a failed delivery as the cleaner's silence", async () => {
    // Lena's number cannot receive texts.
    const s = await setup(["Lena", "Rosa"], { Lena: "+15550100001" });
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);

    const after = await s.job(jobId);
    const lena = after.assignments.find((row) => row.cleanerId === s.cleaners.Lena)!;
    // Not "expired": she never saw it. The offer is ended as undelivered and her link is closed.
    expect(lena).toMatchObject({ status: "cancelled", endCause: "undelivered" });
    const record = await s.record(jobId);
    expect(record.messages.find((row) => row.assignmentId === lena._id)).toMatchObject({ status: "failed", problem: "The carrier says this number cannot receive texts.", deliveredAt: null });
    expect(record.links.find((link) => link.assignmentId === lena._id)).toMatchObject({ status: "revoked", opened: null });
    // Someone is told to check how to reach her, and Dispatch has already asked Rosa.
    const handoffs = await s.tasks("needs_decision");
    expect(handoffs).toMatchObject([{ handoffTo: "team_coordinator", title: "Check how to reach Lena: a text did not go through" }]);
    expect(after.assignments.find((row) => row.cleanerId === s.cleaners.Rosa)).toMatchObject({ status: "offered" });
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).excluded).toMatchObject([{ name: "Lena", reason: "could not be reached: the offer message for this visit was not delivered" }]);
  });

  it("retries a text the carrier dropped without sending it twice, and never resends one whose fate is unknown", async () => {
    const s = await setup(["Lena", "Rosa"], { Lena: "+15550100002", Rosa: "+15550100003" });
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    await flush(s.t);
    // Lena's carrier fails twice and then takes it: three attempts, one accepted text.
    vi.advanceTimersByTime(30_000);
    await flush(s.t);
    vi.advanceTimersByTime(60_000);
    await flush(s.t);
    const toLena = mockOutbox.filter((row) => row.to === "+15550100002");
    expect(toLena.map((row) => row.result)).toEqual(["failed", "failed", "accepted"]);
    expect((await s.record(jobId)).messages[0]).toMatchObject({ status: "delivered" });

    // A delivery report that arrives twice changes nothing the second time.
    const receipt = { provider: "mock", eventId: "evt-1", providerMessageId: "does-not-matter", outcome: "delivered" as const };
    expect(await s.t.mutation(internal.messaging.receipt, receipt)).toBe("ignored");
    expect(await s.t.mutation(internal.messaging.receipt, receipt)).toBe("duplicate");

    // Lena declines; Rosa's send dies with no answer. Nobody knows if it went, so it is not sent again.
    await s.t.mutation(api.links.declineOffer, { token: linkFor("+15550100002", "offer") });
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.to === "+15550100003")).toHaveLength(1);
    vi.advanceTimersByTime(6 * MINUTE);
    expect(await s.t.mutation(internal.messaging.sweepStuck, {})).toBe(1);
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.to === "+15550100003")).toHaveLength(1);
    const rosa = (await s.job(jobId)).assignments.find((row) => row.cleanerId === s.cleaners.Rosa)!;
    expect(rosa).toMatchObject({ status: "cancelled", endCause: "undelivered" });
    expect((await s.record(jobId)).messages.find((row) => row.assignmentId === rosa._id)).toMatchObject({ status: "unconfirmed" });
  });

  it("runs the same workflow step and the same tool call twice without a second offer or text", async () => {
    const s = await setup();
    await s.autonomous();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    for (let i = 0; i < 3; i += 1) await s.t.mutation(internal.dispatch.cover, { jobId });
    await flush(s.t);
    expect((await s.job(jobId)).assignments).toHaveLength(1);
    expect(mockOutbox).toHaveLength(1);

    await s.t.mutation(api.links.declineOffer, { token: linkFor(PHONES.Lena, "offer") });
    await flush(s.t);
    await s.t.mutation(api.links.declineOffer, { token: linkFor(PHONES.Rosa, "offer") });
    const mia = await dispatchCleaner(s.as, s.companyId, "Mia");
    await s.as.mutation(api.cleaners.update, { companyId: s.companyId, cleanerId: mia, phone: PHONES.Mia });

    // The agent's tool, called twice with the same key, is carried out once and answers the same.
    const call = { companyId: s.companyId, tool: "send_job_offers" as const, input: { jobId, cleanerId: mia }, idempotencyKey: "step-7" };
    const one = await s.t.mutation(internal.dispatchTools.run, call);
    const two = await s.t.mutation(internal.dispatchTools.run, call);
    await flush(s.t);
    expect(one).toMatchObject({ outcome: "done", authorization: "dispatch.send_replacement_offer at execute", repeated: false });
    expect(two).toMatchObject({ outcome: "done", repeated: true, result: one.result });
    expect((await s.job(jobId)).assignments.filter((row) => row.cleanerId === mia)).toHaveLength(1);
    expect(mockOutbox.filter((row) => row.to === PHONES.Mia)).toHaveLength(1);
    // The record of the run says what allowed it, what went in and what came of it.
    expect(await s.as.query(api.dispatchTools.forJob, { companyId: s.companyId, jobId })).toMatchObject([{ tool: "send_job_offers", authorization: "dispatch.send_replacement_offer at execute", outcome: "done" }]);
  });

  it("does not let a tool offer a job to a cleaner who fails a hard requirement", async () => {
    const s = await setup(["Lena"]);
    await s.autonomous();
    const far = await dispatchCleaner(s.as, s.companyId, "Zed", { areas: ["90210"] });
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const answer = await s.t.mutation(internal.dispatchTools.run, { companyId: s.companyId, tool: "send_job_offers", input: { jobId, cleanerId: far }, idempotencyKey: "k1" });
    expect(answer).toMatchObject({ outcome: "refused", result: { why: "Zed does not work in 78701. A hard requirement cannot be set aside by Dispatch." } });
    expect((await s.job(jobId)).assignments.filter((row) => row.cleanerId === far)).toEqual([]);
    // A tool that changes things is refused while Dispatch is paused; one that only reads still answers.
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["dispatch"] });
    expect(await s.t.mutation(internal.dispatchTools.run, { companyId: s.companyId, tool: "send_job_offers", input: { jobId }, idempotencyKey: "k2" })).toMatchObject({ outcome: "refused", authorization: "dispatch.request_acceptance: Dispatch is paused" });
    expect(await s.t.mutation(internal.dispatchTools.run, { companyId: s.companyId, tool: "find_eligible_cleaners", input: { jobId }, idempotencyKey: "k3" })).toMatchObject({ outcome: "done", authorization: "read" });
  });

  it("keeps one company's records and links out of another's reach", async () => {
    const s = await setup();
    const a = await accepted(s);
    const { as: other, companyId: otherCompany } = await company(s.t, "owner-b", "Beta Cleaning");
    // Another company's owner cannot read the job, its links, its texts or its tool runs, or act on its link.
    expect(await refusal(other.query(api.dispatchViews.jobRecord, { companyId: otherCompany, jobId: a.jobId }))).toBe("Not found.");
    expect(await refusal(other.query(api.dispatchViews.jobRecord, { companyId: s.companyId, jobId: a.jobId }))).toBe("Not found.");
    expect(await other.query(api.dispatchViews.actionLinks, { companyId: otherCompany })).toEqual([]);
    const link = (await s.record(a.jobId)).links[0];
    expect(await refusal(other.mutation(api.dispatchOps.revokeActionLink, { companyId: otherCompany, linkId: link.linkId, reason: "x" }))).toBe("Not found.");
    expect(await refusal(other.mutation(api.dispatchOps.reissueLink, { companyId: otherCompany, assignmentId: a.assignmentId }))).toBe("Not found.");
    expect(await s.t.mutation(internal.dispatchTools.run, { companyId: otherCompany, tool: "inspect_job", input: { jobId: a.jobId }, idempotencyKey: "x" })).toMatchObject({ outcome: "refused" });

    // A cleaner's link reaches its own job only: an item on another company's job is not found through it.
    const otherPlace = await dispatchPlace(other, otherCompany);
    const otherJob = await dispatchJob(other, otherCompany, otherPlace);
    await other.mutation(api.dispatchOps.setChecklist, { companyId: otherCompany, jobId: otherJob, items: [{ label: "Kitchen" }] });
    const foreign = await s.t.run(async (ctx) => (await ctx.db.query("checklistItems").collect()).find((item) => item.companyId === otherCompany)!);
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    expect(await refusal(s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: foreign._id, state: "done" }))).toBe("Not found.");
    // With no secret on the deployment, no link opens at all.
    delete process.env.ACTION_LINK_SECRET;
    expect(await refusal(s.t.query(api.links.job, { token: a.jobToken }))).toBe("Not found.");
  });
});

