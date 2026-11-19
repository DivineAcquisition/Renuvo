/**
 * Turns the record's facts into the sidebar's badges. Every badge says something a person can act on,
 * in words, and the one shown is chosen by `topBadge`: a problem always comes before "working".
 */
import type { AgentId, Badge } from "./navigation";
import { topBadge } from "./navigation-helpers";

export type SidebarFacts = {
  decisions: number;
  dispatch: { paused: boolean; withYou: number; inProgress: number; waiting: number; unfilled: number; unfilledWithinDay: number; awaitingAnswer: number };
  sales: { paused: boolean; withYou: number; running: number; waiting: number };
  retention: { paused: boolean; serious: number; withYou: number; overdue: number; underway: number; waiting: number };
};

const count = (n: number, label: string): string => `${n} ${label}`;

/** Sales: a person's decision first, then paused. "Working" only while a run is really in progress. */
function salesBadges(s: SidebarFacts["sales"]): Badge[] {
  const badges: Badge[] = [];
  if (s.withYou > 0) badges.push({ kind: "decision", label: count(s.withYou, "for you"), count: s.withYou });
  if (s.paused) badges.push({ kind: "attention", label: "Paused" });
  else if (s.running > 0) badges.push({ kind: "working", label: "Working" });
  else if (s.waiting > 0) badges.push({ kind: "working", label: "Waiting on replies" });
  return badges;
}

/**
 * Retention: a serious concern nobody has taken outranks everything, then a person's decision, then a
 * commitment past its deadline. "Working" only while a step is really being carried out.
 */
function retentionBadges(r: SidebarFacts["retention"]): Badge[] {
  const badges: Badge[] = [];
  if (r.serious > 0) badges.push({ kind: "urgent", label: count(r.serious, "serious"), count: r.serious });
  if (r.withYou > 0) badges.push({ kind: "decision", label: count(r.withYou, "for you"), count: r.withYou });
  if (r.overdue > 0) badges.push({ kind: "attention", label: count(r.overdue, "overdue"), count: r.overdue });
  if (r.paused) badges.push({ kind: "attention", label: "Paused" });
  else if (r.underway > 0) badges.push({ kind: "working", label: "Working" });
  else if (r.waiting > 0) badges.push({ kind: "working", label: "Waiting on replies" });
  return badges;
}

/** Every badge that applies to an agent right now. Dispatch, Sales and Retention have facts so far. */
export function agentBadges(agent: AgentId, facts: SidebarFacts | undefined): Badge[] {
  if (facts && agent === "sales") return salesBadges(facts.sales);
  if (facts && agent === "retention") return retentionBadges(facts.retention);
  if (!facts || agent !== "dispatch") return [];
  const d = facts.dispatch;
  const badges: Badge[] = [];
  if (d.unfilledWithinDay > 0) badges.push({ kind: "urgent", label: count(d.unfilled, "unfilled"), count: d.unfilled });
  else if (d.unfilled > 0) badges.push({ kind: "attention", label: count(d.unfilled, "unfilled"), count: d.unfilled });
  if (d.withYou > 0) badges.push({ kind: "decision", label: count(d.withYou, "for you"), count: d.withYou });
  if (d.paused) badges.push({ kind: "attention", label: "Paused" });
  else if (d.inProgress > 0) badges.push({ kind: "working", label: "Working" });
  else if (d.waiting > 0) badges.push({ kind: "working", label: "Waiting on replies" });
  return badges;
}

/** Every badge that applies to one of an agent's work tabs. */
export function tabBadges(agent: AgentId, tab: string, facts: SidebarFacts | undefined): Badge[] {
  if (facts && agent === "sales") return tab === "pipeline" && facts.sales.withYou > 0 ? [{ kind: "decision", label: count(facts.sales.withYou, "for you"), count: facts.sales.withYou }] : [];
  if (facts && agent === "retention") {
    if (tab !== "needs-attention") return [];
    const r = facts.retention;
    const badges: Badge[] = [];
    if (r.serious > 0) badges.push({ kind: "urgent", label: count(r.serious, "serious"), count: r.serious });
    if (r.withYou > 0) badges.push({ kind: "decision", label: count(r.withYou, "for you"), count: r.withYou });
    return badges;
  }
  if (!facts || agent !== "dispatch") return [];
  const d = facts.dispatch;
  if (tab === "offers-coverage") {
    const badges: Badge[] = [];
    if (d.unfilled > 0) badges.push({ kind: d.unfilledWithinDay > 0 ? "urgent" : "attention", label: count(d.unfilled, "unfilled"), count: d.unfilled });
    if (d.awaitingAnswer > 0) badges.push({ kind: "working", label: count(d.awaitingAnswer, "awaiting reply"), count: d.awaitingAnswer });
    return badges;
  }
  return [];
}

export function approvalsBadge(facts: SidebarFacts | undefined): Badge | null {
  return facts && facts.decisions > 0 ? { kind: "decision", label: count(facts.decisions, "to decide"), count: facts.decisions } : null;
}

export const agentBadge = (agent: AgentId, facts: SidebarFacts | undefined) => topBadge(agentBadges(agent, facts));
export const tabBadge = (agent: AgentId, tab: string, facts: SidebarFacts | undefined) => topBadge(tabBadges(agent, tab, facts));
