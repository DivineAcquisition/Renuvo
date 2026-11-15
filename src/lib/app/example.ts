/**
 * Made-up data for the layout preview at /dev/overview. Every name, time and amount is invented. The
 * real screens read the company's record and never use this file.
 */
import type { TeamDepartment } from "@/components/app/overview/team-at-work";
import type { OverviewData } from "@/components/app/overview/overview-view";

import type { Id } from "../../../convex/_generated/dataModel";
import type { Detail } from "../../../convex/details";
import type { Described } from "../../../convex/lib/eventWords";
import type { Decision, Visit } from "../../../convex/overview";

const HOUR = 3_600_000;
const id = <T extends "jobs" | "approvals" | "tasks" | "events" | "assignments">(value: string) => value as unknown as Id<T>;

export const EXAMPLE_TIMEZONE = "America/Chicago";

export function exampleOverview(now: number): OverviewData {
  const day = Math.floor(now / (24 * HOUR)) * 24 * HOUR + 6 * HOUR; // midnight in Chicago, near enough for a picture
  const at = (hour: number, minute = 0) => day + hour * HOUR + minute * 60_000;

  const visits: Visit[] = [
    { jobId: id("job1"), startsAt: at(9), endsAt: at(11), customer: "Dana Whitfield", place: "12 Elm St, Austin", serviceType: "Recurring clean", state: "in_progress", cleaner: "Rosa Alvarez", respondBy: null },
    { jobId: id("job2"), startsAt: at(11, 30), endsAt: at(14), customer: "Marcus Lee", place: "480 Rio Grande, Austin", serviceType: "Deep clean", state: "accepted", cleaner: "Lena Ortiz", respondBy: null },
    { jobId: id("job3"), startsAt: at(13), endsAt: at(15), customer: "Harbor Stays", place: "Unit 4B, 77 Lake Dr", serviceType: "Turnover clean", state: "awaiting_acceptance", cleaner: "Maya Chen", respondBy: now + 40 * 60_000 },
    { jobId: id("job4"), startsAt: at(14), endsAt: at(16), customer: "Priya Johnson", place: "9 Maple Ct, Austin", serviceType: "Standard clean", state: "needs_coverage", cleaner: null, respondBy: null },
    { jobId: id("job5"), startsAt: at(16, 30), endsAt: at(18), customer: "Northside Dental", place: "210 W 6th St", serviceType: "Office clean", state: "accepted", cleaner: "Rosa Alvarez", respondBy: null },
  ];

  const decisions: Decision[] = [
    {
      ref: { kind: "approval", id: id("approval1") },
      agent: "dispatch",
      agentName: "Dispatch",
      department: "Operations",
      title: "Offer today's 2:00 PM standard clean to Lena Ortiz",
      situation: "The original cleaner declined this morning. Lena is free from 2:00 PM with 45 minutes after her deep clean, works in 78704, and has cleaned this home twice before. This customer usually has Rosa, who is booked.",
      recommended: "Offer the visit to Lena Ortiz",
      authorizes: "Dispatch sends Lena Ortiz the offer for Priya Johnson's 2:00 PM visit, with her pay for it and 60 minutes to answer. Nothing else.",
      ifWaiting: "The visit stays without a cleaner. After 1:00 PM there is not enough time for an offer to be answered.",
      deadline: now + 55 * 60_000,
      context: [
        { label: "Visit", value: "today at 2:00 PM · Standard clean", ref: { kind: "job", id: id("job4") } },
        { label: "Customer", value: "Priya Johnson", ref: null },
        { label: "Cleaner", value: "Lena Ortiz", ref: null },
      ],
      canDecide: true,
      carriesOut: true,
    },
    {
      ref: { kind: "task", id: id("task9") },
      agent: "dispatch",
      agentName: "Dispatch",
      department: "Operations",
      title: "Cover Thursday's move-out clean",
      situation: "No cleaner can be offered this visit: two lack the move-out skill, one has time off, and one has no pay rate set. Set the pay rate, change the time, or offer it yourself.",
      recommended: null,
      authorizes: null,
      ifWaiting: null,
      deadline: now + 20 * HOUR,
      context: [{ label: "Visit", value: "Thu at 10:00 AM · Move-out clean", ref: { kind: "job", id: id("job8") } }],
      canDecide: true,
      carriesOut: false,
    },
  ];

  const team: TeamDepartment[] = [
    {
      id: "sales",
      name: "Sales",
      purpose: "Give every inquiry a timely, honest path to a decision.",
      summary: "No agent is working here yet.",
      agents: [{ agent: "sales", name: "Sales", responsibility: "Inquiries, quotes, follow-ups and bookings.", state: "not_built", counts: { open: 0, waiting: 0, needsDecision: 0 }, lines: [] }],
    },
    {
      id: "operations",
      name: "Operations",
      purpose: "Keep the team ready and every visit covered.",
      summary: "1 item needs your decision; 1 in progress; 1 waiting on a response.",
      agents: [
        { agent: "recruiter", name: "Recruiter", responsibility: "Applicants, interviews and onboarding.", state: "not_built", counts: { open: 0, waiting: 0, needsDecision: 0 }, lines: [] },
        {
          agent: "dispatch",
          name: "Dispatch",
          responsibility: "Assignments, coverage and service status.",
          state: "needs_you",
          counts: { open: 1, waiting: 1, needsDecision: 1 },
          lines: [
            { taskId: id("task9"), title: "Cover Thursday's move-out clean", status: "needs_decision", nextAction: null, dueAt: now + 20 * HOUR, waitingOn: null, followUpAt: null },
            { taskId: id("task4"), title: "Cover today's 2:00 PM standard clean", status: "open", nextAction: "Offer to Lena Ortiz once approved", dueAt: now + 55 * 60_000, waitingOn: null, followUpAt: null },
            { taskId: id("task3"), title: "Cover today's 1:00 PM turnover clean", status: "waiting", nextAction: null, dueAt: now + 40 * 60_000, waitingOn: "cleaner", followUpAt: now + 40 * 60_000 },
          ],
        },
      ],
    },
    {
      id: "customer_success",
      name: "Customer Success",
      purpose: "Earn repeat business through consistent care.",
      summary: "No agent is working here yet.",
      agents: [{ agent: "retention", name: "Retention", responsibility: "Feedback, service concerns and recurring service.", state: "not_built", counts: { open: 0, waiting: 0, needsDecision: 0 }, lines: [] }],
    },
  ];

  const dispatch = { kind: "agent" as const, label: "Dispatch", agent: "dispatch" as const };
  const activity: Described[] = [
    { id: id("e1"), at: now - 2 * 60_000, type: "approval.requested", actor: dispatch, text: 'proposed "Offer today\'s 2:00 PM standard clean to Lena Ortiz"', ref: { kind: "approval", id: id("approval1") } },
    { id: id("e2"), at: now - 9 * 60_000, type: "assignment.declined", actor: { kind: "member", label: "Jo (office)", agent: null }, text: "recorded that Sam Reyes declined the visit today at 2:00 PM for Priya Johnson", ref: { kind: "job", id: id("job4") } },
    { id: id("e3"), at: now - 20 * 60_000, type: "assignment.offered", actor: dispatch, text: "offered the visit today at 1:00 PM for Harbor Stays to Maya Chen", ref: { kind: "job", id: id("job3") } },
    { id: id("e4"), at: now - 55 * 60_000, type: "job.in_progress", actor: { kind: "member", label: "Jo (office)", agent: null }, text: "started the visit today at 9:00 AM for Dana Whitfield", ref: { kind: "job", id: id("job1") } },
    { id: id("e5"), at: now - 3 * HOUR, type: "assignment.expired", actor: { kind: "system", label: "Selestial", agent: null }, text: "closed the offer to Ben Carter for the visit today at 1:00 PM: no answer in time", ref: { kind: "job", id: id("job3") } },
  ];

  return {
    firstName: "Malik",
    now,
    timezone: EXAMPLE_TIMEZONE,
    today: {
      lastChangeAt: now - 2 * 60_000,
      briefing: [
        { text: "3 of today's 5 visits have a cleaner who accepted.", certainty: "confirmed", link: { kind: "view", view: "schedule_today" } },
        { text: "The 2:00 PM visit for Priya Johnson has no cleaner.", certainty: "attention", link: { kind: "job", id: id("job4") } },
        { text: "The 1:00 PM visit for Harbor Stays is waiting on Maya Chen's answer, due in 40 minutes.", certainty: "pending", link: { kind: "job", id: id("job3") } },
        { text: "Every visit tomorrow has a cleaner who accepted.", certainty: "confirmed", link: { kind: "view", view: "schedule_tomorrow" } },
        { text: "2 decisions are waiting for you; the earliest is due in under an hour.", certainty: "attention", link: { kind: "view", view: "decisions" } },
      ],
      indicators: {
        jobs: { total: 5, completed: 0, inProgress: 1, upcoming: 4 },
        coverage: { needing: 5, accepted: 3, awaiting: 1, uncovered: 1 },
        decisions: { count: 2, nextDeadline: now + 55 * 60_000 },
        payments: { state: "not_set_up" },
      },
    },
    decisions,
    schedule: { visits, dayStarts: [day] },
    team,
    activity,
    week: [
      { key: "completed_visits", label: "Completed visits", why: "Work actually delivered.", state: "measured", kind: "count", value: 31, previous: 27, limitation: null },
      { key: "completed_revenue", label: "Completed service revenue", why: "Value of work actually delivered. This is not cash collected.", state: "measured", kind: "cents", value: 512000, previous: 468000, limitation: "2 completed visits have no price, so they are left out." },
      { key: "coverage_gaps", label: "Coverage gaps", why: "Visits in the next seven days without an accepted cleaner.", state: "measured", kind: "count", value: 3, previous: null, limitation: null },
    ],
  };
}

export function exampleDetail(now: number): Detail {
  const dispatch = { kind: "agent" as const, label: "Dispatch", agent: "dispatch" as const };
  return {
    ref: { kind: "job", id: id("job3") },
    title: "Harbor Stays · Turnover clean",
    subtitle: "today at 1:00 PM to 3:00 PM",
    responsible: { label: "Dispatch", agent: "dispatch" },
    status: { label: "Awaiting acceptance", tone: "pending" },
    situation: ["An offer is out to Maya Chen. Nobody has accepted this visit yet."],
    context: [
      { label: "Customer", value: "Harbor Stays", ref: null },
      { label: "Property", value: "Unit 4B, 77 Lake Dr, Austin, TX 78701", ref: null },
      { label: "Scope", value: "2 bed, 1 bath turnover. Linens, restock, photos of each room.", ref: null },
      { label: "Access instructions", value: "Lockbox on the railing, code changes weekly. Guest checks in at 4:00 PM.", ref: null },
      { label: "Price", value: "$165.00", ref: null },
      { label: "Payment", value: "Payments are not connected yet", ref: null, missing: true },
      { label: "Conversation", value: "Conversations are not built yet", ref: null, missing: true },
    ],
    next: { action: "Wait for Maya Chen's answer.", when: now + 40 * 60_000, ifFails: "With no answer in time the offer expires and the visit is offered to the next eligible cleaner, or handed to you." },
    history: [
      { id: id("h1"), at: now - 20 * 60_000, type: "assignment.offered", actor: dispatch, text: "offered the visit today at 1:00 PM for Harbor Stays to Maya Chen", ref: null },
      { id: id("h2"), at: now - 3 * HOUR, type: "assignment.expired", actor: { kind: "system", label: "Selestial", agent: null }, text: "closed the offer to Ben Carter for the visit today at 1:00 PM: no answer in time", ref: null },
      { id: id("h3"), at: now - 5 * HOUR, type: "assignment.offered", actor: dispatch, text: "offered the visit today at 1:00 PM for Harbor Stays to Ben Carter", ref: null },
      { id: id("h4"), at: now - 26 * HOUR, type: "job.created", actor: { kind: "member", label: "Jo (office)", agent: null }, text: "scheduled the visit today at 1:00 PM for Harbor Stays", ref: null },
    ],
    job: {
      status: "scheduled",
      withPerson: false,
      assignments: [
        { id: id("a2"), cleaner: "Maya Chen", status: "offered", respondBy: now + 40 * 60_000, payCents: 9075, endReason: null },
        { id: id("a1"), cleaner: "Ben Carter", status: "expired", respondBy: now - 3 * HOUR, payCents: 9075, endReason: "The response deadline passed." },
      ],
    },
    approval: null,
    task: null,
  };
}
