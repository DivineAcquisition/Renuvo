/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accepted, dispatchTestEnv, flush, linkFor, PHONES, setup } from "../tests/dispatchHarness";
import { dispatchJob, HOUR, JOB_END, JOB_START, NOW, refusal } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockOutbox } from "./lib/messaging/provider";

const MINUTE = 60 * 1000;

async function photo(s: Awaited<ReturnType<typeof setup>>, token: string, kind: "before" | "after" | "item", clientKey: string, itemId?: Id<"checklistItems">) {
  // The phone asks for an upload address, uploads, then records the photo. The upload itself is stood in for here.
  expect(typeof (await s.t.mutation(api.links.photoUploadUrl, { token }))).toBe("string");
  const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["jpeg-bytes"], { type: "image/jpeg" })));
  return s.t.mutation(api.links.attachPhoto, { token, storageId, kind, clientKey, itemId });
}

describe("Dispatch: the day of service", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("goes from the offer text to the owner's review queue, and approves or pays nothing on the way", async () => {
    const s = await setup();
    await s.as.mutation(api.dispatchOps.setPolicy, { companyId: s.companyId, policy: { beforePhotosRequired: 1, afterPhotosRequired: 1, sendBeforePhotoLink: true, reminderLeadMinutes: 60 } });
    const a = await accepted(s);
    await s.as.mutation(api.dispatchOps.setChecklist, { companyId: s.companyId, jobId: a.jobId, items: [{ label: "Kitchen counters", section: "Kitchen" }, { label: "Oven", section: "Kitchen", requiresPhoto: true }, { label: "Balcony" }] });

    // Offer text → offer page → acceptance → the job page, with the address only now.
    let page = (await s.t.query(api.links.job, { token: a.jobToken })).detail!;
    expect(page).toMatchObject({ when: "Tue, Mar 2 at 10:00 AM", address: { line1: "12 Elm St", city: "Austin" }, role: "Solo job", estimatedPay: "$80.00", checkedInAt: null });
    expect(page.beforeSubmit[0]).toBe("Check in first.");

    // The reminder goes out an hour before. It says when the job is; it does not say she is on her way.
    vi.setSystemTime(JOB_START - 59 * MINUTE);
    await s.t.mutation(internal.dispatchOps.watch, { jobId: a.jobId });
    await s.t.mutation(internal.dispatchOps.watch, { jobId: a.jobId });
    await flush(s.t);
    const reminders = mockOutbox.filter((row) => row.body.includes("reminder"));
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toBe(`Alpha Cleaning reminder: your job is Tue, Mar 2 at 10:00 AM. Open it to check in when you arrive, or to tell us if you're running late: https://selestial.io/c/job/${a.jobToken}`);
    expect(reminders[0].body).not.toMatch(/on (the|her|your) way|arriving|en route/i);

    // Nothing on the checklist or photos before check-in.
    expect(await refusal(s.t.mutation(api.links.photoUploadUrl, { token: a.jobToken }))).toBe("Check in before you add photos.");

    // Check-in, with the phone's position. Checking in again changes nothing and sends nothing again.
    vi.setSystemTime(JOB_START + 2 * MINUTE);
    expect(await s.t.mutation(api.links.checkInJob, { token: a.jobToken, lat: 30.27, lng: -97.74, accuracyM: 12 })).toMatchObject({ status: "checked_in" });
    await flush(s.t);
    expect(await s.t.mutation(api.links.checkInJob, { token: a.jobToken })).toMatchObject({ status: "already_checked_in", at: JOB_START + 2 * MINUTE });
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.body.includes("before photos"))).toHaveLength(1);
    expect(linkFor(PHONES.Lena, "job", "/photos")).toBe(a.jobToken);
    let row = await s.board(a.jobId);
    expect(row).toMatchObject({ status: "in_progress", group: "in_progress" });
    expect(row.crew[0]).toMatchObject({ checkedInAt: JOB_START + 2 * MINUTE, checkInHasPosition: true });
    expect((await s.t.run(async (ctx) => ctx.db.get(a.assignmentId)))?.checkIn).toMatchObject({ lat: 30.27, lng: -97.74, accuracyM: 12 });

    // Before photos. A retried upload of the same photo is kept once.
    expect(await photo(s, a.jobToken, "before", "before-photo-0001")).toMatchObject({ duplicate: false });
    expect(await photo(s, a.jobToken, "before", "before-photo-0001")).toMatchObject({ duplicate: true });

    // The checklist: done, skipped with a reason, and an item that needs its photo first.
    page = (await s.t.query(api.links.job, { token: a.jobToken })).detail!;
    expect(page.photos.before).toHaveLength(1);
    const [counters, oven, balcony] = page.checklist;
    await s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: counters.id, state: "done" });
    expect(await refusal(s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: balcony.id, state: "skipped" }))).toBe("Say why this item is skipped.");
    await s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: balcony.id, state: "skipped", skipReason: "Balcony door is locked" });
    expect(await refusal(s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: oven.id, state: "done" }))).toBe("Add the photo for this item first.");

    // An add-on request is a request. It waits for a person and charges nobody.
    const asked = await s.t.mutation(api.links.report, { token: a.jobToken, kind: "addon_request", text: "Customer asked for inside the fridge too" });
    expect(asked.status).toBe("awaiting_decision");
    expect((await s.as.query(api.jobs.get, { companyId: s.companyId, jobId: a.jobId })).job.priceCents).toBe(16000);
    const care = (await s.tasks("needs_decision")).find((task) => task.handoffTo === "customer_care")!;
    expect(care.openQuestion).toContain("Approving this request does not charge anyone");
    await s.as.mutation(api.dispatchOps.decideReport, { companyId: s.companyId, reportId: asked.reportId, decision: "declined", note: "Not today" });
    expect((await s.t.query(api.links.job, { token: a.jobToken })).detail!.reports).toMatchObject([{ kind: "addon_request", status: "declined", decisionNote: "Not today" }]);

    // Submitting too early says exactly what is missing.
    expect(await refusal(s.t.mutation(api.links.submitJob, { token: a.jobToken, incomplete: false }))).toBe(
      "Not ready to submit. 1 checklist item is not done or skipped. 1 more after photo needed. If something cannot be finished, submit it as incomplete and say why.",
    );
    await photo(s, a.jobToken, "item", "oven-photo-000001", oven.id);
    await s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: oven.id, state: "done" });
    await photo(s, a.jobToken, "after", "after-photo-00001");

    // Completion: "submitted for review", and a second tap is the same submission.
    vi.setSystemTime(JOB_END - 5 * MINUTE);
    const done = await s.t.mutation(api.links.submitJob, { token: a.jobToken, incomplete: false });
    expect(done).toMatchObject({ status: "submitted_for_review", waitingOnCrew: 0 });
    expect(await s.t.mutation(api.links.submitJob, { token: a.jobToken, incomplete: false })).toMatchObject({ status: "already_submitted", submittedAt: done.submittedAt });
    expect((await s.t.query(api.links.job, { token: a.jobToken })).state).toBe("submitted");

    // The owner's side: the visit is in the review queue. It is not completed, not approved, not paid.
    row = await s.board(a.jobId);
    expect(row).toMatchObject({ status: "in_progress", group: "awaiting_completion_review", completionReportedAt: done.submittedAt });
    const reviews = (await s.tasks("needs_decision")).filter((task) => task.handoffTo === "quality");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ title: "Review the completed visit for Dana Whitfield on Tue, Mar 2, 10:00 AM", completionCondition: "A person reviewed the evidence and closed the visit or arranged corrective work" });
    expect(reviews[0].openQuestion).toBe("The crew reported this visit complete. Checklist: 2 done, 1 skipped, of 3. Photos: 1 before, 1 after. Review it, then close the visit or send it back. Nothing has been approved or paid.");
    expect((await s.as.query(api.jobs.get, { companyId: s.companyId, jobId: a.jobId })).job.status).toBe("in_progress");
    const types = (await s.as.query(api.events.recent, { companyId: s.companyId, limit: 400 })).map((event) => event.type);
    expect(types).toContain("assignment.completion_submitted");
    expect(types.filter((type) => /payout|payment|charge|refund|job\.completed/.test(type))).toEqual([]);

    // The job record shows each text and each link with what is actually known about it.
    const record = await s.record(a.jobId);
    expect(record.messages.map((message) => [message.purpose, message.status])).toEqual([["offer", "delivered"], ["assignment_confirmed", "delivered"], ["reminder", "delivered"], ["before_photos", "delivered"]]);
    expect(record.messages.every((message) => !message.body.includes(a.jobToken) && !message.body.includes(a.offerToken))).toBe(true);
    const jobLink = record.links.find((link) => link.purpose === "job")!;
    expect(jobLink).toMatchObject({ status: "active", recipient: { name: "Lena" }, lastAction: "complete", opened: null, nextAction: "Submitted for review. Quality reviews the visit." });
    expect(record.links.find((link) => link.purpose === "offer")).toMatchObject({ status: "revoked", lastAction: "accept" });
    // No token is written to the event log either.
    const everything = JSON.stringify(await s.t.run(async (ctx) => ({ events: await ctx.db.query("events").collect(), links: await ctx.db.query("actionLinks").collect(), messages: await ctx.db.query("messages").collect() })));
    expect(everything.includes(a.jobToken) || everything.includes(a.offerToken) || everything.includes(a.jobToken.split(".")[1])).toBe(false);
  });

  it("reassigns after a cleaner drops: the place reopens, the old link dies, the replacement gets the whole job", async () => {
    const s = await setup();
    const a = await accepted(s, {});
    await s.t.run(async (ctx) => ctx.db.patch(a.jobId, { instructions: "Gate code is with the concierge" }));
    await s.as.mutation(api.dispatchOps.setChecklist, { companyId: s.companyId, jobId: a.jobId, items: [{ label: "Kitchen" }] });
    expect((await s.t.query(api.links.job, { token: a.jobToken })).detail?.accessInstructions).toBeNull();

    // Lena says she cannot come, with a reason. No reason, no drop.
    expect(await refusal(s.t.mutation(api.links.cannotAttendJob, { token: a.jobToken, reason: " " }))).toBe("Say briefly what happened.");
    await s.t.mutation(api.links.cannotAttendJob, { token: a.jobToken, reason: "Car broke down" });
    await flush(s.t);

    // Her link shows nothing and does nothing from that moment.
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
    expect(await refusal(s.t.mutation(api.links.checkInJob, { token: a.jobToken }))).toBe("This link is no longer active.");

    // The place is open again, a coverage request says why, and Rosa has a backup offer with a shorter window.
    let row = await s.board(a.jobId);
    expect(row).toMatchObject({ acceptedCrew: 0, openPlaces: 1, offersOut: 1, group: "offers_out" });
    expect(row.coverage).toMatchObject([{ cause: "drop", status: "open" }]);
    expect(row.offers).toMatchObject([{ name: "Rosa", kind: "backup" }]);
    // A backup offer has its own, shorter window: 20 minutes here, against 120 for a first offer.
    expect(Math.round((row.offers[0].respondBy - NOW) / MINUTE)).toBe(20);
    const backupText = mockOutbox.filter((entry) => entry.to === PHONES.Rosa)[0].body;
    expect(backupText).toContain("Alpha Cleaning: cover needed.");
    expect(backupText).not.toContain("Elm");

    // Rosa accepts. She gets the complete job: address, instructions and the same checklist.
    const rosa = await s.t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Rosa, "offer") });
    const page = (await s.t.query(api.links.job, { token: rosa.jobToken! })).detail!;
    expect(page).toMatchObject({ address: { line1: "12 Elm St" }, instructions: "Gate code is with the concierge", scope: "3 bed, 2 bath standard clean" });
    expect(page.checklist).toMatchObject([{ label: "Kitchen", state: "pending" }]);
    row = await s.board(a.jobId);
    expect(row).toMatchObject({ group: "fully_staffed", coverage: [] });
    expect(row.ended).toMatchObject([{ name: "Lena", status: "cancelled", cause: "dropped" }]);
    const requests = (await s.as.query(api.dispatchViews.offersAndCoverage, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END })).coverage;
    expect(requests).toMatchObject([{ cause: "drop", status: "filled", detail: "Car broke down" }]);
    // Lena's link is still dead after the replacement.
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
  });

  it("marks coverage unresolved, with what was tried and by when to decide, when nobody can cover", async () => {
    const s = await setup(["Lena"]);
    const a = await accepted(s);
    await s.t.mutation(api.links.cannotAttendJob, { token: a.jobToken, reason: "Sick" });
    const row = await s.board(a.jobId);
    expect(row.group).toBe("needs_staffing");
    expect(row.coverage).toMatchObject([{ cause: "drop", status: "unresolved" }]);
    expect(row.coverage[0].summary).toBe(
      "No other cleaner could be asked. Lena said they cannot attend this visit. What is left: offer it yourself to a cleaner Dispatch may not ask, move the visit, or ask Recruiter for an urgent hire. Decide by Tue, Mar 2, 10:00 AM.",
    );
    const [task] = await s.tasks("needs_decision");
    expect(task.openQuestion).toContain("Cover could not be found for this visit.");
    // Recruiter is asked for an urgent hire, once, however often Dispatch looks again.
    await s.t.mutation(internal.dispatch.cover, { jobId: a.jobId });
    const urgent = await s.tasks("open", "recruiter");
    expect(urgent.filter((entry) => entry.title.startsWith("Urgent hire"))).toHaveLength(1);
    expect(urgent.find((entry) => entry.title.startsWith("Urgent hire"))).toMatchObject({ handoffTo: "recruiter", trigger: "A cleaner left this visit and no ready cleaner could cover it." });
  });

  it("tells a communicated delay from silence, and finds the later job it puts at risk", async () => {
    const s = await setup(["Lena"]);
    const a = await accepted(s);
    // Lena also holds a later job the same day, 12:30 to 14:30.
    const later = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_END + 30 * MINUTE, endsAt: JOB_END + 150 * MINUTE });
    await flush(s.t);
    await s.t.mutation(api.links.acceptOffer, { token: linkFor(PHONES.Lena, "offer") });

    // Ten minutes after the start she reports a 45-minute delay through her link.
    vi.setSystemTime(JOB_START + 10 * MINUTE);
    const said = await s.t.mutation(api.links.reportDelayJob, { token: a.jobToken, etaMinutes: 45, reason: "Traffic" });
    expect(said.etaWords).toBe("Tue, Mar 2, 10:55 AM");
    const live = (await s.as.query(api.dispatchViews.liveJobs, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END + 3 * HOUR })).jobs;
    const first = live.find((row) => row.jobId === a.jobId)!;
    // Late with an ETA is its own state. It is not "not checked in" and not a no-show.
    expect(first.crew[0]).toMatchObject({ arrival: "late_with_eta", late: { etaAt: JOB_START + 55 * MINUTE, reason: "Traffic" }, contactStage: null });
    // Arriving 10:55 with two hours of work and 30 minutes between jobs, she cannot make 12:30.
    expect(first.crew[0].affectedLaterJobs).toEqual([{ jobId: later, assignmentId: expect.anything(), startsAt: JOB_END + 30 * MINUTE, shortByMinutes: 55 }]);
    const decisions = await s.tasks("needs_decision");
    expect(decisions.find((task) => task.title.startsWith("Later visits affected"))?.openQuestion).toBe(
      "Lena reported a delay. Lena will not reach the 12:30 PM visit (about 55 minutes short) on time. For each: find cover, move it, or tell the customer and keep it. Dispatch has changed nothing.",
    );
    // A customer update is drafted for a person. Dispatch sent the customer nothing.
    expect(decisions.find((task) => task.handoffTo === "customer_care")?.openQuestion).toContain("Your cleaner is running behind and expects to arrive around 10:55 AM.");
    expect(mockOutbox.every((row) => Object.values(PHONES).includes(row.to as (typeof PHONES)["Lena"]))).toBe(true);

    // The watch leaves her alone while her ETA stands: no "are you coming" text, no alert.
    vi.setSystemTime(JOB_START + 40 * MINUTE);
    await s.t.mutation(internal.dispatchOps.watch, { jobId: a.jobId });
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.body.includes("check-in for your"))).toEqual([]);
    expect((await s.job(later)).assignments[0].status).toBe("accepted");
  });

  it("does not call a missing check-in a no-show until the cleaner was asked, the operator alerted and the wait is over", async () => {
    const s = await setup();
    const a = await accepted(s);
    const watch = async (minutesAfterStart: number) => {
      vi.setSystemTime(JOB_START + minutesAfterStart * MINUTE);
      await s.t.mutation(internal.dispatchOps.watch, { jobId: a.jobId });
      await flush(s.t);
      const jobs = (await s.as.query(api.dispatchViews.liveJobs, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END })).jobs;
      return jobs.find((row) => row.jobId === a.jobId)!;
    };
    expect((await watch(5)).crew[0].arrival).toBe("not_checked_in");
    expect(mockOutbox.filter((row) => row.body.includes("we don't have a check-in"))).toEqual([]);

    // +10: the cleaner is asked, by text, with a link to answer.
    expect((await watch(11)).crew[0].arrival).toBe("cleaner_asked");
    const nudge = mockOutbox.filter((row) => row.body.includes("we don't have a check-in"));
    expect(nudge).toHaveLength(1);
    expect(linkFor(PHONES.Lena, "job", "/delay")).toBe(a.jobToken);

    // +20: the operator is alerted. It says what is known, and that this is not yet a no-show.
    expect((await watch(21)).crew[0].arrival).toBe("operator_alerted");
    let alert = (await s.tasks("needs_decision")).find((task) => task.title.startsWith("No check-in"))!;
    expect(alert.openQuestion).toBe(
      "Lena has not checked in for Dana Whitfield's visit due Tue, Mar 2 at 10:00 AM. The text asking them was delivered. Call Lena. The customer has been waiting since 10:00 AM. This is not yet a no-show.",
    );
    // A manager cannot be told the steps are complete when they are not, but may still confirm; the record says so.
    // +40: the conditions are met. Declaring it is on Propose, so a person confirms. Still accepted until then.
    const row = await watch(41);
    expect(row.crew[0].arrival).toBe("no_show_suspected");
    expect(row.acceptedCrew).toBe(1);
    alert = (await s.tasks("needs_decision")).find((task) => task.title.startsWith("No check-in"))!;
    expect(alert.openQuestion).toContain("Confirm the no-show to start cover, or record that they are coming.");
    expect(mockOutbox.filter((entry) => entry.body.includes("we don't have a check-in"))).toHaveLength(1);

    const confirmed = await s.as.mutation(api.dispatchOps.confirmNoShow, { companyId: s.companyId, assignmentId: a.assignmentId });
    expect(confirmed.stepsComplete).toBe(true);
    await flush(s.t);
    const after = await s.board(a.jobId);
    expect(after.ended).toMatchObject([{ name: "Lena", cause: "no_show" }]);
    expect(after.coverage).toMatchObject([{ cause: "no_show" }]);
    // Her access is withdrawn and cover has started with Rosa.
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
    expect(mockOutbox.filter((entry) => entry.to === PHONES.Rosa && entry.body.includes("cover needed"))).toHaveLength(1);
    // No consequence for the cleaner is recorded anywhere: she is still ready for work.
    expect((await s.as.query(api.cleaners.get, { companyId: s.companyId, cleanerId: s.cleaners.Lena })).status).toBe("ready");
  });

  it("stops new autonomous actions when Dispatch is paused, and nothing else", async () => {
    const s = await setup();
    const a = await accepted(s);
    await s.as.mutation(api.dispatchOps.setChecklist, { companyId: s.companyId, jobId: a.jobId, items: [{ label: "Kitchen" }] });
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["dispatch"] });
    const sentBefore = mockOutbox.length;

    // No reminder goes out while paused.
    vi.setSystemTime(JOB_START - 30 * MINUTE);
    await s.t.mutation(internal.dispatchOps.watch, { jobId: a.jobId });
    await flush(s.t);
    expect(mockOutbox).toHaveLength(sentBefore);

    // The owner can still read everything, and the cleaner can still do the whole job through her link.
    expect((await s.board(a.jobId)).group).toBe("fully_staffed");
    expect((await s.as.query(api.dispatchViews.overview, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END })).paused).toBe(true);
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    const [item] = (await s.t.query(api.links.job, { token: a.jobToken })).detail!.checklist;
    await s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: item.id, state: "done" });
    expect(await s.t.mutation(api.links.submitJob, { token: a.jobToken, incomplete: false })).toMatchObject({ status: "submitted_for_review" });
    // The handoff to review still happens: it is a record for a person, not an action on the outside world.
    expect((await s.tasks("needs_decision")).some((task) => task.handoffTo === "quality")).toBe(true);

    // A second job needs a cleaner while paused: Dispatch offers nothing, and says so on the task.
    const next = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START + 24 * HOUR, endsAt: JOB_END + 24 * HOUR });
    await flush(s.t);
    expect((await s.job(next)).assignments).toEqual([]);
    expect((await s.tasks("open")).map((task) => task.nextAction)).toContain("Dispatch is paused. Resume Dispatch, or offer this visit to a cleaner yourself.");
  });

  it("lets a manager issue a fresh link, which closes the old one", async () => {
    const s = await setup();
    const a = await accepted(s);
    const reissued = await s.as.mutation(api.dispatchOps.reissueLink, { companyId: s.companyId, assignmentId: a.assignmentId });
    await flush(s.t);
    expect(reissued.messageStatus).toBe("queued");
    const fresh = linkFor(PHONES.Lena, "job");
    expect(fresh).not.toBe(a.jobToken);
    expect(await s.t.query(api.links.job, { token: a.jobToken })).toMatchObject({ state: "ended", detail: null });
    expect((await s.t.query(api.links.job, { token: fresh })).state).toBe("active");
    // Showing a link's address to a manager is recorded, and an office member cannot ask for it.
    const live = (await s.record(a.jobId)).links.find((link) => link.status === "active" && link.purpose === "job")!;
    expect((await s.as.mutation(api.dispatchOps.revealActionLink, { companyId: s.companyId, linkId: live.linkId })).url).toBe(`https://selestial.io/c/job/${fresh}`);
    expect((await s.as.query(api.events.recent, { companyId: s.companyId, limit: 50 })).map((event) => event.type)).toContain("link.revealed");
  });
});

