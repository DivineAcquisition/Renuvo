import { describe, expect, it } from "vitest";

import { performanceFrom, recommendationsFor, SCORE_VERSION, type AssignmentFact, type DisputeFact } from "./performance";

const DAY = 86_400_000;
const NOW = Date.UTC(2027, 5, 1, 12);
let n = 0;

/** An accepted job that went ahead, `days` ago, checked in on time unless told otherwise. */
function job(days: number, extra: Partial<AssignmentFact> = {}): AssignmentFact {
  n += 1;
  const startsAt = NOW - days * DAY;
  return {
    assignmentId: `a${n}`,
    jobId: `j${n}`,
    label: `Job ${n}`,
    status: "accepted",
    endCause: null,
    offeredAt: startsAt - 2 * DAY,
    respondBy: startsAt - DAY,
    respondedAt: startsAt - 2 * DAY + 3_600_000,
    jobStatus: "completed",
    startsAt,
    endsAt: startsAt + 2 * 3_600_000,
    arrivalEndsAt: startsAt,
    checkInAt: startsAt - 5 * 60_000,
    lateReportedAt: null,
    completion: { submittedAt: startsAt + 2 * 3_600_000, incomplete: false },
    crewSize: 1,
    ...extra,
  };
}

const kept = (count: number, from = 2) => Array.from({ length: count }, (_, index) => job(from + index));

describe("performance from verified records", () => {
  it("gives no score with too little history, and still shows the records", () => {
    const result = performanceFrom({ now: NOW, facts: kept(3), disputes: [] });
    expect(result.score).toMatchObject({ state: "not_enough", have: 3, needed: 5, version: SCORE_VERSION });
    expect(result.score.state === "not_enough" && result.score.words).toContain("Not enough history");
    expect(result.measures.reliability.records).toHaveLength(3);
  });

  it("tells silence from a no, and leaves out offers that never reached them", () => {
    const facts = [
      ...kept(4),
      job(10, { status: "declined", respondedAt: NOW - 12 * DAY, jobStatus: "scheduled" }),
      job(11, { status: "declined", respondedAt: NOW - 13 * DAY, jobStatus: "scheduled" }),
      job(12, { status: "expired", respondedAt: null }),
      job(13, { status: "cancelled", endCause: "undelivered", respondedAt: null }),
      job(14, { status: "offered", respondedAt: null, offeredAt: NOW - DAY, startsAt: NOW + 2 * DAY }),
    ];
    const { responsiveness } = performanceFrom({ now: NOW, facts, disputes: [] }).measures;
    expect([responsiveness.numerator, responsiveness.denominator]).toEqual([6, 7]);
    expect(responsiveness.breakdown).toEqual([
      { label: "Accepted", count: 4, tone: "neutral" },
      { label: "Declined", count: 2, tone: "neutral" },
      { label: "No answer", count: 1, tone: "concern" },
    ]);
    // A no is an answer, never a concern.
    expect(responsiveness.records.filter((row) => row.outcome === "Declined").every((row) => row.tone === "neutral")).toBe(true);
  });

  it("never counts a missing check-in as late, and keeps late-with-notice apart", () => {
    const facts = [
      ...kept(4),
      job(10, { checkInAt: null }),
      job(11, { checkInAt: NOW - 11 * DAY + 20 * 60_000, lateReportedAt: NOW - 11 * DAY - 30 * 60_000 }),
      job(12, { checkInAt: NOW - 12 * DAY + 25 * 60_000 }),
      job(13, { checkInAt: NOW - 13 * DAY + 4 * 60_000 }),
    ];
    const { punctuality } = performanceFrom({ now: NOW, facts, disputes: [] }).measures;
    // Four on time, one within the five-minute grace, one late with notice, one late without word; one not counted.
    expect([punctuality.numerator, punctuality.denominator]).toEqual([5, 7]);
    expect(punctuality.breakdown.map((row) => [row.label, row.count])).toEqual([
      ["On time", 5],
      ["Late, told the office beforehand", 1],
      ["Late without word", 1],
      ["No check-in recorded (not counted)", 1],
    ]);
    expect(punctuality.records.find((row) => row.outcome.startsWith("No check-in"))).toMatchObject({ counts: false, tone: "neutral" });
  });

  it("leaves out what the company did, and counts saying no in advance apart from a declared no-show", () => {
    const facts = [
      ...kept(5),
      job(10, { status: "cancelled", endCause: "released" }),
      job(11, { status: "cancelled", endCause: "job_cancelled", jobStatus: "cancelled" }),
      job(12, { status: "cancelled", endCause: "job_moved" }),
      job(13, { status: "cancelled", endCause: "dropped" }),
      job(14, { status: "cancelled", endCause: "no_show" }),
    ];
    const { reliability } = performanceFrom({ now: NOW, facts, disputes: [] }).measures;
    expect([reliability.numerator, reliability.denominator]).toEqual([5, 7]);
    expect(reliability.words).toContain("3 jobs the company released, cancelled or moved are left out");
    expect(reliability.breakdown.map((row) => row.label)).toEqual(["Kept", "Said they could not attend", "No-show, declared by a person"]);
  });

  it("does not put a crew's completion report on one member", () => {
    const facts = [...kept(5), job(10, { crewSize: 3, completion: null }), job(11, { completion: null })];
    const { completion } = performanceFrom({ now: NOW, facts, disputes: [] }).measures;
    expect([completion.numerator, completion.denominator]).toEqual([5, 6]);
    expect(completion.words).toContain("1 crew job not counted for one person");
  });

  it("leaves a disputed record out until it is upheld, and for good once corrected", () => {
    const facts = [...kept(5), job(10, { status: "cancelled", endCause: "no_show" }), job(11, { status: "cancelled", endCause: "no_show" })];
    const dispute = (assignmentId: string, status: DisputeFact["status"]): DisputeFact => ({ disputeId: `d-${assignmentId}`, assignmentId, measure: "reliability", status, reason: "I was there; the door code was wrong." });
    const [first, second] = facts.slice(-2).map((row) => row.assignmentId);
    const open = performanceFrom({ now: NOW, facts, disputes: [dispute(first, "open")] }).measures.reliability;
    expect([open.numerator, open.denominator, open.disputed]).toEqual([5, 6, 1]);
    expect(open.records.find((row) => row.assignmentId === first)).toMatchObject({ counts: false, dispute: { status: "open" } });
    const decided = performanceFrom({ now: NOW, facts, disputes: [dispute(first, "corrected"), dispute(second, "upheld")] }).measures.reliability;
    expect([decided.numerator, decided.denominator]).toEqual([5, 6]);
    expect(decided.records.find((row) => row.assignmentId === second)).toMatchObject({ counts: true, dispute: { status: "upheld" } });
  });

  it("scores the same facts the same way, shares out the points of a part without enough records, and explains each part", () => {
    const facts = [...kept(8), job(20, { status: "cancelled", endCause: "dropped" }), ...Array.from({ length: 2 }, (_, i) => job(30 + i, { status: "expired", respondedAt: null }))];
    for (const row of facts.slice(0, 5)) row.checkInAt = null;
    const once = performanceFrom({ now: NOW, facts, disputes: [] });
    const twice = performanceFrom({ now: NOW, facts: [...facts].reverse(), disputes: [] });
    expect(once.score).toEqual(twice.score);
    if (once.score.state !== "scored") throw new Error("expected a score");
    // Reliability 8/9 (50 points) and responsiveness 9/11 (20 points); punctuality has 3 check-ins and is left out.
    expect(once.score.value).toBe(Math.round(((50 * 8) / 9 + (20 * 9) / 11) / 70 * 100));
    expect(once.score.lines.find((line) => line.key === "punctuality")).toMatchObject({ points: null });
    expect(once.score.lines.find((line) => line.key === "punctuality")!.words).toContain("left out, only 3 records (needs 5)");
    expect(once.score.version).toBe(SCORE_VERSION);
  });

  it("recommends only what the records show, each with its records", () => {
    const facts = [...kept(5), job(10, { status: "cancelled", endCause: "no_show" }), job(11, { checkInAt: NOW - 11 * DAY + 40 * 60_000 }), job(12, { checkInAt: NOW - 12 * DAY + 40 * 60_000 })];
    const recs = recommendationsFor(performanceFrom({ now: NOW, facts, disputes: [] }));
    expect(recs.map((row) => row.key)).toEqual(["no_show", "late"]);
    expect(recs[0].evidence).toHaveLength(1);
    expect(recs[1].evidence).toHaveLength(2);
    const steady = recommendationsFor(performanceFrom({ now: NOW, facts: kept(12), disputes: [] }));
    expect(steady.map((row) => row.key)).toEqual(["recognize"]);
    expect(recommendationsFor(performanceFrom({ now: NOW, facts: kept(2), disputes: [] }))).toEqual([]);
  });
});
