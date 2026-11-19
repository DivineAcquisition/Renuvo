import { describe, expect, it } from "vitest";

import { agentBadge, agentBadges, approvalsBadge, tabBadge, type SidebarFacts } from "./badges";

const quiet: SidebarFacts = { decisions: 0, dispatch: { paused: false, withYou: 0, inProgress: 0, waiting: 0, unfilled: 0, unfilledWithinDay: 0, awaitingAnswer: 0 }, sales: { paused: false, withYou: 0, running: 0, waiting: 0 }, retention: { paused: false, serious: 0, withYou: 0, overdue: 0, underway: 0, waiting: 0 } };
const facts = (dispatch: Partial<SidebarFacts["dispatch"]>, decisions = 0): SidebarFacts => ({ decisions, dispatch: { ...quiet.dispatch, ...dispatch }, sales: quiet.sales, retention: quiet.retention });
const sales = (values: Partial<SidebarFacts["sales"]>): SidebarFacts => ({ ...quiet, sales: { ...quiet.sales, ...values } });
const care = (values: Partial<SidebarFacts["retention"]>): SidebarFacts => ({ ...quiet, retention: { ...quiet.retention, ...values } });

describe("sidebar badges", () => {
  it("shows nothing when there is nothing to act on, and nothing before the record has loaded", () => {
    expect(agentBadge("dispatch", quiet)).toBeNull();
    expect(agentBadge("dispatch", undefined)).toBeNull();
    expect(approvalsBadge(quiet)).toBeNull();
    expect(tabBadge("dispatch", "offers-coverage", quiet)).toBeNull();
  });

  it("never gives an unbuilt agent a badge", () => {
    const busy = facts({ withYou: 3, unfilled: 2, unfilledWithinDay: 2, inProgress: 4 }, 5);
    for (const agent of ["marketing", "quality", "customer-care", "recruiter", "team-coordinator"] as const) {
      expect(agentBadges(agent, busy)).toEqual([]);
      expect(tabBadge(agent, "playbook", busy)).toBeNull();
    }
  });

  it("badges Sales with a person's decision first, and says working only while a run is in progress", () => {
    expect(agentBadge("sales", quiet)).toBeNull();
    expect(agentBadge("sales", sales({ waiting: 2 }))).toEqual({ kind: "working", label: "Waiting on replies" });
    expect(agentBadge("sales", sales({ running: 1, waiting: 2 }))).toEqual({ kind: "working", label: "Working" });
    expect(agentBadge("sales", sales({ running: 1, withYou: 3 }))).toEqual({ kind: "decision", label: "3 for you", count: 3 });
    expect(agentBadge("sales", sales({ paused: true, running: 1 }))).toEqual({ kind: "attention", label: "Paused" });
    expect(tabBadge("sales", "pipeline", sales({ withYou: 2 }))).toEqual({ kind: "decision", label: "2 for you", count: 2 });
    expect(tabBadge("sales", "playbook", sales({ withYou: 2 }))).toBeNull();
  });

  it("badges Retention with a serious concern first, then a decision, then an overdue commitment", () => {
    expect(agentBadge("retention", quiet)).toBeNull();
    expect(agentBadge("retention", care({ waiting: 2 }))).toEqual({ kind: "working", label: "Waiting on replies" });
    expect(agentBadge("retention", care({ underway: 1, waiting: 2 }))).toEqual({ kind: "working", label: "Working" });
    expect(agentBadge("retention", care({ underway: 1, overdue: 1 }))).toEqual({ kind: "attention", label: "1 overdue", count: 1 });
    expect(agentBadge("retention", care({ withYou: 3, overdue: 1, underway: 1 }))).toEqual({ kind: "decision", label: "3 for you", count: 3 });
    expect(agentBadge("retention", care({ serious: 1, withYou: 3 }))).toEqual({ kind: "urgent", label: "1 serious", count: 1 });
    expect(agentBadge("retention", care({ paused: true, underway: 2 }))).toEqual({ kind: "attention", label: "Paused" });
    expect(tabBadge("retention", "needs-attention", care({ withYou: 2 }))).toEqual({ kind: "decision", label: "2 for you", count: 2 });
    expect(tabBadge("retention", "recovery", care({ withYou: 2 }))).toBeNull();
  });

  it("puts an unfilled visit and a needed decision ahead of working", () => {
    expect(agentBadge("dispatch", facts({ inProgress: 2 }))).toEqual({ kind: "working", label: "Working" });
    expect(agentBadge("dispatch", facts({ waiting: 1 }))).toEqual({ kind: "working", label: "Waiting on replies" });
    expect(agentBadge("dispatch", facts({ inProgress: 2, withYou: 1 }))).toEqual({ kind: "decision", label: "1 for you", count: 1 });
    // Unfilled further out is something to look at; unfilled within a day is urgent and outranks a decision.
    expect(agentBadge("dispatch", facts({ unfilled: 2, inProgress: 1 }))).toEqual({ kind: "attention", label: "2 unfilled", count: 2 });
    expect(agentBadge("dispatch", facts({ unfilled: 2, withYou: 1 }))).toEqual({ kind: "decision", label: "1 for you", count: 1 });
    expect(agentBadge("dispatch", facts({ unfilled: 2, unfilledWithinDay: 1, withYou: 1, inProgress: 3 }))).toEqual({ kind: "urgent", label: "2 unfilled", count: 2 });
    // A paused agent says so instead of "working", and a decision still comes first.
    expect(agentBadge("dispatch", facts({ paused: true, inProgress: 2 }))).toEqual({ kind: "attention", label: "Paused" });
    expect(agentBadge("dispatch", facts({ paused: true, withYou: 2 }))).toMatchObject({ kind: "decision" });
  });

  it("badges a tab with what can be acted on there", () => {
    expect(tabBadge("dispatch", "offers-coverage", facts({ unfilled: 2 }))).toEqual({ kind: "attention", label: "2 unfilled", count: 2 });
    expect(tabBadge("dispatch", "offers-coverage", facts({ awaitingAnswer: 3 }))).toEqual({ kind: "working", label: "3 awaiting reply", count: 3 });
    expect(tabBadge("dispatch", "offers-coverage", facts({ unfilled: 1, unfilledWithinDay: 1, awaitingAnswer: 3 }))).toMatchObject({ kind: "urgent", label: "1 unfilled" });
    expect(tabBadge("dispatch", "schedule", facts({ unfilled: 2 }))).toBeNull();
    expect(approvalsBadge(facts({}, 3))).toEqual({ kind: "decision", label: "3 to decide", count: 3 });
  });
});
