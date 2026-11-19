/**
 * The public page for each of the eight agents: what it is responsible for, a worked example the page plays,
 * what it handles, what it always brings back to the owner, and who it hands work to. The four working
 * agents describe only what the product does today (checked against AGENT_PROFILES by the content test);
 * the four coming-soon agents use the same words as their in-app coming-soon pages (src/lib/app/coming-soon.ts).
 * Every name, price and time in an example is made up, and the page says so.
 */
import type { MockKind, SceneSpec } from "@/components/agents/scene";
import { COMING_SOON } from "@/lib/app/coming-soon";

export const AGENT_PAGE_IDS = ["sales", "recruiter", "dispatch", "retention", "marketing", "quality", "customer-care", "team-coordinator"] as const;
export type AgentPageId = (typeof AGENT_PAGE_IDS)[number];

export type AgentPage = {
  id: AgentPageId;
  name: string;
  department: "Growth" | "Operations" | "Team";
  status: "live" | "coming_soon";
  /** Short line for cards and the page title. */
  headline: string;
  pitch: string;
  scene: SceneSpec;
  capabilities: { title: string; detail: string; mock: MockKind }[];
  /** What it always brings back to a person instead of deciding itself. */
  bringsToYou: string[];
  /** Agents it hands work to or takes work from. */
  handoffs: { agent: AgentPageId; what: string }[];
  plan: string;
};

const LIVE: AgentPage[] = [
  {
    id: "sales",
    name: "Sales",
    department: "Growth",
    status: "live",
    headline: "Keep the next booking moving.",
    pitch: "Answers new inquiries by text and email, asks only what your price needs, quotes from your own services, follows up until there's an answer, and books the time the customer chooses around your capacity.",
    scene: {
      trigger: { title: "Text from a new customer", detail: "“How much for a 3 bed, 2 bath clean? We're in 78701.”" },
      work: ["Asks only what your price needs", "Prices it from your published services", "Sends a quote the customer can accept online"],
      outcomes: [
        { title: "Quote sent: $185.00", detail: "With a private link to accept" },
        { title: "Customer accepts and picks a time", detail: "From times you can actually staff" },
        { title: "Booking confirmed", detail: "Handed to Dispatch to cover" },
      ],
    },
    capabilities: [
      { title: "Every inquiry answered", detail: "Texts and emails get a reply and a clear next step, in your company's voice.", mock: "chat" },
      { title: "Quotes from your own pricing", detail: "Prices come from the services and rules you publish, not guesses.", mock: "offer" },
      { title: "Follow-ups that stop on time", detail: "Reminders go out on your schedule and stop the moment the customer answers or says no.", mock: "list" },
      { title: "A pipeline you can see", detail: "Every opportunity, its stage and its next step, from first message to booked.", mock: "pipeline" },
    ],
    bringsToYou: ["A discount beyond the limit you set", "A request outside your services or service area", "Its first messages, for one review before it works on its own"],
    handoffs: [
      { agent: "dispatch", what: "Confirmed bookings, to staff and cover" },
      { agent: "retention", what: "New customers, once the first clean is done" },
    ],
    plan: "Included in Operate and Expand.",
  },
  {
    id: "recruiter",
    name: "Recruiter",
    department: "Team",
    status: "live",
    headline: "Build the team your schedule needs.",
    pitch: "Works your hiring inbox: reads applications against your requirements, invites good fits to finish applying, schedules interviews from your open times, and prepares offers for your approval.",
    scene: {
      trigger: { title: "New application in your hiring inbox", detail: "Maria · 3 years residential experience" },
      work: ["Checks it against your requirements", "Invites her to finish the application", "Books an interview from your open times"],
      outcomes: [
        { title: "Interview booked", detail: "Thursday 2pm, reminders sent" },
        { title: "Offer prepared", detail: "Sent after your approval" },
        { title: "Accepted and handed over", detail: "Onboarding starts" },
      ],
    },
    capabilities: [
      { title: "A hiring inbox that sorts itself", detail: "Applications from email and your apply page land in one place, read and filed.", mock: "list" },
      { title: "Screening against your requirements", detail: "Experience, availability, area and documents, checked the same way for everyone.", mock: "checklist" },
      { title: "Interviews scheduled for you", detail: "Applicants pick from your open times; reminders go out so fewer people miss them.", mock: "week" },
      { title: "Offers and agreements", detail: "Prepared from your terms, sent only once you approve, and tracked to signature.", mock: "progress" },
    ],
    bringsToYou: ["Every hiring decision", "Every offer, before it is sent", "Every decline, before the applicant hears it"],
    handoffs: [
      { agent: "team-coordinator", what: "New cleaners, for onboarding (when released)" },
      { agent: "dispatch", what: "Cleaners who are ready to be offered work" },
    ],
    plan: "Included in Operate and Expand.",
  },
  {
    id: "dispatch",
    name: "Dispatch",
    department: "Operations",
    status: "live",
    headline: "Give every job a clear plan.",
    pitch: "Matches booked work with the cleaners who can do it, texts offers they accept from their phone, finds a replacement when someone drops, and follows each visit live until it's done.",
    scene: {
      trigger: { title: "Tomorrow's 9am has no cleaner", detail: "14 Oak Ave · 3 hours · recurring" },
      work: ["Ranks available cleaners by your rules", "Texts the best match an offer with a link", "Moves to the next if there's no answer in time"],
      outcomes: [
        { title: "Rosa accepted from her phone", detail: "One tap on the link" },
        { title: "Visit covered", detail: "The schedule updates itself" },
        { title: "Followed live tomorrow", detail: "Check-in, photos, done" },
      ],
    },
    capabilities: [
      { title: "Offers in the right order", detail: "Distance, skills, hours and your preferences decide who is asked first.", mock: "rank" },
      { title: "Accepted from a text", detail: "Cleaners accept, decline or report a delay from a link. No app to install.", mock: "chat" },
      { title: "Coverage you can trust", detail: "Gaps are found early and filled before they become a customer's problem.", mock: "calendar" },
      { title: "Live jobs", detail: "See who is on the way, on site and finished, with exceptions raised to you.", mock: "progress" },
    ],
    bringsToYou: ["Pay above the limits you set", "A gap it can't fill in time", "Anything that changes what a customer was promised"],
    handoffs: [
      { agent: "sales", what: "Takes confirmed bookings from Sales" },
      { agent: "retention", what: "Correction visits Retention arranges" },
    ],
    plan: "Included in Operate and Expand.",
  },
  {
    id: "retention",
    name: "Retention",
    department: "Growth",
    status: "live",
    headline: "Give customers a reason to stay.",
    pitch: "Notices when a customer relationship needs attention, follows a concern through to an outcome the customer confirms, keeps recurring plans running, and reconnects with customers who've gone quiet.",
    scene: {
      trigger: { title: "Customer reply after a clean", detail: "“The shower wasn't cleaned.”" },
      work: ["Opens a case and checks the visit's checklist", "Proposes a correction visit for your approval", "Asks the customer to confirm it's fixed"],
      outcomes: [
        { title: "Correction booked", detail: "Handed to Dispatch" },
        { title: "Customer confirms: fixed", detail: "From their link" },
        { title: "Case closed as resolved", detail: "Recorded as it actually ended" },
      ],
    },
    capabilities: [
      { title: "Concerns followed to the end", detail: "Every complaint becomes a case with a next step, until the customer confirms the outcome.", mock: "list" },
      { title: "Recurring plans kept running", detail: "Customers skip, pause or change a visit from their own link, within your rules.", mock: "week" },
      { title: "Renewals prepared on time", detail: "Agreements coming up for renewal are prepared from their real dates, for you to decide.", mock: "calendar" },
      { title: "Quiet customers reconnected", detail: "Former customers who may be contacted get a return offer you approve, never a discount you didn't set.", mock: "offer" },
    ],
    bringsToYou: ["Any safety or damage concern", "A correction that costs you money", "A price change on a recurring plan"],
    handoffs: [
      { agent: "dispatch", what: "Correction visits to schedule" },
      { agent: "sales", what: "Customers ready for a recurring plan" },
    ],
    plan: "Included in Operate and Expand.",
  },
];

const HANDOFFS: Record<"marketing" | "quality" | "customer-care" | "team-coordinator", AgentPage["handoffs"]> = {
  marketing: [{ agent: "sales", what: "New inquiries its campaigns bring in" }],
  quality: [
    { agent: "dispatch", what: "Re-clean visits to schedule" },
    { agent: "retention", what: "Issues a customer reported" },
  ],
  "customer-care": [
    { agent: "dispatch", what: "Schedule changes to staff" },
    { agent: "retention", what: "Concerns that need a follow-through" },
  ],
  "team-coordinator": [
    { agent: "recruiter", what: "New hires, once their offer is signed" },
    { agent: "dispatch", what: "Cleaners who are ready for jobs" },
  ],
};

const SOON: AgentPage[] = (["marketing", "quality", "customer-care", "team-coordinator"] as const).map((id) => {
  const soon = COMING_SOON[id];
  return {
    id,
    name: soon.name,
    department: soon.department as AgentPage["department"],
    status: "coming_soon" as const,
    headline: soon.capabilities[0].title,
    pitch: soon.pitch,
    scene: soon.scene,
    capabilities: soon.capabilities.map(({ title, detail, mock }) => ({ title, detail, mock })),
    bringsToYou: ["Anything outside the permissions you set", "Every decision that costs you money"],
    handoffs: HANDOFFS[id],
    plan: "Included in Expand when it's released.",
  };
});

export const AGENT_PAGES: Record<AgentPageId, AgentPage> = Object.fromEntries([...LIVE, ...SOON].map((page) => [page.id, page])) as Record<AgentPageId, AgentPage>;

export const agentPagePath = (id: AgentPageId) => `/agents/${id}`;

export function agentPage(id: string): AgentPage | null {
  return (AGENT_PAGE_IDS as readonly string[]).includes(id) ? AGENT_PAGES[id as AgentPageId] : null;
}
