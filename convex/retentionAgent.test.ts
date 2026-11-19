/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv } from "../tests/dispatchHarness";
import { careLink, DAY, flush, HOUR, JOB_START, retentionSetup, textsTo, WEEK } from "../tests/retentionHarness";
import { api } from "./_generated/api";

let undo: () => void;
beforeEach(() => {
  undo = dispatchTestEnv();
});
afterEach(() => undo());

const SCOPE = "A full clean of the home.\n- Bathroom: Clean the shower\n- Kitchen: Wipe kitchen counters\nNot included: Inside the oven.";
const CHECKLIST = [
  { label: "Clean the shower", state: "skipped" as const, skipReason: "Ran out of time" },
  { label: "Wipe kitchen counters", state: "done" as const },
];

describe("first-service follow-through and recovery", () => {
  it("takes feedback to a case, a proposed correction, approval, a Dispatch handoff, and the customer's confirmation", async () => {
    const s = await retentionSetup();
    const jobId = await s.completed({ scope: SCOPE, checklist: CHECKLIST });

    // The first verified service opens one follow-through, and the feedback request waits for approval.
    let cases = await s.cases();
    expect(cases.map((c) => [c.kind, c.status])).toEqual([["follow_through", "needs_attention"]]);
    expect(textsTo()).toEqual([]);
    const [ask] = await s.pending();
    expect(ask).toMatchObject({ action: "retention.request_feedback", status: "pending" });
    expect((await s.approve(ask._id))?.ok).toBe(true);
    expect(textsTo().at(-1)).toContain("/c/care/");
    const feedbackToken = careLink();

    // Opening the page changes nothing.
    const page = await s.t.query(api.retentionCare.view, { token: feedbackToken });
    expect(page).toMatchObject({ state: "active", purpose: "feedback", property: { name: "12 Elm St" } });
    expect(await s.feedback()).toEqual([]);

    // A five-star rating with a described issue is still an issue: the rating routes nothing.
    const sent = await s.t.mutation(api.retentionCare.submitFeedback, { token: feedbackToken, rating: 5, issue: { description: "Lovely crew but the shower was not cleaned.", areas: [], wantsDifferentCleaner: false }, clientKey: "abcdefgh1" });
    expect(sent.ok).toBe(true);
    await flush(s.t);
    cases = await s.cases();
    const recovery = cases.find((c) => c.kind === "recovery")!;
    expect(recovery).toMatchObject({ jobId, areas: ["shower"], status: "needs_attention" });
    expect(recovery.diagnosis).toMatchObject({ category: "quality_miss", basis: "fact", reader: "rules" });
    expect(cases.find((c) => c.kind === "follow_through")).toMatchObject({ status: "closed" });

    // The correction is proposed, with an estimated cost, and nothing is booked before approval.
    const detail = await s.detail(recovery._id);
    const visit = detail.actions.find((a) => a.kind === "correction_visit")!;
    expect(visit).toMatchObject({ status: "awaiting_approval", estimatedCostCents: 3000 });
    expect(visit.visit?.payBasisCents).toBe(6000);
    expect(detail.timeline.some((e) => e.basis === "fact" && e.text.includes("skipped"))).toBe(true);
    expect(detail.timeline.some((e) => e.basis === "customer_stated" && e.quote?.includes("shower"))).toBe(true);
    const [proposal] = await s.pending();
    expect((await s.approve(proposal._id))?.ok).toBe(true);

    // Approved: a visit exists for Dispatch, at no charge, and the case is open and under way.
    const after = await s.detail(recovery._id);
    const booked = after.actions.find((a) => a.kind === "correction_visit")!;
    expect(booked).toMatchObject({ status: "underway", handoff: { to: "dispatch", status: "open" } });
    expect(after.card.status).toBe("action_underway");
    const correctionId = booked.visit!.jobId!;
    const correction = await s.job(correctionId);
    expect(correction.job).toMatchObject({ serviceType: "Correction visit", status: "scheduled", priceCents: 6000 });

    // The visit is done. That is the work, not the outcome: the customer is asked.
    await s.finish(correctionId);
    await s.approveAll();
    const done = await s.detail(recovery._id);
    expect(done.card.status).toBe("monitoring");
    expect(done.actions.find((a) => a.kind === "correction_visit")).toMatchObject({ status: "done", handoff: { status: "returned" }, actualCostCents: 2000 });
    expect(done.card.outcome).toBeNull();
    const confirmToken = careLink();
    expect(confirmToken).not.toBe(feedbackToken);
    expect((await s.t.mutation(api.retentionCare.confirmCorrection, { token: confirmToken, answer: "resolved" })).ok).toBe(true);
    const closed = await s.detail(recovery._id);
    expect(closed.card).toMatchObject({ status: "closed", outcome: { code: "customer_confirmed", verified: true } });
    // Every link of a closed case stops working.
    expect((await s.t.query(api.retentionCare.view, { token: confirmToken }))?.state).toBe("revoked");
  });
});
