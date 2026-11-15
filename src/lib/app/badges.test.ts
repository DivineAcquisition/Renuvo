import { describe, expect, it } from "vitest";

import { agentBadge, agentBadges, approvalsBadge, tabBadge, type SidebarFacts } from "./badges";

const quiet: SidebarFacts = { decisions: 0, dispatch: { paused: false, withYou: 0, inProgress: 0, waiting: 0, unfilled: 0, unfilledWithinDay: 0, awaitingAnswer: 0 } };
const facts = (dispatch: Partial<SidebarFacts["dispatch"]>, decisions = 0): SidebarFacts => ({ decisions, dispatch: { ...quiet.dispatch, ...dispatch } });

describe("sidebar badges", () => {
  it("shows nothing when there is nothing to act on, and nothing before the record has loaded", () => {
    expect(agentBadge("dispatch", quiet)).toBeNull();
    expect(agentBadge("dispatch", undefined)).toBeNull();
    expect(approvalsBadge(quiet)).toBeNull();
    expect(tabBadge("dispatch", "offers-coverage", quiet)).toBeNull();
  });

  it("never gives an unbuilt agent a badge", () => {
    const busy = facts({ withYou: 3, unfilled: 2, unfilledWithinDay: 2, inProgress: 4 }, 5);
    for (const agent of ["marketing", "sales", "retention", "quality", "customer-care", "recruiter", "team-coordinator"] as const) {
      expect(agentBadges(agent, busy)).toEqual([]);
      expect(tabBadge(agent, "playbook", busy)).toBeNull();
    }
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
