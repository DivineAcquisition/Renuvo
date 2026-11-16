import { writeFileSync } from "node:fs";

import { getFunctionName } from "convex/server";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CompanyProvider } from "@/components/app/company";

const data: Record<string, unknown> = {};
let search = "";
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === "skip" ? undefined : data[getFunctionName(ref)]),
  useMutation: () => async () => undefined,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/agents/recruiter", useRouter: () => ({ replace: () => undefined, push: () => undefined }), useSearchParams: () => new URLSearchParams(search) }));

const { RecruiterOverviewScreen } = await import("./overview");
const { ApplicantsScreen } = await import("./applicants");
const { ScreeningScreen } = await import("./screening");
const { InterviewsScreen } = await import("./interviews");
const { OffersScreen } = await import("./offers");
const { HiringNeedsScreen } = await import("./hiring-needs");

const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 16, 15);
const row = (id: string, name: string, stage: string, extra: Record<string, unknown> = {}) => ({
  applicationId: id,
  applicantId: `p${id}`,
  name,
  role: "House Cleaner",
  roleSeen: "House Cleaner",
  roleStatus: "open",
  source: "indeed",
  stage,
  appliedAt: T - 2 * DAY,
  contact: { status: "direct", words: "Email address given in the application.", address: `${name.split(" ")[0].toLowerCase()}@example.test`, bounced: false },
  completion: { invitedAt: T - 2 * DAY, startedAt: T - DAY, submittedAt: stage === "invited" ? null : T - DAY / 2 },
  nextAction: { by: "recruiter", what: "Send a reminder if the form is not finished", dueAt: T + DAY },
  withPerson: false,
  waitingOnReply: false,
  closure: null,
  detailsRemoved: false,
  ...extra,
});
const screening = {
  _id: "s1",
  _creationTime: T,
  companyId: "c",
  createdAt: T,
  applicationId: "a2",
  needId: "n1",
  summary: { experience: "3 years cleaning homes and offices", availability: "Weekdays 8–4", met: ["Transportation", "Experience"], concerns: ["Weekend availability unclear"], suggestedNextStep: "Invite to an interview this week." },
  results: [
    { key: "transport", label: "Has reliable transportation", source: "application form", outcome: "meets", evidence: "I have my own car", fixed: true },
    { key: "experience", label: "At least 1 year of cleaning", source: "application form", outcome: "meets", evidence: "3 years at Sparkle Co.", fixed: false },
    { key: "weekends", label: "Available some weekends", source: "application form", outcome: "needs_clarification", evidence: "Mostly weekdays", fixed: false },
  ],
  missing: [],
  contradictions: [],
  recommendation: "advance",
};
const rows = [
  row("a1", "Maria Lopez", "invited", { nextAction: { by: "applicant", what: "Finish the application form", dueAt: T + DAY }, waitingOnReply: true }),
  row("a2", "Dana Cole", "screening", { withPerson: true, nextAction: { by: "owner", what: "Decide whether to interview", dueAt: T + DAY } }),
  row("a3", "Lee Wong", "interview", { nextAction: { by: "recruiter", what: "Confirm the interview time" } }),
  row("a4", "Sam Ortiz", "received", { contact: { status: "relay", words: "Only a job-board relay address so far.", address: "x@indeedemail.com", bounced: false } }),
  row("a5", "Ava Chen", "offer_sent"),
  row("a6", "Noah Kim", "onboarding_handoff"),
];

function fill() {
  data["recruiter:overview"] = {
    asOf: T,
    openHiringNeeds: 2,
    newApplications: 1,
    contactNeeded: 0,
    invitationsAwaitingApproval: 0,
    incompleteNeedingFollowUp: 0,
    incompleteApplications: 1,
    awaitingScreening: 1,
    awaitingInterview: 1,
    decisionsAwaitingOwner: 1,
    offersOut: 1,
    awaitingOnboardingHandoff: 0,
    inOnboarding: 1,
    inbox: [{ connectionId: "m1", address: "hiring@alpha-cleaning.test", provider: "gmail", status: "connected", problem: null, lastSyncAt: T - 600_000, connectorBuilt: true, sendsApplicantEmail: true }],
    inboxConnected: true,
    failures: { messages: 0, flaggedMessages: 0, mailboxes: 0 },
    connections: { applicantLinks: true, email: "resend", texting: null, calendar: null, signing: null, reader: "claude" },
    paused: false,
    gmailAvailable: true,
  };
  data["applications:list"] = rows;
  data["recruiter:staffingRequests"] = [{ taskId: "t1", kind: "urgent_hire", title: "Two cleaners needed for Saturday", what: "Coverage gap on three visits", dueAt: T + DAY, about: null }];
  data["permissions:list"] = { pausedAgents: [] };
  data["approvals:pending"] = [];
  data["applications:get"] = {
    ...rows[1],
    applicant: { name: "Dana Cole", email: "dana@example.test", phone: "+1 512 555 0101", location: "Austin, TX", mayBeTexted: true, doNotContact: null, possibleDuplicateOf: null },
    contactEvidence: [{ kind: "direct", address: "dana@example.test", where: "body: labelled Email" }],
    facts: [{ value: "3 years", from: "message", field: "Experience", where: "Indeed notification" }],
    form: { savedAt: T, submittedAt: T - DAY / 2, answers: [{ key: "car", label: "Do you have a car?", answer: "Yes, my own car" }], answered: 4, required: 4 },
    attachments: [{ attachmentId: "f1", kind: "resume", fileName: "Dana-Cole-resume.pdf", size: 52_000, uploadedAt: T, verified: false }],
    conversation: [
      { direction: "in", at: T - 2 * DAY, classification: "new_application", classifiedBy: "model", source: "indeed", subject: "New application for House Cleaner", excerpt: "Dana Cole applied to House Cleaner.", flag: null, attachments: [] },
      { direction: "out", at: T - 2 * DAY + 3_600_000, purpose: "application_invitation", channel: "email", subject: "Next step for your House Cleaner application", status: "delivered", sentAt: T - 2 * DAY, deliveredAt: T - 2 * DAY, bouncedAt: null, problem: null },
    ],
    remindersSent: 1,
    screening,
    interviews: [],
    offers: [],
    handoff: null,
    decisions: [],
  };
  data["applications:screeningQueue"] = [{ ...rows[1], screening }];
  data["hiringNeeds:list"] = [
    { _id: "n1", _creationTime: T, title: "House Cleaner", companyId: "c", createdBy: "m", createdAt: T, status: "open", location: "Austin, TX", questions: [], engagement: "contractor", requiredSkills: [], titleAliases: [], responsibilities: "Residential cleaning: kitchens, bathrooms, floors and dusting, following each home's checklist.", serviceTypes: ["standard"], coverageAreas: [], requiredAvailability: "Weekdays", openings: 3, criteria: screening.results.map((r) => ({ key: r.key, label: r.label, field: r.key, fixed: r.fixed, test: { kind: "person_reviews" } })), applications: 6, active: 5, hired: 1, compensation: { approvedBy: "m", approvedAt: T, pay: { kind: "hourly", hourlyCents: 2200 } } },
    { _id: "n2", _creationTime: T, title: "Deep-Clean Specialist", companyId: "c", createdBy: "m", createdAt: T, status: "paused", location: "Round Rock, TX", questions: [], engagement: "employee", requiredSkills: [], titleAliases: [], responsibilities: "Move-out and deep cleans.", serviceTypes: [], coverageAreas: [], requiredAvailability: "Weekends", openings: 1, criteria: [], applications: 0, active: 0, hired: 0 },
  ];
  data["interviews:board"] = {
    interviews: [
      { interviewId: "i1", applicationId: "a3", applicant: "Lee Wong", status: "confirmed", startsAt: T + DAY, endsAt: T + DAY + 1_800_000, interviewer: "Owner A", how: "Phone", reschedules: 0, reminderQueuedAt: null, feedback: null, inCalendar: false },
      { interviewId: "i2", applicationId: "a2", applicant: "Dana Cole", status: "awaiting_slots", startsAt: null, endsAt: null, interviewer: null, how: null, reschedules: 0, reminderQueuedAt: null, feedback: null, inCalendar: false },
    ],
    slots: [{ slotId: "sl1", interviewerId: "m", startsAt: T + 2 * DAY, endsAt: T + 2 * DAY + 1_800_000, status: "open" }],
    offerable: 1,
    calendar: null,
    timezone: "America/Chicago",
  };
  data["members:list"] = [{ id: "m", name: "Owner A", email: "a@example.test", role: "owner", status: "active" }];
  data["hiringOffers:board"] = {
    rows: [{ applicationId: "a5", applicant: "Ava Chen", role: "House Cleaner", stage: "offer_sent", approvedTerms: { engagement: "contractor", pay: "$22.00 an hour", approvedAt: T }, offers: [{ offerId: "o1", status: "sent", pay: "$22.00 an hour", terms: { role: "House Cleaner", engagement: "contractor", pay: { kind: "hourly", hourlyCents: 2200 }, startConditions: "After one shadow shift", expectations: "Three days a week" }, approvalId: null, sentAt: T, expiresAt: T + 5 * DAY, respondedAt: null, agreement: { status: "not_started" } }], handoff: null, nextAction: { by: "applicant", what: "Answer the offer" } }],
    signing: null,
  };
  data["onboarding:queue"] = [
    { handoffId: "h1", applicationId: "a6", applicant: "Noah Kim", role: "House Cleaner", approvedTerms: { payWords: "$22.00 an hour", role: "House Cleaner", engagement: "contractor", pay: { kind: "hourly", hourlyCents: 2200 }, startConditions: "", expectations: "" }, information: [], requirements: [{ key: "agreement", label: "Agreement signed", status: "done" }, { key: "background", label: "Background check recorded", status: "outstanding" }, { key: "availability", label: "Availability confirmed", status: "done" }], responsible: "Owner A", nextAction: "Record the background check", dueAt: T + 3 * DAY, status: "open", cleanerId: "cl1", workerStatus: "onboarding", dispatchReady: false },
  ];
}

const html = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <CompanyProvider company={{ companyId: "c" as never, name: "Alpha Cleaning", timezone: "America/Chicago", role: "owner" }}>{node}</CompanyProvider>,
  );

/** Writes each screen to a file when VISUAL_OUT is set, so it can be looked at with the built styles. */
function keep(name: string, markup: string) {
  const out = process.env.VISUAL_OUT;
  if (out) writeFileSync(`${out}/${name}.html`, markup);
}

describe("Recruiter's screens", () => {
  it("the overview shows the pipeline, who acts next, the inbox and Dispatch's requests", () => {
    fill();
    const page = html(<RecruiterOverviewScreen />);
    keep("overview", page);
    for (const text of ["Hiring pipeline", "Inbox", "Screening", "Onboarding", "Needs you · 1", "Recruiter is on it", "Waiting on applicants · 1", "Watching hiring@alpha-cleaning.test", "Two cleaners needed for Saturday", "1 applicant is waiting for your decision."]) expect(page, text).toContain(text);
  });

  it("an applicant opens with the journey and how Recruiter read them, with sources", () => {
    fill();
    search = "open=a2";
    const page = html(<ApplicantsScreen />);
    keep("applicants", page);
    search = "";
    for (const text of ["Dana Cole", "How Recruiter got here", "Found in the hiring inbox (Indeed)", "Read by the AI reader", "Recruiter suggests an interview", "Dana-Cole-resume.pdf", "not verified", "Hand back to Recruiter", "A person decides every decline."]) expect(page, text).toContain(text);
  });

  it("screening shows each criterion with the applicant's words, and a person decides", () => {
    fill();
    const page = html(<ScreeningScreen />);
    keep("screening", page);
    for (const text of ["Recruiter&#x27;s reading", "Has reliable transportation", "“I have my own car”", "fixed requirement", "Needs clarification", "Invite to interview", "Decline"]) expect(page, text).toContain(text);
    expect(page).not.toMatch(/score/i);
  });

  it("interviews, offers and onboarding show where each one stands", () => {
    fill();
    const interviews = html(<InterviewsScreen />);
    const offers = html(<OffersScreen />);
    const needs = html(<HiringNeedsScreen />);
    keep("interviews", interviews);
    keep("offers", offers);
    keep("hiring-needs", needs);
    for (const text of ["Waiting for times", "Booked", "Lee Wong", "Open time", "Offer interview times"]) expect(interviews, text).toContain(text);
    for (const text of ["Ava Chen", "Accepted", "Agreement: not started", "Noah Kim", "Not ready yet", "Background check recorded"]) expect(offers, text).toContain(text);
    for (const text of ["House Cleaner", "1/3", "$22 an hour", "Deep-Clean Specialist", "Paused", "Required: "]) expect(needs, text).toContain(text);
  });
});
